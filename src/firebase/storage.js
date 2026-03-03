import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './config.js';

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
