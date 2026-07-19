const router = require('express').Router();
const {
    createTeam,
    getTeamsForUser,
    getTeamOwnedByUser,
    addAthlete,
    getAthletesForTeam,
} = require('../../models/database');

// Only basketball is active for team creation right now - other sports are
// shown in the UI dropdown but rejected here if somehow submitted.
const ACTIVE_SPORTS = ['Basketball'];

const MAX_NAME_LENGTH = 100;
const MIN_SEASON = 1900;
const MAX_SEASON = 2100;
const MAX_ATHLETE_NAME_LENGTH = 100;

function requireAuth(req, res, next) {
    if (!res.locals.user) {
        return res.status(401).json({ error: 'You must be logged in.' });
    }
    next();
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const teams = await getTeamsForUser(res.locals.user.id);
        res.json({ teams });
    } catch (err) {
        console.error('Failed to load teams:', err.message);
        res.status(500).json({ error: 'Something went wrong loading your teams.' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    const name = typeof (req.body && req.body.name) === 'string' ? req.body.name.trim() : '';
    const season = Number(req.body && req.body.season);
    const sport = typeof (req.body && req.body.sport) === 'string' ? req.body.sport.trim() : '';

    if (!name || name.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: 'Please enter a valid team name.' });
    }

    if (!Number.isInteger(season) || season < MIN_SEASON || season > MAX_SEASON) {
        return res.status(400).json({ error: 'Please enter a valid season year.' });
    }

    if (!ACTIVE_SPORTS.includes(sport)) {
        return res.status(400).json({ error: 'Please select a valid sport.' });
    }

    try {
        const team = await createTeam(res.locals.user.id, { name, season, sport });
        res.status(201).json({ team });
    } catch (err) {
        console.error('Failed to create team:', err.message);
        res.status(500).json({ error: 'Something went wrong creating your team.' });
    }
});

// Roster (athletes) for a specific team - nested under /api/teams/:teamId so
// ownership can be checked before any read or write.
router.get('/:teamId/athletes', requireAuth, async (req, res) => {
    const teamId = Number(req.params.teamId);
    if (!Number.isInteger(teamId)) {
        return res.status(400).json({ error: 'Invalid team id.' });
    }

    try {
        const team = await getTeamOwnedByUser(teamId, res.locals.user.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found.' });
        }

        const athletes = await getAthletesForTeam(res.locals.user.id, teamId);
        res.json({ athletes });
    } catch (err) {
        console.error('Failed to load roster:', err.message);
        res.status(500).json({ error: 'Something went wrong loading the roster.' });
    }
});

router.post('/:teamId/athletes', requireAuth, async (req, res) => {
    const teamId = Number(req.params.teamId);
    if (!Number.isInteger(teamId)) {
        return res.status(400).json({ error: 'Invalid team id.' });
    }

    const name = typeof (req.body && req.body.name) === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > MAX_ATHLETE_NAME_LENGTH) {
        return res.status(400).json({ error: 'Please enter a valid athlete name.' });
    }

    try {
        const team = await getTeamOwnedByUser(teamId, res.locals.user.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found.' });
        }

        const athlete = await addAthlete(res.locals.user.id, teamId, name);
        if (!athlete) {
            return res.status(404).json({ error: 'Team not found.' });
        }
        res.status(201).json({ athlete });
    } catch (err) {
        console.error('Failed to add athlete:', err.message);
        res.status(500).json({ error: 'Something went wrong adding the athlete.' });
    }
});

module.exports = router;
