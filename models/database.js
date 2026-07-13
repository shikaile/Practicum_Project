// PostgreSQL persistence for subscriber emails, via the `pg` package.
//
// Setup:
//   1. `npm install` (pulls in `pg`, already listed in package.json)
//   2. Point at a real Postgres instance via .env:
//        DATABASE_URL=postgres://user:password@host:5432/dbname
//        DATABASE_SSL=true   (set this for most hosted providers - Heroku,
//                             Render, Supabase, etc. - that terminate with a
//                             self-signed cert; leave unset for local dev)
//
// If DATABASE_URL isn't set, `pg` falls back to the standard libpq
// environment variables (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) or,
// failing that, a local default connection.

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const BCRYPT_SALT_ROUNDS = 12;

const useSSL = process.env.DATABASE_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Errors on idle clients (e.g. the connection dropping) shouldn't crash
  // the whole process - just log them.
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// The table is created lazily on first use rather than at startup, so the
// app can still boot (and serve every other page) even if the database
// isn't reachable yet. The promise is memoized so we don't re-run the DDL
// on every request, but is cleared on failure so a later request can retry
// once the database becomes reachable.
let schemaReadyPromise = null;

function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        season INTEGER NOT NULL,
        sport TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS athletes (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }

  return schemaReadyPromise;
}

// Adds an email to the subscribers table if it isn't already present.
// Returns { created, subscriber } - created is false if the email already existed.
async function addSubscriber(email) {
  const normalized = String(email).trim().toLowerCase();

  await ensureSchema();

  const inserted = await pool.query(
    `INSERT INTO subscribers (email) VALUES ($1)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, created_at`,
    [normalized]
  );

  if (inserted.rows.length > 0) {
    return { created: true, subscriber: inserted.rows[0] };
  }

  // Already subscribed - look up the existing row.
  const existing = await pool.query(
    'SELECT id, email, created_at FROM subscribers WHERE email = $1',
    [normalized]
  );
  return { created: false, subscriber: existing.rows[0] };
}

async function getAllSubscribers() {
  await ensureSchema();
  const result = await pool.query('SELECT id, email, created_at FROM subscribers ORDER BY created_at DESC');
  return result.rows;
}

// Creates a new user account with a bcrypt-hashed password.
// Returns { created: false, reason: 'EMAIL_TAKEN' } if the email is already
// registered, otherwise { created: true, user }. The plaintext password is
// never persisted or returned - only the hash is stored.
async function createUser(email, password) {
  const normalized = String(email).trim().toLowerCase();

  await ensureSchema();

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [normalized, passwordHash]
    );
    return { created: true, user: inserted.rows[0] };
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return { created: false, reason: 'EMAIL_TAKEN' };
    }
    throw err;
  }
}

// Verifies an email/password combination against the stored bcrypt hash.
// Returns the user (without the hash) on success, or null on any mismatch.
async function verifyUser(email, password) {
  const normalized = String(email).trim().toLowerCase();

  await ensureSchema();

  const result = await pool.query(
    'SELECT id, email, password_hash, created_at FROM users WHERE email = $1',
    [normalized]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return null;
  }

  delete user.password_hash;
  return user;
}

// Creates a team owned by the given user.
async function createTeam(userId, { name, season, sport }) {
  await ensureSchema();

  const inserted = await pool.query(
    `INSERT INTO teams (user_id, name, season, sport) VALUES ($1, $2, $3, $4)
     RETURNING id, name, season, sport, created_at`,
    [userId, name, season, sport]
  );

  return inserted.rows[0];
}

// Returns every team owned by the given user, most recently created first.
async function getTeamsForUser(userId) {
  await ensureSchema();

  const result = await pool.query(
    'SELECT id, name, season, sport, created_at FROM teams WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );

  return result.rows;
}

// Returns the team if it exists and is owned by the given user, else null.
// Used to authorize roster reads/writes before touching a team's athletes.
async function getTeamOwnedByUser(teamId, userId) {
  await ensureSchema();

  const result = await pool.query(
    'SELECT id, name, season, sport FROM teams WHERE id = $1 AND user_id = $2',
    [teamId, userId]
  );

  return result.rows[0] || null;
}

// Adds an athlete to a team's roster.
async function addAthlete(teamId, name) {
  await ensureSchema();

  const inserted = await pool.query(
    `INSERT INTO athletes (team_id, name) VALUES ($1, $2)
     RETURNING id, name, created_at`,
    [teamId, name]
  );

  return inserted.rows[0];
}

// Returns a team's roster, in the order athletes were added.
async function getAthletesForTeam(teamId) {
  await ensureSchema();

  const result = await pool.query(
    'SELECT id, name, created_at FROM athletes WHERE team_id = $1 ORDER BY created_at ASC',
    [teamId]
  );

  return result.rows;
}

module.exports = {
  pool,
  addSubscriber,
  getAllSubscribers,
  createUser,
  verifyUser,
  createTeam,
  getTeamsForUser,
  getTeamOwnedByUser,
  addAthlete,
  getAthletesForTeam,
};
