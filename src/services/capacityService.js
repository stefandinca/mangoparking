import { getDocument, subscribeDoc, subscribeCollection, updateDocument, getCollection, incrementField } from '../firebase/db.js';
import { TOTAL_CAPACITY } from '../utils/constants.js';
import { auditLog } from './auditService.js';

// Roll a spots-collection snapshot into a capacity summary. Single source
// of truth: every status we care about is on the spot doc itself, so this
// can never drift the way `settings/global.occupiedSpots` could.
function aggregateSpots(spots) {
  let total = 0;
  let occupied = 0;
  let reserved = 0;
  let maintenance = 0;
  for (const s of spots) {
    total++;
    const st = s.status || 'available';
    if (st === 'occupied') occupied++;
    else if (st === 'reserved') reserved++;
    else if (st === 'maintenance') maintenance++;
  }
  // Treat reserved as "not available for new arrivals" so the headline
  // available counter matches the staff mental model.
  const effectiveOccupied = occupied + reserved;
  return {
    total: total || TOTAL_CAPACITY,
    occupied,
    reserved,
    maintenance,
    available: Math.max(0, (total || TOTAL_CAPACITY) - effectiveOccupied - maintenance),
  };
}

/**
 * Get current capacity by counting spots — ignores the legacy
 * `settings/global.occupiedSpots` counter, which can drift.
 */
export async function getCapacity() {
  const spots = await getCollection('spots').catch(() => []);
  if (spots.length === 0) {
    return { total: TOTAL_CAPACITY, occupied: 0, reserved: 0, maintenance: 0, available: TOTAL_CAPACITY };
  }
  return aggregateSpots(spots);
}

/**
 * Subscribe to real-time capacity changes. Aggregates the spots
 * collection on every snapshot — the only authoritative source.
 */
export function subscribeCapacity(callback) {
  return subscribeCollection('spots', (spots) => {
    if (!spots || spots.length === 0) {
      callback({ total: TOTAL_CAPACITY, occupied: 0, reserved: 0, maintenance: 0, available: TOTAL_CAPACITY });
      return;
    }
    callback(aggregateSpots(spots));
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
