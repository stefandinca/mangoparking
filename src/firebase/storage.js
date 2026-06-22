import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './config.js';
import { compressImage } from '../utils/imageCompress.js';

/**
 * Upload a photo for a booking
 */
export async function uploadBookingPhoto(bookingId, file) {
  const filename = `${Date.now()}-${file.name}`;
  const storageRef = ref(storage, `bookings/${bookingId}/${filename}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

/**
 * Delete a booking photo
 */
export async function deleteBookingPhoto(path) {
  const storageRef = ref(storage, path);
  return deleteObject(storageRef);
}

/**
 * Upload a facility-gallery image. Returns both the public download URL and the
 * storage path (kept on the Firestore doc so the image can be deleted later).
 */
export async function uploadGalleryImage(file) {
  // Downscale + recompress in the browser before upload (smaller storage and,
  // more importantly, smaller homepage download for every visitor).
  const optimized = await compressImage(file);
  const path = `gallery/${Date.now()}-${optimized.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, optimized);
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

/**
 * Delete any storage object by its path (e.g. a gallery image).
 */
export async function deleteStorageObject(path) {
  return deleteObject(ref(storage, path));
}
