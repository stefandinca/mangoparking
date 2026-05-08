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
