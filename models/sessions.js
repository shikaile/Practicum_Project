// Minimal in-memory session store for logged-in users.
//
// No new dependency (e.g. express-session) is pulled in for this - a random
// token mapped to a user in memory is enough for this app's needs, and
// matches the existing in-memory rate limiter in controllers/pages/index.js.
// Sessions reset on server restart, which is an accepted tradeoff here.

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'session_id';
const sessionsById = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessionsById.set(token, { id: user.id, email: user.email });
  return token;
}

function getSession(token) {
  if (!token) return null;
  return sessionsById.get(token) || null;
}

function destroySession(token) {
  if (!token) return;
  sessionsById.delete(token);
}

// Express doesn't parse the `Cookie` header without the `cookie-parser`
// middleware; since we only ever need this one cookie, parse it directly
// rather than pulling in a new dependency.
function parseCookieHeader(header) {
  const cookies = {};
  if (!header) return cookies;

  header.split(';').forEach((pair) => {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) return;

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

function getSessionFromRequest(req) {
  return getSession(getSessionTokenFromRequest(req));
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSession,
  getSession,
  destroySession,
  getSessionFromRequest,
  getSessionTokenFromRequest,
};
