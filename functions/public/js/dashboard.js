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
            processAndUploadStats(results.data, file.name);
        }
    });
});

// Pipeline parsing with fault-tolerant header variations matching tracking formats
async function processAndUploadStats(rows, filename) {
    try {
        const players = [];

        rows.forEach((row) => {
            const playerKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'player');
            const playerVal = playerKey ? row[playerKey] : null;

            if (!playerVal || playerVal.toString().toLowerCase().includes("total")) return;

            const getVal = (headerName) => {
                const key = Object.keys(row).find(k => k.trim().toLowerCase() === headerName.toLowerCase());
                return key ? row[key] : 0;
            };

            const fgm = getVal('fgm');
            const fga = getVal('fga');
            const tpm = getVal('3pm') || getVal('3ptm') || 0;

            players.push({
                playerName: playerVal.toString().trim(),
                minutes: getVal('mp') || getVal('min') || 0,
                points: getVal('pts') || getVal('points') || 0,
                assists: getVal('ast') || getVal('assist') || 0,
                rebounds: getVal('reb') || getVal('rebounds') || 0,
                steals: getVal('stl') || getVal('stls') || 0,
                blocks: getVal('blk') || getVal('blks') || 0,
                turnovers: getVal('to') || getVal('tov') || 0,
                fgm: fgm,
                fga: fga,
                tpm: tpm,
            });
        });

        if (players.length === 0) {
            document.getElementById("upload-status").innerHTML =
                `<span style="color: #ffcc00;">Warning: Found 0 players. Verify CSV headers.</span>`;
            return;
        }

        const result = await postGame(filename, players);

        if (!result.ok) {
            document.getElementById("upload-status").innerHTML =
                `<span style="color: #ff3333;">Pipeline Ingestion Failure: ${result.error}</span>`;
            return;
        }

        document.getElementById("upload-status").innerHTML =
            `<span style="color: #00ff66;">Engine Success: Parsed and stored records for ${players.length} players.</span>`;

        loadSeasonAnalytics();
    } catch (error) {
        console.error("Game upload processing error:", error);
        document.getElementById("upload-status").innerHTML =
            `<span style="color: #ff3333;">Pipeline Ingestion Failure: ${error.message}</span>`;
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

// Dynamic Game Removal Engine
async function deleteGameRecord(gameId, displayTitle) {
    if (!confirm(`Are you absolutely sure you want to delete data logs for [ ${displayTitle} ]?`)) return;

    try {
        const response = await fetch(`/api/games/${gameId}`, { method: 'DELETE' });
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

// Aggregation and advanced calculation framework loop
async function loadSeasonAnalytics() {
    try {
        const [gamesResponse, boxScoresResponse] = await Promise.all([
            fetch('/api/games'),
            fetch('/api/games/box-scores'),
        ]);
        const { games } = await gamesResponse.json();
        const { boxScores } = await boxScoresResponse.json();

        // Sync Audit Panel
        const mgmtBody = document.getElementById("game-management-body");
        mgmtBody.innerHTML = "";

        games.forEach((game) => {
            mgmtBody.innerHTML += `
                <tr style="border-bottom: 1px solid #1a222d;">
                    <td style="padding: 8px 6px; color: #ffffff; font-weight: 500;">${game.sourceFile}</td>
                    <td style="padding: 8px 6px; text-align: right;">
                        <button class="delete-btn" data-game-id="${game.id}" data-source-file="${game.sourceFile}">🗑️ Remove</button>
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

        const tbody = document.getElementById("roster-trends-body");
        tbody.innerHTML = "";

        const playersArray = Object.values(playerMap);
        if (playersArray.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" style="padding: 20px; text-align: center; color: #9aa5b5; font-style: italic;">No season data found.</td></tr>`;
            document.getElementById("assistant-card").style.display = "none";
            return;
        }

        playersArray.forEach((player) => {
            const avgMin = (player.min / player.games).toFixed(1);
            const avgPts = (player.pts / player.games).toFixed(1);
            const avgAst = (player.ast / player.games).toFixed(1);
            const avgReb = (player.reb / player.games).toFixed(1);
            const avgStl = (player.stl / player.games).toFixed(1);
            const avgBlk = (player.blk / player.games).toFixed(1);
            const avgTo = (player.to / player.games).toFixed(1);
            const eFG = player.fga > 0 ? (((player.fgm + (0.5 * player.tpm)) / player.fga) * 100).toFixed(1) + "%" : "0.0%";

            let momentumScore = 0;
            if (player.gamePointsArray.length >= 2) {
                player.gamePointsArray.sort((a, b) => a.gameId - b.gameId);
                const recentAvg = (Number(player.gamePointsArray[player.gamePointsArray.length - 1].pts) + Number(player.gamePointsArray[player.gamePointsArray.length - 2].pts)) / 2;
                momentumScore = parseFloat((recentAvg - parseFloat(avgPts)).toFixed(1));
            }

            let momentumBadge = `<span style="color: #9aa5b5; font-weight: bold;">${momentumScore > 0 ? '+' : ''}${momentumScore}</span>`;
            if (momentumScore >= 0.5) {
                momentumBadge = `<span style="background: rgba(0, 255, 102, 0.15); color: #00ff66; padding: 4px 8px; border-radius: 4px; font-weight: bold;">🔥 +${momentumScore}</span>`;
            } else if (momentumScore <= -0.5) {
                momentumBadge = `<span style="background: rgba(255, 51, 51, 0.15); color: #ff3333; padding: 4px 8px; border-radius: 4px; font-weight: bold;">📉 ${momentumScore}</span>`;
            }

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #283141;">
                    <td style="padding: 12px 4px; font-weight: 600; color: white;">${player.name}</td>
                    <td style="padding: 12px 4px; text-align: center; color: #9aa5b5;">${player.games}</td>
                    <td style="padding: 12px 4px; text-align: center; color: white;">${avgMin}</td>
                    <td style="padding: 12px 4px; text-align: center; color: white;">${avgPts}</td>
                    <td style="padding: 12px 4px; text-align: center; color: white;">${avgAst}</td>
                    <td style="padding: 12px 4px; text-align: center; color: white;">${avgReb}</td>
                    <td style="padding: 12px 4px; text-align: center; color: #00ff66;">${avgStl}</td>
                    <td style="padding: 12px 4px; text-align: center; color: #00ff66;">${avgBlk}</td>
                    <td style="padding: 12px 4px; text-align: center; color: #ff3333;">${avgTo}</td>
                    <td style="padding: 12px 4px; text-align: center; color: #00ff66; font-weight: 600;">${eFG}</td>
                    <td style="padding: 12px 4px; text-align: right;">${momentumBadge}</td>
                </tr>
            `;
        });

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
