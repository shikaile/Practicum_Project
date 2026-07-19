// Relational PostgreSQL persistence, replacing the Firestore layer.
//
// Connection strategy is picked at runtime so the same code works both
// locally and when deployed as a Firebase Cloud Function:
//   - If INSTANCE_CONNECTION_NAME is set, connect via the Cloud SQL Node.js
//     Connector (@google-cloud/cloud-sql-connector) - this is what Cloud
//     Functions/Cloud Run use to reach a Cloud SQL Postgres instance over an
//     encrypted tunnel, without a Cloud SQL Auth Proxy sidecar or a public
//     IP allowlist.
//   - Otherwise, fall back to a plain connection string (DATABASE_URL) -
//     for local dev against any reachable Postgres instance.
//
// bcryptjs (pure JS) rather than bcrypt (native addon) is used for password
// hashing - native modules are a common cause of Cloud Functions deploys
// failing to even load the function ("Unable to find a valid endpoint for
// function `app`", since the require() throws before any routes are defined).

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BCRYPT_SALT_ROUNDS = 12;

let poolPromise = null;

function getPool() {
  if (poolPromise) return poolPromise;

  if (process.env.INSTANCE_CONNECTION_NAME) {
    poolPromise = (async () => {
      const { Connector } = require('@google-cloud/cloud-sql-connector');
      const connector = new Connector();
      const clientOpts = await connector.getOptions({
        instanceConnectionName: process.env.INSTANCE_CONNECTION_NAME,
        ipType: process.env.DB_IP_TYPE || 'PUBLIC',
      });

      const pool = new Pool({
        ...clientOpts,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        max: 5,
      });

      pool.on('error', (err) => {
        console.error('Unexpected PostgreSQL pool error:', err.message);
      });

      return pool;
    })().catch((err) => {
      poolPromise = null;
      throw err;
    });
  } else {
    const useSSL = process.env.DATABASE_SSL === 'true';
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    });

    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err.message);
    });

    poolPromise = Promise.resolve(pool);
  }

  return poolPromise;
}

// The schema is created lazily on first use rather than at startup, so the
// app can still boot (and serve every other page) even if the database
// isn't reachable yet. The promise is memoized so we don't re-run the DDL on
// every request, but is cleared on failure so a later request can retry once
// the database becomes reachable.
let schemaReadyPromise = null;

async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const pool = await getPool();
      await pool.query(`
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
        );

        CREATE TABLE IF NOT EXISTS games (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source_file TEXT NOT NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS player_box_scores (
          id SERIAL PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          player_name TEXT NOT NULL,
          minutes INTEGER NOT NULL DEFAULT 0,
          points INTEGER NOT NULL DEFAULT 0,
          assists INTEGER NOT NULL DEFAULT 0,
          rebounds INTEGER NOT NULL DEFAULT 0,
          steals INTEGER NOT NULL DEFAULT 0,
          blocks INTEGER NOT NULL DEFAULT 0,
          turnovers INTEGER NOT NULL DEFAULT 0,
          fgm INTEGER NOT NULL DEFAULT 0,
          fga INTEGER NOT NULL DEFAULT 0,
          tpm INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => {
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
  const pool = await getPool();

  const inserted = await pool.query(
    `INSERT INTO subscribers (email) VALUES ($1)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, created_at`,
    [normalized]
  );

  if (inserted.rows.length > 0) {
    return { created: true, subscriber: inserted.rows[0] };
  }

  const existing = await pool.query(
    'SELECT id, email, created_at FROM subscribers WHERE email = $1',
    [normalized]
  );
  return { created: false, subscriber: existing.rows[0] };
}

async function getAllSubscribers() {
  await ensureSchema();
  const pool = await getPool();
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
  const pool = await getPool();

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
  const pool = await getPool();

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
  const pool = await getPool();

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
  const pool = await getPool();

  const result = await pool.query(
    'SELECT id, name, season, sport, created_at FROM teams WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );

  return result.rows;
}

// Returns the team if it exists and is owned by the given user, else null.
async function getTeamOwnedByUser(teamId, userId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    'SELECT id, name, season, sport FROM teams WHERE id = $1 AND user_id = $2',
    [teamId, userId]
  );

  return result.rows[0] || null;
}

// Adds an athlete to a team's roster. The join against teams enforces
// ownership at the query level too, not just via the caller's earlier
// getTeamOwnedByUser check.
async function addAthlete(userId, teamId, name) {
  await ensureSchema();
  const pool = await getPool();

  const inserted = await pool.query(
    `INSERT INTO athletes (team_id, name)
     SELECT t.id, $3 FROM teams t WHERE t.id = $1 AND t.user_id = $2
     RETURNING id, name, created_at`,
    [teamId, userId, name]
  );

  return inserted.rows[0] || null;
}

// Returns a team's roster, in the order athletes were added.
async function getAthletesForTeam(userId, teamId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT a.id, a.name, a.created_at
     FROM athletes a
     JOIN teams t ON t.id = a.team_id
     WHERE a.team_id = $1 AND t.user_id = $2
     ORDER BY a.created_at ASC`,
    [teamId, userId]
  );

  return result.rows;
}

const BOX_SCORE_STAT_COLUMNS = [
  'minutes', 'points', 'assists', 'rebounds', 'steals', 'blocks', 'turnovers', 'fgm', 'fga', 'tpm',
];

// Creates a game and its player box scores in one transaction (mirrors the
// atomic writeBatch this replaced) - either all rows land, or none do.
async function createGameWithBoxScores(userId, sourceFile, players) {
  await ensureSchema();
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const gameResult = await client.query(
      `INSERT INTO games (user_id, source_file) VALUES ($1, $2)
       RETURNING id, source_file AS "sourceFile", uploaded_at AS "uploadedAt"`,
      [userId, sourceFile]
    );
    const game = gameResult.rows[0];

    for (const player of players) {
      const values = BOX_SCORE_STAT_COLUMNS.map((column) => player[column]);
      await client.query(
        `INSERT INTO player_box_scores
           (game_id, player_name, minutes, points, assists, rebounds, steals, blocks, turnovers, fgm, fga, tpm)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [game.id, player.playerName, ...values]
      );
    }

    await client.query('COMMIT');
    return game;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Returns every game logged by the given user, oldest first (insertion
// order via the serial id doubles as chronological order).
async function getGamesForUser(userId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT id, source_file AS "sourceFile", uploaded_at AS "uploadedAt"
     FROM games WHERE user_id = $1 ORDER BY id ASC`,
    [userId]
  );

  return result.rows;
}

// Returns every player box score across all of the user's games.
async function getBoxScoresForUser(userId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT b.id, b.game_id AS "gameId", b.player_name AS "playerName",
            b.minutes, b.points, b.assists, b.rebounds, b.steals, b.blocks,
            b.turnovers, b.fgm, b.fga, b.tpm
     FROM player_box_scores b
     JOIN games g ON g.id = b.game_id
     WHERE g.user_id = $1
     ORDER BY b.game_id ASC`,
    [userId]
  );

  return result.rows;
}

// Deletes a game (and, via ON DELETE CASCADE, its box scores) if it exists
// and belongs to the given user. Returns whether anything was deleted.
async function deleteGame(userId, gameId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    'DELETE FROM games WHERE id = $1 AND user_id = $2',
    [gameId, userId]
  );

  return result.rowCount > 0;
}

// Sessions are stored here (rather than in an in-memory Map) because Cloud
// Functions gives no guarantee that the same container instance handles
// every request from a given user - a session created in one instance's
// memory would simply not exist from another instance's point of view.
// Postgres is the one thing every instance shares.
async function createSession(user) {
  await ensureSchema();
  const pool = await getPool();

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO sessions (token, user_id, email) VALUES ($1, $2, $3)',
    [token, user.id, user.email]
  );

  return token;
}

async function getSession(token) {
  if (!token) return null;

  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    'SELECT user_id AS id, email FROM sessions WHERE token = $1',
    [token]
  );

  return result.rows[0] || null;
}

async function destroySession(token) {
  if (!token) return;

  await ensureSchema();
  const pool = await getPool();

  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

module.exports = {
  addSubscriber,
  getAllSubscribers,
  createUser,
  verifyUser,
  createTeam,
  getTeamsForUser,
  getTeamOwnedByUser,
  addAthlete,
  getAthletesForTeam,
  createGameWithBoxScores,
  getGamesForUser,
  getBoxScoresForUser,
  createSession,
  getSession,
  destroySession,
  deleteGame,
};
