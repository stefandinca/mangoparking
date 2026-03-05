import { getDocument, subscribeDoc, updateDocument, getCollection, incrementField } from '../firebase/db.js';
import { TOTAL_CAPACITY } from '../utils/constants.js';
import { auditLog } from './auditService.js';

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

/**
 * Update a spot's status and recalculate global occupied count
 */
export async function updateSpotStatus(spotId, status) {
  const old = await getDocument('spots', spotId);
  await updateDocument('spots', spotId, { status });
  await auditLog('spot_updated', 'spot', spotId, { status: old?.status }, { status });
  // Update occupied count with atomic increment
  const wasOccupied = old?.status === 'occupied';
  const nowOccupied = status === 'occupied';
  if (wasOccupied !== nowOccupied) {
    await incrementField('settings', 'global', 'occupiedSpots', nowOccupied ? 1 : -1);
  }
}
