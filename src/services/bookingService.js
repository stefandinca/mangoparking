import { addDocument, getCollection, getDocument, updateDocument, query, where, orderBy, limit } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';
import { auditLog } from './auditService.js';

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
 * Check in a booking
 */
export async function checkInBooking(bookingId, spotId) {
  const old = await getDocument('bookings', bookingId);
  if (!old) throw new Error(`Booking ${bookingId} not found`);
  await updateDocument('bookings', bookingId, {
    status: 'active',
    spotId,
    checkinTimestamp: new Date().toISOString(),
  });
  await auditLog('booking_checkin', 'booking', bookingId, { status: old.status }, { status: 'active', spotId });
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
  });
  if (old.spotId) {
    await updateDocument('spots', old.spotId, { status: 'available', currentBookingId: null });
  }
  await auditLog('booking_checkout', 'booking', bookingId, { status: old.status }, { status: 'completed' });
}

/**
 * Cancel a booking
 */
export async function cancelBooking(bookingId) {
  const old = await getDocument('bookings', bookingId);
  if (!old) throw new Error(`Booking ${bookingId} not found`);
  await updateDocument('bookings', bookingId, { status: 'cancelled' });
  await auditLog('booking_cancelled', 'booking', bookingId, { status: old.status }, { status: 'cancelled' });
}
