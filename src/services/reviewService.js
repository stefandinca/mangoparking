// Customer reviews — admin-managed.
//
// Schema for `reviews/{id}`:
//   name:       string  (display name)
//   rating:     1..5
//   comment:    string
//   date:       ISO date string
//   photoUrl:   string | null
//   published:  boolean
//   sortOrder:  number   (lower = earlier in the list)
//   type:       'traveler' | 'commuter'   (used for the small label under the name)

import {
  getCollection, addDocument, updateDocument, removeDocument,
  where, orderBy, limit,
} from '../firebase/db.js';
import { auditLog } from './auditService.js';

export async function getPublishedReviews(max = 6) {
  return getCollection('reviews',
    where('published', '==', true),
    orderBy('sortOrder', 'asc'),
    limit(max),
  );
}

export async function getAllReviews() {
  return getCollection('reviews', orderBy('sortOrder', 'asc'));
}

export async function createReview(data) {
  const id = await addDocument('reviews', {
    name: data.name || '',
    rating: clampRating(data.rating),
    comment: data.comment || '',
    date: data.date || new Date().toISOString().slice(0, 10),
    photoUrl: data.photoUrl || null,
    published: data.published !== false,
    sortOrder: Number.isFinite(data.sortOrder) ? data.sortOrder : 100,
    type: data.type === 'commuter' ? 'commuter' : 'traveler',
  });
  await auditLog('review_created', 'review', id, null, data);
  return id;
}

export async function updateReview(id, data) {
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.rating !== undefined) patch.rating = clampRating(data.rating);
  if (data.comment !== undefined) patch.comment = data.comment;
  if (data.date !== undefined) patch.date = data.date;
  if (data.photoUrl !== undefined) patch.photoUrl = data.photoUrl;
  if (data.published !== undefined) patch.published = !!data.published;
  if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder) || 0;
  if (data.type !== undefined) patch.type = data.type === 'commuter' ? 'commuter' : 'traveler';
  await updateDocument('reviews', id, patch);
  await auditLog('review_updated', 'review', id, null, patch);
}

export async function deleteReview(id) {
  await removeDocument('reviews', id);
  await auditLog('review_deleted', 'review', id, null, null);
}

function clampRating(r) {
  const n = Math.round(Number(r) || 0);
  return Math.max(1, Math.min(5, n));
}
