// Server-authoritative price computation. Used by createPayment to
// reject any client that submits a tampered `totalPrice` — without
// this guard the browser can POST `totalPrice: 1` and pay 1 RON for a
// 30-day booking.
//
// What we recompute:
//   • Long-term: re-derive billing days from dropoffAt/pickupAt, look
//     up the canonical rate tiers (default + any active seasonal
//     override matching the PICK-UP day in Europe/Bucharest local time),
//     and compute the expected ONLINE total. Compare to body.totalPrice.
//     The pay-at-pickup gross-up and voucher subtraction stay on top of
//     this validated base — no recompute needed there.
//   • Credits: look up the pack by packId and require the canonical
//     price + quantity match the submitted values.
//
// Tolerance: 0 RON. Everything is whole-lei integers; any mismatch is
// either a client bug or an attempt. We reject loudly so the dev sees it.

import { getFirestore } from 'firebase-admin/firestore';

const BILLING_GRACE_MS = 2 * 60 * 60 * 1000;
const BUCHAREST_TZ = 'Europe/Bucharest';

// Local-date extraction in the Bucharest timezone. Critical so a 02:00
// pick-up doesn't get bucketed into the previous calendar day's period
// because the server happens to run in UTC.
// Exported (with the three helpers below) for functions/test/pricing.test.js —
// the pure core of the authoritative pricer, testable without Firestore.
export function bucharestDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  // 'sv-SE' gives YYYY-MM-DD format directly.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: BUCHAREST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function billingDays(dropMs, pickMs) {
  const dur = pickMs - dropMs;
  if (!Number.isFinite(dur) || dur <= 0) return 0;
  return Math.max(1, Math.ceil((dur - BILLING_GRACE_MS) / 86_400_000));
}

export function tierForDays(days, tiers) {
  return tiers.find((t) =>
    days >= t.minDays && (t.maxDays == null || days <= t.maxDays)
  ) || tiers[tiers.length - 1];
}

export function findActivePeriod(periods, dayStr) {
  if (!dayStr) return null;
  for (const p of periods) {
    if (!p.active) continue;
    if (!p.startDate || !p.endDate) continue;
    if (dayStr >= p.startDate && dayStr <= p.endDate) return p;
  }
  return null;
}

// Returns { ok, days, expected, periodId, error? }
export async function computeAuthoritativeLongTermTotal({ dropoffAt, pickupAt }) {
  if (!dropoffAt || !pickupAt) {
    return { ok: false, error: 'missing-dates' };
  }
  const dropMs = new Date(dropoffAt).getTime();
  const pickMs = new Date(pickupAt).getTime();
  if (!Number.isFinite(dropMs) || !Number.isFinite(pickMs)) {
    return { ok: false, error: 'invalid-dates' };
  }
  if (pickMs <= dropMs) {
    return { ok: false, error: 'bad-range' };
  }

  const db = getFirestore();
  const [ratesSnap, periodsSnap] = await Promise.all([
    db.collection('settings').doc('longTermRates').get(),
    db.collection('seasonalPricing').get(),
  ]);
  const defaults = ratesSnap.exists ? ratesSnap.data() : null;
  if (!defaults?.tiers?.length) {
    return { ok: false, error: 'rates-not-configured' };
  }
  const periods = periodsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const pickupDay = bucharestDay(pickupAt);
  const period = findActivePeriod(periods, pickupDay);
  const effectiveTiers = (period?.tiers?.length ? period.tiers : defaults.tiers);

  const days = billingDays(dropMs, pickMs);
  if (days < 1) return { ok: false, error: 'zero-days' };
  const tier = tierForDays(days, effectiveTiers);
  const expected = days * Number(tier.perDay);

  return {
    ok: true,
    days,
    perDay: Number(tier.perDay),
    expected,
    periodId: period?.id || null,
    periodName: period?.name || null,
  };
}

// ── Promo voucher validation ─────────────────────────────────────────
//
// Server-authoritative voucher resolution. Used by createPayment to
// re-validate any client-submitted code before applying its discount,
// and by the standalone `validateVoucherCode` callable to preview
// eligibility for the booking UI.
//
// Returns either { ok: true, voucher, discountAmount, identityKey }
// or { ok: false, error: '<reason>' }.
//
// Constraints checked:
//   • Voucher exists, is active.
//   • Today (Bucharest local day) is between startDate and endDate inclusive.
//   • Private vouchers — caller's authedUid is in assignedUserIds.
//   • Public vouchers — anyone (authed or guest with plate identity).
//   • One redemption per identity (authedUid OR `plate:${plate}` for
//     guests) for fixed/percent. Days vouchers are SPLITTABLE instead:
//     each identity holds a day balance (the voucher value) that can be
//     spent across multiple bookings — a 7-day voucher covers a 3-day
//     stay now and a 4-day stay later. The balance lives in
//     voucherDayBalances/{CODE}_{identityKey} (server-written; updated
//     transactionally by createPayment).
//   • maxRedemptionsTotal not exceeded. For days vouchers the cap counts
//     DISTINCT holders (an identity's first redemption), so returning
//     holders can keep splitting their remaining days after the cap fills.
//   • Days vouchers — long-term orders only (orderType === 'longTerm').
//
// Discount calculation:
//   • Fixed RON: min(value, baseAmount - 1) — keep order amount ≥ 1 RON.
//   • Percent: round(baseAmount * value / 100), capped at baseAmount - 1.
//   • Days: min(remaining days, bookedDays) × perDay — free days valued
//     at the booking's own (tier/seasonal-aware) daily rate. May cover
//     the WHOLE amount: a fully-covered order skips Netopia entirely
//     (createPayment fulfils it immediately as paidBy='voucher').
//
// `days`/`perDay` context: createPayment passes the server-recomputed
// values from computeAuthoritativeLongTermTotal (authoritative); the
// validateVoucherCode preview callable passes client-supplied ones
// (display-only — pay time always re-resolves with authoritative data).
//
// Days-voucher success extras: `daysUsed` (days this order consumes) and
// `daysAvailable` (balance BEFORE this order) ride along on the result.
export async function resolveVoucher({ code, plate, baseAmount, authedUid, orderType, days, perDay }) {
  if (!code) return { ok: false, error: 'no-code' };
  if (!Number.isFinite(Number(baseAmount)) || Number(baseAmount) <= 0) {
    return { ok: false, error: 'bad-base-amount' };
  }
  const normCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normCode) return { ok: false, error: 'invalid-code' };

  const db = getFirestore();
  const ref = db.collection('promoVouchers').doc(normCode);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'not-found' };
  const v = snap.data();

  if (!v.active) return { ok: false, error: 'inactive' };

  // Credits gift vouchers aren't a purchase discount — they grant free
  // parking credits via the standalone redeemCreditVoucher flow. Refuse them
  // here so the checkout discount box points the customer at the redeem box.
  if (v.type === 'credits') return { ok: false, error: 'gift-only' };

  const today = bucharestDay(new Date().toISOString());
  // Compare on date-only strings — tolerate any accidental time component on
  // the stored value so a "2026-06-11T00:00:00" can't read as after today.
  const startDay = v.startDate ? String(v.startDate).slice(0, 10) : null;
  const endDay = v.endDate ? String(v.endDate).slice(0, 10) : null;
  if (startDay && today < startDay) return { ok: false, error: 'not-yet-active' };
  if (endDay && today > endDay) return { ok: false, error: 'expired' };

  if (v.visibility === 'private') {
    if (!authedUid) return { ok: false, error: 'must-be-logged-in' };
    if (!Array.isArray(v.assignedUserIds) || !v.assignedUserIds.includes(authedUid)) {
      return { ok: false, error: 'not-assigned' };
    }
  }

  // Days vouchers only make sense on long-term bookings and need the
  // booking's day count + daily rate to value the discount.
  if (v.type === 'days') {
    if (orderType !== 'longTerm') return { ok: false, error: 'longterm-only' };
    if (!Number.isFinite(Number(days)) || Number(days) < 1
        || !Number.isFinite(Number(perDay)) || Number(perDay) <= 0) {
      return { ok: false, error: 'no-days-context' };
    }
  }

  // Identity key for redemption enforcement. Registered users key off
  // their uid; guests key off the normalized plate. Without a plate or
  // uid we cannot enforce the rule and must refuse.
  let identityKey = null;
  if (authedUid) {
    identityKey = `uid:${authedUid}`;
  } else if (plate) {
    const norm = String(plate).toUpperCase().replace(/\s+/g, '');
    if (norm) identityKey = `plate:${norm}`;
  }
  if (!identityKey) return { ok: false, error: 'no-identity' };

  // Usage check. Fixed/percent are one-shot per identity. Days vouchers
  // hold a per-identity day balance that can be split across bookings —
  // tracked in voucherDayBalances/{CODE}_{identityKey} (server-written,
  // transactionally updated by createPayment so concurrent splits can't
  // overdraw). Refuse only once the balance is gone.
  let daysAvailable = null;
  let isFirstUse = true;
  if (v.type === 'days') {
    const balSnap = await db.collection('voucherDayBalances')
      .doc(`${normCode}_${identityKey}`)
      .get();
    const used = balSnap.exists ? Number(balSnap.data().daysUsed) || 0 : 0;
    isFirstUse = !balSnap.exists;
    daysAvailable = Math.max(0, Number(v.value) - used);
    if (daysAvailable <= 0) return { ok: false, error: 'no-days-left' };
  } else {
    const dupSnap = await db.collection('voucherRedemptions')
      .where('voucherCode', '==', normCode)
      .where('identityKey', '==', identityKey)
      .limit(1)
      .get();
    if (!dupSnap.empty) return { ok: false, error: 'already-used' };
  }

  // Total-cap check — counts one-shot redemptions, or distinct holders
  // for days vouchers (so a returning holder can keep splitting their
  // remaining days even after the cap fills).
  if (isFirstUse
      && Number.isFinite(Number(v.maxRedemptionsTotal)) && Number(v.maxRedemptionsTotal) > 0
      && Number(v.redeemedCount || 0) >= Number(v.maxRedemptionsTotal)) {
    return { ok: false, error: 'sold-out' };
  }

  const base = Number(baseAmount);
  let discount; // every type branch assigns; unknown types return early
  let daysUsed = null;
  if (v.type === 'fixed') {
    discount = Math.min(Number(v.value), base - 1);
  } else if (v.type === 'percent') {
    discount = Math.round((base * Number(v.value)) / 100);
    if (discount >= base) discount = base - 1;
  } else if (v.type === 'days') {
    // Free days valued at the booking's own daily rate; capped at the
    // booked days so 3 remaining days on a 2-day booking spend only 2.
    // Deliberately NOT capped at base-1 — full coverage means a free
    // booking (createPayment short-circuits Netopia when amount hits 0).
    daysUsed = Math.min(daysAvailable, Number(days));
    discount = Math.min(daysUsed * Number(perDay), base);
  } else {
    return { ok: false, error: 'unknown-type' };
  }
  if (discount <= 0) return { ok: false, error: 'no-discount' };

  return {
    ok: true,
    voucher: {
      code: normCode,
      name: v.name,
      type: v.type,
      value: Number(v.value),
    },
    discountAmount: discount,
    identityKey,
    daysUsed,
    daysAvailable,
    isFirstUse,
  };
}

// Returns { ok, expectedPrice, error? }
export async function computeAuthoritativePackPrice({ packId, quantity }) {
  if (!packId) return { ok: false, error: 'missing-packId' };
  const db = getFirestore();
  const snap = await db.collection('tokenPacks').doc(packId).get();
  if (!snap.exists) return { ok: false, error: 'pack-not-found' };
  const data = snap.data();
  if (data.active === false) return { ok: false, error: 'pack-inactive' };
  const expectedPrice = Number(data.price);
  const expectedQty = Number(data.quantity);
  if (quantity != null && Number(quantity) !== expectedQty) {
    return { ok: false, error: 'quantity-mismatch', expectedPrice, expectedQty };
  }
  return { ok: true, expectedPrice, expectedQty };
}
