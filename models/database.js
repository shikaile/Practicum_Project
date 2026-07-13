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

module.exports = { pool, addSubscriber, getAllSubscribers };
