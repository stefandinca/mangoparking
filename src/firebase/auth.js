import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './config.js';

const googleProvider = new GoogleAuthProvider();

let currentUser = null;
let userProfile = null;
const authListeners = [];

// Resolves after the FIRST onAuthStateChanged callback finishes — at
// that point we know whether the user is signed in AND have loaded their
// users/{uid} profile (so role guards have what they need).
//
// The router awaits this before its initial route dispatch so a hard
// refresh of an authed page doesn't briefly redirect to /login while
// Firebase rehydrates the persisted session (which takes 200–500 ms).
let _authReadyResolve;
export const authReady = new Promise((resolve) => { _authReadyResolve = resolve; });
let _authReadyDone = false;

// Listen to auth state
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    const profileDoc = await getDoc(doc(db, 'users', user.uid));
    if (profileDoc.exists()) {
      userProfile = { id: user.uid, ...profileDoc.data() };
    } else {
      // Create default profile
      const profile = {
        email: user.email,
        displayName: user.displayName || '',
        phone: '',
        role: 'customer',
        loyaltyPoints: 0,
        loyaltyTier: 'bronze',
        vehicles: [],
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', user.uid), profile);
      userProfile = { id: user.uid, ...profile };
    }
  } else {
    userProfile = null;
  }
  authListeners.forEach((fn) => fn(currentUser, userProfile));
  if (!_authReadyDone) {
    _authReadyDone = true;
    _authReadyResolve();
  }
});

export function getCurrentUser() {
  return currentUser;
}

export function getUserProfile() {
  return userProfile;
}

export function onAuthChange(callback) {
  authListeners.push(callback);
  // Call immediately with current state
  if (currentUser !== undefined) {
    callback(currentUser, userProfile);
  }
  return () => {
    const idx = authListeners.indexOf(callback);
    if (idx > -1) authListeners.splice(idx, 1);
  };
}

export async function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(email, password, displayName, phone = '') {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    email,
    displayName,
    phone,
    role: 'customer',
    loyaltyPoints: 0,
    loyaltyTier: 'bronze',
    vehicles: [],
    createdAt: new Date().toISOString(),
  });
  return cred;
}

// Re-read users/{uid} into the module cache and notify listeners. The cache is
// otherwise only populated by onAuthStateChanged, so callers that mutate the
// profile (e.g. the complete-your-profile modal) use this to refresh it without
// a full reload — keeping getUserProfile() and the auth listeners in sync.
export async function refreshUserProfile() {
  if (!currentUser) return null;
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  if (snap.exists()) {
    userProfile = { id: currentUser.uid, ...snap.data() };
    authListeners.forEach((fn) => fn(currentUser, userProfile));
  }
  return userProfile;
}

export async function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function logout() {
  // Clear the module-level cache synchronously so the next render (Navbar,
  // route guards) sees a logged-out state without waiting for the async
  // onAuthStateChanged callback to propagate. Without this, callers that
  // do `await logout(); navigate('/')` race the listener and the post-
  // logout page sometimes still paints with the previous user — only a
  // manual refresh fixes it.
  currentUser = null;
  userProfile = null;
  authListeners.forEach((fn) => fn(null, null));
  return signOut(auth);
}

export function isAdmin() {
  return userProfile?.role === 'admin';
}

// Backwards-compat helper. Returns true for admin + agent (and legacy
// 'staff', which is now treated as agent) + driver. Use the permission
// helpers in utils/permissions.js for new code instead.
export function isStaff() {
  const r = userProfile?.role;
  return r === 'admin' || r === 'agent' || r === 'staff' || r === 'driver';
}
