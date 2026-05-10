export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone) {
  return /^(\+?40|0)[27]\d{8}$/.test(phone.replace(/[\s-]/g, ''));
}

export function isValidLicensePlate(plate) {
  // Romanian license plates: B 123 ABC or XX 12 ABC
  return /^[A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{3}$/.test(plate.toUpperCase().trim());
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

// Trade Registry number (Reg.Com) — "J01/123/2020" or "F40/12/2024" etc.
// Format: <letter><judet>/<sequential>/<year>. Optional but format-checked when present.
export function isValidRegCom(regCom) {
  if (!regCom) return true; // optional
  return /^[A-Z]\d{1,2}\/\d{1,6}\/\d{4}$/i.test(String(regCom).trim());
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
