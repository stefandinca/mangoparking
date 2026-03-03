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
