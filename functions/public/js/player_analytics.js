// CourtVision player deep-dive - ported from a contributor's standalone
// views/pages/player_analytics.html. Originally read Firestore directly
// from the browser; now talks to this app's own /api/games/box-scores
// endpoint (backed by PostgreSQL), scoped by the logged-in user's session.

let trendChartInstance = null;
let matrixChartInstance = null;
let boxScores = [];

async function loadPlayerRoster() {
    try {
        const response = await fetch('/api/games/box-scores');
        ({ boxScores } = await response.json());

        const selector = document.getElementById('player-profile-selector');

        if (boxScores.length === 0) {
            selector.innerHTML = '<option value="">No Roster Data Found</option>';
            return;
        }

        const uniqueNames = [...new Set(boxScores.map((s) => s.playerName))];
        selector.innerHTML = uniqueNames.map((name) => `<option value="${name}">${name}</option>`).join('');

        switchPlayerProfile(uniqueNames[0]);
    } catch (err) {
        console.error('Failed to load player roster:', err);
    }
}

function switchPlayerProfile(playerName) {
    const rows = boxScores.filter((s) => s.playerName === playerName);
    const tbody = document.getElementById('player-history-tbody');
    tbody.innerHTML = '';

    let sumPts = 0, sumAst = 0, sumReb = 0;
    const count = rows.length;
    const ptsLog = [], astLog = [], rebLog = [], labels = [];

    rows.forEach((row, i) => {
        const fga = Number(row.fga) || 0, fgm = Number(row.fgm) || 0, tpm = Number(row.tpm) || 0;
        const efg = fga > 0 ? (((fgm + (0.5 * tpm)) / fga) * 100).toFixed(1) + '%' : '0.0%';

        sumPts += Number(row.points) || 0;
        sumAst += Number(row.assists) || 0;
        sumReb += Number(row.rebounds) || 0;

        ptsLog.push(Number(row.points) || 0);
        astLog.push(Number(row.assists) || 0);
        rebLog.push(Number(row.rebounds) || 0);
        labels.push(`G ${i + 1}`);

        tbody.innerHTML += `
            <tr>
                <td style="font-weight:600; color:white;">Game Performance Entry ${i + 1}</td>
                <td style="text-align:center;">${row.minutes || 0}</td>
                <td style="text-align:center; color:white; font-weight:600;">${row.points || 0}</td>
                <td style="text-align:center;">${row.assists || 0}</td>
                <td style="text-align:center;">${row.rebounds || 0}</td>
                <td style="text-align:center; color:var(--cv-success);">${row.steals || 0}</td>
                <td style="text-align:center; color:var(--cv-success);">${row.blocks || 0}</td>
                <td style="text-align:right; font-weight:bold; color:var(--cv-success);">${efg}</td>
            </tr>`;
    });

    document.getElementById('stat-season-ppg').innerText = count > 0 ? (sumPts / count).toFixed(1) + ' PPG' : '--';
    document.getElementById('stat-season-apg').innerText = count > 0 ? (sumAst / count).toFixed(1) + ' APG' : '--';
    document.getElementById('stat-season-rpg').innerText = count > 0 ? (sumReb / count).toFixed(1) + ' RPG' : '--';

    document.querySelectorAll('.placeholder-text').forEach((p) => { p.style.display = 'none'; });
    document.getElementById('playerPointsTrendChart').style.display = 'block';
    document.getElementById('playerResourceMatrixChart').style.display = 'block';

    if (trendChartInstance) trendChartInstance.destroy();
    if (matrixChartInstance) matrixChartInstance.destroy();

    trendChartInstance = new Chart(document.getElementById('playerPointsTrendChart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Points', data: ptsLog, borderColor: '#ff6600', backgroundColor: 'rgba(255, 102, 0, 0.1)', borderWidth: 3, fill: true }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    matrixChartInstance = new Chart(document.getElementById('playerResourceMatrixChart').getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Assists', data: astLog, backgroundColor: '#00ff66' }, { label: 'Rebounds', data: rebLog, backgroundColor: '#ff6600' }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

document.getElementById('player-profile-selector').addEventListener('change', (e) => {
    if (e.target.value) switchPlayerProfile(e.target.value);
});

window.addEventListener('DOMContentLoaded', loadPlayerRoster);
