import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, query, orderBy, limit, getDocs, increment,
  where,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Singleton — avoid re-initializing on hot reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// ─── Auth helpers ────────────────────────────────────────────────────────────

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  if (result?.user) {
    await ensureUserProfile(result.user);
  }
}

export async function logOut() {
  await signOut(auth);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─── User profile ─────────────────────────────────────────────────────────────

export async function ensureUserProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      displayName: user.displayName || 'Anonymous',
      photoURL: user.photoURL || null,
      username: null,           // set separately — must be unique
      totalScore: 0,
      gamesPlayed: 0,
      bestScore: 0,
      createdAt: new Date().toISOString(),
    });
  }
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

// ─── Username system ───────────────────────────────────────────────────────────

/**
 * Normalise a username for uniqueness checks.
 * All comparisons are lowercase — usernames are case-insensitive.
 */
function normaliseUsername(raw) {
  return raw.trim().toLowerCase();
}

/**
 * Validate username format.
 * Rules (industry standard):
 *  - 3–20 characters
 *  - Letters, numbers, underscores, hyphens only (no spaces)
 *  - Cannot start or end with _ or -
 * Returns null if valid, or an error string.
 */
export function validateUsernameFormat(raw) {
  if (!raw || raw.trim().length === 0) return 'Username cannot be empty.';
  const name = raw.trim();
  if (name.length < 3) return 'Username must be at least 3 characters.';
  if (name.length > 20) return 'Username must be 20 characters or fewer.';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Only letters, numbers, underscores and hyphens are allowed.';
  if (/^[_-]|[_-]$/.test(name)) return 'Username cannot start or end with _ or -.';
  return null;
}

/**
 * Check if a username is available.
 * We maintain a /usernames/{normalised} doc as an index for fast lookups.
 */
export async function checkUsernameAvailable(raw) {
  const key = normaliseUsername(raw);
  const snap = await getDoc(doc(db, 'usernames', key));
  return !snap.exists();
}

/**
 * Claim a username for a user.
 * - Validates format
 * - Checks availability
 * - Writes to /usernames index + updates /users/{uid}
 * - Releases old username if they had one
 * Returns { ok: true } or { ok: false, error: string }
 */
export async function setUsername(uid, raw) {
  const formatError = validateUsernameFormat(raw);
  if (formatError) return { ok: false, error: formatError };

  const key = normaliseUsername(raw);
  const displayUsername = raw.trim(); // preserve original casing for display

  // Check availability
  const available = await checkUsernameAvailable(displayUsername);
  if (!available) return { ok: false, error: 'That username is already taken.' };

  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data() || {};

  // Release old username from index
  if (userData.username) {
    const oldKey = normaliseUsername(userData.username);
    await deleteDoc(doc(db, 'usernames', oldKey)).catch(() => {});
  }

  // Claim new username in index
  await setDoc(doc(db, 'usernames', key), { uid, username: displayUsername });

  // Update user profile
  await updateDoc(userRef, { username: displayUsername });

  return { ok: true };
}

// ─── Score updates ────────────────────────────────────────────────────────────

export async function submitGameScore(uid, gameScore) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};

  await updateDoc(ref, {
    totalScore: increment(gameScore),
    gamesPlayed: increment(1),
    bestScore: Math.max(data.bestScore || 0, gameScore),
  });

  // Also write to global leaderboard collection (one doc per game)
  await setDoc(doc(collection(db, 'leaderboard')), {
    uid,
    displayName: data.username || data.displayName,
    photoURL: data.photoURL || null,
    score: gameScore,
    playedAt: new Date().toISOString(),
  });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export async function getLeaderboard(n = 20) {
  const q = query(
    collection(db, 'users'),
    orderBy('bestScore', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d, i) => ({ rank: i + 1, ...d.data() }));
}
