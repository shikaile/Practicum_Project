const router = require('express').Router();
const {
    createGameWithBoxScores,
} = require('../../models/database');

// Backs the Dashboard's Manual Entry form (views/pages/dashboard.ejs /
// public/js/dashboard.js) - the only remaining thing that writes to the
// games/player_box_scores tables. CSV uploads and the Game page's
// "End/Record Game" button both write to the separate
// game_records/player_stats tables instead (see controllers/api/advancedStats.js),
// which is also what the Dashboard/Team Analytics/Game Analytics/Player
// Deep Dive pages read from - so data submitted here won't show up there.

const MAX_SOURCE_FILE_LENGTH = 200;
const MAX_PLAYER_NAME_LENGTH = 100;
const MAX_PLAYERS_PER_GAME = 100;

const STAT_FIELDS = ['minutes', 'points', 'assists', 'rebounds', 'steals', 'blocks', 'turnovers', 'fgm', 'fga', 'tpm'];

function requireAuth(req, res, next) {
    if (!res.locals.user) {
        return res.status(401).json({ error: 'You must be logged in.' });
    }
    next();
}

// Validates and coerces the player rows from a manual entry into a
// consistent shape. Returns null if the input isn't usable.
function sanitizePlayers(players) {
    if (!Array.isArray(players) || players.length === 0 || players.length > MAX_PLAYERS_PER_GAME) {
        return null;
    }

    const sanitized = [];

    for (const row of players) {
        const playerName = typeof (row && row.playerName) === 'string' ? row.playerName.trim() : '';
        if (!playerName || playerName.length > MAX_PLAYER_NAME_LENGTH) {
            return null;
        }

        const player = { playerName };
        for (const field of STAT_FIELDS) {
            const value = Number(row ? row[field] : 0);
            player[field] = Number.isFinite(value) ? Math.trunc(value) : 0;
        }

        sanitized.push(player);
    }

    return sanitized;
}

router.post('/', requireAuth, async (req, res) => {
    const sourceFile = typeof (req.body && req.body.sourceFile) === 'string' ? req.body.sourceFile.trim() : '';
    const players = sanitizePlayers(req.body && req.body.players);

    if (!sourceFile || sourceFile.length > MAX_SOURCE_FILE_LENGTH) {
        return res.status(400).json({ error: 'Please provide a source file name.' });
    }
    if (!players) {
        return res.status(400).json({ error: 'Please provide at least one valid player stat row.' });
    }

    try {
        const game = await createGameWithBoxScores(res.locals.user.id, sourceFile, players);
        res.status(201).json({ game, playersUploaded: players.length });
    } catch (err) {
        console.error('Failed to create game:', err.message);
        res.status(500).json({ error: 'Something went wrong saving the game.' });
    }
});

module.exports = router;
