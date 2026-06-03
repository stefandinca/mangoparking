// Promo vouchers — admin-managed discount codes that customers enter at
// checkout. Distinct from the legacy `vouchers/{uid}` signup-bonus
// system (kept for in-flight balances; not issued for new sign-ups).
//
// Doc shape (`promoVouchers/{CODE}` — doc ID equals the uppercased code,
// giving natural code-uniqueness without a query):
//
//   code:                 'BLACK50',                  // uppercased, A-Z 0-9
//   name:                 'Black Friday 2026',
//   active:               true,
//   type:                 'fixed' | 'percent',
//   value:                50,                         // RON for fixed, 1-100 for percent
//   startDate:            'YYYY-MM-DD',               // inclusive
//   endDate:              'YYYY-MM-DD',               // inclusive
//   visibility:           'public' | 'private',
//   assignedUserIds:      [],                         // required for private; allowed uids
//   maxRedemptionsTotal:  null | number,              // null = unlimited
//   redeemedCount:        0,                          // server-incremented
//   createdBy, createdAt, updatedAt
//
// Locked decisions (v1.6):
//   • Admin types the code (memorable). Uniqueness via doc-ID collision.
//   • Private vouchers bind by registered uid (anonymous users can't
//     redeem private codes).
//   • One redemption per user per code (enforced server-side via the
//     voucherRedemptions ledger).
//   • Vouchers cannot be combined. Only one applies per booking.

import {
  getCollection,
  getDocument,
  setDocument,
  removeDocument,
  orderBy,
} from '../firebase/db.js';
import { auditLog } from './auditService.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';

const COLLECTION = 'promoVouchers';
const CODE_PATTERN = /^[A-Z0-9]{3,24}$/;

const validateVoucherCodeFn = httpsCallable(functions, 'validateVoucherCode');

export function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCodeFormat(raw) {
  return CODE_PATTERN.test(String(raw || ''));
}

export async function listVouchers() {
  return getCollection(COLLECTION, orderBy('createdAt', 'desc')).catch(() => []);
}

export async function getVoucher(code) {
  return getDocument(COLLECTION, normalizeCode(code));
}

export async function saveVoucher(data) {
  const code = normalizeCode(data.code);
  if (!isValidCodeFormat(code)) {
    throw new Error('Invalid code format');
  }
  const nowIso = new Date().toISOString();
  const docData = {
    ...data,
    code,
    redeemedCount: data.redeemedCount || 0,
    updatedAt: nowIso,
    createdAt: data.createdAt || nowIso,
  };
  await setDocument(COLLECTION, code, docData);
  await auditLog('promo_voucher_saved', COLLECTION, code, null, {
    name: data.name, type: data.type, value: data.value, active: data.active,
  });
  return docData;
}

export async function deleteVoucher(code) {
  const norm = normalizeCode(code);
  await removeDocument(COLLECTION, norm);
  await auditLog('promo_voucher_deleted', COLLECTION, norm, null, null);
}

// Server-side preview — caller passes the code + base amount + plate so
// the server can check eligibility (date window, redemption ledger,
// private assignment) without actually redeeming. Returns
// `{ ok, discountAmount, type, value, voucherCode, name }` on success or
// `{ ok: false, error: '<reason>' }` on failure. Used by booking pages
// to show the customer their applied discount before they pay.
export async function previewVoucher({ code, plate, baseAmount, orderType }) {
  if (!code) return { ok: false, error: 'no-code' };
  const res = await validateVoucherCodeFn({
    code: normalizeCode(code),
    plate,
    baseAmount,
    orderType,
  });
  return res?.data || { ok: false, error: 'no-response' };
}
