// CourtVision team analytics - ported from a contributor's standalone
// views/pages/team_analytics.html. Originally read Firestore directly from
// the browser; now talks to this app's own /api/games/box-scores endpoint
// (backed by PostgreSQL), scoped by the logged-in user's session.

let pointsChartInstance = null;
let efficiencyChartInstance = null;

async function loadTeamAnalytics() {
    try {
        const response = await fetch('/api/games/box-scores');
        const { boxScores } = await response.json();

        const playerMap = {};
        boxScores.forEach((row) => {
            const name = row.playerName;
            if (!playerMap[name]) {
                playerMap[name] = { name, games: 0, min: 0, pts: 0, ast: 0, reb: 0, fgm: 0, fga: 0, tpm: 0 };
            }
            playerMap[name].games += 1;
            playerMap[name].min += Number(row.minutes) || 0;
            playerMap[name].pts += Number(row.points) || 0;
            playerMap[name].ast += Number(row.assists) || 0;
            playerMap[name].reb += Number(row.rebounds) || 0;
            playerMap[name].fgm += Number(row.fgm) || 0;
            playerMap[name].fga += Number(row.fga) || 0;
            playerMap[name].tpm += Number(row.tpm) || 0;
        });

        const players = Object.values(playerMap);
        const tbody = document.getElementById('team-roster-tbody');

        document.getElementById('stat-roster-size').innerText = players.length || '--';
        document.getElementById('stat-team-pts').innerText = boxScores.reduce((sum, row) => sum + (Number(row.points) || 0), 0);

        if (players.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--cv-text-muted); font-style: italic;">No box scores logged yet. Upload a game on the Dashboard first.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        const names = [], pts = [], efgs = [];

        players.forEach((p) => {
            const efgVal = p.fga > 0 ? (((p.fgm + (0.5 * p.tpm)) / p.fga) * 100).toFixed(1) : '0.0';
            names.push(p.name);
            pts.push(p.pts);
            efgs.push(parseFloat(efgVal));

            tbody.innerHTML += `
                <tr>
                    <td style="font-weight:600; color:white;">${p.name}</td>
                    <td style="text-align:center;">${p.games}</td>
                    <td style="text-align:center;">${p.min}</td>
                    <td style="text-align:center; color:white; font-weight:600;">${p.pts}</td>
                    <td style="text-align:center;">${p.ast}</td>
                    <td style="text-align:center;">${p.reb}</td>
                    <td style="text-align:right; font-weight:bold; color:var(--cv-success);">${efgVal}%</td>
                </tr>`;
        });

        document.querySelectorAll('.placeholder-text').forEach((p) => { p.style.display = 'none'; });
        document.getElementById('pointsLeaderboardChart').style.display = 'block';
        document.getElementById('efficiencyBreakdownChart').style.display = 'block';

        if (pointsChartInstance) pointsChartInstance.destroy();
        if (efficiencyChartInstance) efficiencyChartInstance.destroy();

        pointsChartInstance = new Chart(document.getElementById('pointsLeaderboardChart').getContext('2d'), {
            type: 'bar',
            data: { labels: names, datasets: [{ label: 'Points', data: pts, backgroundColor: 'rgba(255, 102, 0, 0.6)', borderColor: '#ff6600', borderWidth: 2 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });

        efficiencyChartInstance = new Chart(document.getElementById('efficiencyBreakdownChart').getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: names,
                datasets: [{
                    label: 'eFG%',
                    data: efgs,
                    backgroundColor: ['#ff6600', '#00ff66', '#ffcc00', '#3399ff', '#ff3333', '#9966ff', '#33cccc', '#ff66cc'],
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } catch (err) {
        console.error('Failed to load team analytics:', err);
    }
}

window.addEventListener('DOMContentLoaded', loadTeamAnalytics);
