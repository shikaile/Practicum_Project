// Session cookie handling. The actual session storage lives in Postgres
// (see models/database.js) rather than in-process memory - on Cloud
// Functions, different requests can be handled by different container
// instances, so an in-memory session store would make users appear logged
// out as soon as a different instance served their next request.

const {
  createSession: createSessionRow,
  getSession: getSessionRow,
  destroySession: destroySessionRow,
} = require('./database');

const SESSION_COOKIE_NAME = 'session_id';

async function createSession(user) {
  return createSessionRow(user);
}

async function getSession(token) {
  return getSessionRow(token);
}

async function destroySession(token) {
  return destroySessionRow(token);
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
  const token = cookies[SESSION_COOKIE_NAME] || null;
  // TEMP DIAGNOSTIC - remove once the production session lookup is confirmed
  // working.
  console.log('[session-debug] raw Cookie header:', JSON.stringify(req.headers.cookie), '-> extracted token:', token);
  return token;
}

async function getSessionFromRequest(req) {
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
