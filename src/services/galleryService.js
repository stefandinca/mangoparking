// Facility gallery — admin-managed homepage photos ("Our facility" section).
//
// Schema for `galleryImages/{id}`:
//   url:       string  (public download URL)
//   path:      string  (storage path under gallery/, kept so we can delete it)
//   caption:   string  (optional alt text / overlay label)
//   sortOrder: number  (lower = earlier; matches the reviews pattern)
//
// Mirrors reviewService.js (CRUD + audit + sortOrder); images upload to Firebase
// Storage via storage.js and the URL/path are stored here.

import {
  getCollection, addDocument, updateDocument, removeDocument, orderBy,
} from '../firebase/db.js';
import { deleteStorageObject } from '../firebase/storage.js';
import { auditLog } from './auditService.js';

const COLLECTION = 'galleryImages';

export async function getGalleryImages() {
  return getCollection(COLLECTION, orderBy('sortOrder', 'asc')).catch(() => []);
}

export async function addGalleryImage(data) {
  const id = await addDocument(COLLECTION, {
    url: String(data.url || ''),
    path: String(data.path || ''),
    caption: String(data.caption || '').trim(),
    sortOrder: Number.isFinite(data.sortOrder) ? data.sortOrder : 100,
  });
  await auditLog('gallery_image_added', 'galleryImages', id, null, { url: data.url, caption: data.caption });
  return id;
}

export async function updateGalleryImage(id, data) {
  const patch = {};
  if (data.caption !== undefined) patch.caption = String(data.caption || '').trim();
  if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder) || 0;
  await updateDocument(COLLECTION, id, patch);
  await auditLog('gallery_image_updated', 'galleryImages', id, null, patch);
}

export async function deleteGalleryImage(id, path) {
  await removeDocument(COLLECTION, id);
  // Best-effort storage cleanup — a missing/forbidden object shouldn't block
  // removing the Firestore row.
  if (path) {
    try { await deleteStorageObject(path); } catch (err) { console.warn('gallery storage delete failed:', err?.message); }
  }
  await auditLog('gallery_image_deleted', 'galleryImages', id, null, null);
}
