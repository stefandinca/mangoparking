// Profile-completeness check.
//
// A registered CUSTOMER must hold a complete profile — name, email, phone,
// at least one license plate, and billing — before they can book or buy
// credits. Without it staff can't reach or invoice them. The check is data
// -level (operates on the cached `users/{uid}` profile object) so it can run
// in the auth hook, the booking gates, and the completion modal alike.
//
// Phone and plate are checked as "present" (non-empty) rather than strict
// format: the *input forms* (registration, completion modal) validate format
// on entry, so we don't lock out an existing customer whose stored number is
// non-empty but slightly off-format. Billing mirrors readBilling()'s required
// fields (BillingFields.js).

import { required, isValidCui } from './validators.js';

// Billing is complete when the required fields for its type are present:
//   PJ → company name + valid CUI + company address
//   PF (default) → full name (or first/last) + locality + address
// (CNP / Reg.Com are optional, matching readBilling.)
export function isBillingComplete(b) {
  if (!b || typeof b !== 'object') return false;
  if (b.type === 'PJ') {
    return required(b.companyName) && isValidCui(b.cui) && required(b.companyAddress);
  }
  const name = b.name || [b.firstName, b.lastName].filter(Boolean).join(' ');
  return required(name) && required(b.locality) && required(b.address);
}

// Returns the list of missing required fields:
// 'name' | 'email' | 'phone' | 'plate' | 'billing'. Empty array = complete.
export function missingProfileFields(profile) {
  const missing = [];
  if (!required(profile?.displayName)) missing.push('name');
  if (!required(profile?.email)) missing.push('email');
  if (!required(profile?.phone)) missing.push('phone');
  const hasPlate = Array.isArray(profile?.vehicles)
    && profile.vehicles.some((v) => required(v?.plate));
  if (!hasPlate) missing.push('plate');
  if (!isBillingComplete(profile?.billing)) missing.push('billing');
  return missing;
}

export function isProfileComplete(profile) {
  return missingProfileFields(profile).length === 0;
}
