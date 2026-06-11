// Online-payment discount.
//
// Stored on `settings/global.onlineDiscountPercent` (admin-editable).
// All prices in the database (`tokenPacks.price`, `longTermRates.tiers[].perDay`,
// etc.) are the STANDARD prices — what a customer pays on-site / at pickup.
// Paying online applies a REAL discount on top, computed both on display and
// at charge time (createPayment performs the same reduction server-side):
//
//     online = round(standard * (1 - discount / 100))
//
// e.g. 10% discount + standard 100 lei → online 90 lei. Pay-at-pickup orders
// are charged the standard price unchanged.

import { getDocument, setDocument } from '../firebase/db.js';
import { auditLog } from './auditService.js';

const DEFAULT_DISCOUNT_PERCENT = 10;

let cached = null;

export async function getOnlineDiscountPercent() {
  if (cached != null) return cached;
  try {
    const doc = await getDocument('settings', 'global');
    const value = doc?.onlineDiscountPercent;
    cached = Number.isFinite(value) ? value : DEFAULT_DISCOUNT_PERCENT;
  } catch {
    cached = DEFAULT_DISCOUNT_PERCENT;
  }
  return cached;
}

export async function saveOnlineDiscountPercent(percent) {
  const clean = Math.max(0, Math.min(50, Math.round(Number(percent) || 0)));
  // setDocument already does {merge:true} so other settings/global fields
  // (capacity, etc.) are preserved.
  await setDocument('settings', 'global', { onlineDiscountPercent: clean });
  cached = clean;
  await auditLog('online_discount_updated', 'settings', 'global', null, { onlineDiscountPercent: clean });
}

// Compute the discounted online price from the standard (listed) price.
// Returns null when no meaningful discount applies (zero/invalid percent, or
// rounding leaves the price unchanged) so callers can skip the strikethrough
// anchor + "-X% online" badge.
export function onlineFromStandard(standardPrice, discountPercent) {
  const p = Number(standardPrice);
  const d = Number(discountPercent);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!Number.isFinite(d) || d <= 0) return null;
  const online = Math.round(p * (1 - d / 100));
  return online < p ? online : null;
}
