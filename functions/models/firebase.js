// Firebase-backed persistence, replacing the Postgres layer so this branch
// runs on the same Firebase project as `main` (my-solo-project-basket) - see
// main's public/dashboard.html for the matching client-side Firestore usage.
//
// User accounts (email/password) live in a Firestore `users` collection
// rather than Firebase Authentication. Firestore itself doesn't hash
// anything, so passwords are bcrypt-hashed here before being stored -
// same approach as the earlier Postgres-backed version of this file, just
// with Firestore as the store instead of a `users` table.
//
// The config below is the public web config (safe to keep in source - it's
// how Firebase web apps work; access is controlled by security rules, not
// by keeping this secret). It matches the config committed on `main`.
// Override via env vars to point this branch at a different Firebase project.

const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  runTransaction,
  query,
  orderBy,
} = require('firebase/firestore');
// bcryptjs (pure JS) rather than bcrypt (native addon) - native modules are
// a common cause of Cloud Functions deploys failing to even load the
// function (surfaces as "Unable to find a valid endpoint for function `app`"
// during deploy, since the require() throws before any routes are defined).
const bcrypt = require('bcryptjs');

const BCRYPT_SALT_ROUNDS = 12;

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Creates a user account, storing a bcrypt hash of the password (never the
// plaintext) in Firestore. Doc ID = the normalized email, so lookups on
// login don't need a query. A transaction guards against two concurrent
// signups for the same email both passing the "does this exist" check.
// Returns { created: false, reason: 'EMAIL_TAKEN' } if already registered,
// otherwise { created: true, user: { id, email } }.
async function createUser(email, password) {
  const normalized = String(email).trim().toLowerCase();
  const ref = doc(db, 'users', normalized);
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const createdAt = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists()) {
        throw new Error('EMAIL_TAKEN');
      }
      transaction.set(ref, { email: normalized, passwordHash, createdAt });
    });
  } catch (err) {
    if (err.message === 'EMAIL_TAKEN') {
      return { created: false, reason: 'EMAIL_TAKEN' };
    }
    throw err;
  }

  return { created: true, user: { id: normalized, email: normalized } };
}

// Verifies an email/password combination against the stored bcrypt hash.
// Returns { id, email } on success, or null on any mismatch.
async function verifyUser(email, password) {
  const normalized = String(email).trim().toLowerCase();
  const snapshot = await getDoc(doc(db, 'users', normalized));

  if (!snapshot.exists()) {
    return null;
  }

  const matches = await bcrypt.compare(password, snapshot.data().passwordHash);
  if (!matches) {
    return null;
  }

  return { id: normalized, email: normalized };
}

// Adds an email to the subscribers collection if it isn't already present
// (doc ID = the normalized email, so re-subscribing is a no-op).
// Returns { created, subscriber } - created is false if already subscribed.
async function addSubscriber(email) {
  const normalized = String(email).trim().toLowerCase();
  const ref = doc(db, 'subscribers', normalized);

  const existing = await getDoc(ref);
  if (existing.exists()) {
    return { created: false, subscriber: { email: normalized, ...existing.data() } };
  }

  const createdAt = new Date().toISOString();
  await setDoc(ref, { email: normalized, createdAt });
  return { created: true, subscriber: { email: normalized, createdAt } };
}

async function getAllSubscribers() {
  const snapshot = await getDocs(query(collection(db, 'subscribers'), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((docSnap) => docSnap.data());
}

function teamsCollection(userId) {
  return collection(db, 'users', userId, 'teams');
}

function athletesCollection(userId, teamId) {
  return collection(db, 'users', userId, 'teams', teamId, 'athletes');
}

// Creates a team owned by the given user.
async function createTeam(userId, { name, season, sport }) {
  const createdAt = new Date().toISOString();
  const ref = await addDoc(teamsCollection(userId), { name, season, sport, createdAt });
  return { id: ref.id, name, season, sport, createdAt };
}

// Returns every team owned by the given user, most recently created first.
async function getTeamsForUser(userId) {
  const snapshot = await getDocs(query(teamsCollection(userId), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

// Returns the team if it exists and is owned by the given user, else null.
// Ownership is implicit in the path (users/{userId}/teams/{teamId}) rather
// than a separate check, since Firestore docs are already scoped per user.
async function getTeamOwnedByUser(teamId, userId) {
  const snapshot = await getDoc(doc(db, 'users', userId, 'teams', teamId));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

// Adds an athlete to a team's roster.
async function addAthlete(userId, teamId, name) {
  const createdAt = new Date().toISOString();
  const ref = await addDoc(athletesCollection(userId, teamId), { name, createdAt });
  return { id: ref.id, name, createdAt };
}

// Returns a team's roster, in the order athletes were added.
async function getAthletesForTeam(userId, teamId) {
  const snapshot = await getDocs(query(athletesCollection(userId, teamId), orderBy('createdAt', 'asc')));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

module.exports = {
  db,
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
