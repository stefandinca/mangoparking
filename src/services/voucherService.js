// Signup-incentive vouchers.
//
// Schema for vouchers/{userId} (the doc ID equals the owning user's uid —
// this is the locking mechanism that enforces ONE signup voucher per user;
// a second create fails because the doc already exists):
//
//   userId:      string  (== doc ID, redundant for query convenience)
//   amount:      number  (RON; signup voucher = 20)
//   currency:    'RON'
//   status:      'unused' | 'redeemed' | 'expired'
//   source:      'signup-incentive'
//   createdAt:   ISO string
//   redeemedAt:  ISO | null
//   redeemedOn:  orderId | null
//
// Firestore rules enforce: client may create only with amount === 20,
// source === 'signup-incentive', status === 'unused', and userId === auth.uid.
// Client cannot update or delete; only the admin SDK (the IPN callback) flips
// status to 'redeemed'.

import { getDocument, setDocument } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';

export const SIGNUP_VOUCHER_AMOUNT = 20;

export async function getMyVoucher() {
  const user = getCurrentUser();
  if (!user) return null;
  return getDocument('vouchers', user.uid).catch(() => null);
}

// Idempotent — safe to call after every login/registration. Creates the
// signup voucher if (and only if) the user doesn't already have one.
export async function ensureSignupVoucher() {
  const user = getCurrentUser();
  if (!user) return null;
  const existing = await getDocument('vouchers', user.uid).catch(() => null);
  if (existing) return existing;
  const voucher = {
    userId: user.uid,
    amount: SIGNUP_VOUCHER_AMOUNT,
    currency: 'RON',
    status: 'unused',
    source: 'signup-incentive',
    createdAt: new Date().toISOString(),
    redeemedAt: null,
    redeemedOn: null,
  };
  try {
    await setDocument('vouchers', user.uid, voucher);
    return voucher;
  } catch {
    // Race: someone else (or a re-login) created it; treat as success.
    return getDocument('vouchers', user.uid).catch(() => null);
  }
}
