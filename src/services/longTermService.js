import { getDocument, setDocument, addDocument, updateDocument, getCollection, where, orderBy, limit } from '../firebase/db.js';
import { auditLog } from './auditService.js';

// ── Long-term rate tiers (admin configurable) ──
// Shape: { tiers: [{ minDays: n, maxDays: n|null, perDay: n }, ...] }
// Stored at settings/longTermRates.

const DEFAULT_RATES = {
  tiers: [
    { minDays: 1, maxDays: 6, perDay: 49 },
    { minDays: 7, maxDays: 13, perDay: 39 },
    { minDays: 14, maxDays: null, perDay: 29 },
  ],
};

export async function getLongTermRates() {
  const doc = await getDocument('settings', 'longTermRates');
  return doc || DEFAULT_RATES;
}

export async function saveLongTermRates(rates) {
  await setDocument('settings', 'longTermRates', rates);
  await auditLog('long_term_rates_updated', 'settings', 'longTermRates', null, rates);
}

// Find the applicable tier for a given day count and compute total price.
export function calculateLongTermCost(days, rates) {
  if (!days || days < 1) return { days: 0, perDay: 0, total: 0, tier: null };
  const tier = rates.tiers.find(t =>
    days >= t.minDays && (t.maxDays == null || days <= t.maxDays)
  ) || rates.tiers[rates.tiers.length - 1];
  return { days, perDay: tier.perDay, total: days * tier.perDay, tier };
}

// ── Commuter late-pickup policy (admin configurable) ──
// Stored at settings/commuterPolicy — currently just a daily overtime rate in RON.

const DEFAULT_COMMUTER_POLICY = {
  latePickupDailyRate: 49,
};

export async function getCommuterPolicy() {
  const doc = await getDocument('settings', 'commuterPolicy');
  return doc || DEFAULT_COMMUTER_POLICY;
}

export async function saveCommuterPolicy(policy) {
  await setDocument('settings', 'commuterPolicy', policy);
  await auditLog('commuter_policy_updated', 'settings', 'commuterPolicy', null, policy);
}

// ── Bookings (used by BOTH funnels) ──
// Schema for a bookings/{id} doc:
//   type:          'longTerm' | 'credit'
//   customerId:    string | null      (null for guests)
//   licensePlate:  string (normalised upper-case)
//   startDate:     ISO string
//   endDate:       ISO string         (planned end for longTerm; computed/actual for credit)
//   days:          number
//   basePrice:     number             (RON)
//   latePrice:     number             (RON — 0 unless commuter overran)
//   totalPrice:    number             (RON)
//   status:        'upcoming' | 'active' | 'completed' | 'cancelled'
//   contact:       { name, email, phone }
//   paymentId:     string | null      (Netopia orderId, null until paid)
//   createdAt:     ISO
//   completedAt:   ISO | null
//   source:        'web' | 'admin'

function normalizePlate(plate) {
  return String(plate || '').toUpperCase().replace(/[\s-]/g, '');
}

export async function createLongTermBooking({ customerId, licensePlate, startDate, endDate, days, totalPrice, contact, paymentId }) {
  const id = await addDocument('bookings', {
    type: 'longTerm',
    customerId: customerId || null,
    licensePlate: normalizePlate(licensePlate),
    startDate, endDate, days,
    basePrice: totalPrice,
    latePrice: 0,
    totalPrice,
    status: paymentId ? 'upcoming' : 'upcoming',
    contact: contact || {},
    paymentId: paymentId || null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    source: 'web',
  });
  await auditLog('booking_created', 'booking', id, null, { type: 'longTerm', days, totalPrice });
  return id;
}

export async function createCreditBooking({ customerId, licensePlate, plannedEndDate }) {
  const nowIso = new Date().toISOString();
  const id = await addDocument('bookings', {
    type: 'credit',
    customerId: customerId || null,
    licensePlate: normalizePlate(licensePlate),
    startDate: nowIso,
    endDate: plannedEndDate || nowIso,
    days: 1,
    basePrice: 0, // already paid via credit pack
    latePrice: 0,
    totalPrice: 0,
    status: 'active',
    contact: {},
    paymentId: null,
    createdAt: nowIso,
    completedAt: null,
    source: 'admin',
  });
  await auditLog('booking_created', 'booking', id, null, { type: 'credit', licensePlate });
  return id;
}

export async function completeBooking(bookingId, { latePrice = 0, notes = null } = {}) {
  const nowIso = new Date().toISOString();
  const patch = {
    status: 'completed',
    completedAt: nowIso,
  };
  if (latePrice > 0) patch.latePrice = latePrice;
  if (notes) patch.notes = notes;
  await updateDocument('bookings', bookingId, patch);
  await auditLog('booking_completed', 'booking', bookingId, null, { latePrice, notes });
}

// ── Lookups for admin ──

export async function getActiveBookings(type = null) {
  const filters = [where('status', 'in', ['upcoming', 'active'])];
  if (type) filters.unshift(where('type', '==', type));
  return getCollection('bookings', ...filters, orderBy('startDate', 'desc'), limit(100));
}

export async function getBookingByPlate(licensePlate) {
  const plate = normalizePlate(licensePlate);
  const results = await getCollection('bookings',
    where('licensePlate', '==', plate),
    where('status', 'in', ['upcoming', 'active']),
    limit(5));
  return results[0] || null;
}

export async function getRecentBookings(limitCount = 50) {
  return getCollection('bookings', orderBy('createdAt', 'desc'), limit(limitCount));
}

// ── Commuter late-fee computation ──
// Given a booking's plannedEnd and actual checkout time, charge the late-pickup
// daily rate for each started calendar day past plannedEnd.
export function computeLateFee(plannedEndIso, actualIso, policy) {
  const planned = new Date(plannedEndIso).getTime();
  const actual = new Date(actualIso).getTime();
  if (actual <= planned) return 0;
  const daysLate = Math.ceil((actual - planned) / 86_400_000);
  return daysLate * (policy?.latePickupDailyRate ?? 0);
}
