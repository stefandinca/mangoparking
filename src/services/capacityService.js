import { getDocument, subscribeDoc, updateDocument, getCollection } from '../firebase/db.js';
import { TOTAL_CAPACITY } from '../utils/constants.js';

/**
 * Get current capacity (from settings/global)
 */
export async function getCapacity() {
  const settings = await getDocument('settings', 'global');
  if (!settings) return { total: TOTAL_CAPACITY, occupied: 0, available: TOTAL_CAPACITY };
  return {
    total: settings.totalCapacity || TOTAL_CAPACITY,
    occupied: settings.occupiedSpots || 0,
    available: (settings.totalCapacity || TOTAL_CAPACITY) - (settings.occupiedSpots || 0),
  };
}

/**
 * Subscribe to real-time capacity changes
 */
export function subscribeCapacity(callback) {
  return subscribeDoc('settings', 'global', (data) => {
    if (!data) {
      callback({ total: TOTAL_CAPACITY, occupied: 0, available: TOTAL_CAPACITY });
      return;
    }
    callback({
      total: data.totalCapacity || TOTAL_CAPACITY,
      occupied: data.occupiedSpots || 0,
      available: (data.totalCapacity || TOTAL_CAPACITY) - (data.occupiedSpots || 0),
    });
  });
}

/**
 * Update occupied spots count
 */
export async function updateOccupied(count) {
  await updateDocument('settings', 'global', { occupiedSpots: count });
}

/**
 * Get all spots
 */
export async function getAllSpots() {
  return getCollection('spots');
}
