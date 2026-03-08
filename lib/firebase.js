import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, query, orderBy, limit, getDocs, increment } from 'firebase/firestore';

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

// Popup-based sign-in — works reliably on all hosting environments.
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
      totalScore: 0,
      gamesPlayed: 0,
      bestScore: 0,
      createdAt: new Date().toISOString(),
    });
  }
}

// ─── Score updates ────────────────────────────────────────────────────────────

/**
 * After a game ends, update the user's lifetime stats.
 * @param {string} uid
 * @param {number} gameScore - Score earned in this game
 */
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
    displayName: data.displayName,
    photoURL: data.photoURL || null,
    score: gameScore,
    playedAt: new Date().toISOString(),
  });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

/**
 * Fetch top N players by bestScore.
 */
export async function getLeaderboard(n = 20) {
  const q = query(
    collection(db, 'users'),
    orderBy('bestScore', 'desc'),
    limit(n)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d, i) => ({ rank: i + 1, ...d.data() }));
}
