const router = require('express').Router();
const { addSubscriber, createUser, verifyUser } = require('../../models/database');
const {
    SESSION_COOKIE_NAME,
    createSession,
    destroySession,
    getSessionFromRequest,
    getSessionTokenFromRequest,
} = require('../../models/sessions');

// Reasonably strict but not pedantic - good enough to reject junk/garbage
// input without rejecting real addresses.
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
}

// Minimal in-memory rate limiter for the subscribe form - no new dependency
// required. Limits each IP to a handful of submissions per window to curb
// spam/abuse. Resets on server restart, which is fine for this use case.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5;
const submissionsByIp = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const record = submissionsByIp.get(ip);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
        submissionsByIp.set(ip, { windowStart: now, count: 1 });
        return false;
    }

    record.count += 1;
    return record.count > RATE_LIMIT_MAX;
}

router.get('/', (req, res) => {
    res.render('index');
});

router.get('/about', (req,res) =>{
    res.render('pages/about');
});

// The Archive page is now the Home page - redirect old links.
router.get('/archive', (req,res) =>{
    res.redirect('/');
});

router.get('/projects', (req,res) =>{
    res.render('pages/projects');
});

router.get('/participate', (req,res) =>{
    res.render('pages/participate');
});

// Ported from the CourtVision dashboard on `main` (public/dashboard.html),
// wired up to this app's real login instead of main's hardcoded coach list.
router.get('/dashboard', (req, res) => {
    if (!res.locals.user) return res.redirect('/login');
    res.render('pages/dashboard');
});

// Ported from a contributor's standalone CourtVision analytics pages
// (views/pages/team_analytics.html, game_analytics.html, player_analytics.html),
// wired up to this app's real login and /api/games data instead of their
// original sessionStorage auth + direct Firestore reads.
router.get('/team-analytics', (req, res) => {
    if (!res.locals.user) return res.redirect('/login');
    res.render('pages/team_analytics');
});

router.get('/game-analytics', (req, res) => {
    if (!res.locals.user) return res.redirect('/login');
    res.render('pages/game_analytics');
});

router.get('/player-analytics', (req, res) => {
    if (!res.locals.user) return res.redirect('/login');
    res.render('pages/player_analytics');
});

// The standalone contact page was merged into /about - redirect old links.
router.get('/contact', (req,res) =>{
    res.redirect('/about');
});

router.get('/subscribe', (req,res) =>{
    res.render('pages/subscribe', { submitted: false, error: null });
});

router.post('/subscribe', async (req,res) =>{
    if (isRateLimited(req.ip)) {
        return res.status(429).render('pages/subscribe', {
            submitted: false,
            error: 'Too many attempts. Please try again later.',
        });
    }

    const email = typeof (req.body && req.body.email) === 'string' ? req.body.email.trim() : '';

    if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        return res.status(400).render('pages/subscribe', { submitted: false, error: 'Please enter a valid email.' });
    }

    try {
        await addSubscriber(email);
        res.status(200).render('pages/subscribe', { submitted: true, error: null });
    } catch (err) {
        console.error('Failed to save subscriber:', err.message);
        res.status(500).render('pages/subscribe', {
            submitted: false,
            error: 'Something went wrong saving your email. Please try again later.',
        });
    }
});

router.get('/signup', async (req, res) => {
    if (await getSessionFromRequest(req)) return res.redirect('/');
    res.render('pages/signup', { error: null });
});

router.post('/signup', async (req, res) => {
    if (isRateLimited(req.ip)) {
        return res.status(429).render('pages/signup', {
            error: 'Too many attempts. Please try again later.',
        });
    }

    const email = typeof (req.body && req.body.email) === 'string' ? req.body.email.trim() : '';
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';

    if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        return res.status(400).render('pages/signup', { error: 'Please enter a valid email.' });
    }

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        return res.status(400).render('pages/signup', {
            error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
        });
    }

    try {
        const result = await createUser(email, password);

        if (!result.created) {
            return res.status(400).render('pages/signup', { error: 'An account with that email already exists.' });
        }

        const token = await createSession(result.user);
        setSessionCookie(res, token);
        res.redirect('/');
    } catch (err) {
        console.error('Failed to create account:', err.message);
        res.status(500).render('pages/signup', { error: 'Something went wrong creating your account. Please try again later.' });
    }
});

router.get('/login', async (req, res) => {
    if (await getSessionFromRequest(req)) return res.redirect('/');
    res.render('pages/login', { error: null });
});

router.post('/login', async (req, res) => {
    if (isRateLimited(req.ip)) {
        return res.status(429).render('pages/login', {
            error: 'Too many attempts. Please try again later.',
        });
    }

    const email = typeof (req.body && req.body.email) === 'string' ? req.body.email.trim() : '';
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.status(400).render('pages/login', { error: 'Please enter your email and password.' });
    }

    try {
        const user = await verifyUser(email, password);

        if (!user) {
            return res.status(401).render('pages/login', { error: 'Invalid email or password.' });
        }

        const token = await createSession(user);
        setSessionCookie(res, token);
        res.redirect('/');
    } catch (err) {
        console.error('Failed to log in:', err.message);
        res.status(500).render('pages/login', { error: 'Something went wrong logging you in. Please try again later.' });
    }
});

router.post('/logout', async (req, res) => {
    await destroySession(getSessionTokenFromRequest(req));
    res.clearCookie(SESSION_COOKIE_NAME);
    res.redirect('/');
});

module.exports = router;