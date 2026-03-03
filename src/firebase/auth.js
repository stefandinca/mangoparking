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

export async function registerWithEmail(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    email,
    displayName,
    role: 'customer',
    loyaltyPoints: 0,
    loyaltyTier: 'bronze',
    vehicles: [],
    createdAt: new Date().toISOString(),
  });
  return cred;
}

export async function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function logout() {
  return signOut(auth);
}

export function isAdmin() {
  return userProfile?.role === 'admin';
}

export function isStaff() {
  return userProfile?.role === 'admin' || userProfile?.role === 'staff';
}
