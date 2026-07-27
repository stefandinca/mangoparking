// Human-readable reservation codes for the new admin check-in dashboard.
//
//   LT-XXXXX  long-term airport bookings
//   CR-XXXXX  credit / commuter sessions
//
// 5-char base32 suffix with ambiguous glyphs removed (no I/O/0/1) so a
// shuttle driver can read it over the phone without confusion. With 32^5 =
// ~33M combinations, collisions at our volume are extremely rare; the
// Cloud Function path runs a transaction-level uniqueness check anyway.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function bookingCodePrefix(type) {
  if (type === 'longTerm') return 'LT';
  if (type === 'credit') return 'CR';
  return 'MNG';
}

export function generateBookingCode(type) {
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${bookingCodePrefix(type)}-${suffix}`;
}

/**
 * The code to DISPLAY for a booking, everywhere. Real `code` when the doc has
 * one; otherwise a stable pseudo-code derived from the Firestore doc id, in
 * the same LT-/CR- shape — staff must never see a raw doc id ("aTUFw5tp…"),
 * it reads like a second, confusing code format. Needs `{ id, code?, type? }`.
 */
export function bookingDisplayCode(b) {
  if (!b) return '';
  if (b.code) return b.code;
  const suffix = String(b.id || '').slice(0, 5).toUpperCase();
  return suffix ? `${bookingCodePrefix(b.type || 'longTerm')}-${suffix}` : '';
}
