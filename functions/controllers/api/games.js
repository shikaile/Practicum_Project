const router = require('express').Router();
const {
    createGameWithBoxScores,
    getGamesForUser,
    getBoxScoresForUser,
    deleteGame,
} = require('../../models/database');

// Backs the CourtVision dashboard (views/pages/dashboard.ejs /
// public/js/dashboard.js) - previously this data lived in Firestore and was
// read/written directly from the browser; it's now scoped per logged-in
// user through this API instead, same as the Team/Game features.

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

// Validates and coerces the player rows from a CSV upload or manual entry
// into a consistent shape. Returns null if the input isn't usable.
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

router.get('/', requireAuth, async (req, res) => {
    try {
        const games = await getGamesForUser(res.locals.user.id);
        res.json({ games });
    } catch (err) {
        console.error('Failed to load games:', err.message);
        res.status(500).json({ error: 'Something went wrong loading games.' });
    }
});

router.get('/box-scores', requireAuth, async (req, res) => {
    try {
        const boxScores = await getBoxScoresForUser(res.locals.user.id);
        res.json({ boxScores });
    } catch (err) {
        console.error('Failed to load box scores:', err.message);
        res.status(500).json({ error: 'Something went wrong loading box scores.' });
    }
});

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

router.delete('/:gameId', requireAuth, async (req, res) => {
    const gameId = Number(req.params.gameId);
    if (!Number.isInteger(gameId)) {
        return res.status(400).json({ error: 'Invalid game id.' });
    }

    try {
        const deleted = await deleteGame(res.locals.user.id, gameId);
        if (!deleted) {
            return res.status(404).json({ error: 'Game not found.' });
        }
        res.status(204).end();
    } catch (err) {
        console.error('Failed to delete game:', err.message);
        res.status(500).json({ error: 'Something went wrong deleting the game.' });
    }
});

module.exports = router;
