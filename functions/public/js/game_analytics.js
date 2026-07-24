// CourtVision game analytics - ported from a contributor's standalone
// views/pages/game_analytics.html. Originally read Firestore directly from
// the browser and had to fuzzy-match manual entries to CSV uploads by
// timestamp proximity; this app's box scores carry a real gameId foreign
// key (see /api/games and /api/games/box-scores, backed by PostgreSQL), so
// filtering by game is a plain equality check.

let scoringChartInstance = null;
let efficiencyChartInstance = null;
let games = [];
let boxScores = [];

async function loadGameAnalytics() {
    try {
        const [gamesResponse, boxScoresResponse] = await Promise.all([
            fetch('/api/games'),
            fetch('/api/games/box-scores'),
        ]);
        ({ games } = await gamesResponse.json());
        ({ boxScores } = await boxScoresResponse.json());

        const dropdown = document.getElementById('game-selector-dropdown');

        if (games.length === 0) {
            dropdown.innerHTML = '<option value="">No Games Logged</option>';
            return;
        }

        dropdown.innerHTML = games.map((game) => `<option value="${game.id}">${game.sourceFile}</option>`).join('');
        dropdown.value = games[games.length - 1].id;
        renderGameMatrix(games[games.length - 1].id);
    } catch (err) {
        console.error('Failed to load game analytics:', err);
    }
}

function renderGameMatrix(selectedGameId) {
    const tbody = document.getElementById('game-matrix-tbody');
    tbody.innerHTML = '';

    const gameId = Number(selectedGameId);
    const rows = boxScores.filter((row) => row.gameId === gameId);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--cv-text-muted);">No records logged for this game.</td></tr>`;
        return;
    }

    const players = [], pts = [], efgs = [];
    let totalPts = 0, totalFga = 0, totalTo = 0;

    rows.forEach((row) => {
        const fga = Number(row.fga) || 0, fgm = Number(row.fgm) || 0, tpm = Number(row.tpm) || 0;
        const efgVal = fga > 0 ? (((fgm + (0.5 * tpm)) / fga) * 100).toFixed(1) : '0.0';

        totalPts += Number(row.points) || 0;
        totalFga += fga;
        totalTo += Number(row.turnovers) || 0;

        players.push(row.playerName);
        pts.push(Number(row.points) || 0);
        efgs.push(parseFloat(efgVal));

        tbody.innerHTML += `
            <tr>
                <td style="font-weight:600; color:white;">${row.playerName}</td>
                <td style="text-align:center;">${row.minutes || 0}</td>
                <td style="text-align:center; color:white; font-weight:600;">${row.points || 0}</td>
                <td style="text-align:center;">${row.assists || 0}</td>
                <td style="text-align:center;">${row.rebounds || 0}</td>
                <td style="text-align:center; color:var(--cv-success);">${row.steals || 0}</td>
                <td style="text-align:center; color:var(--cv-success);">${row.blocks || 0}</td>
                <td style="text-align:center; color:var(--cv-danger);">${row.turnovers || 0}</td>
                <td style="text-align:right; font-weight:bold; color:var(--cv-success);">${efgVal}%</td>
            </tr>`;
    });

    const calculatedPace = (totalFga + (0.44 * (totalPts * 0.2)) + totalTo).toFixed(1);
    document.getElementById('pace-stat-box').innerText = calculatedPace;
    document.getElementById('ortg-stat-box').innerText = calculatedPace > 0 ? ((totalPts / calculatedPace) * 100).toFixed(1) : '--';

    document.querySelectorAll('.placeholder-text').forEach((p) => { p.style.display = 'none'; });
    document.getElementById('scoringDistributionChart').style.display = 'block';
    document.getElementById('efficiencyLineChart').style.display = 'block';

    if (scoringChartInstance) scoringChartInstance.destroy();
    if (efficiencyChartInstance) efficiencyChartInstance.destroy();

    scoringChartInstance = new Chart(document.getElementById('scoringDistributionChart').getContext('2d'), {
        type: 'bar',
        data: { labels: players, datasets: [{ label: 'Points', data: pts, backgroundColor: 'rgba(255, 102, 0, 0.6)', borderColor: '#ff6600', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });

    efficiencyChartInstance = new Chart(document.getElementById('efficiencyLineChart').getContext('2d'), {
        type: 'line',
        data: { labels: players, datasets: [{ label: 'eFG%', data: efgs, borderColor: '#ff6600', backgroundColor: 'rgba(255, 102, 0, 0.1)', borderWidth: 3, fill: true }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } }
    });
}

document.getElementById('game-selector-dropdown').addEventListener('change', (e) => {
    if (e.target.value) renderGameMatrix(e.target.value);
});

window.addEventListener('DOMContentLoaded', loadGameAnalytics);
