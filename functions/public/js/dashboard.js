// CourtVision analytics dashboard - ported from `main`'s public/dashboard.html.
// Originally this read/wrote Firestore directly from the browser; it now
// talks to this app's own /api/games endpoints instead (backed by
// PostgreSQL - see models/database.js), scoped automatically by the
// logged-in user's session, same as the Team/Game features. The CSV
// parsing and season-analytics/insights logic below is otherwise unchanged.

// Interactive View Controller Tab Switcher. Wired via addEventListener below
// rather than inline onclick="" attributes (main used those, but this app's
// CSP script-src has no 'unsafe-inline', so inline handlers are blocked).
function switchIngestMode(mode) {
    const csvBtn = document.getElementById("tab-csv-btn");
    const manualBtn = document.getElementById("tab-manual-btn");
    const csvWrapper = document.getElementById("wrapper-csv-ingest");
    const manualWrapper = document.getElementById("wrapper-manual-ingest");

    if (mode === 'csv') {
        csvBtn.classList.add("active");
        manualBtn.classList.remove("active");
        csvWrapper.style.display = "block";
        manualWrapper.style.display = "none";
    } else {
        manualBtn.classList.add("active");
        csvBtn.classList.remove("active");
        manualWrapper.style.display = "block";
        csvWrapper.style.display = "none";
    }
    document.getElementById("upload-status").innerText = "";
}

document.getElementById("tab-csv-btn").addEventListener("click", () => switchIngestMode('csv'));
document.getElementById("tab-manual-btn").addEventListener("click", () => switchIngestMode('manual'));

// CSV format selector (Individual Athlete Stats vs Team Stats) - matches the
// two ingestion scripts a contributor provided (public/py/*_ingestion.py)
// and the advanced-metrics schema ported from their archetec.sql (see
// models/database.js's game_records/players/player_stats/game_stats
// tables). Whichever button is active determines how the file picker below
// parses and ingests the CSV (see the file-picker change handler).
const csvTypeIndividualBtn = document.getElementById("csv-type-individual-btn");
const csvTypeTeamBtn = document.getElementById("csv-type-team-btn");
let selectedCsvType = "individual";

function setCsvType(type) {
    selectedCsvType = type;
    csvTypeIndividualBtn.classList.toggle("active", type === "individual");
    csvTypeTeamBtn.classList.toggle("active", type === "team");
}

csvTypeIndividualBtn.addEventListener("click", () => setCsvType("individual"));
csvTypeTeamBtn.addEventListener("click", () => setCsvType("team"));

// MY_TEAM_NAME in the original ingestion scripts was a hardcoded config
// constant at the top of the file; here it's just remembered in
// localStorage between uploads so the coach doesn't have to retype it.
const MY_TEAM_NAME_STORAGE_KEY = "dsPracticumMyTeamName";
const myTeamNameInput = document.getElementById("my-team-name-input");
(function restoreMyTeamName() {
    try {
        const stored = window.localStorage.getItem(MY_TEAM_NAME_STORAGE_KEY);
        if (stored) myTeamNameInput.value = stored;
    } catch (e) {
        // localStorage unavailable (private browsing, etc.) - no-op.
    }
})();
myTeamNameInput.addEventListener("change", () => {
    try {
        window.localStorage.setItem(MY_TEAM_NAME_STORAGE_KEY, myTeamNameInput.value.trim());
    } catch (e) {
        // no-op
    }
});

// Parses the "YYYY-M-D_TeamA_vs_TeamB..." filename convention both
// ingestion scripts relied on (month is zero-indexed, matching the
// scripts' `int(month_zero_indexed) + 1`).
function parseGameFilename(filename) {
    const match = filename.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ _](.+?)[ _]vs[ _](.+?)[ _]/);
    if (!match) return null;

    const [, year, monthZeroIndexed, day, teamA, teamB] = match;
    const gameMonth = parseInt(monthZeroIndexed, 10) + 1;
    const gameDate = `${year}-${String(gameMonth).padStart(2, "0")}-${String(parseInt(day, 10)).padStart(2, "0")}`;

    return { gameDate, teamA, teamB };
}

function mapRowColumns(row, columnMap) {
    const mapped = {};
    Object.keys(columnMap).forEach((csvCol) => {
        mapped[columnMap[csvCol]] = row[csvCol];
    });
    return mapped;
}

document.getElementById("csv-file-picker").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById("upload-status").style.color = "#ff6600";
    document.getElementById("upload-status").innerText = `Executing ingestion engine logic on ${file.name}...`;

    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function (results) {
            if (selectedCsvType === "team") {
                processTeamStatsCsv(results.data, file.name);
            } else {
                processIndividualAthleteCsv(results.data, file.name);
            }
        }
    });
});

// Team Stats CSV - mirrors public/py/gameStats_ingestion.py: one row each
// for "my" team and the opponent (told apart by the "Team" column matching
// My Team Name above), keyed to a game by date + opponent parsed from the
// filename.
const GAME_STATS_COLUMN_MAP = {
    "Points": "points",
    "1": "q1_points",
    "2": "q2_points",
    "3": "q3_points",
    "4": "q4_points",
    "OT": "ot_points",
    "FG Made": "fgm",
    "FG Attempts": "fga",
    "FG%": "fg_pct",
    "3FG Made": "tpm",
    "3FG Att": "tpa",
    "3FG%": "tp_pct",
    "FT Made": "ftm",
    "FT Att": "fta",
    "FT%": "ft_pct",
    "Offensive Rebounds": "off_rebounds",
    "Defensive Rebounds": "def_rebounds",
    "Rebounds": "rebounds",
    "Assists": "assists",
    "Steals": "steals",
    "Blocks": "blocks",
    "Turnovers": "turnovers",
    "Fouls": "fouls",
    "True Shooting%": "ts_pct",
    "Effective Field Goal%": "efg_pct",
    "Offensive Rebounding%": "oreb_pct",
    "Defensive Rebounding%": "dreb_pct",
    "AST-TO Ratio": "ast_to_ratio",
    "Turnover%": "to_pct",
    "Off Rating": "off_rating",
    "Def Rating": "def_rating",
};

async function processTeamStatsCsv(rows, filename) {
    const status = document.getElementById("upload-status");
    const myTeamName = myTeamNameInput.value.trim();

    if (!myTeamName) {
        status.innerHTML = `<span style="color: #ff3333;">Enter your team name above before uploading a Team Stats CSV.</span>`;
        return;
    }

    const parsed = parseGameFilename(filename);
    if (!parsed) {
        status.innerHTML = `<span style="color: #ff3333;">Filename must match the pattern YYYY-M-D_TeamA_vs_TeamB... (e.g. 2026-1-9_Allen Park_vs_Melvindale.csv).</span>`;
        return;
    }

    const { gameDate, teamA, teamB } = parsed;
    let opponent, location;
    if (teamA === myTeamName) {
        location = "Away";
        opponent = teamB;
    } else if (teamB === myTeamName) {
        location = "Home";
        opponent = teamA;
    } else {
        status.innerHTML = `<span style="color: #ff3333;">"${myTeamName}" wasn't found in the filename matchup (${teamA} vs ${teamB}).</span>`;
        return;
    }

    let teamRow = null;
    let opponentRow = null;
    rows.forEach((row) => {
        const mapped = mapRowColumns(row, GAME_STATS_COLUMN_MAP);
        if (row["Team"] === myTeamName) {
            teamRow = mapped;
        } else {
            opponentRow = mapped;
        }
    });

    if (!teamRow || !opponentRow) {
        status.innerHTML = `<span style="color: #ff3333;">Couldn't find both team rows - check the CSV's "Team" column values.</span>`;
        return;
    }

    try {
        const response = await fetch('/api/advanced-stats/game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameDate, opponent, location, teamStats: teamRow, opponentStats: opponentRow }),
        });
        const data = await response.json();

        if (!response.ok) {
            status.innerHTML = `<span style="color: #ff3333;">${data.error || 'Something went wrong ingesting team stats.'}</span>`;
            return;
        }

        status.innerHTML = `<span style="color: #4ade80;">Team Stats ingested for game vs ${opponent} (${gameDate}).</span>`;
    } catch (error) {
        console.error("Team stats ingestion error:", error);
        status.innerHTML = `<span style="color: #ff3333;">Something went wrong ingesting team stats.</span>`;
    }
}

// Individual Athlete Stats CSV - mirrors public/py/playerStats_ingestion.py:
// per-player rows attached to a game that must already exist (the Team
// Stats CSV for this game needs to be uploaded first), same ordering
// dependency as the original scripts.
const PLAYER_STATS_COLUMN_MAP = {
    "Basic:PTS": "points",
    "Basic:FGM": "fgm",
    "Basic:FGA": "fga",
    "Basic:FG%": "fg_pct",
    "Basic:3FGM": "tpm",
    "Basic:3FGA": "tpa",
    "Basic:3FG%": "tp_pct",
    "Basic:FTM": "ftm",
    "Basic:FTA": "fta",
    "Basic:FT%": "ft_pct",
    "Basic:ORB": "off_rebounds",
    "Basic:DRB": "def_rebounds",
    "Basic:TRB": "rebounds",
    "Basic:AST": "assists",
    "Basic:STL": "steals",
    "Basic:BLK": "blocks",
    "Basic:TO": "turnovers",
    "Basic:PF": "fouls",
    "Advanced:ORB%": "oreb_pct",
    "Advanced:DRB%": "dreb_pct",
    "Advanced:TRB%": "treb_pct",
    "Advanced:AST%": "ast_pct",
    "Advanced:AST/TO": "ast_to_ratio",
    "Advanced:TO-Ratio": "to_ratio",
    "Advanced:USG%": "usg_pct",
    "Advanced:Ch.-Drawn": "charges_drawn",
    "Shooting:TS%": "ts_pct",
    "Shooting:eFG%": "efg_pct",
};

// "MM:SS" -> total seconds.
function mpToSeconds(mpStr) {
    const parts = String(mpStr).split(":");
    if (parts.length !== 2) return null;
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return Number.isNaN(minutes) || Number.isNaN(seconds) ? null : minutes * 60 + seconds;
}

// Strips a leading apostrophe some spreadsheet tools add to force a
// negative-looking number to stay text (e.g. "'-5").
function cleanPlusMinus(value) {
    const parsed = parseInt(String(value).replace(/^'/, ""), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

async function processIndividualAthleteCsv(rows, filename) {
    const status = document.getElementById("upload-status");
    const myTeamName = myTeamNameInput.value.trim();

    if (!myTeamName) {
        status.innerHTML = `<span style="color: #ff3333;">Enter your team name above before uploading an Individual Athlete Stats CSV.</span>`;
        return;
    }

    const parsed = parseGameFilename(filename);
    if (!parsed) {
        status.innerHTML = `<span style="color: #ff3333;">Filename must match the pattern YYYY-M-D_TeamA_vs_TeamB... (e.g. 2026-0-21_Melvindale_vs_Romulus.csv).</span>`;
        return;
    }

    const { gameDate, teamA, teamB } = parsed;
    const opponent = teamA === myTeamName ? teamB : teamA;

    // The opponent's players show up in the same export, auto-named
    // "{Opponent}_# Player" - filter those out, same as the Python script.
    const myPlayerRows = rows.filter((row) => !String(row["Athlete"] || "").startsWith(`${opponent}_`));

    if (myPlayerRows.length === 0) {
        status.innerHTML = `<span style="color: #ffcc00;">Warning: found 0 player rows after filtering out the opponent. Verify the CSV's "Athlete" column.</span>`;
        return;
    }

    const players = myPlayerRows.map((row) => {
        const stats = mapRowColumns(row, PLAYER_STATS_COLUMN_MAP);
        stats.mp = mpToSeconds(row["Basic:MP"]);
        stats.plus_minus = cleanPlusMinus(row["Advanced:+/-"]);
        return { name: row["Athlete"], playerNumber: Number(row["#"]), stats };
    });

    try {
        const response = await fetch('/api/advanced-stats/players', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameDate, opponent, players }),
        });
        const data = await response.json();

        if (!response.ok) {
            status.innerHTML = `<span style="color: #ff3333;">${data.error || 'Something went wrong ingesting player stats.'}</span>`;
            return;
        }

        status.innerHTML = `<span style="color: #4ade80;">Ingested stats for ${players.length} player(s) vs ${opponent} (${gameDate}).</span>`;
    } catch (error) {
        console.error("Player stats ingestion error:", error);
        status.innerHTML = `<span style="color: #ff3333;">Something went wrong ingesting player stats.</span>`;
    }
}

// Direct Individual Form Manual Upload Processing Logic
async function executeManualUpload(event) {
    event.preventDefault();
    document.getElementById("upload-status").style.color = "#ff6600";
    document.getElementById("upload-status").innerText = "Injecting custom data profile record...";

    try {
        const nameVal = document.getElementById("m-name").value.trim();

        const players = [{
            playerName: nameVal,
            minutes: Number(document.getElementById("m-min").value) || 0,
            points: Number(document.getElementById("m-pts").value) || 0,
            assists: Number(document.getElementById("m-ast").value) || 0,
            rebounds: Number(document.getElementById("m-reb").value) || 0,
            steals: Number(document.getElementById("m-stl").value) || 0,
            blocks: Number(document.getElementById("m-blk").value) || 0,
            turnovers: Number(document.getElementById("m-to").value) || 0,
            fgm: Number(document.getElementById("m-fgm").value) || 0,
            fga: Number(document.getElementById("m-fga").value) || 0,
            tpm: Number(document.getElementById("m-tpm").value) || 0,
        }];

        const result = await postGame(`Manual: ${nameVal}`, players);

        if (!result.ok) {
            document.getElementById("upload-status").innerHTML = `<span style="color: #ff3333;">${result.error}</span>`;
            return;
        }

        document.getElementById("upload-status").innerHTML = `<span style="color: #00ff66;">Manual Entry Captured Successfully!</span>`;
        document.getElementById("manual-stats-form").reset();
        loadSeasonAnalytics();

    } catch (error) {
        console.error(error);
        document.getElementById("upload-status").innerHTML = `<span style="color: #ff3333;">Entry capturing failed.</span>`;
    }
}

document.getElementById("manual-stats-form").addEventListener("submit", executeManualUpload);

async function postGame(sourceFile, players) {
    const response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFile, players }),
    });

    const data = await response.json();
    if (!response.ok) {
        return { ok: false, error: data.error || 'Something went wrong.' };
    }
    return { ok: true, data };
}

// Dynamic Game Removal Engine - operates on the CSV-ingested game_records
// table (see models/database.js), not the separate games table the Game
// page's live stat-logging and Manual Entry form write to.
async function deleteGameRecord(gameId, displayTitle) {
    if (!confirm(`Are you absolutely sure you want to delete data logs for [ ${displayTitle} ]?`)) return;

    try {
        const response = await fetch(`/api/advanced-stats/games/${gameId}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
            throw new Error(`Delete failed with status ${response.status}`);
        }

        alert("Game statistics completely scrubbed!");
        loadSeasonAnalytics();
    } catch (err) {
        console.error("Error executing game delete pipeline:", err);
    }
}

// Event delegation instead of inline onclick="" on the dynamically-rendered
// "Remove" buttons (see loadSeasonAnalytics below).
document.getElementById("game-management-body").addEventListener("click", (event) => {
    const btn = event.target.closest(".delete-btn");
    if (!btn) return;
    deleteGameRecord(btn.dataset.gameId, btn.dataset.sourceFile);
});

// Sortable "Two-Way Roster Analytics" table. currentRosterRows holds the
// last-computed season averages as plain numbers (see loadSeasonAnalytics);
// clicking a column header re-sorts and re-renders that array in place,
// with no re-fetch needed.
let currentRosterRows = [];
let rosterSort = { key: null, direction: "asc" };

function renderRosterRows(rows) {
    const tbody = document.getElementById("roster-trends-body");
    tbody.innerHTML = "";

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="padding: 20px; text-align: center; color: #9aa5b5; font-style: italic;">No season data found.</td></tr>`;
        return;
    }

    rows.forEach((row) => {
        let momentumBadge = `<span style="color: #9aa5b5; font-weight: bold;">${row.momentumScore > 0 ? '+' : ''}${row.momentumScore}</span>`;
        if (row.momentumScore >= 0.5) {
            momentumBadge = `<span style="background: rgba(0, 255, 102, 0.15); color: #00ff66; padding: 4px 8px; border-radius: 4px; font-weight: bold;">🔥 +${row.momentumScore}</span>`;
        } else if (row.momentumScore <= -0.5) {
            momentumBadge = `<span style="background: rgba(255, 51, 51, 0.15); color: #ff3333; padding: 4px 8px; border-radius: 4px; font-weight: bold;">📉 ${row.momentumScore}</span>`;
        }

        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid #283141;">
                <td style="padding: 12px 4px; font-weight: 600; color: white;">${row.name}</td>
                <td style="padding: 12px 4px; text-align: center; color: #9aa5b5;">${row.games}</td>
                <td style="padding: 12px 4px; text-align: center; color: white;">${row.avgMin.toFixed(1)}</td>
                <td style="padding: 12px 4px; text-align: center; color: white;">${row.avgPts.toFixed(1)}</td>
                <td style="padding: 12px 4px; text-align: center; color: white;">${row.avgAst.toFixed(1)}</td>
                <td style="padding: 12px 4px; text-align: center; color: white;">${row.avgReb.toFixed(1)}</td>
                <td style="padding: 12px 4px; text-align: center; color: #00ff66;">${row.avgStl.toFixed(1)}</td>
                <td style="padding: 12px 4px; text-align: center; color: #00ff66;">${row.avgBlk.toFixed(1)}</td>
                <td style="padding: 12px 4px; text-align: center; color: #ff3333;">${row.avgTo.toFixed(1)}</td>
                <td style="padding: 12px 4px; text-align: center; color: #00ff66; font-weight: 600;">${row.eFG.toFixed(1)}%</td>
                <td style="padding: 12px 4px; text-align: right;">${momentumBadge}</td>
            </tr>
        `;
    });
}

function updateSortIndicators() {
    document.querySelectorAll(".sortable-th").forEach((th) => {
        const arrow = th.querySelector(".sort-arrow");
        if (!arrow) return;
        arrow.textContent = th.dataset.sortKey === rosterSort.key ? (rosterSort.direction === "asc" ? " ▲" : " ▼") : "";
    });
}

function applyCurrentRosterSort() {
    const rows = currentRosterRows.slice();
    if (rosterSort.key) {
        rows.sort((a, b) => {
            const key = rosterSort.key;
            const cmp = key === "name" ? a.name.localeCompare(b.name) : a[key] - b[key];
            return rosterSort.direction === "asc" ? cmp : -cmp;
        });
    }
    renderRosterRows(rows);
    updateSortIndicators();
}

document.querySelectorAll(".sortable-th").forEach((th) => {
    th.addEventListener("click", () => {
        const key = th.dataset.sortKey;
        if (rosterSort.key === key) {
            rosterSort.direction = rosterSort.direction === "asc" ? "desc" : "asc";
        } else {
            rosterSort.key = key;
            rosterSort.direction = "asc";
        }
        applyCurrentRosterSort();
    });
});

// Aggregation and advanced calculation framework loop - reads only from the
// CSV-ingested game_records/player_stats tables (via /api/advanced-stats/*),
// so this view only ever reflects uploaded CSVs, never the Game page's live
// stat-logging or the Manual Entry form above (both of which still write to
// the separate games/player_box_scores tables - see controllers/api/games.js).
async function loadSeasonAnalytics() {
    try {
        const [gamesResponse, playerStatsResponse] = await Promise.all([
            fetch('/api/advanced-stats/games'),
            fetch('/api/advanced-stats/player-stats'),
        ]);
        const { games } = await gamesResponse.json();
        const { playerStats: boxScores } = await playerStatsResponse.json();

        // Sync Audit Panel
        const mgmtBody = document.getElementById("game-management-body");
        mgmtBody.innerHTML = "";

        games.forEach((game) => {
            const sourceFile = `${game.opponent} (${game.gameDate ? game.gameDate.slice(0, 10) : 'unknown date'})`;
            mgmtBody.innerHTML += `
                <tr style="border-bottom: 1px solid #1a222d;">
                    <td style="padding: 8px 6px; color: #ffffff; font-weight: 500;">${sourceFile}</td>
                    <td style="padding: 8px 6px; text-align: right;">
                        <button class="delete-btn" data-game-id="${game.id}" data-source-file="${sourceFile}">🗑️ Remove</button>
                    </td>
                </tr>
            `;
        });

        if (games.length === 0) {
            mgmtBody.innerHTML = `<tr><td colspan="2" style="padding: 15px; text-align: center; color: #5f7597; font-style: italic;">No games logged in database.</td></tr>`;
        }

        // Process Box Scores
        const playerMap = {};

        boxScores.forEach((data) => {
            const name = data.playerName;

            if (!playerMap[name]) {
                playerMap[name] = { name: name, games: 0, min: 0, pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, to: 0, fgm: 0, fga: 0, tpm: 0, gamePointsArray: [] };
            }

            playerMap[name].games += 1;
            playerMap[name].min += Number(data.minutes) || 0;
            playerMap[name].pts += Number(data.points) || 0;
            playerMap[name].ast += Number(data.assists) || 0;
            playerMap[name].reb += Number(data.rebounds) || 0;
            playerMap[name].stl += Number(data.steals) || 0;
            playerMap[name].blk += Number(data.blocks) || 0;
            playerMap[name].to += Number(data.turnovers) || 0;
            playerMap[name].fgm += Number(data.fgm) || 0;
            playerMap[name].fga += Number(data.fga) || 0;
            playerMap[name].tpm += Number(data.tpm) || 0;

            playerMap[name].gamePointsArray.push({ gameId: data.gameId, pts: Number(data.points) || 0 });
        });

        const playersArray = Object.values(playerMap);
        if (playersArray.length === 0) {
            currentRosterRows = [];
            document.getElementById("roster-trends-body").innerHTML =
                `<tr><td colspan="11" style="padding: 20px; text-align: center; color: #9aa5b5; font-style: italic;">No season data found.</td></tr>`;
            document.getElementById("assistant-card").style.display = "none";
            return;
        }

        // Builds the sortable rows once as plain numbers (not pre-formatted
        // strings) so re-sorting later doesn't need to re-fetch or re-parse
        // anything - see renderRosterRows/applyCurrentRosterSort below.
        currentRosterRows = playersArray.map((player) => {
            const avgPts = player.pts / player.games;

            let momentumScore = 0;
            if (player.gamePointsArray.length >= 2) {
                player.gamePointsArray.sort((a, b) => a.gameId - b.gameId);
                const recentAvg = (Number(player.gamePointsArray[player.gamePointsArray.length - 1].pts) + Number(player.gamePointsArray[player.gamePointsArray.length - 2].pts)) / 2;
                momentumScore = parseFloat((recentAvg - avgPts).toFixed(1));
            }

            return {
                name: player.name,
                games: player.games,
                avgMin: player.min / 60 / player.games, // player.min is stored in seconds
                avgPts,
                avgAst: player.ast / player.games,
                avgReb: player.reb / player.games,
                avgStl: player.stl / player.games,
                avgBlk: player.blk / player.games,
                avgTo: player.to / player.games,
                eFG: player.fga > 0 ? ((player.fgm + (0.5 * player.tpm)) / player.fga) * 100 : 0,
                momentumScore,
            };
        });

        applyCurrentRosterSort();

        // Multi-Variable Tactical Insights Engine Sync
        const assistantCard = document.getElementById("assistant-card");
        const assistantText = document.getElementById("assistant-recommendation");
        let insightsHtml = "";

        playersArray.forEach((p) => {
            let mScore = 0;
            if (p.gamePointsArray.length >= 2) {
                p.gamePointsArray.sort((a, b) => a.gameId - b.gameId);
                const recentAvg = (Number(p.gamePointsArray[p.gamePointsArray.length - 1].pts) + Number(p.gamePointsArray[p.gamePointsArray.length - 2].pts)) / 2;
                mScore = recentAvg - (p.pts / p.games);
            }

            const avgPts = (p.pts / p.games);
            const avgReb = (p.reb / p.games);
            const avgBlk = (p.blk / p.games);
            const eFG = p.fga > 0 ? ((p.fgm + (0.5 * p.tpm)) / p.fga) : 0;

            // Condition 1: Momentum Hot Streak Trigger
            if (mScore >= 0.5) {
                insightsHtml += `<div style="margin-bottom: 12px;"><strong>🔥 Lineup Optimization Alert:</strong> ${p.name} is surging with an offensive momentum score of <strong>+${mScore.toFixed(1)} PPG</strong> over the last two matchups. Consider expanding tactical sets to leverage this hot streak.</div>`;
            }

            // Condition 2: High-Impact Defensive Anchor Spotlight
            if (avgBlk >= 2.0 || avgReb >= 8.0) {
                insightsHtml += `<div style="margin-bottom: 12px; border-top: 1px solid rgba(255,102,0,0.2); padding-top: 12px;"><strong>🛡️ Defensive Anchor Spotlight:</strong> ${p.name} is completely anchoring the paint, averaging <strong>${avgReb.toFixed(1)} RPG</strong> and <strong>${avgBlk.toFixed(1)} BPG</strong>. Ensure defensive rotations funnel opponents toward his help-side positioning.</div>`;
            }

            // Condition 3: High-Volume Scoring Efficiency Elite Metric
            if (avgPts >= 20.0 && eFG >= 0.60) {
                insightsHtml += `<div style="margin-bottom: 12px; border-top: 1px solid rgba(255,102,0,0.2); padding-top: 12px;"><strong>🎯 Elite Efficiency Notice:</strong> ${p.name} is executing at a high-volume, elite efficiency clip (<strong>${avgPts.toFixed(1)} PPG</strong>, <strong>${(eFG * 100).toFixed(1)}% eFG%</strong>). The offensive blueprint should continue prioritizing high-value touches for him in early transition sets.</div>`;
            }
        });

        if (insightsHtml !== "") {
            assistantCard.style.display = "block";
            assistantText.innerHTML = insightsHtml;
        } else {
            assistantCard.style.display = "block";
            assistantText.innerHTML = `<strong>System Notice:</strong> Ingestion pipelines active. Awaiting secondary historical box scores to generate dynamic automated tactical insights templates.`;
        }
    } catch (err) { console.error(err); }
}

document.getElementById("refresh-data-btn").addEventListener("click", loadSeasonAnalytics);
window.addEventListener("DOMContentLoaded", loadSeasonAnalytics);

// Logout goes through this app's real session (POST /logout) - see
// views/partials/header.ejs for the equivalent control used site-wide.
document.getElementById("logout-trigger-btn").addEventListener("click", () => {
    if (confirm("Log out of CourtVision?")) {
        fetch('/logout', { method: 'POST' }).then(() => { window.location.href = '/'; });
    }
});
