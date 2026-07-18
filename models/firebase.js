// Firebase-backed persistence, replacing the Postgres layer so this branch
// runs on the same Firebase project as `main` (my-solo-project-basket) - see
// main's public/dashboard.html for the matching client-side Firestore usage.
//
// Auth is done via the Firebase Auth REST API rather than the `firebase/auth`
// client SDK's signInWithEmailAndPassword/createUserWithEmailAndPassword.
// That SDK keeps one global "current user" per app instance, which is fine
// for a single browser tab but wrong for a Node server handling concurrent
// requests from different logged-in users at once. The REST API is
// stateless per request, which fits an Express server.
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
  query,
  orderBy,
} = require('firebase/firestore');

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyAoCTKQ3072pftAkYJgIsGhaR589ljhJ_0',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'my-solo-project-basket.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'my-solo-project-basket',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'my-solo-project-basket.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '109404963599',
  appId: process.env.FIREBASE_APP_ID || '1:109404963599:web:2ab5e946f13cdea8f6347a',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const AUTH_BASE_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';

async function firebaseAuthRequest(endpoint, body) {
  const response = await fetch(`${AUTH_BASE_URL}:${endpoint}?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { ok: false, code: data.error && data.error.message };
  }

  return { ok: true, data };
}

// Creates a Firebase Authentication account.
// Returns { created: false, reason: 'EMAIL_TAKEN' } if the email is already
// registered, otherwise { created: true, user: { id, email } }. Firebase
// itself hashes and stores the password - it never passes through here.
async function createUser(email, password) {
  const normalized = String(email).trim().toLowerCase();
  const result = await firebaseAuthRequest('signUp', { email: normalized, password });

  if (!result.ok) {
    if (result.code === 'EMAIL_EXISTS') {
      return { created: false, reason: 'EMAIL_TAKEN' };
    }
    throw new Error(result.code || 'Firebase sign-up failed');
  }

  return { created: true, user: { id: result.data.localId, email: normalized } };
}

// Verifies an email/password combination against Firebase Authentication.
// Returns { id, email } on success, or null on any mismatch.
async function verifyUser(email, password) {
  const normalized = String(email).trim().toLowerCase();
  const result = await firebaseAuthRequest('signInWithPassword', { email: normalized, password });

  if (!result.ok) {
    return null;
  }

  return { id: result.data.localId, email: normalized };
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
