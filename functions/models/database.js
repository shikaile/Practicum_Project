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
          tpm INTEGER NOT NULL DEFAULT 0,
          tpa INTEGER NOT NULL DEFAULT 0,
          fta INTEGER NOT NULL DEFAULT 0,
          ftm INTEGER NOT NULL DEFAULT 0,
          off_rebounds INTEGER NOT NULL DEFAULT 0,
          def_rebounds INTEGER NOT NULL DEFAULT 0,
          fouls INTEGER NOT NULL DEFAULT 0
        );

        -- Older deployments already have player_box_scores without the
        -- columns above (CREATE TABLE IF NOT EXISTS is a no-op once the
        -- table exists) - add them explicitly so existing databases catch up.
        ALTER TABLE player_box_scores ADD COLUMN IF NOT EXISTS tpa INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE player_box_scores ADD COLUMN IF NOT EXISTS fta INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE player_box_scores ADD COLUMN IF NOT EXISTS ftm INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE player_box_scores ADD COLUMN IF NOT EXISTS off_rebounds INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE player_box_scores ADD COLUMN IF NOT EXISTS def_rebounds INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE player_box_scores ADD COLUMN IF NOT EXISTS fouls INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Ported from a contributor's models/archetec.sql, a standalone
        -- SQLite schema (with matching ingestion scripts in public/py/) for
        -- a more detailed, advanced-metrics box score than the
        -- games/player_box_scores tables above. Converted to Postgres
        -- (SERIAL ids, snake_case columns, quoted "%"-suffixed names aren't
        -- used - percentages are named "_pct" instead) and scoped per user
        -- like every other table here, since the source schema assumed a
        -- single standalone team with no coach/user concept. Named
        -- "game_records"/"players" rather than "games"/"athletes" to avoid
        -- colliding with the existing tables of those names, which serve a
        -- different (simpler, CSV/manual entry) box-score flow.
        CREATE TABLE IF NOT EXISTS game_records (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          game_date DATE,
          opponent TEXT,
          location TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS players (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          player_number INTEGER,
          class TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS player_stats (
          id SERIAL PRIMARY KEY,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          game_id INTEGER NOT NULL REFERENCES game_records(id) ON DELETE CASCADE,
          mp INTEGER,
          points INTEGER,
          fgm INTEGER,
          fga INTEGER,
          fg_pct REAL,
          tpm INTEGER,
          tpa INTEGER,
          tp_pct REAL,
          ftm INTEGER,
          fta INTEGER,
          ft_pct REAL,
          off_rebounds INTEGER,
          def_rebounds INTEGER,
          rebounds INTEGER,
          assists INTEGER,
          steals INTEGER,
          blocks INTEGER,
          turnovers INTEGER,
          fouls INTEGER,
          plus_minus INTEGER,
          oreb_pct REAL,
          dreb_pct REAL,
          treb_pct REAL,
          ast_pct REAL,
          ast_to_ratio REAL,
          to_ratio REAL,
          usg_pct REAL,
          charges_drawn INTEGER,
          ts_pct REAL,
          efg_pct REAL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS game_stats (
          id SERIAL PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES game_records(id) ON DELETE CASCADE,
          team_role TEXT NOT NULL CHECK (team_role IN ('Team', 'Opponent')),
          points INTEGER NOT NULL,
          q1_points INTEGER,
          q2_points INTEGER,
          q3_points INTEGER,
          q4_points INTEGER,
          ot_points INTEGER,
          fgm INTEGER,
          fga INTEGER,
          fg_pct REAL,
          tpm INTEGER,
          tpa INTEGER,
          tp_pct REAL,
          ftm INTEGER,
          fta INTEGER,
          ft_pct REAL,
          off_rebounds INTEGER,
          def_rebounds INTEGER,
          rebounds INTEGER,
          assists INTEGER,
          steals INTEGER,
          blocks INTEGER,
          turnovers INTEGER,
          fouls INTEGER,
          ts_pct REAL,
          efg_pct REAL,
          oreb_pct REAL,
          dreb_pct REAL,
          ast_to_ratio REAL,
          to_pct REAL,
          off_rating REAL,
          def_rating REAL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (game_id, team_role)
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

// Renames an athlete on a team's roster (e.g. to fix a typo). Ownership is
// enforced via the EXISTS check, same as addAthlete's join. Returns the
// updated athlete, or null if it doesn't exist / isn't owned by this user.
async function renameAthlete(userId, teamId, athleteId, name) {
  await ensureSchema();
  const pool = await getPool();

  const updated = await pool.query(
    `UPDATE athletes SET name = $4
     WHERE id = $3 AND team_id = $1
       AND EXISTS (SELECT 1 FROM teams t WHERE t.id = athletes.team_id AND t.user_id = $2)
     RETURNING id, name, created_at`,
    [teamId, userId, athleteId, name]
  );

  return updated.rows[0] || null;
}

// Removes an athlete from a team's roster (e.g. added by mistake). Returns
// whether anything was deleted.
async function deleteAthlete(userId, teamId, athleteId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `DELETE FROM athletes
     WHERE id = $3 AND team_id = $1
       AND EXISTS (SELECT 1 FROM teams t WHERE t.id = athletes.team_id AND t.user_id = $2)`,
    [teamId, userId, athleteId]
  );

  return result.rowCount > 0;
}

// --- Advanced-metrics box score (ported from archetec.sql) ---
// See the game_records/players/player_stats/game_stats tables above. These
// functions mirror what the contributor's public/py/*_ingestion.py scripts
// did directly against SQLite, but scoped per user and going through this
// app's own Postgres connection instead.

// Creates a game record (date/opponent/location) owned by the given user.
async function createGameRecord(userId, { gameDate, opponent, location }) {
  await ensureSchema();
  const pool = await getPool();

  const inserted = await pool.query(
    `INSERT INTO game_records (user_id, game_date, opponent, location)
     VALUES ($1, $2, $3, $4)
     RETURNING id, game_date AS "gameDate", opponent, location, created_at AS "createdAt"`,
    [userId, gameDate, opponent, location]
  );

  return inserted.rows[0];
}

// Returns every game record owned by the given user, most recent first.
async function getGameRecordsForUser(userId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT id, game_date AS "gameDate", opponent, location, created_at AS "createdAt"
     FROM game_records WHERE user_id = $1 ORDER BY game_date DESC NULLS LAST, id DESC`,
    [userId]
  );

  return result.rows;
}

// Deletes a game record (and, via ON DELETE CASCADE, its game_stats and
// player_stats rows) if it exists and belongs to the given user. Returns
// whether anything was deleted.
async function deleteGameRecord(userId, gameId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    'DELETE FROM game_records WHERE id = $1 AND user_id = $2',
    [gameId, userId]
  );

  return result.rowCount > 0;
}

// Looks up a previously-ingested game by date + opponent (mirrors
// playerStats_ingestion.py, which uses this to attach player stats to the
// game record the team-stats script already inserted).
async function findGameRecordByDateAndOpponent(userId, gameDate, opponent) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT id, game_date AS "gameDate", opponent, location, created_at AS "createdAt"
     FROM game_records WHERE user_id = $1 AND game_date = $2 AND opponent = $3
     ORDER BY id DESC LIMIT 1`,
    [userId, gameDate, opponent]
  );

  return result.rows[0] || null;
}

const GAME_STATS_COLUMNS = [
  'points', 'q1_points', 'q2_points', 'q3_points', 'q4_points', 'ot_points',
  'fgm', 'fga', 'fg_pct', 'tpm', 'tpa', 'tp_pct', 'ftm', 'fta', 'ft_pct',
  'off_rebounds', 'def_rebounds', 'rebounds', 'assists', 'steals', 'blocks',
  'turnovers', 'fouls', 'ts_pct', 'efg_pct', 'oreb_pct', 'dreb_pct',
  'ast_to_ratio', 'to_pct', 'off_rating', 'def_rating',
];

// Records one team's (or its opponent's) stat line for a game. teamRole
// must be 'Team' or 'Opponent' (see the CHECK constraint on game_stats).
// Ownership of the game is enforced via the join against game_records.
async function createGameStats(userId, gameId, teamRole, stats) {
  await ensureSchema();
  const pool = await getPool();

  const statValues = GAME_STATS_COLUMNS.map((column) => (stats ? stats[column] : undefined) ?? null);
  const statPlaceholders = statValues.map((_, i) => `$${i + 3}`); // $1=gameId, $2=teamRole

  const inserted = await pool.query(
    `INSERT INTO game_stats (game_id, team_role, ${GAME_STATS_COLUMNS.join(', ')})
     SELECT $1, $2, ${statPlaceholders.join(', ')}
     FROM game_records g WHERE g.id = $1 AND g.user_id = $${statValues.length + 3}
     RETURNING *`,
    [gameId, teamRole, ...statValues, userId]
  );

  return inserted.rows[0] || null;
}

// Returns both stat lines (Team + Opponent) for a game, if any.
async function getGameStatsForGame(userId, gameId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT gs.*
     FROM game_stats gs
     JOIN game_records g ON g.id = gs.game_id
     WHERE gs.game_id = $1 AND g.user_id = $2
     ORDER BY gs.team_role ASC`,
    [gameId, userId]
  );

  return result.rows;
}

// Looks up a player by roster number, creating them if they don't exist yet
// (mirrors playerStats_ingestion.py's "look up or create" logic, which used
// Player_Number rather than name as the de-duplication key).
async function findOrCreatePlayer(userId, { name, playerNumber, playerClass }) {
  await ensureSchema();
  const pool = await getPool();

  const existing = await pool.query(
    `SELECT id, name, player_number AS "playerNumber", class, created_at AS "createdAt"
     FROM players WHERE user_id = $1 AND player_number = $2`,
    [userId, playerNumber]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO players (user_id, name, player_number, class)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, player_number AS "playerNumber", class, created_at AS "createdAt"`,
    [userId, name, playerNumber, playerClass]
  );

  return inserted.rows[0];
}

// Returns every player on the given user's roster.
async function getPlayersForUser(userId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT id, name, player_number AS "playerNumber", class, created_at AS "createdAt"
     FROM players WHERE user_id = $1 ORDER BY player_number ASC NULLS LAST`,
    [userId]
  );

  return result.rows;
}

const PLAYER_STATS_COLUMNS = [
  'mp', 'points', 'fgm', 'fga', 'fg_pct', 'tpm', 'tpa', 'tp_pct', 'ftm', 'fta', 'ft_pct',
  'off_rebounds', 'def_rebounds', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers',
  'fouls', 'plus_minus', 'oreb_pct', 'dreb_pct', 'treb_pct', 'ast_pct', 'ast_to_ratio',
  'to_ratio', 'usg_pct', 'charges_drawn', 'ts_pct', 'efg_pct',
];

// Records one player's stat line for a game. Ownership of both the player
// and the game is enforced via their joins back to this user.
async function createPlayerStats(userId, gameId, playerId, stats) {
  await ensureSchema();
  const pool = await getPool();

  const statValues = PLAYER_STATS_COLUMNS.map((column) => (stats ? stats[column] : undefined) ?? null);
  const statPlaceholders = statValues.map((_, i) => `$${i + 4}`); // $1=playerId, $2=gameId, $3=userId

  const inserted = await pool.query(
    `INSERT INTO player_stats (player_id, game_id, ${PLAYER_STATS_COLUMNS.join(', ')})
     SELECT $1, $2, ${statPlaceholders.join(', ')}
     FROM players p
     JOIN game_records g ON g.id = $2
     WHERE p.id = $1 AND p.user_id = $3 AND g.user_id = $3
     RETURNING *`,
    [playerId, gameId, userId, ...statValues]
  );

  return inserted.rows[0] || null;
}

// Returns every player's stat line for a game, joined with the player's name.
async function getPlayerStatsForGame(userId, gameId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT ps.*, p.name AS player_name, p.player_number
     FROM player_stats ps
     JOIN players p ON p.id = ps.player_id
     JOIN game_records g ON g.id = ps.game_id
     WHERE ps.game_id = $1 AND g.user_id = $2
     ORDER BY p.player_number ASC NULLS LAST`,
    [gameId, userId]
  );

  return result.rows;
}

// Returns every player stat line across every game_records game owned by
// the given user, joined with the player's name/number and the game's
// date/opponent - backs the Dashboard/Team Analytics/Game Analytics/Player
// Deep Dive pages, which read only from CSV-uploaded data (game_records +
// player_stats), not the separate games/player_box_scores tables the Game
// page's live stat-logging and the Dashboard's Manual Entry form use.
async function getAllPlayerStatsForUser(userId) {
  await ensureSchema();
  const pool = await getPool();

  const result = await pool.query(
    `SELECT ps.id, ps.player_id AS "playerId", ps.game_id AS "gameId",
            ps.mp AS minutes, ps.points, ps.fgm, ps.fga, ps.tpm, ps.tpa,
            ps.ftm, ps.fta, ps.off_rebounds AS "offRebounds", ps.def_rebounds AS "defRebounds",
            ps.rebounds, ps.assists, ps.steals, ps.blocks, ps.turnovers, ps.fouls,
            p.name AS "playerName", p.player_number AS "playerNumber",
            g.game_date AS "gameDate", g.opponent
     FROM player_stats ps
     JOIN players p ON p.id = ps.player_id
     JOIN game_records g ON g.id = ps.game_id
     WHERE p.user_id = $1
     ORDER BY g.game_date ASC NULLS LAST, ps.id ASC`,
    [userId]
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
  renameAthlete,
  deleteAthlete,
  createGameWithBoxScores,
  createSession,
  getSession,
  destroySession,
  createGameRecord,
  getGameRecordsForUser,
  deleteGameRecord,
  findGameRecordByDateAndOpponent,
  createGameStats,
  getGameStatsForGame,
  findOrCreatePlayer,
  getPlayersForUser,
  createPlayerStats,
  getPlayerStatsForGame,
  getAllPlayerStatsForUser,
};
