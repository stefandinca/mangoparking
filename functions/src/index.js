// Mango Parking Cloud Functions — Netopia Mobilpay v2 payment bridge.
//
// Flow:
//   1. Client → POST createPayment
//      → returns { action, env_key, data, cipher, iv, orderId }
//      → client auto-submits a POST form to `action` (Netopia hosted page)
//   2. User pays on Netopia.
//   3. Netopia → POST netopiaCallback (server-to-server)
//      → decrypt envelope with merchant private key
//      → parse XML, check action==='confirmed' (or 'paid')
//      → credit tokens / create booking
//      → respond with <crc>success</crc>
//   4. Netopia → redirects browser to the merchant `return_url`
//      → client-side success page reads ?orderId=... and polls status.
//
// Integration reference: https://github.com/mobilpay/Node.js (official PoC)
//
// Secrets (bind via `firebase functions:secrets:set`):
//   NETOPIA_SIGNATURE    — merchant POS signature string (goes in XML <signature>)
//   NETOPIA_PUBLIC_KEY   — PEM, used to encrypt outgoing requests
//   NETOPIA_PRIVATE_KEY  — PEM, used to decrypt IPN callbacks
//   NETOPIA_ENV          — 'sandbox' or 'live' (defaults to sandbox)
//   NETOPIA_API_KEY      — currently unused; reserved for the v3 REST API

import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import {
  NETOPIA_ENDPOINTS,
  encryptRequest,
  decryptIpn,
  buildRequestXml,
  crcSuccess,
  crcError,
} from './netopia.js';
import { BREVO_API_KEY, sendBrevoEmail } from './brevo.js';
import { sendRepayPaidEmail, sendRefundIssuedEmail, sendBookingConfirmationEmail } from './emails.js';
import { notifyAdminPasswordReset } from './adminNotifications.js';
import { computeAuthoritativeLongTermTotal, computeAuthoritativePackPrice, resolveVoucher } from './pricingValidate.js';
import {
  SMARTBILL_SECRETS,
  listSeries,
  listTaxes,
  DEFAULT_VAT_PERCENT,
  PROFORMA_SERIES,
  INVOICE_SERIES,
  matchSeries,
  ABROAD_CNP,
  buildInvoicePayload,
  checkBillingComplete,
  issueInvoice,
  deleteInvoice,
  issueEstimate,
  deleteEstimate,
  reverseInvoice,
} from './smartbill.js';

// Email triggers (Phase E) — re-exported so firebase deploy picks them up.
export { onUserCreated, onBookingCreated, onTokenTransactionCreated, onContactMessageCreated, onPromoVoucherAssigned } from './emails.js';

// Internal ops alerts to rezervari@ — customer activity (signup, reservation,
// cancellation, credit purchase). Inline-HTML sends, no Brevo template.
export {
  adminNotifyUserCreated,
  adminNotifyBookingCreated,
  adminNotifyBookingCancelled,
  adminNotifyCreditPurchase,
} from './adminNotifications.js';

// ANAF CUI lookup callable (Phase B4).
export { lookupCui } from './cui.js';

// Flight-status lookup — flags delayed/cancelled flights on the admin board.
// Dormant until a flight API key is configured (see flightStatus.js).
export { lookupFlightStatuses } from './flightStatus.js';

// Scheduled jobs (Phase F).
export { daily24hReminders, commuter7PMCheck, expireStaleHolds, markNoShows } from './scheduled.js';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const NETOPIA_SIGNATURE   = defineSecret('NETOPIA_SIGNATURE');
const NETOPIA_PUBLIC_KEY  = defineSecret('NETOPIA_PUBLIC_KEY');
const NETOPIA_PRIVATE_KEY = defineSecret('NETOPIA_PRIVATE_KEY');
const NETOPIA_ENV         = defineSecret('NETOPIA_ENV');       // 'sandbox' | 'live'
const NETOPIA_API_KEY     = defineSecret('NETOPIA_API_KEY');   // reserved

const SITE_URL = process.env.SITE_URL || 'https://mangoparking.ro';
// `netopiaCallback` is a separate Cloud Run service in Gen 2 — its hostname
// differs from `createPayment`, so we can't derive it from `req.host`.
// Override per environment via NETOPIA_CALLBACK_URL when redeploying.
const CALLBACK_URL =
  process.env.NETOPIA_CALLBACK_URL
  || 'https://netopiacallback-zddpe6b7fa-ew.a.run.app';

function normalizePlate(plate) {
  return String(plate || '').toUpperCase().replace(/[\s-]/g, '');
}

// Lowercased, trimmed email — the canonical stored form. mergeGuestData links
// guest data to accounts by email equality and Firestore equality is
// case-sensitive: a booking saved with a phone-auto-capitalized "Roxana@…"
// would otherwise never link to the roxana@… account.
function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

// `hour`:00 Europe/Bucharest on the local calendar day of `iso`, as an ISO
// string. Commuter (credit) check-ins use this as their pick-up deadline —
// "leave by 8 PM the same day" — instead of mirroring the drop-off time.
// DST-correct: anchors the wall-clock hour via the zone's offset at that day.
function bucharestCutoffIso(iso, hour = 20) {
  const base = iso ? new Date(iso) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(base); // YYYY-MM-DD
  const guessUtc = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(guessUtc)) return null;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(new Date(guessUtc)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const h = +p.hour === 24 ? 0 : +p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
  const offMin = Math.round((asUtc - guessUtc) / 60000);
  return new Date(guessUtc - offMin * 60000).toISOString();
}

function balanceDocId({ customerId, licensePlate }) {
  return customerId || `plate_${normalizePlate(licensePlate)}`;
}

// Record a plate on the customer's profile (users/{uid}.vehicles) unless it is
// already listed. Guests book without an account, so the plate they actually
// parked with only reaches a profile once one exists — without this the
// Vehicles list stays empty for anyone who never saved a vehicle by hand.
//
// Read-modify-write inside a transaction rather than arrayUnion: arrayUnion
// matches whole objects, so a {plate,make:'',model:''} entry would not dedupe
// against an existing {plate,make:'VW',model:'Golf'} for the same plate and the
// list would end up with the plate twice.
//
// Best-effort by design — a booking must never fail over a profile nicety.
async function addPlateToProfile(uid, rawPlate) {
  const plate = normalizePlate(rawPlate);
  if (!uid || !plate) return;
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      // Legacy entries are bare plate strings; current ones are objects.
      const vehicles = Array.isArray(snap.data().vehicles) ? snap.data().vehicles : [];
      const known = vehicles.some(
        (v) => normalizePlate(typeof v === 'string' ? v : v?.plate) === plate,
      );
      if (known) return;
      tx.update(ref, { vehicles: [...vehicles, { plate, make: '', model: '' }] });
    });
  } catch (err) {
    console.warn('vehicle profile cache failed:', err?.message);
  }
}

// Reservation codes — mirror of src/utils/bookingCode.js. Kept inline so
// the function bundle doesn't depend on the client tree. Ambiguous chars
// I/O/0/1 removed so the code reads cleanly over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateBookingCode(type) {
  const prefix = type === 'longTerm' ? 'LT' : type === 'credit' ? 'CR' : 'MNG';
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}

async function creditTokens({ packId, quantity, amount = 0, customerData, source = 'netopia', paidBy = null, grantedBy = null }) {
  const db = getFirestore();
  const docId = balanceDocId(customerData);
  const plate = normalizePlate(customerData.licensePlate);
  const ref = db.collection('tokenBalances').doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data();
      // Skip empty plates — an account-only grant (e.g. a gift to a uid with
      // no saved vehicle) has none, and we don't want '' in the array.
      const existingPlates = data.plates || [];
      const plates = (plate && !existingPlates.includes(plate)) ? [...existingPlates, plate] : existingPlates;
      // Patch contact details on the existing doc if they were missing —
      // a guest plate doc may have been created without an email, and
      // later signed up: we want resolveRecipient to find them.
      const patch = {
        balance: FieldValue.increment(quantity),
        totalPurchased: FieldValue.increment(quantity),
        plates,
      };
      if (!data.email && customerData.email) patch.email = normalizeEmail(customerData.email);
      if (!data.displayName && customerData.name) patch.displayName = customerData.name;
      if (!data.phone && customerData.phone) patch.phone = customerData.phone;
      tx.update(ref, patch);
    } else {
      tx.set(ref, {
        balance: quantity,
        totalPurchased: quantity,
        plates: plate ? [plate] : [],
        email: normalizeEmail(customerData.email),
        displayName: customerData.name || '',
        phone: customerData.phone || '',
      });
    }
  });

  const txRef = await db.collection('tokenTransactions').add({
    customerId: customerData.customerId || null,
    licensePlate: plate,
    type: 'purchase',
    quantity,
    // Total RON paid for this batch — required by the credit-purchase
    // email template; blank otherwise.
    amount: Number(amount) || 0,
    packId: packId || null,
    timestamp: new Date().toISOString(),
    source,
    paidBy,
    grantedBy,
    billing: customerData.billing || { type: 'PF' },
  });

  // Cache billing on the user profile for future pre-fill on subsequent purchases.
  if (customerData.customerId && customerData.billing) {
    await db.collection('users')
      .doc(customerData.customerId)
      .set({ billing: customerData.billing }, { merge: true })
      .catch((err) => console.warn('billing profile cache failed:', err?.message));
  }

  return { balanceDocId: docId, txId: txRef.id };
}

// Pick the first available spot and flip it to `reserved`, then return
// its id. Returns null if no spot is free — callers should treat that
// as "all reserved" and continue without a spotId (admin can assign
// manually from the capacity page).
//
// Uses a Firestore transaction so two concurrent reservations don't
// grab the same spot.
async function reserveAvailableSpot(bookingId) {
  const db = getFirestore();
  const snap = await db.collection('spots')
    .where('status', '==', 'available')
    .limit(1)
    .get();
  if (snap.empty) return null;

  const candidateId = snap.docs[0].id;
  const ref = db.collection('spots').doc(candidateId);

  try {
    return await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists || cur.data().status !== 'available') {
        return null;
      }
      tx.update(ref, {
        status: 'reserved',
        currentBookingId: bookingId || null,
      });
      return candidateId;
    });
  } catch (err) {
    console.warn('reserveAvailableSpot transaction failed:', err?.message);
    return null;
  }
}

async function createBookingFromOrder(orderId, order) {
  const db = getFirestore();
  const nowIso = new Date().toISOString();
  // Branch on the payment method so the booking is written with the
  // correct paymentStatus atomically — the onBookingCreated trigger
  // reads this exact snapshot to pick the email-template branch.
  const isPickup = order.paymentMethod === 'pay-at-pickup';
  // The booking total is what the customer is actually charged: online =
  // standard price minus the online discount (and any voucher), pay-at-pickup
  // = the standard price. `order.amount` carries that; fall back to the
  // standard total only for older orders that predate the field.
  const chargedAmount = Number.isFinite(Number(order.amount))
    ? Math.round(Number(order.amount))
    : Number(order.totalPrice);
  const bookingRef = await db.collection('bookings').add({
    // Orders mint the code up front (it's already on the proforma); older
    // orders without one still get a fresh code here.
    code: order.bookingCode || generateBookingCode('longTerm'),
    type: 'longTerm',
    customerId: order.customerData.customerId || null,
    licensePlate: normalizePlate(order.customerData.licensePlate),
    // Date-only fields kept for backward compat with older admin views
    // and existing booking docs. New canonical fields are dropoffAt/pickupAt.
    startDate: order.startDate,
    endDate: order.endDate,
    dropoffAt: order.dropoffAt || null,
    pickupAt: order.pickupAt || null,
    days: order.days,
    passengers: sanitizePassengers(order.customerData?.passengers),
    flightNumberDropoff: sanitizeFlight(order.customerData?.flightNumberDropoff),
    flightNumberPickup: sanitizeFlight(order.customerData?.flightNumberPickup),
    basePrice: chargedAmount,
    latePrice: 0,
    totalPrice: chargedAmount,
    status: 'upcoming',
    contact: {
      name: order.customerData.name || '',
      email: normalizeEmail(order.customerData.email),
      phone: order.customerData.phone || '',
    },
    billing: order.customerData.billing || { type: 'PF' },
    // Always reference the pendingOrders doc — admin "Mark paid" and the
    // pay-online repay link both need it. Field is no longer "paid via X"
    // semantics; it's just the order reference.
    paymentId: orderId,
    paymentMethod: isPickup ? 'pay-at-pickup' : 'online',
    paymentStatus: isPickup ? 'unpaid' : 'paid',
    paidAt: isPickup ? null : nowIso,
    // 'voucher' when a days-type voucher fully covered the amount (free
    // order — no Netopia charge happened); 'netopia' otherwise.
    paidBy: isPickup ? null : (order.paidBy || 'netopia'),
    spotId: null,
    createdAt: nowIso,
    completedAt: null,
    source: 'web',
  });

  // Reserve a spot only when the booking is already paid. Pay-at-pickup
  // bookings reserve later, when admin flips them to paid.
  if (!isPickup) {
    const spotId = await reserveAvailableSpot(bookingRef.id);
    if (spotId) {
      await bookingRef.update({ spotId });
    }
  }

  // Cache billing on the user profile for future pre-fill. Only when a
  // logged-in customer placed the order — guests have no profile to write to.
  if (order.customerData.customerId && order.customerData.billing) {
    await db.collection('users')
      .doc(order.customerData.customerId)
      .set({ billing: order.customerData.billing }, { merge: true })
      .catch((err) => console.warn('billing profile cache failed:', err?.message));
  }

  // Same idea for the plate — no-ops for guests (no uid to write to); they pick
  // it up instead when mergeGuestData links this booking to a new account.
  await addPlateToProfile(order.customerData.customerId, order.customerData.licensePlate);

  return bookingRef.id;
}

// ── SmartBill v1.2 Phase 2: document issuance on the paid flows ──────────
// Locked model (documentation/roadmap/v.1.2_smartbill.md): every order gets a
// PROFORMA up front; online-confirmed payments (Netopia IPN / repay) also get
// a FISCAL INVOICE. Pay-at-location money gets its invoice manually in the
// SmartBill UI after collection, so adminMarkOrderPaid issues nothing.
// A SmartBill failure must never break a money flow — issuance is best-effort
// and the outcome lands on the source docs under `smartbill.*` (server-written
// only; firestore.rules block the field from client writes).

// Both pinned series must resolve or nothing may be issued — issuing into a
// wrong series would pollute a real numbering sequence. Cached per instance;
// the names only change if someone renames them in the SmartBill UI.
let smartbillSeriesCache = null;
async function resolveSmartbillSeries() {
  if (smartbillSeriesCache) return smartbillSeriesCache;
  const [f, p] = await Promise.all([listSeries('f'), listSeries('p')]);
  const resolved = {
    invoice: matchSeries(seriesNames(f), INVOICE_SERIES),
    proforma: matchSeries(seriesNames(p), PROFORMA_SERIES),
  };
  if (!resolved.invoice || !resolved.proforma) {
    throw new Error(`SmartBill series missing (invoice=${resolved.invoice}, proforma=${resolved.proforma})`);
  }
  smartbillSeriesCache = resolved;
  return resolved;
}

// Documents carry the LOCAL fiscal date — at 01:00 in Bucharest the UTC date
// is still yesterday, and a wrong issueDate is a fiscal defect, not a nit.
function bucharestToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date());
}

// Stamp a smartbill.* patch onto every given doc ref, swallowing failures.
async function smartbillStamp(refs, patch, label) {
  await Promise.all(refs.map((ref) =>
    ref.update(patch).catch((err) => console.warn(`smartbill stamp failed (${label}):`, err?.message))
  ));
}

// One document line per sale, priced at the VAT-inclusive charged total —
// vouchers/discounts make a days×perDay split disagree with what was charged.
// Descriptions per client spec (2026-07-17): long-term references the
// reservation number; credits use the generic credits wording.
function longTermDocItems({ bookingCode, amount }) {
  return [{
    name: bookingCode
      ? `Servicii parcare conform rezervării ${bookingCode}`
      : 'Servicii parcare',
    quantity: 1,
    price: Number(amount) || 0,
    code: 'PARK-LT',
  }];
}

function creditsDocItems({ amount }) {
  return [{
    name: 'Servicii parcare - credite',
    quantity: 1,
    price: Number(amount) || 0,
    code: 'PARK-CR',
  }];
}

// Issue one SmartBill document (kind: 'proforma' | 'invoice') and stamp the
// outcome onto every given doc ref via dot-path updates (so an invoice stamp
// never clobbers the earlier proforma block). NEVER throws.
//   field  — smartbill.* key the block lands under (defaults to `kind`)
//   append — arrayUnion the block instead of overwriting (extension proformas,
//            partial stornos: several can accumulate on one booking)
//   statusOnSuccess — smartbill.status value to set; null leaves status alone
//            (adjustment documents must not mask 'invoiced')
async function smartbillIssueSafe({
  kind, billing, email, items, refs = [], label = '',
  field = kind,
  append = false,
  statusOnSuccess = kind === 'invoice' ? 'invoiced' : 'proforma-issued',
}) {
  const stamp = (patch) => smartbillStamp(refs, patch, label);
  // Adjustment documents (statusOnSuccess: null) leave smartbill.status alone
  // on failure too — a failed extension proforma must not mask 'invoiced'.
  const failPatch = (msg) => ({
    ...(statusOnSuccess ? { 'smartbill.status': 'failed' } : {}),
    'smartbill.lastError': msg,
  });
  try {
    const complete = checkBillingComplete(billing || {});
    if (!complete.ok) {
      await stamp(failPatch(`billing incomplete: ${complete.missing.join(', ')}`));
      return null;
    }
    const series = await resolveSmartbillSeries();
    const seriesName = kind === 'invoice' ? series.invoice : series.proforma;
    const res = await (kind === 'invoice' ? issueInvoice : issueEstimate)(
      buildInvoicePayload({
        billing: { ...billing, email: billing?.email || email || '' },
        items,
        seriesName,
        issueDate: bucharestToday(),
      })
    );
    const block = {
      series: seriesName,
      number: res?.number ?? null,
      issuedAt: new Date().toISOString(),
    };
    await stamp({
      [`smartbill.${field}`]: append ? FieldValue.arrayUnion(block) : block,
      ...(statusOnSuccess ? { 'smartbill.status': statusOnSuccess } : {}),
      // A replacement proforma revives the "there is a live proforma" state.
      ...(field === 'proforma' && !append ? { 'smartbill.proformaDeleted': FieldValue.delete() } : {}),
      'smartbill.lastError': null,
    });
    return block;
  } catch (err) {
    console.error(`smartbill ${kind} issue failed (${label}):`, err?.message);
    await stamp(failPatch(String(err?.message || err)));
    return null;
  }
}

// ── Phase 4: document invalidation on cancellation ───────────────────────
// Best-effort like issuance — fiscal cleanup must never block a cancellation.

// Delete the (non-fiscal) proforma of a cancelled/expired order or booking.
async function smartbillDeleteProformaSafe({ sb, refs = [], label = '' }) {
  const p = sb?.proforma;
  if (!p?.number || sb?.proformaDeleted) return;
  try {
    await deleteEstimate(p.series, p.number);
    await smartbillStamp(refs, { 'smartbill.proformaDeleted': true }, label);
  } catch (err) {
    // Common benign cause: staff already converted/deleted it in the UI.
    console.warn(`smartbill proforma delete failed (${label}):`, err?.message);
    await smartbillStamp(refs, { 'smartbill.lastError': `proforma delete: ${err?.message || err}` }, label);
  }
}

// Invalidate the fiscal invoice of a cancelled paid booking — ALWAYS via
// storno (reverse), even on the issue day. Client decision 2026-07-17: no
// anulare; a reversing invoice is the safer trail in every case (the earlier
// same-day-anulare branch is gone). Stamps smartbill.status = 'storno'
// (+ smartbill.storno block) or 'cancel-failed'.
async function smartbillCancelInvoiceSafe({ sb, refs = [], label = '' }) {
  const inv = sb?.invoice;
  if (!inv?.number) return;
  if (['cancelled', 'storno'].includes(sb?.status)) return; // idempotent
  try {
    const res = await reverseInvoice(inv.series, inv.number, bucharestToday());
    await smartbillStamp(refs, {
      'smartbill.storno': {
        series: res?.series || inv.series,
        number: res?.number ?? null,
        issuedAt: new Date().toISOString(),
        ...(res?.documentViewUrl ? { viewUrl: res.documentViewUrl } : {}),
      },
      'smartbill.status': 'storno',
      'smartbill.lastError': null,
    }, label);
  } catch (err) {
    console.error(`smartbill invoice storno failed (${label}):`, err?.message);
    await smartbillStamp(refs, {
      'smartbill.status': 'cancel-failed',
      'smartbill.lastError': String(err?.message || err),
    }, label);
  }
}

// ── POST /createPayment ──────────────────────────────────────────────────
// Body (credits):   { orderType:'credits',  packId, quantity, customerData }
// Body (longTerm):  { orderType:'longTerm', startDate, endDate, days, totalPrice, customerData }
// customerData: { customerId?, licensePlate, name, email, phone }
//
// Returns: { action, env_key, data, cipher, iv, orderId }
//   → client builds a POST form with those three/four fields and submits to `action`.
export const createPayment = onRequest(
  {
    cors: true,
    secrets: [NETOPIA_SIGNATURE, NETOPIA_PUBLIC_KEY, NETOPIA_ENV, ...SMARTBILL_SECRETS],
  },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const body = req.body || {};
    const orderType = body.orderType || 'credits';
    const cd = body.customerData || {};
    if (!cd.licensePlate) return res.status(400).json({ error: 'Missing licensePlate' });
    if (orderType === 'credits' && (!body.packId || !body.quantity)) {
      return res.status(400).json({ error: 'credits order requires packId + quantity' });
    }
    if (orderType === 'longTerm' && (!body.days || !body.totalPrice)) {
      return res.status(400).json({ error: 'longTerm order requires days + totalPrice' });
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const paymentMethod = body.paymentMethod === 'pay-at-pickup' ? 'pay-at-pickup' : 'online';

    // Compute amount (RON) per funnel. Stored prices are the STANDARD
    // (on-site) price; online orders get the online-payment discount
    // applied below, pay-at-pickup orders pay the standard price unchanged.
    let amount;
    let details;
    // Authoritative day-count + daily rate from the long-term recompute —
    // consumed by days-type vouchers (N free days × this rate).
    let authoritativeDays = null;
    let authoritativePerDay = null;
    if (orderType === 'longTerm') {
      // Server-authoritative recomputation — re-derive the expected
      // online total from the canonical rates + seasonal periods and
      // require an exact match against what the client sent. Without
      // this, a tampered totalPrice would be charged as-is.
      const check = await computeAuthoritativeLongTermTotal({
        dropoffAt: body.dropoffAt,
        pickupAt: body.pickupAt,
      }).catch((err) => ({ ok: false, error: `compute-failed:${err?.message || 'unknown'}` }));
      if (!check.ok) {
        console.warn('createPayment longTerm price validation refused:', check.error, { dropoffAt: body.dropoffAt, pickupAt: body.pickupAt });
        return res.status(400).json({ error: `price validation failed: ${check.error}` });
      }
      const submitted = Number(body.totalPrice);
      if (!Number.isFinite(submitted) || submitted <= 0) {
        return res.status(400).json({ error: 'invalid totalPrice' });
      }
      if (submitted !== check.expected) {
        console.warn('createPayment longTerm price mismatch:', { submitted, expected: check.expected, days: check.days, periodId: check.periodId, plate: cd.licensePlate });
        return res.status(400).json({
          error: 'price mismatch — refresh the page and try again',
          expected: check.expected,
        });
      }
      amount = check.expected;
      authoritativeDays = check.days;
      authoritativePerDay = check.perDay;
      details = `Mango Parking — parcare pe termen lung (${check.days} zile)`;
    } else {
      // Credits — recompute against the canonical token pack to
      // prevent submitting a discounted price for a premium pack.
      const packCheck = await computeAuthoritativePackPrice({
        packId: body.packId,
        quantity: body.quantity,
      }).catch((err) => ({ ok: false, error: `compute-failed:${err?.message || 'unknown'}` }));
      if (!packCheck.ok) {
        console.warn('createPayment credits price validation refused:', packCheck.error, { packId: body.packId, quantity: body.quantity });
        return res.status(400).json({ error: `pack validation failed: ${packCheck.error}` });
      }
      const submitted = Number(body.packPrice || body.totalPrice || 0);
      if (!Number.isFinite(submitted) || submitted <= 0) {
        return res.status(400).json({ error: 'invalid packPrice' });
      }
      if (submitted !== packCheck.expectedPrice) {
        console.warn('createPayment credits price mismatch:', { submitted, expected: packCheck.expectedPrice, packId: body.packId, plate: cd.licensePlate });
        return res.status(400).json({
          error: 'price mismatch — refresh the page and try again',
          expected: packCheck.expectedPrice,
        });
      }
      amount = packCheck.expectedPrice;
      details = `Mango Parking — pachet ${packCheck.expectedQty} credite`;
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Missing or invalid amount' });
    }

    if (paymentMethod === 'online') {
      // Apply the live online-payment discount on top of the standard price.
      // Runs BEFORE voucher resolution so the voucher subtracts from the
      // already-discounted online amount. Pay-at-pickup skips this entirely
      // and is charged the standard price.
      const settingsSnap = await getFirestore().collection('settings').doc('global').get();
      const discountPct = Number(settingsSnap.exists ? settingsSnap.data().onlineDiscountPercent : 10);
      if (Number.isFinite(discountPct) && discountPct > 0 && discountPct < 100) {
        amount = Math.round(amount * (1 - discountPct / 100));
      }
    }

    // Voucher application — supports BOTH the legacy `vouchers/{uid}`
    // signup-bonus (already-issued users) AND the new `promoVouchers/{code}`
    // system (admin-created codes). Promo wins when both are submitted —
    // vouchers cannot be combined.
    //
    // Applied to BOTH online and pay-at-pickup orders. `amount` is already
    // method-correct here (online = discounted, pickup = standard), so the
    // voucher subtracts from the right base; for pickup the reduced amount is
    // what the agent collects at the lot.
    let voucherAmount = 0;
    let voucherId = null;       // legacy signup voucher id (== uid)
    let promoVoucherCode = null; // new promoVouchers code
    let promoVoucherDoc = null;  // resolved voucher details for the redemption record

    {
      // Establish caller identity once — used by both voucher paths.
      const idToken = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      let authedUid = null;
      if (idToken) {
        try {
          const decoded = await getAuth().verifyIdToken(idToken);
          authedUid = decoded.uid;
        } catch (err) {
          console.warn('createPayment: bad ID token, ignoring vouchers:', err?.message);
        }
      }

      // NEW path: promo voucher code.
      if (body.voucherCode) {
        const promoRes = await resolveVoucher({
          code: body.voucherCode,
          plate: cd.licensePlate,
          baseAmount: amount,
          authedUid,
          orderType,
          days: authoritativeDays,
          perDay: authoritativePerDay,
        });
        if (promoRes.ok) {
          voucherAmount = promoRes.discountAmount;
          promoVoucherCode = promoRes.voucher.code;
          promoVoucherDoc = {
            ...promoRes.voucher,
            identityKey: promoRes.identityKey,
            // Days vouchers: how many days this order consumes from the
            // identity's balance (null for fixed/percent).
            daysUsed: promoRes.daysUsed ?? null,
          };
          amount = amount - voucherAmount;
        } else {
          // The booking page previewed the code, so a refusal here means
          // it expired or got fully redeemed between preview and pay.
          // Surface clearly so the client can drop the code and retry.
          console.warn('createPayment promo voucher refused:', promoRes.error, { code: body.voucherCode, plate: cd.licensePlate });
          return res.status(400).json({ error: `voucher: ${promoRes.error}` });
        }
      }
      // LEGACY path: signup bonus (only when no promo code was applied).
      else if (body.voucherId && cd.customerId && body.voucherId === cd.customerId && authedUid && authedUid === cd.customerId) {
        try {
          const v = await getFirestore().collection('vouchers').doc(body.voucherId).get();
          if (v.exists) {
            const data = v.data();
            if (data.userId === authedUid
                && data.status === 'unused'
                && Number(data.amount) > 0
                && Number(data.amount) < amount) {  // strict <: keep amount > 0 for Netopia
              voucherAmount = Number(data.amount);
              voucherId = body.voucherId;
              amount = amount - voucherAmount;
            }
          }
        } catch (err) {
          console.warn('Voucher lookup failed (ignoring):', err);
        }
      }
    }

    // Persist pending order. The IPN callback replays it for online
    // orders; adminMarkOrderPaid replays it for pay-at-pickup orders.
    //
    // WHITELISTED fields only — this endpoint is public, and spreading the
    // raw body let a caller smuggle server-owned fields into the order
    // (`bookingId` → the IPN would flip an ARBITRARY booking to paid off a
    // cheap 1-day charge; `repayAmount` → overwrite its stored price).
    const cdClean = {
      customerId: cd.customerId || null,
      licensePlate: String(cd.licensePlate),
      name: String(cd.name || '').slice(0, 200),
      email: normalizeEmail(cd.email).slice(0, 200),
      phone: String(cd.phone || '').slice(0, 40),
      billing: sanitizeBilling(cd.billing),
      passengers: cd.passengers ?? null,
      flightNumberDropoff: cd.flightNumberDropoff || null,
      flightNumberPickup: cd.flightNumberPickup || null,
    };
    const pendingDoc = {
      orderType,
      ...(orderType === 'longTerm' ? {
        startDate: body.startDate || String(body.dropoffAt || '').slice(0, 10) || null,
        endDate: body.endDate || String(body.pickupAt || '').slice(0, 10) || null,
        dropoffAt: body.dropoffAt || null,
        pickupAt: body.pickupAt || null,
        // Authoritative day count from the server recompute — the client's
        // `days` is unvalidated and can disagree with the validated dates.
        days: authoritativeDays ?? (Number(body.days) || null),
        totalPrice: Number(body.totalPrice) || null,
        // Reservation number minted at ORDER time so the proforma can already
        // reference it; createBookingFromOrder reuses it on the booking doc.
        bookingCode: generateBookingCode('longTerm'),
      } : {
        packId: body.packId,
        quantity: Number(body.quantity) || 0,
        totalPrice: Number(body.packPrice || body.totalPrice) || null,
      }),
      customerData: cdClean,
      amount,
      voucherId,                 // legacy signup voucher; null otherwise
      voucherAmount,             // RON discount, regardless of which voucher path
      promoVoucherCode,          // new promo voucher code; null when not used
      voucherDaysUsed: promoVoucherDoc?.daysUsed ?? null, // days vouchers: days consumed by this order
      status: 'pending',
      paymentMethod,
      paymentStatus: 'unpaid',
      paidAt: null,
      paidBy: null,
      createdAt: new Date().toISOString(),
    };

    // Atomic redemption record + counter increment for the promo voucher.
    // Done BEFORE writing the pending order so a stampede on the same code
    // can't get two requests past the duplicate-check inside resolveVoucher.
    // If the transaction throws (e.g. someone else just claimed the last
    // slot of a capped voucher), surface 409 so the customer can re-enter.
    if (promoVoucherCode && promoVoucherDoc) {
      try {
        await getFirestore().runTransaction(async (tx) => {
          const voucherRef = getFirestore().collection('promoVouchers').doc(promoVoucherCode);
          const vSnap = await tx.get(voucherRef);
          if (!vSnap.exists) throw new HttpsError('not-found', 'voucher disappeared mid-flight');
          const vData = vSnap.data();
          const isDays = promoVoucherDoc.type === 'days';

          // Race-safe usage guard — resolveVoucher already checked but a
          // concurrent createPayment from the same identity could slip.
          // Fixed/percent: one redemption per identity. Days: the
          // per-identity balance doc is read INSIDE the transaction so
          // two concurrent splits can't overdraw (doc-level locking).
          let isFirstUse = true;
          let balanceRef = null;
          let newDaysUsed = null;
          if (isDays) {
            balanceRef = getFirestore().collection('voucherDayBalances')
              .doc(`${promoVoucherCode}_${promoVoucherDoc.identityKey}`);
            const balSnap = await tx.get(balanceRef);
            const used = balSnap.exists ? Number(balSnap.data().daysUsed) || 0 : 0;
            isFirstUse = !balSnap.exists;
            const grant = Number(promoVoucherDoc.daysUsed);
            if (used + grant > Number(vData.value)) {
              throw new HttpsError('already-exists', 'voucher day balance exhausted');
            }
            newDaysUsed = used + grant;
          } else {
            const dupSnap = await getFirestore().collection('voucherRedemptions')
              .where('voucherCode', '==', promoVoucherCode)
              .where('identityKey', '==', promoVoucherDoc.identityKey)
              .limit(1)
              .get();
            if (!dupSnap.empty) throw new HttpsError('already-exists', 'voucher already redeemed by this identity');
          }

          // Total cap: counts one-shot redemptions, or distinct holders
          // for days vouchers — a returning holder splitting their
          // remaining days doesn't consume another cap slot.
          const cap = Number(vData.maxRedemptionsTotal);
          if (isFirstUse && Number.isFinite(cap) && cap > 0 && Number(vData.redeemedCount || 0) >= cap) {
            throw new HttpsError('already-exists', 'voucher fully redeemed');
          }

          if (isDays) {
            tx.set(balanceRef, {
              voucherCode: promoVoucherCode,
              identityKey: promoVoucherDoc.identityKey,
              daysUsed: newDaysUsed,
              updatedAt: new Date().toISOString(),
            });
          }

          // Days vouchers split across bookings (many redemptions per
          // identity) → auto-id, with the balance doc above as the lock.
          // Fixed/percent are one-shot per identity → deterministic id so a
          // concurrent second redemption hits tx.create's already-exists and
          // is rejected (the plain `where` query above isn't transactional).
          const redemptionRef = isDays
            ? getFirestore().collection('voucherRedemptions').doc()
            : getFirestore().collection('voucherRedemptions').doc(`${promoVoucherCode}_${promoVoucherDoc.identityKey}`);
          const redemptionData = {
            voucherCode: promoVoucherCode,
            identityKey: promoVoucherDoc.identityKey,
            userId: cd.customerId || null,
            plate: cd.licensePlate || null,
            orderId,
            bookingId: null,             // patched by IPN handler for online
            amount: voucherAmount,
            type: promoVoucherDoc.type,
            value: promoVoucherDoc.value,
            daysUsed: isDays ? Number(promoVoucherDoc.daysUsed) : null,
            redeemedAt: new Date().toISOString(),
          };
          if (isDays) tx.set(redemptionRef, redemptionData);
          else tx.create(redemptionRef, redemptionData);
          if (isFirstUse) {
            tx.update(voucherRef, { redeemedCount: (Number(vData.redeemedCount) || 0) + 1 });
          }
        });
      } catch (err) {
        console.warn('createPayment voucher redemption failed:', err?.message);
        return res.status(409).json({ error: `voucher: ${err?.message || 'redemption-failed'}` });
      }
    }

    // Free-order short-circuit: a days-type voucher can cover the WHOLE
    // amount (fixed/percent are capped at base-1, credits can never reach
    // 0). Nothing to charge online and nothing to collect at the lot, so
    // fulfil immediately regardless of the chosen method — create the booking
    // as paid (paidBy='voucher') and send the client to the confirmation
    // page. The redemption record was already written atomically above.
    if (amount <= 0) {
      if (orderType !== 'longTerm') {
        // Defensive — resolveVoucher refuses days vouchers on credits.
        console.warn('createPayment: zero amount on non-longTerm order refused', { orderId, orderType });
        return res.status(400).json({ error: 'voucher: no-discount' });
      }
      const nowIso = new Date().toISOString();
      const bookingId = await createBookingFromOrder(orderId, {
        ...pendingDoc,
        paymentMethod: 'online',
        paidBy: 'voucher',
        amount: 0, // fully covered by the days voucher — nothing charged
      });
      pendingDoc.amount = 0;
      pendingDoc.status = 'paid';
      pendingDoc.paymentStatus = 'paid';
      pendingDoc.paidAt = nowIso;
      pendingDoc.paidBy = 'voucher';
      pendingDoc.bookingId = bookingId;
      await getFirestore().collection('pendingOrders').doc(orderId).set(pendingDoc);
      // Stamp the redemption with the booking it produced (best-effort —
      // the IPN handler does the same for paid-via-Netopia orders).
      try {
        const redSnap = await getFirestore().collection('voucherRedemptions')
          .where('orderId', '==', orderId).limit(1).get();
        if (!redSnap.empty) await redSnap.docs[0].ref.update({ bookingId });
      } catch (err) {
        console.warn('free-order redemption bookingId stamp failed:', err?.message);
      }
      return res.json({
        orderId,
        free: true,
        redirectUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      });
    }

    // For pay-at-pickup longTerm bookings, create the booking doc now so
    // the customer's reservation is confirmed at the lot. Credits aren't
    // credited until cash is collected (admin flips status via the
    // adminMarkOrderPaid callable). createBookingFromOrder writes the
    // correct paymentStatus from order.paymentMethod, no override needed.
    if (paymentMethod === 'pay-at-pickup' && orderType === 'longTerm') {
      // `amount` here is the standard price (pay-at-pickup gets no discount) —
      // that's what the customer will owe at the lot.
      const bookingId = await createBookingFromOrder(orderId, { ...pendingDoc, paymentMethod, amount });
      pendingDoc.bookingId = bookingId;
    }

    await getFirestore().collection('pendingOrders').doc(orderId).set(pendingDoc);

    // v1.2: every order gets a proforma up front — the fiscal invoice follows
    // only when payment confirms online (netopiaCallback). Voucher-covered
    // free orders returned earlier and get no documents (nothing was charged).
    {
      const refs = [getFirestore().collection('pendingOrders').doc(orderId)];
      if (pendingDoc.bookingId) refs.push(getFirestore().collection('bookings').doc(pendingDoc.bookingId));
      await smartbillIssueSafe({
        kind: 'proforma',
        billing: cdClean.billing,
        email: cdClean.email,
        items: orderType === 'longTerm'
          ? longTermDocItems({ bookingCode: pendingDoc.bookingCode, amount })
          : creditsDocItems({ amount }),
        refs,
        label: `order ${orderId}`,
      });
    }

    // Pay-at-pickup short-circuit: no Netopia handoff, just tell the
    // client to navigate to the confirmation page. The return page sees
    // paymentMethod=pay-at-pickup and shows the lot-payment copy.
    if (paymentMethod === 'pay-at-pickup') {
      return res.json({
        orderId,
        paymentMethod,
        redirectUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      });
    }

    const [firstName, ...rest] = (cd.name || 'Customer').trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;

    const xml = buildRequestXml({
      orderId,
      amount,
      currency: 'RON',
      signature: NETOPIA_SIGNATURE.value(),
      returnUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      confirmUrl: CALLBACK_URL,
      details,
      billing: {
        first_name: firstName,
        last_name: lastName,
        email: cd.email || '',
        mobile_phone: cd.phone || '',
        address: 'N/A',
      },
    });

    const encrypted = encryptRequest(NETOPIA_PUBLIC_KEY.value(), xml);

    const env = (NETOPIA_ENV.value?.() || 'sandbox').toLowerCase();
    const action = NETOPIA_ENDPOINTS[env] || NETOPIA_ENDPOINTS.sandbox;

    return res.json({
      action,
      env_key: encrypted.env_key,
      data: encrypted.data,
      cipher: encrypted.cipher,
      iv: encrypted.iv,
      orderId,
    });
  }
);

// ── POST /netopiaCallback ────────────────────────────────────────────────
// Server-to-server IPN from Netopia. Expects form-urlencoded fields:
//   env_key, data, cipher, iv
// Responds with <crc>success</crc> or <crc error_type=... error_code=...>msg</crc>.
export const netopiaCallback = onRequest(
  {
    cors: false,
    secrets: [NETOPIA_PRIVATE_KEY, ...SMARTBILL_SECRETS],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Content-Type', 'application/xml');
      return res.status(405).send(crcError('0x01', 'method not allowed'));
    }

    const { env_key, data, cipher, iv } = req.body || {};
    if (!env_key || !data) {
      res.set('Content-Type', 'application/xml');
      return res.status(400).send(crcError('0x02', 'missing env_key or data'));
    }

    let decoded;
    try {
      decoded = await decryptIpn(NETOPIA_PRIVATE_KEY.value(), { env_key, data, cipher, iv });
    } catch (err) {
      console.error('Netopia IPN decrypt failed:', err);
      res.set('Content-Type', 'application/xml');
      return res.status(400).send(crcError('0x03', 'decrypt failed'));
    }

    // Netopia's decoded XML shape:
    //   { order: { $: {id, timestamp, type}, mobilpay: { action, customer, error, ... } } }
    const order = decoded?.order;
    const mobilpay = order?.mobilpay || {};
    const action = String(mobilpay.action || '').toLowerCase();
    const orderId = order?.$?.id;
    const errorCode = mobilpay.error?.$?.code || '0';

    res.set('Content-Type', 'application/xml');
    if (!orderId) return res.status(400).send(crcError('0x04', 'missing orderId'));

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).send(crcError('0x05', 'unknown order'));

    const pending = orderSnap.data();
    if (pending.status === 'paid') return res.status(200).send(crcSuccess()); // idempotent

    // action = 'confirmed' or 'confirmed_pending' on success, 'canceled' / 'credit' on others.
    if ((action === 'confirmed' || action === 'paid') && errorCode === '0') {
      // Replay/concurrency lease. Netopia redelivers IPNs, and the plain
      // status==='paid' check above can't stop two deliveries running the
      // fulfilment CONCURRENTLY (each reads pre-paid state before the other
      // finishes) — which would double-create the booking / double-credit
      // the tokens and, since v1.2, mint a duplicate fiscal invoice. Claim
      // the order transactionally; a stale claim (crashed run) expires after
      // 5 minutes so an order can never get stuck unpaid.
      const IPN_LEASE_MS = 5 * 60 * 1000;
      let claim;
      try {
        claim = await db.runTransaction(async (tx) => {
          const claimSnap = await tx.get(orderRef);
          if (!claimSnap.exists) return 'missing';
          const d = claimSnap.data();
          if (d.status === 'paid') return 'paid';
          const leaseAt = Date.parse(d.ipnProcessingAt || '') || 0;
          if (Date.now() - leaseAt < IPN_LEASE_MS) return 'busy';
          tx.update(orderRef, { ipnProcessingAt: new Date().toISOString() });
          return 'claimed';
        });
      } catch (err) {
        console.error('IPN lease transaction failed:', err?.message);
        return res.status(500).send(crcError('0x06', 'lease failed'));
      }
      if (claim === 'paid') return res.status(200).send(crcSuccess());
      if (claim === 'missing') return res.status(404).send(crcError('0x05', 'unknown order'));
      // Another delivery is mid-fulfilment — tell Netopia to come back; by
      // then the order is either paid (→ success) or the lease has expired.
      if (claim === 'busy') return res.status(500).send(crcError('0x06', 'processing, retry later'));
      try {
        const nowIso = new Date().toISOString();
        const isRepay = pending.paymentMethod === 'pay-at-pickup' && pending.bookingId;
        if (pending.orderType === 'longTerm') {
          // Repay path: a pay-at-pickup booking was already created at
          // order time; this IPN is the online repay coming through.
          // Update the existing booking instead of creating a duplicate.
          // Only pay-at-pickup orders carry a server-set bookingId — never
          // honor one on an online order (createPayment now whitelists its
          // fields, but orders written before that hardening still exist).
          let bookingId = pending.paymentMethod === 'pay-at-pickup' ? pending.bookingId : null;
          if (bookingId) {
            // Reserve a spot now that the booking is paid (it had none
            // because pay-at-pickup bookings don't reserve until paid).
            const bookingRef = db.collection('bookings').doc(bookingId);
            const bookingSnap = await bookingRef.get();
            const patch = {
              paymentStatus: 'paid',
              paidAt: nowIso,
              paidBy: 'netopia',
              paymentMethod: 'online',
              paymentId: orderId,
            };
            // Repay charges the online-discounted amount, but the booking was
            // pre-created (pay-at-pickup) at the STANDARD price. Reconcile the
            // booking to what was actually charged so revenue/invoicing aren't
            // overstated. `repayAmount` is stamped by repayOrder.
            const chargedNow = Number(pending.repayAmount);
            if (Number.isFinite(chargedNow) && chargedNow > 0) {
              patch.totalPrice = chargedNow;
              patch.basePrice = chargedNow;
            }
            if (bookingSnap.exists && !bookingSnap.data().spotId) {
              const spotId = await reserveAvailableSpot(bookingId);
              if (spotId) patch.spotId = spotId;
            }
            await bookingRef.update(patch);
          } else {
            bookingId = await createBookingFromOrder(orderId, pending);
          }
          await orderRef.update({
            status: 'paid',
            bookingId,
            netopiaAction: action,
            paymentMethod: 'online',
            paymentStatus: 'paid',
            paidAt: nowIso,
            paidBy: 'netopia',
            // Keep the order's amount in step with what was charged on repay.
            ...(Number.isFinite(Number(pending.repayAmount)) && Number(pending.repayAmount) > 0
              ? { amount: Number(pending.repayAmount) }
              : {}),
            repayInProgress: FieldValue.delete(),
            ipnProcessingAt: FieldValue.delete(),
          });
          // v1.2: online payment confirmed → fiscal invoice (the proforma was
          // issued at order time). Repays charge the discounted repayAmount.
          const chargedForInvoice = Number.isFinite(Number(pending.repayAmount)) && Number(pending.repayAmount) > 0
            ? Number(pending.repayAmount)
            : Number(pending.amount) || 0;
          if (chargedForInvoice > 0) {
            // Orders mint the reservation number up front; for older orders
            // read it off the booking so the invoice line still carries it.
            let invoiceBookingCode = pending.bookingCode || null;
            if (!invoiceBookingCode) {
              try {
                const bs = await db.collection('bookings').doc(bookingId).get();
                invoiceBookingCode = bs.exists ? (bs.data().code || null) : null;
              } catch (_) { /* line falls back to the generic wording */ }
            }
            const sbRefs = [db.collection('bookings').doc(bookingId), orderRef];
            // A repay charges the DISCOUNTED amount while the proforma was
            // issued at the standard price — replace it so proforma and
            // invoice agree (same rule as an unpaid re-quote).
            if (isRepay && pending.smartbill?.proforma?.number
                && Number(pending.amount) !== chargedForInvoice) {
              await smartbillDeleteProformaSafe({ sb: pending.smartbill, refs: sbRefs, label: `repay requote ${orderId}` });
              await smartbillIssueSafe({
                kind: 'proforma',
                billing: pending.customerData?.billing,
                email: pending.customerData?.email,
                items: longTermDocItems({ bookingCode: invoiceBookingCode, amount: chargedForInvoice }),
                refs: sbRefs,
                label: `repay requote ${orderId}`,
              });
            }
            await smartbillIssueSafe({
              kind: 'invoice',
              billing: pending.customerData?.billing,
              email: pending.customerData?.email,
              items: longTermDocItems({ bookingCode: invoiceBookingCode, amount: chargedForInvoice }),
              refs: sbRefs,
              label: `IPN ${orderId}`,
            });
          }
          // Stamp the promo redemption (if any) with the booking it produced —
          // online longTerm orders only reach here after payment. Mirrors the
          // free-order path; best-effort, never blocks fulfilment.
          try {
            const redSnap = await db.collection('voucherRedemptions')
              .where('orderId', '==', orderId).limit(1).get();
            if (!redSnap.empty && !redSnap.docs[0].data().bookingId) {
              await redSnap.docs[0].ref.update({ bookingId });
            }
          } catch (err) {
            console.warn('IPN redemption bookingId stamp failed:', err?.message);
          }
          // For repays, the onBookingCreated trigger already fired (with
          // paid=false). Send a fresh "payment received" email so the
          // customer gets confirmation. New bookings get this email via
          // the trigger automatically.
          if (isRepay) {
            try {
              await sendRepayPaidEmail(bookingId);
            } catch (err) {
              console.warn('repay paid-email failed (booking still updated):', err?.message);
            }
          }
        } else {
          const { balanceDocId, txId } = await creditTokens({
            packId: pending.packId,
            quantity: pending.quantity,
            amount: pending.amount,
            customerData: pending.customerData,
          });
          await orderRef.update({
            status: 'paid',
            balanceDocId,
            netopiaAction: action,
            paymentStatus: 'paid',
            paidAt: nowIso,
            paidBy: 'netopia',
            ipnProcessingAt: FieldValue.delete(),
          });
          // v1.2: online payment confirmed → fiscal invoice (the proforma was
          // issued at order time by createPayment).
          if (Number(pending.amount) > 0) {
            await smartbillIssueSafe({
              kind: 'invoice',
              billing: pending.customerData?.billing,
              email: pending.customerData?.email,
              items: creditsDocItems({ amount: pending.amount }),
              refs: [orderRef, db.collection('tokenTransactions').doc(txId)],
              label: `IPN credits ${orderId}`,
            });
          }
        }
        // Consume the applied voucher (if any) — flip status to 'redeemed'.
        // Best-effort: a failure here doesn't undo the order. Idempotent
        // (a transaction guards against double-redeem on IPN retries).
        if (pending.voucherId) {
          try {
            await getFirestore().runTransaction(async (tx) => {
              const ref = getFirestore().collection('vouchers').doc(pending.voucherId);
              const snap = await tx.get(ref);
              if (snap.exists && snap.data().status === 'unused') {
                tx.update(ref, {
                  status: 'redeemed',
                  redeemedAt: new Date().toISOString(),
                  redeemedOn: orderId,
                });
              }
            });
          } catch (err) {
            console.warn('Voucher consumption failed (order still credited):', err);
          }
        }
        return res.status(200).send(crcSuccess());
      } catch (err) {
        console.error('Fulfilment failed:', err);
        // Free the lease so Netopia's next redelivery retries immediately
        // instead of waiting out the 5-minute expiry.
        await orderRef.update({ ipnProcessingAt: FieldValue.delete() }).catch(() => {});
        return res.status(500).send(crcError('0x06', 'fulfilment failed'));
      }
    }

    // Non-success outcomes — record but still ack to stop retries.
    await orderRef.update({
      status: action || 'failed',
      netopiaErrorCode: errorCode,
      processedAt: new Date().toISOString(),
    });
    return res.status(200).send(crcSuccess());
  }
);

// ── mergeGuestData (callable) ───────────────────────────────────────────
// On signup / first login post-launch the client invokes this to reconcile
// any prior guest activity tied to the user's email:
//   - tokenBalances/plate_X   → merged into tokenBalances/{uid}, plate doc deleted
//   - tokenTransactions       → customerId stamped on those linked to the merged plates
//   - bookings                → customerId stamped on guest bookings whose contact.email matches
//
// Idempotent: a second invocation finds nothing to merge and returns zero counts.
// Safe-by-default: matches purely on email and customerId == null. We never touch
// data already linked to another user.
export const mergeGuestData = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const uid = request.auth.uid;
    const email = (request.auth.token?.email || '').toLowerCase();
    // Only merge for VERIFIED emails — an attacker could otherwise register
    // (or re-point their profile) with a victim's address unverified and
    // absorb the victim's guest balances, bookings and PII. Google sign-ins
    // arrive verified; password accounts merge on first login after
    // verification (the call is idempotent, so nothing is lost by waiting).
    if (!email || request.auth.token?.email_verified !== true) {
      return { mergedBalance: 0, mergedTransactions: 0, mergedBookings: 0 };
    }

    const db = getFirestore();

    // 1. Plate-keyed balances belonging to this email. New docs store the
    // email lowercased, but legacy guest docs carry it as typed (often
    // phone-auto-capitalized) and Firestore equality is case-sensitive — so
    // scan the plate_* id range and compare lowercased in memory. The range
    // is bounded by the number of unmerged guest balances (small).
    const balanceSnap = await db.collection('tokenBalances')
      .where(FieldPath.documentId(), '>=', 'plate_')
      .where(FieldPath.documentId(), '<', 'plate_')
      .get();
    const guestDocs = balanceSnap.docs.filter(
      (d) => normalizeEmail(d.data().email) === email,
    );

    let totalBalance = 0;
    let totalPurchased = 0;
    const allPlates = [];
    let guestPhone = '';
    let guestDisplayName = '';

    for (const doc of guestDocs) {
      const data = doc.data();
      totalBalance += Number(data.balance) || 0;
      totalPurchased += Number(data.totalPurchased) || 0;
      if (Array.isArray(data.plates)) allPlates.push(...data.plates);
      if (!guestPhone && data.phone) guestPhone = data.phone;
      if (!guestDisplayName && data.displayName) guestDisplayName = data.displayName;
    }
    const uniquePlates = [...new Set(allPlates)];

    // 2. Transfer + delete (atomic). Skip when nothing to merge.
    if (guestDocs.length > 0) {
      await db.runTransaction(async (tx) => {
        const userRef = db.collection('tokenBalances').doc(uid);
        const userSnap = await tx.get(userRef);
        if (userSnap.exists) {
          const existing = userSnap.data();
          const mergedPlates = [...new Set([...(existing.plates || []), ...uniquePlates])];
          tx.update(userRef, {
            balance: FieldValue.increment(totalBalance),
            totalPurchased: FieldValue.increment(totalPurchased),
            plates: mergedPlates,
          });
        } else {
          tx.set(userRef, {
            balance: totalBalance,
            totalPurchased,
            plates: uniquePlates,
            email,
          });
        }
        for (const doc of guestDocs) {
          tx.delete(doc.ref);
        }
      });
    }

    // 3. Stamp customerId on the merged plates' transactions (only those still null)
    let mergedTransactions = 0;
    for (const plate of uniquePlates) {
      const txnsSnap = await db.collection('tokenTransactions')
        .where('licensePlate', '==', plate)
        .get();
      const orphans = txnsSnap.docs.filter((d) => !d.data().customerId);
      if (orphans.length === 0) continue;
      const batch = db.batch();
      for (const o of orphans) {
        batch.update(o.ref, { customerId: uid });
      }
      await batch.commit();
      mergedTransactions += orphans.length;
    }

    // 4. Stamp customerId on guest bookings whose contact.email matches.
    //    Also pull phone/name out of the most recent guest booking as a
    //    fallback if the plate-keyed balances didn't carry them.
    //    Query by customerId == null (the exact set of unlinked bookings —
    //    small and shrinking) and match the email lowercased in memory:
    //    legacy bookings stored the email as typed, and an exact-equality
    //    query silently missed e.g. "Roxana@…" vs "roxana@…" (the LT-D96ZN
    //    incident — the reservation never appeared in the customer profile).
    const bookingsSnap = await db.collection('bookings')
      .where('customerId', '==', null)
      .get();
    const guestBookings = bookingsSnap.docs.filter(
      (d) => normalizeEmail(d.data().contact?.email) === email,
    );
    let mergedBookings = 0;
    // Plates seen on reservations. Only credit purchases write a plate_* balance
    // doc, so without this a customer who only ever booked a long-term stay
    // contributes no plate to their profile at all.
    const bookingPlates = [];
    if (guestBookings.length > 0) {
      const batch = db.batch();
      for (const b of guestBookings) {
        batch.update(b.ref, { customerId: uid });
        const c = b.data().contact || {};
        if (b.data().licensePlate) bookingPlates.push(normalizePlate(b.data().licensePlate));
        if (!guestPhone && c.phone) guestPhone = c.phone;
        if (!guestDisplayName && c.name) guestDisplayName = c.name;
      }
      await batch.commit();
      mergedBookings = guestBookings.length;
    }

    // 4b. Bookings already linked to this uid — from an earlier merge, a
    //     logged-in booking, or a desk reservation the agent linked by email.
    //     Their plates may predate this code, so harvest them too: the merge
    //     runs on every login, which lets existing profiles heal themselves
    //     without a migration.
    const ownBookingsSnap = await db.collection('bookings')
      .where('customerId', '==', uid)
      .get();
    for (const d of ownBookingsSnap.docs) {
      if (d.data().licensePlate) bookingPlates.push(normalizePlate(d.data().licensePlate));
    }

    // 5. Patch users/{uid} with merged plates as vehicles + fill in any
    //    blanks (phone, displayName) from the guest data. Existing values
    //    on the profile are preserved — we never overwrite what the user
    //    has already set.
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const existing = userSnap.exists ? userSnap.data() : {};
      const existingVehicles = Array.isArray(existing.vehicles) ? existing.vehicles : [];
      const existingPlates = new Set(
        // Legacy entries are bare plate strings; current ones are objects.
        existingVehicles.map((v) => normalizePlate(typeof v === 'string' ? v : v?.plate))
      );
      // Credit balances (plate_* docs) + every plate seen on a reservation.
      const profilePlates = [...new Set([...uniquePlates, ...bookingPlates])].filter(Boolean);
      const newVehicles = profilePlates
        .filter((p) => !existingPlates.has(normalizePlate(p)))
        .map((p) => ({ plate: p, make: '', model: '' }));

      const patch = {};
      if (newVehicles.length > 0) {
        patch.vehicles = [...existingVehicles, ...newVehicles];
      }
      if (!existing.phone && guestPhone) patch.phone = guestPhone;
      if (!existing.displayName && guestDisplayName) patch.displayName = guestDisplayName;
      // email lives in the auth token; we don't touch users.email here.

      if (Object.keys(patch).length > 0) {
        if (userSnap.exists) {
          tx.update(userRef, patch);
        } else {
          // New users created via Google sign-in sometimes hit this branch
          // before the auth helper has materialised the users/{uid} doc.
          tx.set(userRef, { ...patch, role: 'customer', email });
        }
      }
    });

    console.log(`mergeGuestData: uid=${uid} email=${email} balance=${totalBalance} txns=${mergedTransactions} bookings=${mergedBookings} plates=${uniquePlates.length}`);
    return {
      mergedBalance: totalBalance,
      mergedTransactions,
      mergedBookings,
      mergedPlates: uniquePlates.length,
    };
  }
);

// ── Cashbook helpers ────────────────────────────────────────────────────
// One ledger row per cash payment collected at the lot. Powers /admin/cashbook
// for both the "my open day" view and the close-and-generate-report flow.
// Only CASH is recorded here — card payments are tracked on the source doc
// (booking / pendingOrder / tokenTransaction) but never reach the cashbook.
async function recordCashEntry({
  agentUid,
  amount,
  source,
  plate = null,
  payerName = null,
  bookingId = null,
  orderId = null,
  tokenBalanceDocId = null,
}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  if (!agentUid) return null;
  const db = getFirestore();
  let agentName = agentUid;
  try {
    const snap = await db.collection('users').doc(agentUid).get();
    const d = snap.exists ? snap.data() : null;
    agentName = d?.displayName || d?.email || agentUid;
  } catch { /* fall through with uid as name */ }
  const nowIso = new Date().toISOString();
  const ref = await db.collection('cashEntries').add({
    agentUid,
    agentName,
    amount: amt,
    paidBy: 'cash',
    paidAt: nowIso,
    paidAtDay: nowIso.slice(0, 10),
    source,
    plate,
    payerName,
    bookingId,
    orderId,
    tokenBalanceDocId,
    closedAt: null,
    closedBy: null,
    closedReportId: null,
  });
  return ref.id;
}

// ── Admin auth gates ────────────────────────────────────────────────────
// Roles: admin > agent (was 'staff') > driver > customer.
// `assertStaff` is the most permissive backoffice gate — allows any role
// with admin-side access (driver included), for check-in/check-out ops.
// `assertAgent` excludes drivers — use for money-bearing ops (mark-paid,
// cashbook handover, etc.).
async function assertStaff(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  const uid = request.auth.uid;
  const snap = await getFirestore().collection('users').doc(uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (!['admin', 'agent', 'staff', 'driver'].includes(role)) {
    throw new HttpsError('permission-denied', 'Backoffice access required');
  }
  return { uid, role };
}

async function assertAgent(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  const uid = request.auth.uid;
  const snap = await getFirestore().collection('users').doc(uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (!['admin', 'agent', 'staff'].includes(role)) {
    throw new HttpsError('permission-denied', 'Agent or admin only');
  }
  return { uid, role };
}

// ── adminMarkOrderPaid (callable) ───────────────────────────────────────
// Admin/staff flips a pay-at-pickup pendingOrders doc to paid. Idempotent.
// For credit orders, credits the tokens at the same time. For longTerm
// orders, also creates the bookings doc if one doesn't already exist
// (the pay-at-pickup flow may persist the booking immediately or defer
// to this step — we handle both shapes).
export const adminMarkOrderPaid = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { orderId, paidBy, payerDetails } = request.data || {};
    if (!orderId) throw new HttpsError('invalid-argument', 'Missing orderId');
    if (!['cash', 'card'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash or card');
    }

    // payerDetails are required for cashbook reconciliation — without
    // them, fiscal audit on a cash payment is impossible. Optional only
    // for backward compat (e.g. an admin reusing an older client).
    const payer = payerDetails && typeof payerDetails === 'object' ? {
      firstName: String(payerDetails.firstName || '').trim(),
      lastName: String(payerDetails.lastName || '').trim(),
      locality: String(payerDetails.locality || '').trim(),
      county: String(payerDetails.county || '').trim(),
      abroad: payerDetails.abroad === true,
      address: String(payerDetails.address || '').trim(),
    } : null;

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found');

    const pending = snap.data();
    if (pending.paymentStatus === 'paid' || pending.status === 'paid') {
      // Idempotent — already paid, just confirm.
      return { ok: true, alreadyPaid: true };
    }

    const nowIso = new Date().toISOString();
    const paymentMark = {
      paymentStatus: 'paid',
      paidAt: nowIso,
      paidBy: paidBy === 'cash' ? 'admin-cash' : 'admin-card',
      status: 'paid',
      collectedByUid: uid,
      ...(payer ? { payerDetails: payer } : {}),
    };

    if (pending.orderType === 'credits') {
      const { balanceDocId: docId } = await creditTokens({
        packId: pending.packId,
        quantity: pending.quantity,
        amount: pending.amount,
        customerData: pending.customerData,
      });
      await orderRef.update({ ...paymentMark, balanceDocId: docId });
    } else if (pending.orderType === 'longTerm') {
      // If the booking was pre-created at order time (pay-at-pickup
      // longTerm path), flip its payment fields. Otherwise create it now.
      const bookingId = pending.bookingId || await createBookingFromOrder(orderId, pending);
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingSnap = await bookingRef.get();
      const patch = {
        paymentStatus: 'paid',
        paidAt: nowIso,
        paidBy: paymentMark.paidBy,
        collectedByUid: uid,
      };
      // If admin captured payer details (the "Încasează acum" form), patch
      // the booking's billing field so cashbook + future invoicing have
      // a complete picture. Merge with the existing billing (e.g. PJ
      // company info captured earlier) rather than overwriting it.
      if (payer) {
        const existing = bookingSnap.exists ? (bookingSnap.data().billing || {}) : {};
        patch.billing = {
          ...existing,
          type: existing.type || 'PF',
          firstName: payer.firstName,
          lastName: payer.lastName,
          locality: payer.locality,
          county: payer.county,
          abroad: payer.abroad,
          address: payer.address,
          // Foreign payer without a CNP on file → the 13-zero stand-in, so a
          // later manual/auto invoice has a complete PF identity.
          ...(payer.abroad && !existing.cnp ? { cnp: ABROAD_CNP } : {}),
        };
      }
      // The reservation is now real (payment confirmed) — reserve a spot
      // if one isn't already assigned. createBookingFromOrder skips this
      // for unpaid pay-at-pickup bookings to avoid orphaning a spot if
      // the customer never shows up.
      if (bookingSnap.exists && !bookingSnap.data().spotId) {
        const spotId = await reserveAvailableSpot(bookingId);
        if (spotId) patch.spotId = spotId;
      }
      await bookingRef.update(patch);
      await orderRef.update({ ...paymentMark, bookingId });
    } else {
      throw new HttpsError('invalid-argument', `Unknown orderType: ${pending.orderType}`);
    }

    await db.collection('auditLog').add({
      action: 'order_marked_paid',
      entityType: 'pendingOrder',
      entityId: orderId,
      actorUid: uid,
      payload: { paidBy: paymentMark.paidBy, orderType: pending.orderType },
      timestamp: nowIso,
    });

    // Cashbook ledger — only cash. Card payments stay on the order doc
    // but don't enter the cashbook (per ops requirement).
    if (paidBy === 'cash') {
      // Record what's actually collected: pending.amount is the standard
      // price minus any voucher (and is what the collect dialog shows). Using
      // totalPrice here would ignore a pay-at-pickup voucher and overstate.
      const cashAmount = Number(pending.amount) || 0;
      await recordCashEntry({
        agentUid: uid,
        amount: cashAmount,
        source: pending.orderType === 'credits' ? 'credits-markpaid' : 'longterm-markpaid',
        plate: pending.customerData?.licensePlate || null,
        payerName: payer ? `${payer.firstName} ${payer.lastName}`.trim() : (pending.customerData?.name || null),
        orderId,
        bookingId: pending.bookingId || null,
      });
    }

    return { ok: true };
  }
);

// ── adminMarkOrderUnpaid (callable) ─────────────────────────────────────
// Misclick recovery. Reverses an admin-cash/card "Mark paid" action.
// Refuses to reverse Netopia-paid orders (that's a refund, not a
// misclick). For longTerm, requires the booking to still be 'upcoming'
// (refuses reversal once the customer has been checked in). For credits,
// requires the balance to still cover the granted quantity (refuses if
// any of the granted tokens have already been used).
export const adminMarkOrderUnpaid = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { orderId } = request.data || {};
    if (!orderId) throw new HttpsError('invalid-argument', 'Missing orderId');

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found');

    const pending = snap.data();
    if (pending.paymentStatus !== 'paid') {
      // Idempotent — nothing to reverse.
      return { ok: true, alreadyUnpaid: true };
    }
    if (pending.paidBy !== 'admin-cash' && pending.paidBy !== 'admin-card') {
      throw new HttpsError(
        'failed-precondition',
        'Only cash/card admin-payments can be reversed here. Netopia payments require a refund.'
      );
    }

    const nowIso = new Date().toISOString();
    const reversalMark = {
      paymentStatus: 'unpaid',
      paidAt: null,
      paidBy: null,
      status: 'pending',
      reversedAt: nowIso,
      reversedBy: uid,
    };

    if (pending.orderType === 'longTerm') {
      const bookingId = pending.bookingId;
      if (!bookingId) {
        throw new HttpsError('failed-precondition', 'Order has no linked booking');
      }
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) {
        throw new HttpsError('not-found', 'Booking not found');
      }
      const booking = bookingSnap.data();
      if (booking.status !== 'upcoming') {
        throw new HttpsError(
          'failed-precondition',
          'Booking has already been checked in — reversal not allowed.'
        );
      }
      // Release the reserved spot — the booking is no longer paid, so
      // the reservation isn't real anymore. Capacity map flips it back
      // to green/available.
      const reservedSpot = booking.spotId;
      await bookingRef.update({
        paymentStatus: 'unpaid',
        paidAt: null,
        paidBy: null,
        spotId: null,
      });
      if (reservedSpot) {
        try {
          const spotRef = db.collection('spots').doc(reservedSpot);
          const spotSnap = await spotRef.get();
          if (spotSnap.exists && spotSnap.data().status === 'reserved') {
            await spotRef.update({ status: 'available', currentBookingId: null });
          }
        } catch (err) {
          console.warn('adminMarkOrderUnpaid: spot release failed', err?.message);
        }
      }
      await orderRef.update(reversalMark);
    } else if (pending.orderType === 'credits') {
      const balanceDocId = pending.balanceDocId;
      const quantity = Number(pending.quantity) || 0;
      if (!balanceDocId || !quantity) {
        throw new HttpsError('failed-precondition', 'Order is missing balance info');
      }
      await db.runTransaction(async (tx) => {
        const balRef = db.collection('tokenBalances').doc(balanceDocId);
        const balSnap = await tx.get(balRef);
        if (!balSnap.exists) {
          throw new HttpsError('failed-precondition', 'Token balance no longer exists');
        }
        const current = balSnap.data();
        if ((current.balance || 0) < quantity) {
          throw new HttpsError(
            'failed-precondition',
            'Some of the granted credits have already been used — reversal not allowed.'
          );
        }
        tx.update(balRef, {
          balance: FieldValue.increment(-quantity),
          totalPurchased: FieldValue.increment(-quantity),
        });
        tx.update(orderRef, reversalMark);
      });
    } else {
      throw new HttpsError('invalid-argument', `Unknown orderType: ${pending.orderType}`);
    }

    // Reverse the cash-drawer entry that adminMarkOrderPaid created for cash
    // payments (this function is the "misclick recovery"). Only delete OPEN
    // entries — a closed/handed-over entry lives in a generated report and
    // mustn't be silently removed. Single-field query → no composite index.
    if (pending.paidBy === 'admin-cash') {
      try {
        const cashSnap = await db.collection('cashEntries').where('orderId', '==', orderId).get();
        const dels = [];
        cashSnap.forEach((d) => { if (!d.data().closedAt) dels.push(d.ref.delete()); });
        await Promise.all(dels);
      } catch (err) {
        console.warn('adminMarkOrderUnpaid: cash entry cleanup failed', err?.message);
      }
    }

    await db.collection('auditLog').add({
      action: 'order_marked_unpaid',
      entityType: 'pendingOrder',
      entityId: orderId,
      actorUid: uid,
      payload: { orderType: pending.orderType, originalPaidBy: pending.paidBy },
      timestamp: nowIso,
    });

    return { ok: true };
  }
);

// ── cancelPendingCreditOrder (callable) ─────────────────────────────────
// Customer self-cancel for an UNPAID pay-at-pickup credit-pack order.
// No money has moved yet, so this just flips the pendingOrders doc to
// `cancelled`. We refuse cancellation once the order is paid — those go
// through the regular refund flow because tokens have already been
// credited and may have been used.
//
// The owner check matches by customerId (logged-in user) OR by email on
// the customerData blob (guest who placed the order while not signed in
// and later returns).
export const cancelPendingCreditOrder = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const callerUid = request.auth.uid;
    const callerEmail = (request.auth.token?.email || '').toLowerCase();
    const { orderId } = request.data || {};
    if (!orderId) throw new HttpsError('invalid-argument', 'Missing orderId');

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found');
    const order = snap.data();

    // Ownership: customerId match OR email match on the customerData blob.
    // Any backoffice user (admin/agent/driver) can cancel any order.
    const cd = order.customerData || {};
    const ownsByUid = cd.customerId && cd.customerId === callerUid;
    const ownsByEmail = callerEmail && String(cd.email || '').toLowerCase() === callerEmail;
    const owns = ownsByUid || ownsByEmail;
    if (!owns) {
      const userSnap = await db.collection('users').doc(callerUid).get();
      const role = userSnap.exists ? userSnap.data().role : null;
      if (!['admin', 'agent', 'staff', 'driver'].includes(role)) {
        throw new HttpsError('permission-denied', 'Not your order');
      }
    }

    if (order.status === 'cancelled') {
      return { ok: true, alreadyCancelled: true };
    }
    if (order.orderType !== 'credits') {
      throw new HttpsError('failed-precondition', 'Only credit orders can be cancelled here');
    }
    if (order.paymentStatus === 'paid') {
      throw new HttpsError(
        'failed-precondition',
        'This order has already been paid — credits may have been issued. Contact support for a refund.'
      );
    }

    const nowIso = new Date().toISOString();
    await orderRef.update({
      status: 'cancelled',
      cancelledAt: nowIso,
      cancelledBy: callerUid,
    });

    // v1.2 Phase 4: drop the order's (non-fiscal) proforma — nothing was paid.
    await smartbillDeleteProformaSafe({ sb: order.smartbill, refs: [orderRef], label: `credit order ${orderId}` });

    await db.collection('auditLog').add({
      action: 'pending_order_cancelled',
      entityType: 'pendingOrder',
      entityId: orderId,
      actorUid: callerUid,
      payload: { orderType: order.orderType, bySelf: owns },
      timestamp: nowIso,
    });

    return { ok: true };
  }
);

// ── closeCashbook (callable) ────────────────────────────────────────────
// An agent (or admin) closes their open cash entries. Snapshots them into
// a `cashbookReports/{auto}` doc, then marks each cashEntry as closed so
// it doesn't appear in the open list anymore. The generated report stays
// readable for audit / printing later.
//
// Without arguments, closes the CALLER's own open cashbook (the common
// case). Admins may pass `{ agentUid }` to close another agent's day.
export const closeCashbook = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: callerUid, role } = await assertStaff(request);
    const targetUid = request.data?.agentUid || callerUid;
    // Only admin can close another agent's cashbook.
    if (targetUid !== callerUid && role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admin can close another agent\'s cashbook');
    }
    // Driver role is checked-in only — they shouldn't be cashing up either.
    if (role === 'driver') {
      throw new HttpsError('permission-denied', 'Drivers do not handle cash');
    }

    const db = getFirestore();
    const open = await db.collection('cashEntries')
      .where('agentUid', '==', targetUid)
      .where('closedAt', '==', null)
      .get();

    if (open.empty) {
      throw new HttpsError('failed-precondition', 'No open cash entries to close');
    }

    const entries = open.docs.map((d) => ({ id: d.id, ...d.data() }));
    entries.sort((a, b) => String(a.paidAt || '').localeCompare(String(b.paidAt || '')));

    const totalAmount = entries.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const rangeFromIso = entries[0]?.paidAt || null;
    const rangeToIso = entries[entries.length - 1]?.paidAt || null;
    const agentName = entries[0]?.agentName || targetUid;

    // Pull any handovers for the matching days so the report stands on
    // its own without cross-referencing cashHandovers separately.
    const days = [...new Set(entries.map((e) => e.paidAtDay))];
    const handovers = [];
    const seenHandovers = new Set();
    for (const day of days) {
      // Match the cash OWNER (forAgentUid), not who physically recorded it —
      // an admin recording a handover on an agent's behalf sets handedBy=admin
      // but forAgentUid=agent, so a handedBy filter dropped it from the agent's
      // report. Filter in code (single-field day query, no composite index)
      // and fall back to handedBy for legacy rows without forAgentUid.
      const h = await db.collection('cashHandovers').where('day', '==', day).get();
      h.forEach((doc) => {
        const d = doc.data();
        const owner = d.forAgentUid || d.handedBy;
        if (owner === targetUid && !seenHandovers.has(doc.id)) {
          seenHandovers.add(doc.id);
          handovers.push({ id: doc.id, ...d });
        }
      });
    }

    const nowIso = new Date().toISOString();
    const reportRef = await db.collection('cashbookReports').add({
      agentUid: targetUid,
      agentName,
      generatedAt: nowIso,
      generatedBy: callerUid,
      rangeFromIso,
      rangeToIso,
      totalAmount,
      entryCount: entries.length,
      entries: entries.map((e) => ({
        cashEntryId: e.id,
        paidAt: e.paidAt,
        amount: e.amount,
        source: e.source,
        plate: e.plate || null,
        payerName: e.payerName || null,
        bookingId: e.bookingId || null,
        orderId: e.orderId || null,
      })),
      handovers,
    });

    // Flip each open entry to closed in a batched write.
    const batch = db.batch();
    for (const e of entries) {
      batch.update(db.collection('cashEntries').doc(e.id), {
        closedAt: nowIso,
        closedBy: callerUid,
        closedReportId: reportRef.id,
      });
    }
    await batch.commit();

    await db.collection('auditLog').add({
      action: 'cashbook_closed',
      entityType: 'cashbookReport',
      entityId: reportRef.id,
      actorUid: callerUid,
      payload: { targetUid, entryCount: entries.length, totalAmount },
      timestamp: nowIso,
    });

    return {
      ok: true,
      reportId: reportRef.id,
      entryCount: entries.length,
      totalAmount,
    };
  }
);

// ── recordCashHandover (callable) ───────────────────────────────────────
// Records a single staff-to-manager cash handover entry. Simple ledger —
// no approval workflow, no double-entry checks, no reversal. Per v1.1
// client decision: it's a logbook, not a finance system.
//
// Fields: day (YYYY-MM-DD), amount (RON), handedTo (manager name), notes?
// `forAgentUid` is optional — admins may record a handover on behalf of
// another agent (e.g. closing out their day for them). Defaults to the
// caller's uid otherwise. `handedBy` always records the actual actor;
// `forAgentUid` is what the cashbook UI filters on so the entry shows up
// under the right agent's section.
export const recordCashHandover = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid, role } = await assertStaff(request);
    const { day, amount, handedTo, notes, forAgentUid } = request.data || {};
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new HttpsError('invalid-argument', 'day must be YYYY-MM-DD');
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be positive');
    }
    if (!handedTo || !String(handedTo).trim()) {
      throw new HttpsError('invalid-argument', 'handedTo required');
    }
    let owner = uid;
    if (forAgentUid && forAgentUid !== uid) {
      if (role !== 'admin') {
        throw new HttpsError('permission-denied', 'Only admin can record a handover for another agent');
      }
      owner = String(forAgentUid);
    }
    const db = getFirestore();
    // One handover per (agent, day) — if the agent miscounted or
    // mistyped, they roll back the existing one via cancelCashHandover
    // and re-record. Server-side enforcement; the UI matches.
    const existing = await db.collection('cashHandovers')
      .where('forAgentUid', '==', owner)
      .where('day', '==', day)
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new HttpsError(
        'already-exists',
        'A handover already exists for this agent on this day. Cancel it before recording a new one.'
      );
    }

    const nowIso = new Date().toISOString();
    const ref = await db.collection('cashHandovers').add({
      day,
      amount: amt,
      handedTo: String(handedTo).trim(),
      notes: String(notes || '').trim() || null,
      forAgentUid: owner,
      handedBy: uid,
      handedAt: nowIso,
    });
    await db.collection('auditLog').add({
      action: 'cash_handover',
      entityType: 'cashHandover',
      entityId: ref.id,
      actorUid: uid,
      payload: { day, amount: amt, handedTo, forAgentUid: owner },
      timestamp: nowIso,
    });
    return { ok: true, id: ref.id };
  }
);

// ── cancelCashHandover (callable) ───────────────────────────────────────
// Rollback for a mistakenly recorded handover. Permitted to the owning
// agent (matched against forAgentUid, falling back to handedBy for legacy
// rows) and to admins. The doc is hard-deleted; the action is audit-logged
// so the trail survives.
export const cancelCashHandover = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid, role } = await assertStaff(request);
    const { handoverId } = request.data || {};
    if (!handoverId) throw new HttpsError('invalid-argument', 'Missing handoverId');
    const db = getFirestore();
    const ref = db.collection('cashHandovers').doc(handoverId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Handover not found');
    const h = snap.data();
    const owner = h.forAgentUid || h.handedBy;
    if (owner !== uid && role !== 'admin') {
      throw new HttpsError('permission-denied', 'Not your handover');
    }
    await ref.delete();
    await db.collection('auditLog').add({
      action: 'cash_handover_cancelled',
      entityType: 'cashHandover',
      entityId: handoverId,
      actorUid: uid,
      payload: {
        forAgentUid: owner,
        day: h.day || null,
        amount: h.amount || null,
        handedTo: h.handedTo || null,
      },
      timestamp: new Date().toISOString(),
    });
    return { ok: true };
  }
);

// ── cancelBookingWithRefund (callable) ──────────────────────────────────
// Customer self-service cancellation for an upcoming long-term booking.
// Three branches keyed off paymentStatus + paidBy:
//
//   paid via Netopia          → paymentStatus 'refund-pending' (online refund
//                               is handled out-of-band by admin since
//                               Netopia's refund API isn't wired in yet).
//   paid via admin-cash/card  → paymentStatus 'refund-pending' (cash refund
//                               at the lot, surfaced in the cashbook queue).
//   unpaid (pay-at-pickup)    → no money to refund; just cancel.
//
// In every branch we flip status to 'cancelled', release the reserved spot
// (so the capacity map updates immediately), and write an audit log.
// Staff/admin may cancel any booking; customers may cancel only their own.
export const cancelBookingWithRefund = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const callerUid = request.auth.uid;
    const { bookingId } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');

    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const snap = await bookingRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const booking = snap.data();

    // Authorization: customer can cancel their own; backoffice users
    // (admin/agent) can cancel any booking. Drivers explicitly excluded
    // — paid-cancellation routes funds into the refund queue which is
    // financially sensitive (v1.7 spec).
    const ownsBooking = booking.customerId && booking.customerId === callerUid;
    if (!ownsBooking) {
      const userSnap = await db.collection('users').doc(callerUid).get();
      const role = userSnap.exists ? userSnap.data().role : null;
      if (!['admin', 'agent', 'staff'].includes(role)) {
        throw new HttpsError('permission-denied', 'Not your booking');
      }
    }

    if (booking.status === 'cancelled' || booking.status === 'no-show') {
      // Idempotent for both terminal-states.
      return { ok: true, alreadyCancelled: booking.status === 'cancelled', alreadyNoShow: booking.status === 'no-show' };
    }
    // v1.7 relaxes from upcoming-only → allow cancelling active bookings
    // too (Check-out tab + Overdue tab need this for emergency aborts).
    // Completed bookings stay locked.
    if (!['upcoming', 'active'].includes(booking.status)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot cancel a booking in status ${booking.status}`,
      );
    }

    const nowIso = new Date().toISOString();

    // v1.7 business rule: if the customer never arrived AND drop-off is
    // more than 12h in the past, this isn't a cancellation — it's a
    // no-show. Per company policy, paid no-shows forfeit the booking
    // fee, so we route to the no-show terminal state (no refund flag).
    // This mirrors the markNoShows scheduled function exactly; the
    // schedule might just not have fired yet for the current row.
    if (booking.status === 'upcoming' && (booking.dropoffAt || booking.startDate)) {
      const dropMs = new Date(booking.dropoffAt || booking.startDate).getTime();
      if (Number.isFinite(dropMs) && Date.now() > dropMs + 12 * 60 * 60 * 1000) {
        await bookingRef.update({
          status: 'no-show',
          noShowAt: nowIso,
          noShowDetectedBy: 'admin-cancel',
          spotId: null,
        });
        // Release the spot (same logic as markNoShows / the cancel path below).
        if (booking.spotId) {
          try {
            const spotRef = db.collection('spots').doc(booking.spotId);
            const spotSnap = await spotRef.get();
            if (spotSnap.exists && ['reserved', 'occupied'].includes(spotSnap.data().status)) {
              await spotRef.update({ status: 'available', currentBookingId: null });
            }
          } catch (err) {
            console.warn('cancelBookingWithRefund (no-show path) spot release failed', err?.message);
          }
        }
        await db.collection('auditLog').add({
          action: 'booking_no_show',
          entityType: 'booking',
          entityId: bookingId,
          actorUid: callerUid,
          payload: {
            triggeredBy: 'admin-cancel',
            wasPaid: booking.paymentStatus === 'paid',
            paidBy: booking.paidBy || null,
            // Explicitly note that no refund was issued for the paid case.
            refundOutcome: 'forfeited',
          },
          timestamp: nowIso,
        });
        // v1.2 Phase 4: paid no-shows forfeit the fee, so their fiscal invoice
        // legitimately stands. An unpaid no-show collected nothing — drop its
        // (non-fiscal) proforma.
        if (booking.paymentStatus !== 'paid') {
          const sbRefs = [bookingRef, ...(booking.paymentId ? [db.collection('pendingOrders').doc(booking.paymentId)] : [])];
          await smartbillDeleteProformaSafe({ sb: booking.smartbill, refs: sbRefs, label: `no-show ${bookingId}` });
        }
        return { ok: true, noShow: true };
      }
    }

    const paid = booking.paymentStatus === 'paid';
    const paidViaNetopia = paid && booking.paidBy === 'netopia';
    const paidViaAdmin = paid && (booking.paidBy === 'admin-cash' || booking.paidBy === 'admin-card');

    const patch = {
      status: 'cancelled',
      cancelledAt: nowIso,
      cancelledBy: callerUid,
      spotId: null,
    };
    let refundOutcome = 'none';
    if (paidViaNetopia || paidViaAdmin) {
      patch.paymentStatus = 'refund-pending';
      patch.refundRequestedAt = nowIso;
      refundOutcome = paidViaNetopia ? 'netopia-pending' : 'cash-pending';
    }
    await bookingRef.update(patch);

    // Release the spot so the capacity map flips it back to green.
    // For upcoming bookings the spot is `reserved`; for active ones it's
    // `occupied`. Both flip back to available.
    if (booking.spotId) {
      try {
        const spotRef = db.collection('spots').doc(booking.spotId);
        const spotSnap = await spotRef.get();
        if (spotSnap.exists && ['reserved', 'occupied'].includes(spotSnap.data().status)) {
          await spotRef.update({ status: 'available', currentBookingId: null });
        }
      } catch (err) {
        console.warn('cancelBookingWithRefund: spot release failed', err?.message);
      }
    }

    // For active bookings, also remove the activeCheckIns row so the
    // plate stops showing up in the "in parking now" view and another
    // car can use the same plate later if needed.
    if (booking.status === 'active' && booking.licensePlate) {
      try {
        // Must match normalizePlate exactly (strips spaces AND hyphens) or a
        // hyphenated plate's activeCheckIns row is never deleted → stale "checked in".
        const plate = normalizePlate(booking.licensePlate);
        await db.collection('activeCheckIns').doc(plate).delete().catch(() => {});
      } catch (err) {
        console.warn('cancelBookingWithRefund: activeCheckIns cleanup failed', err?.message);
      }
    }

    // Mirror the cancel onto the pendingOrders doc (admin views key off it
    // for the pay-at-pickup queue and the cashbook refund queue).
    if (booking.paymentId) {
      await db.collection('pendingOrders').doc(booking.paymentId)
        .update({
          status: 'cancelled',
          cancelledAt: nowIso,
          ...(refundOutcome !== 'none' ? { paymentStatus: 'refund-pending', refundRequestedAt: nowIso } : {}),
        })
        .catch((err) => console.warn('pendingOrders cancel mirror failed:', err?.message));
    }

    // v1.2 Phase 4: invalidate the SmartBill documents. The (non-fiscal)
    // proforma is deleted in every branch; a fiscal invoice gets anulare
    // (same fiscal day) or storno (later — mandatory under RO rules, the
    // number can't just disappear). Money movement stays manual via the
    // refund queue — this is the document trail only, and it never blocks
    // the cancellation itself.
    {
      const sbRefs = [bookingRef, ...(booking.paymentId ? [db.collection('pendingOrders').doc(booking.paymentId)] : [])];
      await smartbillDeleteProformaSafe({ sb: booking.smartbill, refs: sbRefs, label: `cancel ${bookingId}` });
      await smartbillCancelInvoiceSafe({ sb: booking.smartbill, refs: sbRefs, label: `cancel ${bookingId}` });
    }

    await db.collection('auditLog').add({
      action: 'booking_cancelled',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: callerUid,
      payload: {
        wasPaid: paid,
        paidBy: booking.paidBy || null,
        refundOutcome,
        bySelf: ownsBooking,
      },
      timestamp: nowIso,
    });

    return { ok: true, refundOutcome };
  }
);

// ── adminMarkRefunded (callable) ────────────────────────────────────────
// Flips a booking from `paymentStatus: 'refund-pending'` to `'refunded'`
// after the admin has manually processed the refund (in Netopia admin
// panel for online payments, or cash-back at the lot for admin-cash/card
// payments). Stamps `refundedAt`, `refundedBy`, `refundedVia`, and an
// optional `refundNotes`, mirrors onto `pendingOrders`, audit-logs the
// action, and fires the customer-facing refund email via the Brevo
// trigger collection.
//
// Idempotent: if the booking is already 'refunded', returns ok without
// re-mailing.
export const adminMarkRefunded = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { uid, role } = await assertStaff(request);
    const { bookingId, refundedVia, notes } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');
    const allowedVia = ['netopia-panel', 'cash-returned', 'card-terminal'];
    if (!allowedVia.includes(refundedVia)) {
      throw new HttpsError('invalid-argument', `refundedVia must be one of ${allowedVia.join('|')}`);
    }

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const booking = snap.data();

    if (booking.paymentStatus === 'refunded') {
      return { ok: true, alreadyRefunded: true };
    }
    if (booking.paymentStatus !== 'refund-pending') {
      throw new HttpsError(
        'failed-precondition',
        `Only refund-pending bookings can be marked refunded — current status: ${booking.paymentStatus}`
      );
    }

    const nowIso = new Date().toISOString();
    const patch = {
      paymentStatus: 'refunded',
      refundedAt: nowIso,
      refundedBy: uid,
      refundedVia,
      refundNotes: String(notes || '').trim() || null,
    };
    await ref.update(patch);

    if (booking.paymentId) {
      await db.collection('pendingOrders').doc(booking.paymentId)
        .update({
          paymentStatus: 'refunded',
          refundedAt: nowIso,
          refundedBy: uid,
          refundedVia,
        })
        .catch((err) => console.warn('pendingOrders refund mirror failed:', err?.message));
    }

    await db.collection('auditLog').add({
      action: 'booking_refunded',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: {
        refundedVia,
        amount: booking.totalPrice || null,
        paidBy: booking.paidBy || null,
        notes: patch.refundNotes,
      },
      timestamp: nowIso,
    });

    // Fire customer email. Best-effort: if it fails, the refund stands.
    try {
      await sendRefundIssuedEmail(bookingId);
    } catch (err) {
      console.warn('refund email failed (booking still marked refunded):', err?.message);
    }

    return { ok: true };
  }
);

// ── validateVoucherCode (callable) ──────────────────────────────────────
// Client-side preview of voucher eligibility. Booking pages call this
// when the user types/applies a code to surface the discount before pay.
// Stateless — no redemption, no counter increment. createPayment
// re-runs the same validation atomically when the payment is committed,
// so a successful preview here is not a binding promise.
export const validateVoucherCode = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { code, plate, baseAmount, orderType, days, perDay } = request.data || {};
    const authedUid = request.auth?.uid || null;
    // days/perDay are client-supplied here (preview only) — pay time
    // re-resolves with the server-recomputed values inside createPayment.
    const res = await resolveVoucher({ code, plate, baseAmount, authedUid, orderType, days, perDay });
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true,
      voucherCode: res.voucher.code,
      name: res.voucher.name,
      type: res.voucher.type,
      value: res.voucher.value,
      discountAmount: res.discountAmount,
      // Days vouchers: days this booking would consume + balance available
      // BEFORE consuming (splittable across bookings). Null otherwise.
      daysUsed: res.daysUsed ?? null,
      daysAvailable: res.daysAvailable ?? null,
    };
  }
);

// ── redeemCreditVoucher (callable) ──────────────────────────────────────
// Standalone redemption of a `credits`-type promo voucher (a "gift card").
// Unlike fixed/percent/days vouchers — which discount a purchase at
// createPayment time — a credits voucher grants N free parking credits
// straight to the holder's balance, with no purchase involved. One
// redemption per identity (uid for logged-in customers, normalized plate
// for guests), enforced with a deterministic voucherRedemptions doc read +
// written inside the grant transaction so concurrent calls can't double-spend.
// Open to guests (public vouchers); private vouchers require the assigned uid.
// Returns { ok: true, credits, balance, balanceDocId } or { ok: false, error }.
export const redeemCreditVoucher = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const authedUid = request.auth?.uid || null;
    const normCode = String(request.data?.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normCode) return { ok: false, error: 'invalid-code' };

    const db = getFirestore();
    const voucherRef = db.collection('promoVouchers').doc(normCode);
    const snap = await voucherRef.get();
    if (!snap.exists) return { ok: false, error: 'not-found' };
    const v = snap.data();
    if (!v.active) return { ok: false, error: 'inactive' };
    if (v.type !== 'credits') return { ok: false, error: 'not-credits-type' };

    // Validity window — compare on Bucharest-local date-only strings.
    const today = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
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

    const credits = Number(v.value);
    if (!Number.isInteger(credits) || credits <= 0) return { ok: false, error: 'bad-value' };

    // Identity + balance target. Logged-in: credits land on the uid-keyed
    // balance; the plate (from the request, or the user's first saved vehicle)
    // is only tracked on the balance + transaction. Guest: keyed by the plate,
    // which is therefore required.
    let normPlate = String(request.data?.plate || '').toUpperCase().replace(/[\s-]/g, '');
    let customerId = null;
    let identityKey = null;
    let contact = { email: '', name: '', phone: '' };
    if (authedUid) {
      customerId = authedUid;
      identityKey = `uid:${authedUid}`;
      const uSnap = await db.collection('users').doc(authedUid).get();
      if (uSnap.exists) {
        const u = uSnap.data();
        contact = { email: u.email || '', name: u.displayName || '', phone: u.phone || '' };
        if (!normPlate && Array.isArray(u.vehicles) && u.vehicles[0]?.plate) {
          normPlate = String(u.vehicles[0].plate).toUpperCase().replace(/[\s-]/g, '');
        }
      }
    } else {
      if (!normPlate) return { ok: false, error: 'no-plate' };
      identityKey = `plate:${normPlate}`;
    }

    const balanceDocId = customerId || `plate_${normPlate}`;
    const balanceRef = db.collection('tokenBalances').doc(balanceDocId);
    const redemptionRef = db.collection('voucherRedemptions').doc(`${normCode}_${identityKey}`);

    let newBalance = credits;
    try {
      await db.runTransaction(async (tx) => {
        // Reads first (Firestore requires all reads before writes).
        const vSnap = await tx.get(voucherRef);
        if (!vSnap.exists) throw new HttpsError('not-found', 'voucher disappeared');
        const vData = vSnap.data();
        const redSnap = await tx.get(redemptionRef);
        if (redSnap.exists) throw new HttpsError('already-exists', 'already-used');
        const cap = Number(vData.maxRedemptionsTotal);
        if (Number.isFinite(cap) && cap > 0 && Number(vData.redeemedCount || 0) >= cap) {
          throw new HttpsError('already-exists', 'sold-out');
        }
        const balSnap = await tx.get(balanceRef);

        // Writes — grant credits, stamp the one-shot redemption, bump the count.
        if (balSnap.exists) {
          const data = balSnap.data();
          const existingPlates = data.plates || [];
          const plates = (normPlate && !existingPlates.includes(normPlate))
            ? [...existingPlates, normPlate] : existingPlates;
          const patch = {
            balance: FieldValue.increment(credits),
            totalPurchased: FieldValue.increment(credits),
            plates,
          };
          if (!data.email && contact.email) patch.email = contact.email;
          if (!data.displayName && contact.name) patch.displayName = contact.name;
          if (!data.phone && contact.phone) patch.phone = contact.phone;
          tx.update(balanceRef, patch);
          newBalance = Number(data.balance || 0) + credits;
        } else {
          tx.set(balanceRef, {
            balance: credits,
            totalPurchased: credits,
            plates: normPlate ? [normPlate] : [],
            email: contact.email,
            displayName: contact.name,
            phone: contact.phone,
          });
          newBalance = credits;
        }

        tx.set(redemptionRef, {
          voucherCode: normCode,
          identityKey,
          userId: customerId,
          plate: normPlate || null,
          orderId: null,
          bookingId: null,
          amount: 0,
          type: 'credits',
          value: credits,
          creditsGranted: credits,
          daysUsed: null,
          redeemedAt: new Date().toISOString(),
        });
        tx.update(voucherRef, { redeemedCount: (Number(vData.redeemedCount) || 0) + 1 });

        // Append-only ledger row — also fires the credit confirmation email
        // (E3) and the admin notification via the tokenTransactions trigger.
        const txnRef = db.collection('tokenTransactions').doc();
        tx.set(txnRef, {
          customerId,
          licensePlate: normPlate,
          type: 'purchase',
          quantity: credits,
          amount: 0,
          packId: null,
          timestamp: new Date().toISOString(),
          source: 'gift-voucher',
          paidBy: 'voucher',
          grantedBy: null,
          voucherCode: normCode,
          billing: { type: 'PF' },
        });
      });
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('already-used')) return { ok: false, error: 'already-used' };
      if (msg.includes('sold-out')) return { ok: false, error: 'sold-out' };
      console.error('redeemCreditVoucher failed:', err?.message);
      return { ok: false, error: 'redeem-failed' };
    }

    await db.collection('auditLog').add({
      action: 'credit_voucher_redeemed',
      entityType: 'tokenBalance',
      entityId: balanceDocId,
      actorUid: authedUid,
      payload: { code: normCode, credits, plate: normPlate || null, identityKey },
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return { ok: true, credits, balance: newBalance, balanceDocId };
  }
);

// ── adminResendRefundEmail (callable) ───────────────────────────────────
// Manual re-trigger of the customer-facing refund email. Used when the
// automatic send from adminMarkRefunded failed (Brevo outage, template
// ID was missing at the time, bad recipient that the admin has since
// corrected, etc.) or when the customer claims they never received it.
// Idempotent at the customer's mailbox level — sends another copy
// regardless of prior status.
export const adminResendRefundEmail = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { bookingId } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const booking = snap.data();
    if (booking.paymentStatus !== 'refunded') {
      throw new HttpsError(
        'failed-precondition',
        `Only refunded bookings can resend the email — current status: ${booking.paymentStatus}`,
      );
    }

    const result = await sendRefundIssuedEmail(bookingId);
    await db.collection('auditLog').add({
      action: 'refund_email_resent',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: { ok: !!result?.ok, reason: result?.reason || null, recipient: result?.recipient || null },
      timestamp: new Date().toISOString(),
    });

    if (!result?.ok) {
      throw new HttpsError('internal', `Email send failed: ${result?.reason || 'unknown'}`);
    }
    return { ok: true, recipient: result.recipient };
  }
);

// ── adminResendConfirmationEmail (callable) ─────────────────────────────
// Re-send the booking confirmation email for a reservation that hasn't been
// checked in yet (status 'upcoming'). For staff who need to re-issue it when
// the customer says they never got it, the address was wrong, or the auto
// send failed. Reflects the booking's current paid/unpaid state.
export const adminResendConfirmationEmail = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { bookingId } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');

    const db = getFirestore();
    const snap = await db.collection('bookings').doc(bookingId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const booking = snap.data();
    if (booking.type !== 'longTerm') {
      throw new HttpsError('failed-precondition', 'Only long-term reservations have a confirmation email');
    }
    if (booking.status !== 'upcoming') {
      throw new HttpsError(
        'failed-precondition',
        `Can only resend before check-in — current status: ${booking.status}`,
      );
    }

    const result = await sendBookingConfirmationEmail(bookingId);
    await db.collection('auditLog').add({
      action: 'confirmation_email_resent',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: { ok: !!result?.ok, reason: result?.reason || null, recipient: result?.recipient || null },
      timestamp: new Date().toISOString(),
    });

    if (!result?.ok) {
      throw new HttpsError('internal', `Email send failed: ${result?.reason || 'unknown'}`);
    }
    return { ok: true, recipient: result.recipient };
  }
);

// Normalize a client-supplied billing object into the stored shape. Defensive:
// never trust the client — coerce to strings, cap length, drop unknown keys,
// emit no `undefined` (Firestore rejects it). The client already enforces the
// required fields; this just keeps the persisted doc clean. Falls back to a
// bare PF record when nothing usable is provided.
function sanitizeBilling(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const s = (v) => (v == null ? '' : String(v)).trim().slice(0, 200);
  // Customer outside Romania: county/locality not required (documents issue
  // under BUCURESTI) and PF gets the 13-zero CNP stand-in on the profile too.
  const abroad = b.abroad === true;
  if (b.type === 'PJ') {
    return {
      type: 'PJ',
      companyName: s(b.companyName),
      cui: s(b.cui),
      regCom: s(b.regCom),
      // Mandatory on SmartBill PJ invoices — dropping it here silently failed
      // every PJ document against checkBillingComplete.
      locality: s(b.locality),
      county: s(b.county),
      abroad,
      companyAddress: s(b.companyAddress),
    };
  }
  const out = {
    type: 'PF',
    name: s(b.name),
    firstName: s(b.firstName),
    lastName: s(b.lastName),
    locality: s(b.locality),
    county: s(b.county),
    abroad,
    address: s(b.address),
  };
  const cnp = s(b.cnp) || (abroad ? ABROAD_CNP : '');
  if (cnp) out.cnp = cnp;
  return out;
}

// Number of passengers captured on a long-term reservation (1–10). Returns
// null for anything out of range / missing so older bookings stay unset.
function sanitizePassengers(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

// Flight number captured on a long-term reservation (optional). Upper-cased,
// whitespace-collapsed and capped; null when blank so older bookings stay unset.
function sanitizeFlight(v) {
  const s = (v == null ? '' : String(v)).trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 12);
  return s || null;
}

// ── grantCreditsForCash (callable) ──────────────────────────────────────
// Admin/staff grants tokens directly to a plate (or registered customer)
// after collecting cash/card at the lot. No Netopia involvement. Reuses
// the same creditTokens path as the IPN callback so the resulting docs
// are shape-identical to an online purchase (with source='admin-cash').
// ── adminCreateLongtermBooking (callable) ───────────────────────────────
// Lets staff/admin record a long-term reservation paid in cash/card at
// the lot — bypasses the Netopia flow entirely. Creates a paid booking
// (status='upcoming', paymentStatus='paid', paidBy='admin-cash'|'admin-card')
// without going through pendingOrders. The bookings doc still triggers
// the booking-longterm-confirm email (paid branch).
export const adminCreateLongtermBooking = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    const { uid } = await assertStaff(request);
    const {
      plate, dropoffAt, pickupAt, days, totalPrice,
      payerEmail, payerName, payerPhone,
      customerId,
      paidBy = 'cash',
      brokerName,           // broker/prepaid reservations (e.g. ParkVia)
      autoCheckIn = false,  // walk-in flow: car is at the lot now
      notes,                // optional internal note, mirrors the edit-booking flow
      billing,              // PF/PJ invoice identity captured at the desk
      passengers,           // number of people travelling (1–10), for the shuttle
      flightNumberDropoff,  // optional flight numbers (departure / return)
      flightNumberPickup,
    } = request.data || {};

    if (!plate) throw new HttpsError('invalid-argument', 'Missing plate');
    if (!dropoffAt || !pickupAt) throw new HttpsError('invalid-argument', 'Missing dates');
    const d = Number(days);
    const total = Number(totalPrice);
    if (!Number.isFinite(d) || d <= 0) {
      throw new HttpsError('invalid-argument', 'days must be positive');
    }
    if (!Number.isFinite(total) || total <= 0) {
      throw new HttpsError('invalid-argument', 'totalPrice must be positive');
    }
    if (!['cash', 'card', 'broker', 'later'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash, card, broker or later');
    }
    // Broker/prepaid reservations legitimately carry no billing identity —
    // the broker (ParkVia et al.) bills the customer and no SmartBill document
    // is issued for them — so absent billing stays null rather than the hollow
    // PF record sanitizeBilling would fabricate.
    const billingClean = billing && typeof billing === 'object'
      ? sanitizeBilling(billing)
      : null;
    const payerEmailNorm = normalizeEmail(payerEmail);
    // Server-side account linking: when the UI didn't match a customer (its
    // picker only links on an EXACT datalist match — staff often just type
    // the email) but the payer email belongs to a registered account, stamp
    // that uid. An unlinked booking never shows in the customer's profile:
    // both the profile query and the security rules key on customerId.
    let linkedCustomerId = customerId || null;
    if (!linkedCustomerId && payerEmailNorm) {
      try {
        const userRec = await getAuth().getUserByEmail(payerEmailNorm);
        linkedCustomerId = userRec?.uid || null;
      } catch (_) { /* no account with this email — stays a guest booking */ }
    }
    // 'later' = an unpaid reservation the customer pays afterwards (online via
    // the confirmation-email link, or at the lot). It rides the same rails as
    // a customer pay-at-pickup booking — see the pendingOrder created below.
    const payLater = paidBy === 'later';

    // paidBy → stored marker + booking source. Broker/prepaid reservations
    // already collected the money off-lot (ParkVia et al.), so they carry a
    // 'broker' marker (no cashbook entry) and a 'broker' source for separate
    // tracking; cash/card walk-ins keep their admin- markers; pay-later has
    // no payer yet (null).
    const storedPaidBy = paidBy === 'cash' ? 'admin-cash'
      : paidBy === 'card' ? 'admin-card'
      : paidBy === 'broker' ? 'broker'
      : null;
    const bookingSource = paidBy === 'broker' ? 'broker' : 'admin';

    const db = getFirestore();
    const nowIso = new Date().toISOString();
    // Pay-later reservations get a pendingOrder so they're payable online
    // (/pay → repayOrder) and collectable later (Check-in "Collect" →
    // adminMarkOrderPaid), exactly like a customer pay-at-pickup booking.
    const orderId = payLater ? `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
    // Minted before the insert so the proforma line below can reference it.
    const bookingCode = generateBookingCode('longTerm');
    const bookingRef = await db.collection('bookings').add({
      code: bookingCode,
      type: 'longTerm',
      customerId: linkedCustomerId,
      licensePlate: normalizePlate(plate),
      startDate: dropoffAt,
      endDate: pickupAt,
      dropoffAt,
      pickupAt,
      days: d,
      passengers: sanitizePassengers(passengers),
      flightNumberDropoff: sanitizeFlight(flightNumberDropoff),
      flightNumberPickup: sanitizeFlight(flightNumberPickup),
      basePrice: total,
      latePrice: 0,
      totalPrice: total,
      status: 'upcoming',
      contact: {
        name: payerName || '',
        email: payerEmailNorm,
        phone: payerPhone || '',
      },
      billing: billingClean,
      notes: String(notes || '').trim() || null,
      paymentId: orderId,
      paymentMethod: payLater ? 'pay-at-pickup' : (paidBy === 'broker' ? 'broker' : 'admin'),
      paymentStatus: payLater ? 'unpaid' : 'paid',
      paidAt: payLater ? null : nowIso,
      paidBy: storedPaidBy,
      brokerName: paidBy === 'broker' ? (String(brokerName || '').trim() || null) : null,
      spotId: null,
      createdAt: nowIso,
      completedAt: null,
      source: bookingSource,
      createdBy: uid,
    });

    // Auto-reserve a spot for PAID bookings — the reservation is real
    // immediately (a blue tile on the capacity map until check-in). Pay-later
    // bookings reserve nothing until payment lands (same as a customer
    // pay-at-pickup booking), so an unpaid no-show never orphans a spot.
    let spotId = null;
    if (!payLater) {
      spotId = await reserveAvailableSpot(bookingRef.id);
      if (spotId) {
        await bookingRef.update({ spotId });
      }
    } else {
      await db.collection('pendingOrders').doc(orderId).set({
        orderType: 'longTerm',
        paymentMethod: 'pay-at-pickup',
        status: 'pending',
        paymentStatus: 'unpaid',
        amount: total,
        totalPrice: total,
        days: d,
        // Same reservation number as the booking — the IPN invoice line reads
        // it from here on an online repay (avoids the fallback booking read).
        bookingCode,
        startDate: dropoffAt,
        endDate: pickupAt,
        dropoffAt,
        pickupAt,
        bookingId: bookingRef.id,
        customerData: {
          customerId: linkedCustomerId,
          licensePlate: normalizePlate(plate),
          name: payerName || '',
          email: payerEmailNorm,
          phone: payerPhone || '',
          billing: billingClean,
        },
        createdAt: nowIso,
        createdBy: uid,
      });
    }

    // v1.2: proforma up front for desk-created reservations too (cash, card
    // and pay-later; the pay-at-location fiscal invoice stays manual). Broker
    // money never passes through us (ParkVia et al. bill the customer), so
    // broker reservations get no SmartBill documents.
    if (paidBy !== 'broker') {
      await smartbillIssueSafe({
        kind: 'proforma',
        billing: billingClean,
        email: payerEmailNorm,
        items: longTermDocItems({ bookingCode, amount: total }),
        refs: [bookingRef, ...(payLater ? [db.collection('pendingOrders').doc(orderId)] : [])],
        label: `admin booking ${bookingRef.id}`,
      });
    }

    await db.collection('auditLog').add({
      action: 'booking_created',
      entityType: 'booking',
      entityId: bookingRef.id,
      actorUid: uid,
      payload: { plate, days: d, totalPrice: total, paidBy, spotId, source: bookingSource, brokerName: brokerName || null },
      timestamp: nowIso,
    });

    // Cache billing on the customer profile for future pre-fill (mirrors the
    // online-purchase path in creditTokens). Only for a registered account,
    // and only when billing was actually captured — a broker reservation's
    // null must not wipe a previously saved record.
    if (linkedCustomerId && billingClean) {
      await db.collection('users').doc(linkedCustomerId)
        .set({ billing: billingClean }, { merge: true })
        .catch((err) => console.warn('billing profile cache failed:', err?.message));
    }

    // Desk-created reservations carry a plate too — put it on the profile when
    // the payer resolved to a real account.
    await addPlateToProfile(linkedCustomerId, plate);

    // Cash drawer only for physically-collected cash. Card is reconciled by
    // the terminal; broker/prepaid money never touches the lot.
    if (paidBy === 'cash') {
      await recordCashEntry({
        agentUid: uid,
        amount: total,
        source: 'longterm-direct',
        plate: normalizePlate(plate),
        payerName: payerName || null,
        bookingId: bookingRef.id,
      });
    }

    // Walk-in shortcut: customer is at the gate now, flip the booking to
    // active and stamp checkinTimestamp. Spot is already assigned above
    // (reservation auto-happens for paid admin bookings), so we just need
    // to mark it occupied and write the activeCheckIns row.
    let checkedIn = false;
    if (autoCheckIn && !payLater) {
      const checkinIso = new Date().toISOString();
      await bookingRef.update({
        status: 'active',
        checkinTimestamp: checkinIso,
      });
      if (spotId) {
        try {
          await db.collection('spots').doc(spotId)
            .update({ status: 'occupied', currentBookingId: bookingRef.id })
            .catch((err) => console.warn('walk-in spot occupy failed:', err?.message));
        } catch (_) { /* swallow — booking still flipped */ }
      }
      try {
        await db.collection('activeCheckIns').doc(normalizePlate(plate)).set({
          plate: normalizePlate(plate),
          bookingId: bookingRef.id,
          type: 'longTerm',
          customerId: linkedCustomerId,
          checkinTime: checkinIso,
          checkinTimestamp: checkinIso,
          source: 'walk-in',
        });
      } catch (err) {
        console.warn('walk-in activeCheckIns write failed:', err?.message);
      }
      await db.collection('auditLog').add({
        action: 'booking_checkin',
        entityType: 'booking',
        entityId: bookingRef.id,
        actorUid: uid,
        payload: { plate: normalizePlate(plate), spotId, source: 'walk-in' },
        timestamp: checkinIso,
      });
      checkedIn = true;
    }

    return { bookingId: bookingRef.id, spotId, checkedIn };
  }
);

export const grantCreditsForCash = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    const { uid } = await assertStaff(request);
    const {
      plate, quantity, packId, amount,
      payerEmail, payerName, payerPhone,
      customerId,
      paidBy = 'cash',
      autoCheckIn = false,  // walk-in flow: consume one token immediately
      billing,              // PF/PJ invoice identity captured at the desk
    } = request.data || {};
    if (!plate) throw new HttpsError('invalid-argument', 'Missing plate');
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new HttpsError('invalid-argument', 'quantity must be a positive number');
    }
    if (!['cash', 'card'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash or card');
    }

    const adminPaidBy = paidBy === 'cash' ? 'admin-cash' : 'admin-card';
    const billingClean = sanitizeBilling(billing);
    const { balanceDocId: docId, txId } = await creditTokens({
      packId: packId || null,
      quantity: qty,
      amount: Number(amount) || 0,
      customerData: {
        customerId: customerId || null,
        licensePlate: plate,
        email: payerEmail || '',
        name: payerName || '',
        phone: payerPhone || '',
        billing: billingClean,
      },
      source: 'admin-cash',
      paidBy: adminPaidBy,
      grantedBy: uid,
    });

    // v1.2: proforma for the over-the-counter credit sale. The fiscal invoice
    // is issued manually after collection (pay-at-location decision).
    if ((Number(amount) || 0) > 0) {
      await smartbillIssueSafe({
        kind: 'proforma',
        billing: billingClean,
        email: payerEmail || '',
        items: creditsDocItems({ amount: Number(amount) || 0 }),
        refs: [getFirestore().collection('tokenTransactions').doc(txId)],
        label: `credits desk ${txId}`,
      });
    }

    const nowIso = new Date().toISOString();
    await getFirestore().collection('auditLog').add({
      action: 'admin_credits_granted',
      entityType: 'tokenBalance',
      entityId: docId,
      actorUid: uid,
      // Coerce optionals to null — Firestore rejects `undefined`, and the
      // walk-in modal omits packId entirely (that omission was the original
      // 500: "Cannot use undefined ... in field payload.packId").
      payload: {
        plate,
        quantity: qty,
        packId: packId || null,
        paidBy,
        payerEmail: payerEmail || null,
      },
      timestamp: nowIso,
    });

    if (paidBy === 'cash') {
      await recordCashEntry({
        agentUid: uid,
        amount: Number(amount) || 0,
        source: 'credits-direct',
        plate: normalizePlate(plate),
        payerName: payerName || null,
        tokenBalanceDocId: docId,
      });
    }

    // Walk-in shortcut: customer is at the gate now. Consume one token
    // and create the activeCheckIns row in the same call so the agent
    // doesn't have to switch screens.
    let checkedIn = false;
    if (autoCheckIn) {
      const normPlate = normalizePlate(plate);
      const existingActive = await getFirestore().collection('activeCheckIns').doc(normPlate).get();
      if (!existingActive.exists) {
        // Decrement balance.
        try {
          await getFirestore().collection('tokenBalances').doc(docId)
            .update({ balance: FieldValue.increment(-1) });
        } catch (err) {
          console.warn('walk-in token decrement failed:', err?.message);
        }
        // Find the first available spot (best-effort — no spot = still allow check-in).
        let assignedSpotId = null;
        try {
          const spotsSnap = await getFirestore().collection('spots')
            .where('status', '==', 'available')
            .limit(1)
            .get();
          if (!spotsSnap.empty) assignedSpotId = spotsSnap.docs[0].id;
        } catch (err) {
          console.warn('walk-in spot lookup failed:', err?.message);
        }
        const checkinIso = new Date().toISOString();
        // Booking doc so the commuter shows on the Check-out tab + capacity map.
        const bookingId = await createCreditCheckInBooking(getFirestore(), {
          plate: normPlate,
          customerId: customerId || (docId.startsWith('plate_') ? null : docId),
          contact: { name: payerName || '', email: payerEmail || '', phone: payerPhone || '' },
          spotId: assignedSpotId,
          source: 'walk-in',
        });
        if (assignedSpotId) {
          try {
            await getFirestore().collection('spots').doc(assignedSpotId)
              .update({ status: 'occupied', currentBookingId: bookingId });
          } catch (err) { console.warn('walk-in spot occupy failed:', err?.message); }
        }
        // activeCheckIns row keyed by plate (matches client pattern).
        await getFirestore().collection('activeCheckIns').doc(normPlate).set({
          balanceDocId: docId,
          bookingId,
          licensePlate: normPlate,
          spotId: assignedSpotId,
          checkinTime: checkinIso,
          source: 'walk-in',
        });
        // Transaction row so it shows up in ledger.
        await getFirestore().collection('tokenTransactions').add({
          customerId: docId.startsWith('plate_') ? null : docId,
          licensePlate: normPlate,
          type: 'use',
          quantity: -1,
          spotId: assignedSpotId,
          bookingId,
          timestamp: checkinIso,
          source: 'walk-in',
        });
        checkedIn = true;
      }
    }

    return { ok: true, balanceDocId: docId, checkedIn };
  }
);

// ── adminGrantCredits (callable) ────────────────────────────────────────
// Admin/agent grants free parking credits straight to a registered user's
// balance — no voucher, no cash, no payment. Distinct from grantCreditsForCash
// (which records a cash/card sale + a cashbook entry). Used from the user-detail
// modal to gift / compensate a commuter. The plate is derived from the user's
// first saved vehicle (best-effort, purely informational on the balance).
export const adminGrantCredits = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertAgent(request);
    const { customerId, quantity, note } = request.data || {};
    if (!customerId) throw new HttpsError('invalid-argument', 'Missing customerId');
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new HttpsError('invalid-argument', 'quantity must be a positive integer');
    }

    const db = getFirestore();
    const uSnap = await db.collection('users').doc(customerId).get();
    if (!uSnap.exists) throw new HttpsError('not-found', 'User not found');
    const u = uSnap.data();
    const firstPlate = Array.isArray(u.vehicles) && u.vehicles[0]?.plate ? u.vehicles[0].plate : '';

    const { balanceDocId: docId } = await creditTokens({
      packId: null,
      quantity: qty,
      amount: 0,
      customerData: {
        customerId,
        licensePlate: firstPlate,
        email: u.email || '',
        name: u.displayName || '',
        phone: u.phone || '',
      },
      source: 'admin-gift',
      paidBy: 'gift',
      grantedBy: uid,
    });

    await db.collection('auditLog').add({
      action: 'admin_credits_gifted',
      entityType: 'tokenBalance',
      entityId: docId,
      actorUid: uid,
      payload: { customerId, quantity: qty, note: note ? String(note).slice(0, 200) : null },
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    const balSnap = await db.collection('tokenBalances').doc(docId).get();
    return { ok: true, balanceDocId: docId, balance: balSnap.exists ? Number(balSnap.data().balance || 0) : qty };
  }
);

// ── adminDeductCredits (callable) ───────────────────────────────────────
// Admin/agent removes credits from a registered user's balance (correction
// or clawback) — the mirror of adminGrantCredits. Floored at 0: you can't
// drive a balance negative, and concurrent ops can't overdraw (deduct runs
// in a transaction). Writes an `adjustment` ledger row (deliberately NOT a
// `purchase`/`use` type, so the onTokenTransactionCreated email trigger stays
// silent) and audit-logs. Money-adjacent → agent gate (drivers excluded).
export const adminDeductCredits = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertAgent(request);
    const { customerId, quantity, note } = request.data || {};
    if (!customerId) throw new HttpsError('invalid-argument', 'Missing customerId');
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new HttpsError('invalid-argument', 'quantity must be a positive integer');
    }

    const db = getFirestore();
    const ref = db.collection('tokenBalances').doc(customerId);
    const nowIso = new Date().toISOString();

    const { removed, balance, plate } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'No credit balance for this user');
      const data = snap.data();
      const current = Number(data.balance) || 0;
      const take = Math.min(qty, current); // floor at 0
      tx.update(ref, { balance: current - take });
      return { removed: take, balance: current - take, plate: (data.plates && data.plates[0]) || null };
    });

    if (removed > 0) {
      await db.collection('tokenTransactions').add({
        customerId,
        licensePlate: plate,
        type: 'adjustment',
        quantity: -removed,
        amount: 0,
        timestamp: nowIso,
        source: 'admin-adjust',
        paidBy: null,
        grantedBy: uid,
      });
    }

    await db.collection('auditLog').add({
      action: 'admin_credits_adjusted',
      entityType: 'tokenBalance',
      entityId: customerId,
      actorUid: uid,
      payload: { customerId, requested: qty, removed, balance, note: note ? String(note).slice(0, 200) : null },
      timestamp: nowIso,
    }).catch(() => {});

    return { ok: true, balanceDocId: customerId, removed, balance };
  }
);

// ── adminAssignVoucher (callable) ───────────────────────────────────────
// Admin assigns or removes a private promo/credit voucher for a specific
// user, from that user's detail modal (the mirror of the per-voucher user
// picker on /admin/vouchers). Mutates promoVouchers.assignedUserIds via
// arrayUnion / arrayRemove. Assigning reuses the onPromoVoucherAssigned email
// trigger, which notifies the recipient. Vouchers are an admin config surface
// (Firestore rules gate promoVouchers writes to admin), so admin-only here.
export const adminAssignVoucher = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertAdmin(request);
    const { code, customerId, assign } = request.data || {};
    if (!code || !customerId) throw new HttpsError('invalid-argument', 'Missing code or customerId');
    const normCode = String(code).trim().toUpperCase();

    const db = getFirestore();
    const ref = db.collection('promoVouchers').doc(normCode);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Voucher not found');

    await ref.update({
      assignedUserIds: assign
        ? FieldValue.arrayUnion(customerId)
        : FieldValue.arrayRemove(customerId),
      updatedAt: new Date().toISOString(),
    });

    await db.collection('auditLog').add({
      action: assign ? 'voucher_assigned' : 'voucher_unassigned',
      entityType: 'promoVoucher',
      entityId: normCode,
      actorUid: uid,
      payload: { code: normCode, customerId },
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return { ok: true, code: normCode, assigned: !!assign };
  }
);

// Surface a credit (commuter) check-in as a `bookings` doc so it appears on
// the Check-out tab and the capacity map (the dashboard reads `bookings`,
// not `activeCheckIns`). The Check-out tab buckets commuters by their
// check-in time (they leave the day they arrive), so dates are stamped at
// "now" — no scheduled pick-up. Returns the new booking id.
async function createCreditCheckInBooking(db, { plate, customerId, contact, spotId, source }) {
  const nowIso = new Date().toISOString();
  // Commuters park for the day and must leave by 8 PM — pick-up is that day's
  // 20:00 cutoff, not the drop-off time. Falls back to now if the cutoff can't
  // be computed (never expected).
  const pickupIso = bucharestCutoffIso(nowIso, 20) || nowIso;
  const ref = await db.collection('bookings').add({
    code: generateBookingCode('credit'),
    type: 'credit',
    customerId: customerId || null,
    licensePlate: plate,
    startDate: nowIso,
    endDate: pickupIso,
    dropoffAt: nowIso,
    pickupAt: pickupIso,
    days: 1,
    basePrice: 0,
    latePrice: 0,
    totalPrice: 0,
    status: 'active',
    contact: contact || {},
    billing: { type: 'PF' },
    paymentId: null,
    paymentMethod: 'credit',
    paymentStatus: 'paid',
    paidAt: nowIso,
    paidBy: 'credit',
    checkinTimestamp: nowIso,
    spotId: spotId || null,
    createdAt: nowIso,
    completedAt: null,
    source: source || 'admin',
  });
  return ref.id;
}

// ── checkInWithCredits (callable) ───────────────────────────────────────
// Manual commuter (navetist) check-in that consumes EXISTING credits — no
// money movement, no new credits granted. Used by the walk-in flow when an
// agent/driver picks a customer who already has a balance. Mirrors the
// walk-in branch of grantCreditsForCash (spot assignment + activeCheckIns +
// `use` transaction) but deducts from the balance the customer already
// holds. Allowed for any backoffice role (drivers included) since it's a
// pure on-the-lot operation.
export const checkInWithCredits = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { plate, customerId = null, credits = 1 } = request.data || {};
    if (!plate) throw new HttpsError('invalid-argument', 'Missing plate');
    const qty = Number(credits);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new HttpsError('invalid-argument', 'credits must be a positive integer');
    }

    const db = getFirestore();
    const normPlate = normalizePlate(plate);

    // Resolve the balance doc: prefer the registered customer's doc, then a
    // plate-keyed guest doc, then a customer doc that merely tracks this
    // plate in its `plates` array (matches the client lookupByPlate order).
    let docId = null;
    if (customerId) {
      const snap = await db.collection('tokenBalances').doc(customerId).get();
      if (snap.exists) docId = customerId;
    }
    if (!docId) {
      const plateDocId = `plate_${normPlate}`;
      const snap = await db.collection('tokenBalances').doc(plateDocId).get();
      if (snap.exists) docId = plateDocId;
    }
    if (!docId) {
      const arr = await db.collection('tokenBalances')
        .where('plates', 'array-contains', normPlate)
        .limit(1)
        .get();
      if (!arr.empty) docId = arr.docs[0].id;
    }
    if (!docId) throw new HttpsError('not-found', 'NO_BALANCE');

    // Find the first free spot (best-effort — no spot still allows check-in).
    let assignedSpotId = null;
    try {
      const spotsSnap = await db.collection('spots')
        .where('status', '==', 'available')
        .limit(1)
        .get();
      if (!spotsSnap.empty) assignedSpotId = spotsSnap.docs[0].id;
    } catch (err) {
      console.warn('checkInWithCredits spot lookup failed:', err?.message);
    }

    const checkinIso = new Date().toISOString();
    const bookingCustomerId = customerId || (docId.startsWith('plate_') ? null : docId);

    // Deduct + claim the plate in ONE transaction. The ALREADY_CHECKED_IN
    // guard used to be a plain read before the deduction, so two agents (or a
    // double-tap) submitting the same plate in the same second both passed it
    // and both deducted — two credits burned for one check-in. tx.create on
    // the plate-keyed activeCheckIns row makes the second caller abort BEFORE
    // its deduction commits.
    const ref = db.collection('tokenBalances').doc(docId);
    const activeRef = db.collection('activeCheckIns').doc(normPlate);
    await db.runTransaction(async (tx) => {
      const [snap, activeSnap] = await Promise.all([tx.get(ref), tx.get(activeRef)]);
      if (activeSnap.exists) throw new HttpsError('failed-precondition', 'ALREADY_CHECKED_IN');
      if (!snap.exists) throw new HttpsError('not-found', 'NO_BALANCE');
      const bal = Number(snap.data().balance || 0);
      if (bal < qty) throw new HttpsError('failed-precondition', 'INSUFFICIENT_CREDITS');
      tx.update(ref, { balance: FieldValue.increment(-qty) });
      tx.create(activeRef, {
        balanceDocId: docId,
        bookingId: null, // stamped below once the booking doc exists
        licensePlate: normPlate,
        customerId: bookingCustomerId,
        spotId: assignedSpotId,
        checkinTime: checkinIso,
        source: 'manual',
      });
    });

    // Contact from the balance doc (best-effort) for a friendlier check-out row.
    let contact = {};
    try {
      const bd = (await ref.get()).data() || {};
      contact = { name: bd.displayName || '', email: bd.email || '', phone: bd.phone || '' };
    } catch (_) { /* swallow */ }

    // Booking doc so the commuter shows on the Check-out tab + capacity map.
    const bookingId = await createCreditCheckInBooking(db, {
      plate: normPlate, customerId: bookingCustomerId, contact, spotId: assignedSpotId, source: 'manual',
    });
    if (assignedSpotId) {
      try {
        await db.collection('spots').doc(assignedSpotId)
          .update({ status: 'occupied', currentBookingId: bookingId });
      } catch (err) { console.warn('checkInWithCredits spot occupy failed:', err?.message); }
    }

    await activeRef.update({ bookingId })
      .catch((err) => console.warn('checkInWithCredits bookingId stamp failed:', err?.message));

    await db.collection('tokenTransactions').add({
      customerId: bookingCustomerId,
      licensePlate: normPlate,
      type: 'use',
      quantity: -qty,
      spotId: assignedSpotId,
      bookingId,
      timestamp: checkinIso,
      source: 'manual',
    });

    await db.collection('auditLog').add({
      action: 'token_used',
      entityType: 'tokenBalance',
      entityId: docId,
      actorUid: uid,
      payload: { plate: normPlate, credits: qty, spotId: assignedSpotId, source: 'manual' },
      timestamp: checkinIso,
    });

    return { ok: true, balanceDocId: docId, credits: qty, spotId: assignedSpotId, bookingId, checkedIn: true };
  }
);

// ── adminChargeOverstay (callable) ──────────────────────────────────────
// Records an overstay (late-pickup) charge on a booking. The client suggests
// an amount (extra days × the booking's own daily rate) but the agent can
// edit it. Adds to the booking's latePrice, writes a `lateFee` ledger row,
// records a cash-drawer entry when paid in cash, and audit-logs. Money op →
// agent gate (drivers excluded).
export const adminChargeOverstay = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    const { uid } = await assertAgent(request);
    const { bookingId, amount, paidBy = 'cash' } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be a positive number');
    }
    if (!['cash', 'card'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash or card');
    }

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const b = snap.data();
    const nowIso = new Date().toISOString();
    const storedPaidBy = paidBy === 'cash' ? 'admin-cash' : 'admin-card';
    const newLate = (Number(b.latePrice) || 0) + amt;

    await ref.update({
      latePrice: newLate,
      overstayChargedAt: nowIso,
      overstayChargedBy: uid,
      overstayPaidBy: storedPaidBy,
    });

    // Ledger row (shows in /admin/transactions as a late-fee).
    await db.collection('tokenTransactions').add({
      customerId: b.customerId || null,
      licensePlate: b.licensePlate || null,
      bookingId,
      type: 'lateFee',
      amount: amt,
      paidBy: storedPaidBy,
      timestamp: nowIso,
      source: 'overstay',
    });

    // Cash drawer only for physically-collected cash.
    if (paidBy === 'cash') {
      await recordCashEntry({
        agentUid: uid,
        amount: amt,
        source: 'overstay',
        plate: b.licensePlate || null,
        payerName: b.contact?.name || null,
        bookingId,
      });
    }

    // v1.2 Phase 4b: overstay is desk-collected money → proforma for the
    // charge (the fiscal invoice for pay-at-location money stays manual).
    await smartbillIssueSafe({
      kind: 'proforma',
      field: 'extraProformas',
      append: true,
      statusOnSuccess: null,
      billing: b.billing,
      email: b.contact?.email,
      items: [{ name: `Servicii parcare conform rezervării ${b.code || bookingId} - depășire`, quantity: 1, price: amt, code: 'PARK-LT' }],
      refs: [ref],
      label: `overstay ${bookingId}`,
    });

    await db.collection('auditLog').add({
      action: 'booking_overstay_charged',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: { amount: amt, paidBy, latePrice: newLate },
      timestamp: nowIso,
    });

    return { ok: true, latePrice: newLate };
  }
);

// ── previewBookingReprice (callable) ────────────────────────────────────
// Read-only: re-prices a long-term booking (upcoming or active) against new
// drop-off / pick-up datetimes using the authoritative tier/seasonal pricer,
// and returns the price difference vs the current stay. The difference is the
// STANDARD incremental cost (two authoritative recomputes), independent of any
// discount originally applied. No writes; drives the admin edit-dialog preview.
export const previewBookingReprice = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    await assertStaff(request);
    const { bookingId, newDropoffAt, newPickupAt } = request.data || {};
    if (!bookingId || !newPickupAt) {
      throw new HttpsError('invalid-argument', 'Missing bookingId or newPickupAt');
    }

    const db = getFirestore();
    const snap = await db.collection('bookings').doc(bookingId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const b = snap.data();
    if (b.type !== 'longTerm') {
      throw new HttpsError('failed-precondition', 'Only long-term bookings can be re-priced');
    }

    const dropoff = newDropoffAt || b.dropoffAt;
    const newCalc = await computeAuthoritativeLongTermTotal({ dropoffAt: dropoff, pickupAt: newPickupAt });
    if (!newCalc.ok) throw new HttpsError('invalid-argument', newCalc.error || 'Could not price the new dates');
    const oldCalc = await computeAuthoritativeLongTermTotal({ dropoffAt: b.dropoffAt, pickupAt: b.pickupAt });
    const oldTotal = oldCalc.ok ? oldCalc.expected : (Number(b.totalPrice) || 0);

    return {
      ok: true,
      days: newCalc.days,
      perDay: newCalc.perDay,
      newTotal: newCalc.expected,
      oldTotal,
      difference: newCalc.expected - oldTotal,
      paid: b.paymentStatus === 'paid',
    };
  }
);

// ── adminRepriceBooking (callable) ──────────────────────────────────────
// Moves a long-term booking's drop-off and/or pick-up datetime (upcoming or
// active) and re-prices it. Server re-derives the price — never trusts the
// client. Settlement depends on payment state:
//   • unpaid (pay-at-pickup, upcoming only): re-quote — rewrite totalPrice /
//     basePrice / days and keep the linked pending order's amount in sync. No
//     money moves; the new total is collected at pick-up as usual.
//   • paid: settle the difference like an overstay — extension (difference > 0)
//     collects the extra at the desk (cash → cashbook, card → terminal) into a
//     separate `extensionPrice` accumulator + an `extension` ledger row;
//     shortening (difference < 0) routes the overpaid amount to the Refunds
//     queue (`pendingRefundAmount`). The booking stays check-out-able.
// Money op → agent gate (drivers excluded).
export const adminRepriceBooking = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    const { uid } = await assertAgent(request);
    const { bookingId, newDropoffAt, newPickupAt, paidBy = 'cash' } = request.data || {};
    if (!bookingId || !newPickupAt) {
      throw new HttpsError('invalid-argument', 'Missing bookingId or newPickupAt');
    }

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const b = snap.data();
    if (b.type !== 'longTerm') {
      throw new HttpsError('failed-precondition', 'Only long-term bookings can be re-priced');
    }
    if (!['upcoming', 'active'].includes(b.status)) {
      throw new HttpsError('failed-precondition', 'Booking cannot be re-priced in its current state');
    }

    const newDropoff = newDropoffAt || b.dropoffAt;
    if (Date.parse(newPickupAt) <= Date.parse(newDropoff)) {
      throw new HttpsError('invalid-argument', 'Pick-up must be after drop-off');
    }
    const newCalc = await computeAuthoritativeLongTermTotal({ dropoffAt: newDropoff, pickupAt: newPickupAt });
    if (!newCalc.ok) throw new HttpsError('invalid-argument', newCalc.error || 'Could not price the new dates');
    const oldCalc = await computeAuthoritativeLongTermTotal({ dropoffAt: b.dropoffAt, pickupAt: b.pickupAt });
    const oldTotal = oldCalc.ok ? oldCalc.expected : (Number(b.totalPrice) || 0);
    const difference = newCalc.expected - oldTotal;

    const nowIso = new Date().toISOString();
    const patch = {
      dropoffAt: newDropoff,
      startDate: String(newDropoff).slice(0, 10),
      pickupAt: newPickupAt,
      endDate: String(newPickupAt).slice(0, 10),
      days: newCalc.days,
      perDay: newCalc.perDay,
      checkoutAdjustedAt: nowIso,
      checkoutAdjustedBy: uid,
    };

    // Unpaid pay-at-pickup → re-quote (rewrite the gross; no money moves now).
    // The new total is collected at pick-up via the usual collect dialog, which
    // reads the pending order's amount — so keep that in sync too.
    if (b.paymentStatus !== 'paid') {
      patch.totalPrice = newCalc.expected;
      patch.basePrice = newCalc.expected;
      await ref.update(patch);
      if (b.paymentId) {
        await db.collection('pendingOrders').doc(b.paymentId).update({
          amount: newCalc.expected,
          totalPrice: newCalc.expected,
          days: newCalc.days,
          dropoffAt: newDropoff,
          pickupAt: newPickupAt,
        }).catch(() => {}); // best-effort; the booking is the source of truth
      }
      await db.collection('auditLog').add({
        action: 'booking_repriced',
        entityType: 'booking',
        entityId: bookingId,
        actorUid: uid,
        payload: { requote: true, newDropoff, newPickupAt, days: newCalc.days, oldTotal, newTotal: newCalc.expected },
        timestamp: nowIso,
      });
      // v1.2 Phase 4b: the payment request changed → replace the proforma
      // (delete the old non-fiscal one, issue a fresh one at the new total).
      {
        const sbRefs = [ref, ...(b.paymentId ? [db.collection('pendingOrders').doc(b.paymentId)] : [])];
        await smartbillDeleteProformaSafe({ sb: b.smartbill, refs: sbRefs, label: `requote ${bookingId}` });
        await smartbillIssueSafe({
          kind: 'proforma',
          billing: b.billing,
          email: b.contact?.email,
          items: longTermDocItems({ bookingCode: b.code, amount: newCalc.expected }),
          refs: sbRefs,
          label: `requote ${bookingId}`,
        });
      }
      return { ok: true, requote: true, difference, days: newCalc.days, perDay: newCalc.perDay, newTotal: newCalc.expected };
    }

    // Paid → settle the difference (mirrors adminChargeOverstay).
    if (difference > 0) {
      if (!['cash', 'card'].includes(paidBy)) {
        throw new HttpsError('invalid-argument', 'paidBy must be cash or card');
      }
      const storedPaidBy = paidBy === 'cash' ? 'admin-cash' : 'admin-card';
      patch.extensionPrice = (Number(b.extensionPrice) || 0) + difference;
      patch.extensionPaidBy = storedPaidBy;
      await ref.update(patch);

      await db.collection('tokenTransactions').add({
        customerId: b.customerId || null,
        licensePlate: b.licensePlate || null,
        bookingId,
        type: 'extension',
        amount: difference,
        paidBy: storedPaidBy,
        timestamp: nowIso,
        source: 'reprice',
      });

      if (paidBy === 'cash') {
        await recordCashEntry({
          agentUid: uid,
          amount: difference,
          source: 'longterm-extension',
          plate: b.licensePlate || null,
          payerName: b.contact?.name || null,
          bookingId,
        });
      }

      // v1.2 Phase 4b: the extension is desk-collected money → proforma for
      // the difference (fiscal invoice for pay-at-location money is manual).
      await smartbillIssueSafe({
        kind: 'proforma',
        field: 'extraProformas',
        append: true,
        statusOnSuccess: null,
        billing: b.billing,
        email: b.contact?.email,
        items: [{ name: `Servicii parcare conform rezervării ${b.code || bookingId} - extindere`, quantity: 1, price: difference, code: 'PARK-LT' }],
        refs: [ref],
        label: `extension ${bookingId}`,
      });
    } else if (difference < 0) {
      patch.pendingRefundAmount = (Number(b.pendingRefundAmount) || 0) + Math.abs(difference);
      patch.pendingRefundReason = 'reprice-shortened';
      patch.pendingRefundCreatedAt = nowIso;
      await ref.update(patch);

      // v1.2 Phase 4b: shortened paid stay. If WE issued the fiscal invoice
      // (online-paid), adjust it with a partial storno — an invoice with a
      // negative line (verified against the account 2026-07-17). Desk-paid
      // bookings have no auto invoice; staff adjust theirs manually.
      if (b.smartbill?.invoice?.number) {
        await smartbillIssueSafe({
          kind: 'invoice',
          field: 'partialStornos',
          append: true,
          statusOnSuccess: null,
          billing: b.billing,
          email: b.contact?.email,
          items: [{ name: `Storno parțial - Servicii parcare conform rezervării ${b.code || bookingId}`, quantity: 1, price: difference, code: 'PARK-LT' }],
          refs: [ref],
          label: `partial storno ${bookingId}`,
        });
      }
    } else {
      await ref.update(patch);
    }

    await db.collection('auditLog').add({
      action: 'booking_repriced',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: {
        newDropoff,
        newPickupAt,
        days: newCalc.days,
        oldTotal,
        newTotal: newCalc.expected,
        difference,
        paidBy: difference > 0 ? paidBy : null,
      },
      timestamp: nowIso,
    });

    return { ok: true, difference, days: newCalc.days, perDay: newCalc.perDay, newTotal: newCalc.expected };
  }
);

// ── adminResolvePendingRefund (callable) ────────────────────────────────
// Clears a pending partial refund created by re-pricing a booking to a shorter
// stay (adminRepriceBooking). Marks it resolved on the booking + audits; the
// actual money movement (Netopia panel / cash returned / card terminal) is
// manual, mirroring the main refund queue. Money op → agent gate.
export const adminResolvePendingRefund = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertAgent(request);
    const { bookingId, refundedVia = 'cash-returned' } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const b = snap.data();
    const amount = Number(b.pendingRefundAmount) || 0;
    if (amount <= 0) throw new HttpsError('failed-precondition', 'No pending refund on this booking');

    const nowIso = new Date().toISOString();
    await ref.update({
      pendingRefundAmount: FieldValue.delete(),
      pendingRefundReason: FieldValue.delete(),
      pendingRefundCreatedAt: FieldValue.delete(),
      checkoutRefundedAt: nowIso,
      checkoutRefundedBy: uid,
      checkoutRefundedVia: refundedVia,
      checkoutRefundedAmount: amount,
    });

    await db.collection('auditLog').add({
      action: 'booking_checkout_refund_resolved',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: { amount, refundedVia },
      timestamp: nowIso,
    });

    return { ok: true, amount };
  }
);

// ── requestPasswordReset (callable) ──────────────────────────────────────
// Replaces Firebase Auth's built-in password-reset email so we can use the
// branded Brevo template. Uses Admin SDK to mint the action link, then
// sends it via Brevo. Always returns ok — we never leak whether an email
// is registered (timing-safe behavior matches Firebase Auth's default).
export const requestPasswordReset = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { email } = request.data || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'Missing or invalid email');
    }
    try {
      const link = await getAuth().generatePasswordResetLink(email, {
        url: 'https://mangoparking.ro/',
        handleCodeInApp: false,
      });
      let displayName = '';
      let locale = 'ro';
      try {
        const userRecord = await getAuth().getUserByEmail(email);
        displayName = userRecord.displayName || '';
        const u = await getFirestore().collection('users').doc(userRecord.uid).get();
        if (u.exists) {
          const data = u.data();
          displayName = data.displayName || displayName;
          if (data.locale === 'en') locale = 'en';
        }
      } catch (err) {
        // User lookup failure — still send (the action link works on
        // its own; we just use generic copy).
      }
      const firstName = (displayName || email.split('@')[0]).split(/\s+/)[0];
      await sendBrevoEmail({
        to: email,
        name: displayName,
        templateName: 'password-reset',
        locale,
        params: {
          firstName,
          resetLink: link,
          expiresIn: locale === 'en' ? '1 hour' : '1 oră',
        },
      });
      // Alert staff — only reached when the link generated, i.e. the account
      // exists; never fires for unknown emails.
      await notifyAdminPasswordReset({ email, displayName }).catch(() => {});
    } catch (err) {
      // Swallow — never reveal whether the email exists.
      console.warn('requestPasswordReset:', err?.message);
    }
    return { ok: true };
  }
);

// ── assertAdmin: stricter than assertStaff (admin role required) ────────
async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  const uid = request.auth.uid;
  const snap = await getFirestore().collection('users').doc(uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }
  return { uid, role };
}

// ── smartbillHealthcheck (callable) ─────────────────────────────────────
// Phase 1 of the SmartBill integration (see documentation/roadmap/v.1.2_smartbill.md).
// Admin-only. Exercises the read-only SmartBill endpoints to confirm the
// account is wired before any invoice is ever issued:
//   - the pinned fiscal-invoice series ('MANGO', type f) and proforma series
//     ('Mango', type p) both exist on the account
//   - the expected VAT rate (21%) is available
// Returns what SmartBill reports plus a `ready` flag. Throws a clear
// permission/precondition error if the secrets aren't set, so a failed call
// distinguishes "not configured yet" from "misconfigured account".
function seriesNames(seriesResp) {
  const list = Array.isArray(seriesResp?.list) ? seriesResp.list
    : Array.isArray(seriesResp?.series) ? seriesResp.series
    : [];
  return list.map((s) => s?.name).filter(Boolean);
}

export const smartbillHealthcheck = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    await assertAdmin(request);
    let series;
    let proformaSeries;
    let taxes;
    try {
      // Type 'f' = invoice series (factura), 'p' = proforma (estimate) series.
      series = await listSeries('f');
      proformaSeries = await listSeries('p');
      taxes = await listTaxes();
    } catch (err) {
      throw new HttpsError('failed-precondition', `SmartBill: ${err?.message || 'unknown error'}`);
    }
    const invoiceSeriesNames = seriesNames(series);
    const proformaSeriesNames = seriesNames(proformaSeries);
    const taxList = Array.isArray(taxes?.taxes) ? taxes.taxes
      : Array.isArray(taxes?.list) ? taxes.list
      : [];
    const hasExpectedVat = taxList.some((t) => Number(t?.percentage) === DEFAULT_VAT_PERCENT);
    const resolvedInvoiceSeries = matchSeries(invoiceSeriesNames, INVOICE_SERIES);
    const resolvedProformaSeries = matchSeries(proformaSeriesNames, PROFORMA_SERIES);
    return {
      ready: !!resolvedInvoiceSeries && !!resolvedProformaSeries && hasExpectedVat,
      expectedVatPercent: DEFAULT_VAT_PERCENT,
      hasExpectedVat,
      expectedInvoiceSeries: INVOICE_SERIES,
      resolvedInvoiceSeries,
      hasInvoiceSeries: !!resolvedInvoiceSeries,
      expectedProformaSeries: PROFORMA_SERIES,
      resolvedProformaSeries,
      hasProformaSeries: !!resolvedProformaSeries,
      series: invoiceSeriesNames,
      proformaSeries: proformaSeriesNames,
      taxes: taxList,
      // Raw payloads kept so the admin can eyeball unexpected shapes — the
      // documented response keys aren't fully pinned until we see the sandbox.
      raw: { series, proformaSeries, taxes },
    };
  }
);

// ── smartbillTestIssue (callable) ───────────────────────────────────────
// Phase 2 pre-flight: verify that the DRAFTED SmartBill payload shape is
// actually accepted by the live account, WITHOUT leaving fiscal artefacts.
//   - Proforma (estimate): issued for real (non-fiscal, not reported to ANAF)
//     then deleted — so we confirm the exact proforma payload end-to-end.
//   - Fiscal invoice: issued with isDraft:true so it is NOT fiscalized /
//     e-Factura-reported, then the draft is deleted. This validates the
//     invoice payload shape without minting a real reported invoice.
// Every step is best-effort and its raw result is returned, so a stray
// document (e.g. a delete that failed) is surfaced loudly for manual cleanup
// rather than swallowed. Admin-only. Remove or lock down once Phase 2 ships.
export const smartbillTestIssue = onCall(
  { region: 'europe-west1', cors: true, secrets: SMARTBILL_SECRETS },
  async (request) => {
    await assertAdmin(request);
    const issueDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC ok for a test)
    const report = { issueDate, proforma: {}, invoice: {} };

    // Resolve the pinned series for each document type (case-insensitive —
    // the account spells them 'MANGO'/p and 'Mango'/f). Issuing into whatever
    // series happens to exist would pollute a real numbering sequence, so a
    // missing pinned series is a hard per-slot error, not a fallback.
    let proformaSeries = null;
    let invoiceSeries = null;
    try {
      const names = seriesNames(await listSeries('p'));
      proformaSeries = matchSeries(names, PROFORMA_SERIES);
      if (!proformaSeries) report.proforma.seriesError = `Proforma series '${PROFORMA_SERIES}' not on account — has: ${names.join(', ') || '(none)'}`;
    } catch (err) {
      report.proforma.seriesError = err?.message || 'unknown';
    }
    try {
      const names = seriesNames(await listSeries('f'));
      invoiceSeries = matchSeries(names, INVOICE_SERIES);
      if (!invoiceSeries) report.invoice.seriesError = `Invoice series '${INVOICE_SERIES}' not on account — has: ${names.join(', ') || '(none)'}`;
    } catch (err) {
      report.invoice.seriesError = err?.message || 'unknown';
    }
    report.proforma.series = proformaSeries;
    report.invoice.series = invoiceSeries;

    const sampleItems = [{ name: 'TEST — verificare payload SmartBill (a se ignora)', quantity: 1, price: 1, code: 'TEST' }];
    // A PF and a PJ sample so the proforma pass validates BOTH client mappings —
    // in particular the PJ regCom + locality fields that SmartBill made mandatory.
    const sampleBillingPF = {
      type: 'PF',
      name: 'TEST Verificare Payload',
      address: 'Str. Test 1',
      locality: 'Otopeni',
      county: 'Ilfov',
    };
    const sampleBillingPJ = {
      type: 'PJ',
      companyName: 'TEST SRL (verificare payload)',
      cui: 'RO12345678',
      regCom: 'J40/123/2020',
      locality: 'București',
      county: 'București',
      companyAddress: 'Str. Test 1',
      isVatPayer: true,
    };

    // Issue a proforma for a sample billing, then delete it (proformas are
    // non-fiscal — clean delete). Records completeness + outcome under report[key].
    async function runProforma(billing, key) {
      const slot = report[key] = report[key] || {};
      slot.series = proformaSeries;
      slot.complete = checkBillingComplete(billing);
      if (!proformaSeries) return;
      try {
        const res = await issueEstimate(buildInvoicePayload({
          billing, items: sampleItems, seriesName: proformaSeries, issueDate,
        }));
        slot.issued = true;
        slot.number = res?.number ?? null;
        slot.raw = res;
        if (res?.number != null) {
          try {
            await deleteEstimate(proformaSeries, res.number);
            slot.deleted = true;
          } catch (delErr) {
            slot.deleted = false;
            slot.deleteError = delErr?.message || 'unknown';
            slot.STRAY = `Proforma ${proformaSeries} ${res.number} left on account — delete manually`;
          }
        }
      } catch (err) {
        slot.issued = false;
        slot.error = err?.message || 'unknown';
      }
    }

    // ── Proforma: PF then PJ (each issued for real, then deleted) ───────────
    await runProforma(sampleBillingPF, 'proforma');
    await runProforma(sampleBillingPJ, 'proformaCompany');

    // The fiscal-invoice draft smoke test reuses the PF sample.
    const sampleBilling = sampleBillingPF;

    // ── Fiscal invoice: issue as a DRAFT (not fiscalized), then delete ──────
    if (invoiceSeries) {
      try {
        const payload = buildInvoicePayload({
          billing: sampleBilling,
          items: sampleItems,
          seriesName: invoiceSeries,
          issueDate,
          isDraft: true,
        });
        const res = await issueInvoice(payload);
        report.invoice.issued = true;
        report.invoice.draft = true;
        // Drafts (ciorne) get a fiscal number only at validation — SmartBill
        // returns an empty number here, so there is nothing to delete against
        // via the API. Confirmed on the live account: nextNumber does not move.
        const num = res?.number;
        const hasNumber = num !== null && num !== undefined && String(num).trim() !== '' && Number(num) !== 0;
        report.invoice.number = hasNumber ? num : null;
        report.invoice.raw = res;
        if (hasNumber) {
          try {
            await deleteInvoice(invoiceSeries, num);
            report.invoice.deleted = true;
          } catch (delErr) {
            report.invoice.deleted = false;
            report.invoice.deleteError = delErr?.message || 'unknown';
            report.invoice.STRAY = `Draft invoice ${invoiceSeries} ${num} left on account — delete in SmartBill UI`;
          }
        } else {
          report.invoice.deleted = false;
          report.invoice.STRAY = `Draft (ciornă) ${invoiceSeries} has no number — delete manually in SmartBill (Facturi → Ciorne)`;
        }
      } catch (err) {
        report.invoice.issued = false;
        report.invoice.error = err?.message || 'unknown';
      }
    }

    report.ok = report.proforma.issued === true
      && report.proformaCompany.issued === true
      && report.invoice.issued === true;
    return report;
  }
);

// ── adminCreateUser (callable) ──────────────────────────────────────────
// Admin creates a user with email + password directly, bypassing the
// signup flow. Useful for back-office accounts (staff, ops) where the
// person has no inbox they want to reveal.
export const adminCreateUser = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    let { email, password, displayName, role = 'customer' } = request.data || {};
    if (!email || !password) {
      throw new HttpsError('invalid-argument', 'email + password required');
    }
    // Map legacy 'staff' → 'agent' so old admin UIs keep working.
    if (role === 'staff') role = 'agent';
    if (!['customer', 'agent', 'driver', 'admin'].includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
    }
    if (String(password).length < 8) {
      throw new HttpsError('invalid-argument', 'password must be at least 8 characters');
    }

    const userRecord = await getAuth().createUser({
      email,
      password,
      displayName: displayName || email.split('@')[0],
    });

    const nowIso = new Date().toISOString();
    await getFirestore().collection('users').doc(userRecord.uid).set({
      email,
      displayName: displayName || email.split('@')[0],
      role,
      locale: 'ro',
      loyaltyPoints: 0,
      loyaltyTier: 'bronze',
      vehicles: [],
      createdAt: nowIso,
      createdBy: actorUid,
    });

    await getFirestore().collection('auditLog').add({
      action: 'admin_user_created',
      entityType: 'user',
      entityId: userRecord.uid,
      actorUid,
      payload: { email, role },
      timestamp: nowIso,
    });

    return { uid: userRecord.uid };
  }
);

// ── adminDeleteUser (callable) ──────────────────────────────────────────
// Removes a user from Firebase Auth + the users/{uid} doc. Their historical
// data (bookings, tokenTransactions, tokenBalances) is left intact — those
// reference customerId by uid and orphaning them is safer than cascading
// deletes that could disturb financial records.
//
// Safety guards: an admin cannot delete their own account; we refuse to
// delete the only remaining admin.
export const adminDeleteUser = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    const { uid } = request.data || {};
    if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');
    if (uid === actorUid) {
      throw new HttpsError('failed-precondition', 'Cannot delete your own account');
    }

    const db = getFirestore();
    const targetRef = db.collection('users').doc(uid);
    const targetSnap = await targetRef.get();
    const targetData = targetSnap.exists ? targetSnap.data() : null;

    if (targetData?.role === 'admin') {
      const admins = await db.collection('users').where('role', '==', 'admin').get();
      if (admins.size <= 1) {
        throw new HttpsError('failed-precondition', 'Cannot delete the last admin');
      }
    }

    try {
      await getAuth().deleteUser(uid);
    } catch (err) {
      // Orphaned Firestore doc (no matching Auth user) — continue.
      console.warn('adminDeleteUser: Auth deleteUser:', err?.message);
    }
    if (targetSnap.exists) await targetRef.delete();

    await db.collection('auditLog').add({
      action: 'admin_user_deleted',
      entityType: 'user',
      entityId: uid,
      actorUid,
      payload: { email: targetData?.email || null, role: targetData?.role || null },
      timestamp: new Date().toISOString(),
    });

    return { ok: true };
  }
);

// ── adminChangeUserRole (callable) ──────────────────────────────────────
// Admin updates the role on another user's profile. Allowed values:
// 'admin' | 'agent' | 'driver' | 'customer'. The legacy 'staff' value is
// silently mapped to 'agent' if a client somehow sends it.
//
// Refuses to demote the last admin (otherwise the org could lock itself
// out) and refuses to change the caller's own role (use a second admin
// for that — defense against accidental self-demotion).
export const adminChangeUserRole = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    const { uid, role: requestedRole } = request.data || {};
    if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');
    if (uid === actorUid) {
      throw new HttpsError('failed-precondition', 'Cannot change your own role');
    }
    let role = String(requestedRole || '').trim();
    if (role === 'staff') role = 'agent';
    if (!['admin', 'agent', 'driver', 'customer'].includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
    }

    const db = getFirestore();
    const targetRef = db.collection('users').doc(uid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found');
    const targetData = targetSnap.data();
    const previousRole = targetData.role || 'customer';
    if (previousRole === role) {
      return { ok: true, unchanged: true };
    }

    // Last-admin guard: demoting the only admin would lock the org out.
    if (previousRole === 'admin' && role !== 'admin') {
      const admins = await db.collection('users').where('role', '==', 'admin').get();
      if (admins.size <= 1) {
        throw new HttpsError('failed-precondition', 'Cannot demote the last admin');
      }
    }

    await targetRef.update({ role });
    await db.collection('auditLog').add({
      action: 'admin_user_role_changed',
      entityType: 'user',
      entityId: uid,
      actorUid,
      payload: { from: previousRole, to: role, email: targetData.email || null },
      timestamp: new Date().toISOString(),
    });

    return { ok: true, role };
  }
);

// ── adminUpdateUserProfile (callable) ───────────────────────────────────
// Agents/admins edit a customer's profile — displayName, phone, billing,
// vehicles. Never touches role or email (auth-linked). Agents can't write
// another user's doc directly (Firestore rules gate that to admin/self), so
// this server path is required.
export const adminUpdateUserProfile = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: actorUid } = await assertAgent(request);
    const { uid, displayName, phone, billing, vehicles } = request.data || {};
    if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');

    const db = getFirestore();
    const targetRef = db.collection('users').doc(uid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found');

    const cleanVehicles = Array.isArray(vehicles)
      ? vehicles
          .map((v) => ({
            plate: String(v?.plate || '').toUpperCase().replace(/[\s-]/g, ''),
            make: String(v?.make || '').trim(),
            model: String(v?.model || '').trim(),
          }))
          .filter((v) => v.plate)
      : [];

    const patch = {
      displayName: String(displayName || '').trim(),
      phone: String(phone || '').trim(),
      billing: (billing && typeof billing === 'object') ? billing : {},
      vehicles: cleanVehicles,
      updatedAt: new Date().toISOString(),
    };

    await targetRef.update(patch);
    await db.collection('auditLog').add({
      action: 'admin_profile_updated',
      entityType: 'user',
      entityId: uid,
      actorUid,
      payload: {
        displayName: patch.displayName,
        phone: patch.phone,
        billingType: patch.billing?.type || null,
        vehicles: cleanVehicles.length,
      },
      timestamp: new Date().toISOString(),
    });

    return { ok: true };
  }
);

// ── adminSendInvite (callable) ──────────────────────────────────────────
// Admin sends a magic-link signup invite. The recipient clicks the link
// in their inbox, lands on /auth/finish-signup, sets a password, and is
// signed in.
export const adminSendInvite = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    let { email, displayName, role = 'customer', locale = 'ro' } = request.data || {};
    if (!email || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'valid email required');
    }
    if (role === 'staff') role = 'agent';
    if (!['customer', 'agent', 'driver', 'admin'].includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
    }

    const link = await getAuth().generateSignInWithEmailLink(email, {
      url: `${SITE_URL}/auth/finish-signup?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });

    // Stash the assigned role so finish-signup can read it after the
    // magic-link auth completes (no good way to pass it through the link
    // body itself).
    await getFirestore().collection('pendingInvites').doc(email.toLowerCase()).set({
      email,
      displayName: displayName || '',
      role,
      invitedBy: actorUid,
      invitedAt: new Date().toISOString(),
      locale,
    });

    // Resolve the inviter's display name for the email greeting — falls
    // back to a generic "Mango Parking admin" when the profile is sparse.
    let invitedByName = 'Mango Parking';
    try {
      const inviterSnap = await getFirestore().collection('users').doc(actorUid).get();
      if (inviterSnap.exists) {
        const data = inviterSnap.data();
        invitedByName = data.displayName || data.email || invitedByName;
      }
    } catch (_) { /* swallow — email still useful without the name */ }

    const firstName = (displayName || email.split('@')[0]).split(/\s+/)[0];
    await sendBrevoEmail({
      to: email,
      name: displayName || '',
      templateName: 'admin-invite',
      locale: locale === 'en' ? 'en' : 'ro',
      params: {
        firstName,
        signupLink: link,
        invitedByName,
        role,
      },
    });

    await getFirestore().collection('auditLog').add({
      action: 'admin_invite_sent',
      entityType: 'invite',
      entityId: email.toLowerCase(),
      actorUid,
      payload: { email, role },
      timestamp: new Date().toISOString(),
    });

    return { ok: true };
  }
);

// ── finishInviteSignup (callable) ───────────────────────────────────────
// Called by the /auth/finish-signup page after the user completes the
// magic-link auth handshake. Stamps users/{uid} with the role + display
// name captured at invite time, then deletes the pendingInvites doc.
// Idempotent — running twice is harmless.
export const finishInviteSignup = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const uid = request.auth.uid;
    const email = (request.auth.token?.email || '').toLowerCase();
    if (!email) return { ok: false, reason: 'no-email' };

    const db = getFirestore();
    const inviteRef = db.collection('pendingInvites').doc(email);
    const inviteSnap = await inviteRef.get();
    const invite = inviteSnap.exists ? inviteSnap.data() : null;

    const role = invite?.role || 'customer';
    const displayName = invite?.displayName || email.split('@')[0];
    const nowIso = new Date().toISOString();

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      // Only patch role if the doc was a default-customer placeholder.
      const data = userSnap.data();
      const patch = {};
      if (!data.role || data.role === 'customer') patch.role = role;
      if (!data.displayName && displayName) patch.displayName = displayName;
      if (Object.keys(patch).length > 0) await userRef.update(patch);
    } else {
      await userRef.set({
        email,
        displayName,
        role,
        locale: invite?.locale === 'en' ? 'en' : 'ro',
        loyaltyPoints: 0,
        loyaltyTier: 'bronze',
        vehicles: [],
        createdAt: nowIso,
        createdBy: invite?.invitedBy || null,
      });
    }

    if (inviteSnap.exists) {
      await inviteRef.delete();
    }

    return { ok: true, role };
  }
);

// ── repayOrder (HTTP) ────────────────────────────────────────────────────
// Customer-facing self-service repay for a pay-at-pickup order. Looks up
// the existing pendingOrders doc, validates it's still unpaid + pay-at-
// pickup, recomputes the discounted online amount, and returns a fresh
// Netopia handoff envelope. Reuses the same orderId so the IPN routes the
// confirmation to the existing booking (the IPN handler now updates an
// existing bookingId rather than creating a duplicate).
//
// No auth required — the orderId itself is the secret (delivered via the
// confirmation email).
export const repayOrder = onRequest(
  {
    cors: true,
    secrets: [NETOPIA_SIGNATURE, NETOPIA_PUBLIC_KEY, NETOPIA_ENV],
  },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
    const pending = snap.data();

    if (pending.paymentStatus === 'paid' || pending.status === 'paid') {
      return res.status(409).json({ error: 'already_paid' });
    }
    if (pending.paymentMethod !== 'pay-at-pickup') {
      return res.status(400).json({ error: 'not_repayable' });
    }

    // pending.amount is the STANDARD (on-site) price. Apply the live
    // online-discount percent to land on the online price the customer pays
    // now by choosing to pay online instead of at the lot.
    const settingsSnap = await db.collection('settings').doc('global').get();
    const discountPct = Number(settingsSnap.exists ? settingsSnap.data().onlineDiscountPercent : 10);
    let amount = Number(pending.amount);
    if (Number.isFinite(discountPct) && discountPct > 0 && discountPct < 100) {
      amount = Math.round(amount * (1 - discountPct / 100));
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'bad_amount' });
    }

    const cd = pending.customerData || {};
    const details = pending.orderType === 'longTerm'
      ? `Mango Parking — parcare pe termen lung (${pending.days} zile)`
      : `Mango Parking — pachet ${pending.quantity} credite`;

    const [firstName, ...rest] = (cd.name || 'Customer').trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;

    const xml = buildRequestXml({
      orderId,
      amount,
      currency: 'RON',
      signature: NETOPIA_SIGNATURE.value(),
      returnUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      confirmUrl: CALLBACK_URL,
      details,
      billing: {
        first_name: firstName,
        last_name: lastName,
        email: cd.email || '',
        mobile_phone: cd.phone || '',
        address: 'N/A',
      },
    });

    const encrypted = encryptRequest(NETOPIA_PUBLIC_KEY.value(), xml);
    const env = (NETOPIA_ENV.value?.() || 'sandbox').toLowerCase();
    const action = NETOPIA_ENDPOINTS[env] || NETOPIA_ENDPOINTS.sandbox;

    // Stamp `repayInProgress` so the IPN knows this confirmation is a
    // repay (and should patch the existing booking instead of creating a
    // new one). Do NOT flip paymentMethod yet — only on IPN success.
    // Abandoned repays leave the order in its original pay-at-pickup state.
    await orderRef.update({
      repayInProgress: true,
      repayAmount: amount,
      repayStartedAt: new Date().toISOString(),
    });

    return res.json({
      action,
      env_key: encrypted.env_key,
      data: encrypted.data,
      cipher: encrypted.cipher,
      iv: encrypted.iv,
      orderId,
    });
  }
);
