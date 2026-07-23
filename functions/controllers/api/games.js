const router = require('express').Router();
const {
    createGameWithBoxScores,
    getGamesForUser,
    getBoxScoresForUser,
    deleteGame,
    createGame,
    getPlayerBoxScore,
    incrementPlayerBoxScoreStat,
} = require('../../models/database');

// Backs the CourtVision dashboard (views/pages/dashboard.ejs /
// public/js/dashboard.js) - previously this data lived in Firestore and was
// read/written directly from the browser; it's now scoped per logged-in
// user through this API instead, same as the Team/Game features.
//
// The /start and /:gameId/box-score routes below back a second, separate
// flow: live stat-logging on the Game page (public/js/common.js), where box
// score rows are built up one stat click at a time against a game created
// on the fly, rather than uploaded as a complete batch.

const MAX_SOURCE_FILE_LENGTH = 200;
const MAX_PLAYER_NAME_LENGTH = 100;
const MAX_PLAYERS_PER_GAME = 100;

const STAT_FIELDS = ['minutes', 'points', 'assists', 'rebounds', 'steals', 'blocks', 'turnovers', 'fgm', 'fga', 'tpm'];

const LIVE_STAT_KEYS = ['fga', 'fgm', 'tpa', 'tpm', 'fta', 'ftm', 'offRebounds', 'defRebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls'];

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

// Starts an empty game for the Game page's live stat-logging flow (box
// scores get added one stat click at a time afterward).
router.post('/start', requireAuth, async (req, res) => {
    const sourceFile = typeof (req.body && req.body.sourceFile) === 'string' ? req.body.sourceFile.trim() : '';

    if (!sourceFile || sourceFile.length > MAX_SOURCE_FILE_LENGTH) {
        return res.status(400).json({ error: 'Please provide a source file name.' });
    }

    try {
        const game = await createGame(res.locals.user.id, sourceFile);
        res.status(201).json({ game });
    } catch (err) {
        console.error('Failed to start game:', err.message);
        res.status(500).json({ error: 'Something went wrong starting the game.' });
    }
});

router.get('/:gameId/box-score', requireAuth, async (req, res) => {
    const gameId = Number(req.params.gameId);
    const playerName = typeof req.query.playerName === 'string' ? req.query.playerName.trim() : '';

    if (!Number.isInteger(gameId)) {
        return res.status(400).json({ error: 'Invalid game id.' });
    }
    if (!playerName || playerName.length > MAX_PLAYER_NAME_LENGTH) {
        return res.status(400).json({ error: 'Invalid player name.' });
    }

    try {
        const boxScore = await getPlayerBoxScore(gameId, res.locals.user.id, playerName);
        if (!boxScore) {
            return res.status(404).json({ error: 'Game not found.' });
        }
        res.json({ boxScore });
    } catch (err) {
        console.error('Failed to load box score:', err.message);
        res.status(500).json({ error: 'Something went wrong loading the box score.' });
    }
});

router.post('/:gameId/box-score', requireAuth, async (req, res) => {
    const gameId = Number(req.params.gameId);
    const playerName = typeof (req.body && req.body.playerName) === 'string' ? req.body.playerName.trim() : '';
    const stat = typeof (req.body && req.body.stat) === 'string' ? req.body.stat.trim() : '';

    if (!Number.isInteger(gameId)) {
        return res.status(400).json({ error: 'Invalid game id.' });
    }
    if (!playerName || playerName.length > MAX_PLAYER_NAME_LENGTH) {
        return res.status(400).json({ error: 'Invalid player name.' });
    }
    if (!LIVE_STAT_KEYS.includes(stat)) {
        return res.status(400).json({ error: 'Invalid stat.' });
    }

    try {
        const boxScore = await incrementPlayerBoxScoreStat(gameId, res.locals.user.id, playerName, stat);
        if (!boxScore) {
            return res.status(404).json({ error: 'Game not found.' });
        }
        res.json({ boxScore });
    } catch (err) {
        console.error('Failed to update box score:', err.message);
        res.status(500).json({ error: 'Something went wrong updating the box score.' });
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
