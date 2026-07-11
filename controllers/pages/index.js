const router = require('express').Router();
const { addSubscriber } = require('../../models/database');
const { listArchiveImages } = require('../../models/cloudflareImages');

// Reasonably strict but not pedantic - good enough to reject junk/garbage
// input without rejecting real addresses.
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 limit

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

router.get('/', async (req,res) =>{
    let images = [];
    let error = null;

    try {
        images = await listArchiveImages();
    } catch (err) {
        console.error('Failed to load archive images:', err.message);
        error = 'Unable to load archive images right now.';
    }

    res.render('index', { images, error });
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

module.exports = router;