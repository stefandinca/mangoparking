export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? ''));
}

export function isValidPhone(phone) {
  const compact = String(phone ?? '').replace(/[\s-]/g, '');
  // International E.164: "+" then a country code (leading 1–9) and 6–14 more
  // digits (7–15 total). The phone field emits this for every country.
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return true;
  // Legacy Romanian local format (0 + area/mobile + 8 digits) — keeps older
  // numbers already stored without a "+" prefix valid.
  return /^0[27]\d{8}$/.test(compact);
}

export function isValidLicensePlate(plate) {
  // Accept European plates broadly, not just Romanian (B 123 ABC). Formats
  // vary too much across countries to validate precisely (DE "B-AB 1234",
  // FR "AB-123-CD", NL "99-XXX-9", IT "AB 123 CD", UK "AB12 CDE", …), and
  // rejecting a real foreign plate is worse than accepting an odd one — so
  // once spaces/hyphens are stripped (matching how plates are normalized
  // elsewhere) just require 4–10 Latin alphanumerics.
  const compact = String(plate ?? '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{4,10}$/.test(compact);
}

export function required(value) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

export function minLength(value, min) {
  return String(value).trim().length >= min;
}

// Romanian fiscal code (CUI) — accepts "RO12345678" or "12345678" with 2-10 digits.
// Optional "RO" prefix is the VAT-payer marker; we keep it for SmartBill.
export function isValidCui(cui) {
  if (!cui) return false;
  return /^(RO\s?)?\d{2,10}$/i.test(String(cui).trim());
}

// Trade Registry number (Reg.Com). TWO shapes are legal and both must pass:
//   • legacy    "J01/123/2020"    <letter><judet>/<sequential>/<year>
//   • current   "J2014000079041"  <letter> + one unbroken run of digits, the
//                                 separator-less number ONRC issues under Law
//                                 265/2022 (our own registration is this shape)
// Accepting only the legacy form made the field — which is MANDATORY for a PJ
// booking, client-side and in the server's checkBillingComplete — impossible to
// fill for any company registered since the switch, so PJ checkout dead-ended.
// The digit run is length-checked but not decomposed: nothing downstream parses
// this value, it only prints on the SmartBill invoice, so a shape check is the
// right amount of strictness and a narrow guess at the internal layout is not.
// Optional (empty passes) but format-checked when present.
export function isValidRegCom(regCom) {
  if (!regCom) return true; // optional
  // Internal whitespace is dropped so a value pasted as "J 2014 000079041"
  // — how ONRC and several accounting exports render it — still validates.
  const value = String(regCom).replace(/\s+/g, '');
  return /^[A-Z]\d{1,2}\/\d{1,6}\/\d{4}$/i.test(value)
    || /^[A-Z]\d{10,14}$/i.test(value);
}

// Romanian CNP — 13 digits with a weighted-modulo-11 check digit.
// Weights: 2 7 9 1 4 6 3 5 8 2 7 9 (applied to digits 1..12); mod 11; 10 → 1.
export function isValidCnp(cnp) {
  if (!cnp) return false;
  const digits = String(cnp).trim();
  if (!/^\d{13}$/.test(digits)) return false;
  const weights = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * weights[i];
  let check = sum % 11;
  if (check === 10) check = 1;
  return check === Number(digits[12]);
}

// Romanian CI series + number — two uppercase letters then six digits.
// Examples: "AB 123456", "RD485217". County-specific series codes vary;
// we only enforce shape and let the issuing authority be the source of truth.
export function isValidCiSeries(value) {
  if (!value) return false;
  const compact = String(value).trim().replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{6}$/.test(compact);
}

// Passport number — alphanumeric, 6–12 chars. Loose by design since the
// shape varies wildly across issuing countries.
export function isValidPassport(value) {
  if (!value) return false;
  return /^[A-Z0-9]{6,12}$/.test(String(value).trim().toUpperCase());
}

// ── Trip info (long-term bookings) ───────────────────────────────────────
// Passenger count + flight numbers, captured on the public funnel and the
// admin create modal, and editable afterwards on the reservation.
//
// These MIRROR `sanitizePassengers` / `sanitizeFlight` in functions/src/index.js
// character for character. The server re-applies its own copy on every write it
// owns, so keeping them identical means the client stores — and previews — the
// exact value the server would have produced. Both return null for "unset",
// which is what clears the field.

/** Flight number → upper-case, single-spaced, max 12 chars. Empty → null. */
export function sanitizeFlightNumber(value) {
  const s = (value == null ? '' : String(value))
    .trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 12);
  return s || null;
}

/** Passenger count → whole number 1–10. Anything else → null (unset). */
export function sanitizePassengerCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

/**
 * Broker name (ParkVia, Parkos, …) → trimmed, or null when blank.
 * Mirrors `createBrokerBookingCore`'s `String(brokerName || '').trim() || null`.
 * Deliberately uncapped, like the server — brokers name themselves.
 */
export function sanitizeBrokerName(value) {
  const s = (value == null ? '' : String(value)).trim();
  return s || null;
}

/**
 * What an agent may actually collect at the desk against an amount due.
 *
 * Whole lei in `[0, due]`. **0 is valid** — that is how a reservation gets
 * waived outright. Anything above `due` is refused: taking MORE than the
 * reservation is worth is not a collection, it is a re-price or an overstay
 * charge, and both have their own flows (`adminRepriceBooking` /
 * `adminChargeOverstay`) that book the extra money into the right accumulator.
 *
 * Mirrors the guards in `adminMarkOrderPaid` (functions/src/index.js) — the
 * server re-applies them against its own `pendingOrders.amount` and never
 * trusts this result, so keep the two identical.
 *
 * @returns {number|null} the amount, or null when it isn't collectable
 */
export function sanitizeCollectedAmount(value, due) {
  // Blank must NOT coerce to 0 — `Number('')` is 0, so an empty field would
  // otherwise read as "waive the whole reservation" instead of "nothing typed".
  if (value == null || String(value).trim() === '') return null;
  if (due == null || String(due).trim() === '') return null;
  const max = Math.round(Number(due));
  if (!Number.isFinite(max) || max < 0) return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}
