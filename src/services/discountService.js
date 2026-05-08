// Online-payment discount.
//
// Stored on `settings/global.onlineDiscountPercent` (admin-editable).
// All prices in the database (`tokenPacks.price`, `longTermRates.tiers[].perDay`,
// etc.) are the FINAL prices customers pay online. The "original" (anchor)
// price shown crossed-out is computed on display:
//
//     original = round(online / (1 - discount / 100))
//
// e.g. 10% discount + online 90 lei → original 100 lei.

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

// Compute the strikethrough "original" price given the online price.
// Returns null when no meaningful discount is configured (anchor identical
// or zero) so callers can skip rendering the strikethrough.
export function originalFromOnline(onlinePrice, discountPercent) {
  const p = Number(onlinePrice);
  const d = Number(discountPercent);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!Number.isFinite(d) || d <= 0) return null;
  return Math.round(p / (1 - d / 100));
}
