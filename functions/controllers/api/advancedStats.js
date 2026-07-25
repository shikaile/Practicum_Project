const router = require('express').Router();
const {
    createGameRecord,
    getGameRecordsForUser,
    deleteGameRecord,
    findGameRecordByDateAndOpponent,
    createGameStats,
    findOrCreatePlayer,
    createPlayerStats,
    getAllPlayerStatsForUser,
} = require('../../models/database');

// Backs the Dashboard's "Individual Athlete Stats" / "Team Stats" CSV
// upload toggle - mirrors what a contributor's public/py/*_ingestion.py
// scripts did directly against a standalone SQLite file. The CSV parsing
// and column mapping happen client-side (public/js/dashboard.js), same as
// the existing box-score upload; these routes just validate and write the
// already-parsed rows to the game_records/game_stats/players/player_stats
// tables (see models/database.js), scoped to the logged-in user.

const MAX_TEXT_LENGTH = 200;
const MAX_PLAYERS_PER_GAME = 100;

const GAME_STATS_STAT_KEYS = [
    'points', 'q1_points', 'q2_points', 'q3_points', 'q4_points', 'ot_points',
    'fgm', 'fga', 'fg_pct', 'tpm', 'tpa', 'tp_pct', 'ftm', 'fta', 'ft_pct',
    'off_rebounds', 'def_rebounds', 'rebounds', 'assists', 'steals', 'blocks',
    'turnovers', 'fouls', 'ts_pct', 'efg_pct', 'oreb_pct', 'dreb_pct',
    'ast_to_ratio', 'to_pct', 'off_rating', 'def_rating',
];

const PLAYER_STATS_STAT_KEYS = [
    'mp', 'points', 'fgm', 'fga', 'fg_pct', 'tpm', 'tpa', 'tp_pct', 'ftm', 'fta', 'ft_pct',
    'off_rebounds', 'def_rebounds', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers',
    'fouls', 'plus_minus', 'oreb_pct', 'dreb_pct', 'treb_pct', 'ast_pct', 'ast_to_ratio',
    'to_ratio', 'usg_pct', 'charges_drawn', 'ts_pct', 'efg_pct',
];

function requireAuth(req, res, next) {
    if (!res.locals.user) {
        return res.status(401).json({ error: 'You must be logged in.' });
    }
    next();
}

// Numbers, or null - never NaN/undefined, so an untrusted CSV can't smuggle
// something odd into a numeric column.
function sanitizeStats(input, keys) {
    const sanitized = {};
    keys.forEach((key) => {
        const value = input ? input[key] : undefined;
        const num = Number(value);
        sanitized[key] = value === null || value === undefined || value === '' || Number.isNaN(num) ? null : num;
    });
    return sanitized;
}

function isValidDateString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Lists CSV-ingested games and their season-wide player stats - this is the
// only data source the Dashboard/Team Analytics/Game Analytics/Player Deep
// Dive pages read from. The Game page's live stat-logging and the
// Dashboard's Manual Entry form write to the separate games/player_box_scores
// tables (see controllers/api/games.js) instead, and are never surfaced here.
router.get('/games', requireAuth, async (req, res) => {
    try {
        const games = await getGameRecordsForUser(res.locals.user.id);
        res.json({ games });
    } catch (err) {
        console.error('Failed to load games:', err.message);
        res.status(500).json({ error: 'Something went wrong loading games.' });
    }
});

router.get('/player-stats', requireAuth, async (req, res) => {
    try {
        const playerStats = await getAllPlayerStatsForUser(res.locals.user.id);
        res.json({ playerStats });
    } catch (err) {
        console.error('Failed to load player stats:', err.message);
        res.status(500).json({ error: 'Something went wrong loading player stats.' });
    }
});

router.delete('/games/:gameId', requireAuth, async (req, res) => {
    const gameId = Number(req.params.gameId);
    if (!Number.isInteger(gameId)) {
        return res.status(400).json({ error: 'Invalid game id.' });
    }

    try {
        const deleted = await deleteGameRecord(res.locals.user.id, gameId);
        if (!deleted) {
            return res.status(404).json({ error: 'Game not found.' });
        }
        res.status(204).end();
    } catch (err) {
        console.error('Failed to delete game:', err.message);
        res.status(500).json({ error: 'Something went wrong deleting the game.' });
    }
});

// Team Stats CSV (mirrors public/py/gameStats_ingestion.py): one row each
// for "my" team and the opponent, keyed to a game by date + opponent name
// parsed from the filename.
router.post('/game', requireAuth, async (req, res) => {
    const gameDate = req.body && req.body.gameDate;
    const opponent = typeof (req.body && req.body.opponent) === 'string' ? req.body.opponent.trim() : '';
    const location = typeof (req.body && req.body.location) === 'string' ? req.body.location.trim() : '';
    const teamStats = req.body && req.body.teamStats;
    const opponentStats = req.body && req.body.opponentStats;

    if (!isValidDateString(gameDate)) {
        return res.status(400).json({ error: 'Invalid or missing game date (expected the CSV filename to start with YYYY-M-D).' });
    }
    if (!opponent || opponent.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: 'Invalid or missing opponent name.' });
    }
    if (!location || location.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: 'Invalid or missing location.' });
    }
    if (!teamStats || !opponentStats) {
        return res.status(400).json({ error: 'Both a team stat line and an opponent stat line are required.' });
    }

    try {
        const game = await createGameRecord(res.locals.user.id, { gameDate, opponent, location });
        const teamRow = await createGameStats(res.locals.user.id, game.id, 'Team', sanitizeStats(teamStats, GAME_STATS_STAT_KEYS));
        const opponentRow = await createGameStats(res.locals.user.id, game.id, 'Opponent', sanitizeStats(opponentStats, GAME_STATS_STAT_KEYS));
        res.status(201).json({ game, teamStats: teamRow, opponentStats: opponentRow });
    } catch (err) {
        console.error('Failed to ingest team stats:', err.message);
        res.status(500).json({ error: 'Something went wrong ingesting team stats.' });
    }
});

// Individual Athlete Stats CSV (mirrors public/py/playerStats_ingestion.py):
// per-player stat lines attached to a game that must already exist (i.e.
// the Team Stats CSV for this game needs to be uploaded first), same
// ordering dependency as the original ingestion scripts.
router.post('/players', requireAuth, async (req, res) => {
    const gameDate = req.body && req.body.gameDate;
    const opponent = typeof (req.body && req.body.opponent) === 'string' ? req.body.opponent.trim() : '';
    const players = req.body && req.body.players;

    if (!isValidDateString(gameDate)) {
        return res.status(400).json({ error: 'Invalid or missing game date (expected the CSV filename to start with YYYY-M-D).' });
    }
    if (!opponent || opponent.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: 'Invalid or missing opponent name.' });
    }
    if (!Array.isArray(players) || players.length === 0 || players.length > MAX_PLAYERS_PER_GAME) {
        return res.status(400).json({ error: 'Please provide at least one valid player stat row.' });
    }
    for (const player of players) {
        const name = player && player.name;
        if (typeof name !== 'string' || !name.trim() || name.length > MAX_TEXT_LENGTH) {
            return res.status(400).json({ error: 'Every player row needs a valid name.' });
        }
    }

    try {
        const game = await findGameRecordByDateAndOpponent(res.locals.user.id, gameDate, opponent);
        if (!game) {
            return res.status(404).json({
                error: `No matching Team Stats game found for ${gameDate} vs ${opponent}. Upload the Team Stats CSV for this game first.`,
            });
        }

        const created = [];
        for (const player of players) {
            const playerNumber = Number.isFinite(Number(player.playerNumber)) ? Number(player.playerNumber) : null;
            const dbPlayer = await findOrCreatePlayer(res.locals.user.id, {
                name: player.name.trim(),
                playerNumber,
                playerClass: null,
            });
            const stats = await createPlayerStats(res.locals.user.id, game.id, dbPlayer.id, sanitizeStats(player.stats, PLAYER_STATS_STAT_KEYS));
            created.push(stats);
        }

        res.status(201).json({ game, playerStats: created });
    } catch (err) {
        console.error('Failed to ingest player stats:', err.message);
        res.status(500).json({ error: 'Something went wrong ingesting player stats.' });
    }
});

module.exports = router;
