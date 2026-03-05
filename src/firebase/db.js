import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from './config.js';

// Re-export for convenience
export { db, collection, doc, query, where, orderBy, limit, onSnapshot, serverTimestamp, increment };

/**
 * Get a single document
 */
export async function getDocument(collectionName, docId) {
  const snap = await getDoc(doc(db, collectionName, docId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Get all documents from a collection
 */
export async function getCollection(collectionName, ...queryConstraints) {
  const q = queryConstraints.length
    ? query(collection(db, collectionName), ...queryConstraints)
    : collection(db, collectionName);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Add a document (auto-ID)
 */
export async function addDocument(collectionName, data) {
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Set a document (specific ID)
 */
export async function setDocument(collectionName, docId, data) {
  await setDoc(doc(db, collectionName, docId), data, { merge: true });
}

/**
 * Update a document
 */
export async function updateDocument(collectionName, docId, data) {
  await updateDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a document
 */
export async function removeDocument(collectionName, docId) {
  await deleteDoc(doc(db, collectionName, docId));
}

/**
 * Atomically increment a numeric field
 */
export async function incrementField(collectionName, docId, field, delta) {
  await updateDoc(doc(db, collectionName, docId), { [field]: increment(delta) });
}

/**
 * Subscribe to real-time updates on a document
 */
export function subscribeDoc(collectionName, docId, callback) {
  return onSnapshot(doc(db, collectionName, docId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Subscribe to real-time updates on a collection
 */
export function subscribeCollection(collectionName, callback, ...queryConstraints) {
  const q = queryConstraints.length
    ? query(collection(db, collectionName), ...queryConstraints)
    : collection(db, collectionName);
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
