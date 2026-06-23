import { addDocument, getCollection, getDocument, updateDocument, removeDocument, query, where, orderBy, limit } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';
import { auditLog } from './auditService.js';
import { getAllSpots, updateSpotStatus } from './capacityService.js';

/**
 * Generate a booking code (MNG-XXXXX)
 */
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'MNG-';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/**
 * Create a new traveler booking
 */
export async function createBooking(data) {
  const user = getCurrentUser();
  const code = generateCode();
  const booking = {
    code,
    type: 'traveler',
    status: 'upcoming',
    customerId: user?.uid || null,
    customerName: data.name,
    customerPhone: data.phone,
    customerEmail: data.email,
    dates: {
      dropOff: data.dropOff,
      pickUp: data.pickUp,
    },
    vehicle: {
      licensePlate: data.licensePlate,
      makeModel: data.makeModel || '',
    },
    addOns: data.addOns || [],
    estimatedPrice: data.estimatedPrice,
    spotId: null,
    photos: [],
    checkinTimestamp: null,
    checkoutTimestamp: null,
  };
  const id = await addDocument('bookings', booking);
  await auditLog('booking_created', 'booking', id, null, { code, type: 'traveler' });
  return { id, code };
}

/**
 * Get bookings for the current user
 */
export async function getMyBookings() {
  const user = getCurrentUser();
  if (!user) return [];
  return getCollection('bookings', where('customerId', '==', user.uid), orderBy('dates.dropOff', 'desc'));
}

/**
 * Get all bookings (admin)
 */
export async function getAllBookings(limitCount = 200) {
  return getCollection('bookings', orderBy('createdAt', 'desc'), limit(limitCount));
}

/**
 * Check in a booking. If spotId is not provided, the first available spot
 * is auto-picked (mirrors tokenService.useToken). The chosen spot is
 * flipped to `occupied` via updateSpotStatus so the global occupiedSpots
 * counter — read by AdminDashboard + AdminCapacity — stays in sync.
 */
export async function checkInBooking(bookingId, spotId = null) {
  const old = await getDocument('bookings', bookingId);
  if (!old) throw new Error(`Booking ${bookingId} not found`);

  // Payment-first rule: a booking that hasn't been collected yet must not
  // be checked in. Pay-at-pickup web bookings land here as 'unpaid' — the
  // agent collects (Încasează) first, which flips paymentStatus to 'paid'.
  // Coded message so the UI can show a friendly localized string.
  if (old.paymentStatus === 'unpaid') {
    throw new Error('UNPAID_BOOKING');
  }

  let assignedSpot = spotId;
  if (!assignedSpot && old.spotId) {
    // Booking already has a reserved spot — flip that one to occupied
    // rather than picking a new one. Avoids leaving stale "reserved"
    // tiles on the capacity map.
    assignedSpot = old.spotId;
  }
  if (!assignedSpot) {
    const spots = await getAllSpots().catch(() => []);
    const free = spots.find(s => s.status === 'available' || s.status === 'reserved');
    assignedSpot = free?.id || null;
  }

  await updateDocument('bookings', bookingId, {
    status: 'active',
    spotId: assignedSpot,
    checkinTimestamp: new Date().toISOString(),
  });

  if (assignedSpot) {
    await updateSpotStatus(assignedSpot, 'occupied').catch((err) => {
      console.warn('checkInBooking: spot status update failed', err?.message);
    });
  }

  await auditLog('booking_checkin', 'booking', bookingId, { status: old.status }, { status: 'active', spotId: assignedSpot });
}

/**
 * Check out a booking
 */
export async function checkOutBooking(bookingId) {
  const old = await getDocument('bookings', bookingId);
  if (!old) throw new Error(`Booking ${bookingId} not found`);
  await updateDocument('bookings', bookingId, {
    status: 'completed',
    checkoutTimestamp: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  if (old.spotId) {
    // updateSpotStatus also decrements settings/global.occupiedSpots.
    await updateSpotStatus(old.spotId, 'available').catch((err) => {
      console.warn('checkOutBooking: spot status update failed', err?.message);
    });
  }
  // Clear the activeCheckIns row — commuter/walk-in check-ins live there too,
  // and a stale row blocks the plate from a future credit check-in.
  if (old.licensePlate) {
    const normPlate = String(old.licensePlate).toUpperCase().replace(/[\s-]/g, '');
    if (normPlate) await removeDocument('activeCheckIns', normPlate).catch(() => {});
  }
  await auditLog('booking_checkout', 'booking', bookingId, { status: old.status }, { status: 'completed' });
}

/**
 * Edit a reservation's contact + logistics details (admin/agent). Writes only
 * whitelisted fields — contact name/email/phone, plate, and (long-term)
 * drop-off / pick-up dates with the legacy date-only fields + recomputed days.
 * No money / payment / status changes (those go through collect / overstay /
 * cancel-refund). Client-side, like check-in/out — `bookings` rules allow staff
 * updates. `patch` keys are all optional; omit plate/dates for contact-only edits.
 */
export async function updateBookingDetails(bookingId, patch = {}) {
  const old = await getDocument('bookings', bookingId);
  if (!old) throw new Error(`Booking ${bookingId} not found`);

  const update = {};
  if (patch.contact) {
    update.contact = {
      ...(old.contact || {}),
      name: String(patch.contact.name ?? old.contact?.name ?? '').trim(),
      email: String(patch.contact.email ?? old.contact?.email ?? '').trim(),
      phone: String(patch.contact.phone ?? old.contact?.phone ?? '').trim(),
    };
  }
  if (patch.licensePlate !== undefined) {
    update.licensePlate = String(patch.licensePlate || '').toUpperCase().replace(/[\s-]/g, '');
  }
  if (patch.dropoffAt && patch.pickupAt) {
    update.dropoffAt = patch.dropoffAt;
    update.pickupAt = patch.pickupAt;
    update.startDate = patch.dropoffAt.slice(0, 10);
    update.endDate = patch.pickupAt.slice(0, 10);
    update.days = Math.max(1, Math.ceil((Date.parse(patch.pickupAt) - Date.parse(patch.dropoffAt)) / 86_400_000));
  }
  await updateDocument('bookings', bookingId, update);
  await auditLog('booking_edited', 'booking', bookingId, null, update);
  return update;
}

/**
 * Cancel a booking
 */
export async function cancelBooking(bookingId) {
  const old = await getDocument('bookings', bookingId);
  if (!old) throw new Error(`Booking ${bookingId} not found`);
  await updateDocument('bookings', bookingId, { status: 'cancelled' });
  // Release any pre-reserved spot so it goes back to available immediately.
  if (old.spotId) {
    await updateSpotStatus(old.spotId, 'available').catch((err) => {
      console.warn('cancelBooking: spot release failed', err?.message);
    });
  }
  await auditLog('booking_cancelled', 'booking', bookingId, { status: old.status }, { status: 'cancelled' });
}
