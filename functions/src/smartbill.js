// SmartBill REST wrapper — Phase 1 scaffolding for v1.2 fiscal invoicing.
// See documentation/roadmap/v.1.2_smartbill.md for the full plan.
//
// STATUS: inert until the three secrets are set and a function binds them.
// Nothing in the app calls issueInvoice yet — the only wired consumer is the
// admin-only `smartbillHealthcheck` callable (index.js), which exercises the
// two read-only endpoints (/series, /tax) so you can confirm the account is
// configured before any invoice is ever issued.
//
// Verified against the official docs + community SDKs (2026-07-16):
//   base URL, HTTP Basic auth, GET /series, GET /tax, POST /invoice,
//   GET /invoice/pdf. The mutation ops (cancel/reverse/delete) and the invoice
//   PAYLOAD SHAPE are marked PROVISIONAL — confirm them against the sandbox in
//   Phase 1's REPL checkpoint before Phases 2/4 wire them into real flows.

import { defineSecret } from 'firebase-functions/params';

export const SMARTBILL_USERNAME = defineSecret('SMARTBILL_USERNAME');
export const SMARTBILL_TOKEN = defineSecret('SMARTBILL_TOKEN');
export const SMARTBILL_CIF = defineSecret('SMARTBILL_CIF');

// All three must be bound (`secrets: [...]`) on any function that calls in here.
export const SMARTBILL_SECRETS = [SMARTBILL_USERNAME, SMARTBILL_TOKEN, SMARTBILL_CIF];

const BASE = 'https://ws.smartbill.ro/SBORO/api';

// Standard VAT for RO in 2026. If the SmartBill account is a non-VAT payer, the
// invoice payload should carry taxPercentage: 0 instead — decided per-account
// at build time (see the plan's "locked decisions").
export const DEFAULT_VAT_PERCENT = 21;

function requireSecret(param, name) {
  const v = param.value();
  if (!v) throw new Error(`SmartBill not configured: ${name} secret is empty`);
  return v;
}

function authHeader() {
  const user = requireSecret(SMARTBILL_USERNAME, 'SMARTBILL_USERNAME');
  const token = requireSecret(SMARTBILL_TOKEN, 'SMARTBILL_TOKEN');
  return 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');
}

// The seller fiscal code (our own CUI), sent as `cif` on every request.
export function sellerCif() {
  return requireSecret(SMARTBILL_CIF, 'SMARTBILL_CIF');
}

// Core request helper. SmartBill's failure convention is the trap here: a
// validation error comes back as HTTP 200 with `{ errorText: "...", number: 0 }`,
// so the status code alone is NOT enough — always inspect errorText.
async function smartbillFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }

  if (data && data.errorText) {
    throw new Error(`SmartBill: ${data.errorText}`);
  }
  if (!res.ok) {
    const detail = data && data._raw ? `: ${String(data._raw).slice(0, 200)}` : '';
    throw new Error(`SmartBill HTTP ${res.status}${detail}`);
  }
  return data;
}

// ── Read-only endpoints (used by the healthcheck — fully verified) ──────────

// GET /series?cif=..[&type=f|p|c]  (f = invoices, p = estimates, c = receipts)
export async function listSeries(type) {
  const q = new URLSearchParams({ cif: sellerCif() });
  if (type) q.set('type', type);
  return smartbillFetch(`/series?${q.toString()}`);
}

// GET /tax?cif=..  → the VAT rates configured on the account.
export async function listTaxes() {
  return smartbillFetch(`/tax?${new URLSearchParams({ cif: sellerCif() }).toString()}`);
}

// ── Issue (verified path; payload shape PROVISIONAL) ────────────────────────

// POST /invoice → { series, number, message, errorText? }. Note: the standard
// endpoint returns the series+number, NOT a public PDF link — build the
// (authenticated) PDF URL with invoicePdfUrl(). A shareable public link needs
// SmartBill's V2 issue variant; reconcile against Phase 6 when wiring email.
export async function issueInvoice(payload) {
  return smartbillFetch('/invoice', { method: 'POST', body: payload });
}

// ── Proforma (SmartBill "estimate") — same payload shape, different endpoint ─
//
// A proforma is a NON-fiscal payment request: it is NOT reported to ANAF /
// RO e-Factura and can be deleted cleanly. That's the document we issue up
// front (online AND pay-at-location); the fiscal /invoice only follows once
// payment is confirmed. Series `type` for proformas is 'p' (vs 'f' for
// invoices) — see listSeries('p').

// POST /estimate → { series, number, message, errorText? }
export async function issueEstimate(payload) {
  return smartbillFetch('/estimate', { method: 'POST', body: payload });
}

// DELETE /estimate?cif=..&seriesname=..&number=..  (proformas delete cleanly;
// no fiscal trail, unlike invoices).
export async function deleteEstimate(seriesName, number) {
  const q = new URLSearchParams({ cif: sellerCif(), seriesname: seriesName, number: String(number) });
  return smartbillFetch(`/estimate?${q.toString()}`, { method: 'DELETE' });
}

// Authenticated proforma PDF URL (Basic auth required to fetch — not public).
export function estimatePdfUrl(seriesName, number) {
  const q = new URLSearchParams({ cif: sellerCif(), seriesname: seriesName, number: String(number) });
  return `${BASE}/estimate/pdf?${q.toString()}`;
}

// Authenticated PDF URL — requires Basic auth to fetch, so it is NOT safe to
// hand to a customer as-is (the plan's Phase 6 assumes a public URL; that's the
// V2 variant, to confirm).
export function invoicePdfUrl(seriesName, number) {
  const q = new URLSearchParams({ cif: sellerCif(), seriesname: seriesName, number: String(number) });
  return `${BASE}/invoice/pdf?${q.toString()}`;
}

// ── Mutation ops — PROVISIONAL: confirm HTTP method + param location against
//    the sandbox before Phase 4 wires them into cancelBookingWithRefund. The
//    method verbs below are the community-SDK convention, not yet re-verified.
//    SmartBill distinguishes: cancel (anulare, keeps the number), reverse
//    (stornare, issues a reversing invoice), delete (only the last invoice).

// PUT /invoice/cancel?cif=..&seriesname=..&number=..
export async function cancelInvoice(seriesName, number) {
  const q = new URLSearchParams({ cif: sellerCif(), seriesname: seriesName, number: String(number) });
  return smartbillFetch(`/invoice/cancel?${q.toString()}`, { method: 'PUT' });
}

// POST /invoice/reverse — storno. issueDate is the ORIGINAL invoice's date.
export async function reverseInvoice(seriesName, number, issueDate) {
  return smartbillFetch('/invoice/reverse', {
    method: 'POST',
    body: { companyVatCode: sellerCif(), seriesName, number, issueDate },
  });
}

// DELETE /invoice?cif=..&seriesname=..&number=..  (only the last issued invoice)
export async function deleteInvoice(seriesName, number) {
  const q = new URLSearchParams({ cif: sellerCif(), seriesname: seriesName, number: String(number) });
  return smartbillFetch(`/invoice?${q.toString()}`, { method: 'DELETE' });
}

// ── Invoice payload builder — DRAFT (Phase 2 verifies against the sandbox) ──
//
// Maps our billing object (BillingFields.js) + line items onto SmartBill's
// invoice JSON. Field names below match the documented shape, but the
// tax-inclusive flag, county/city split, and payment auto-pairing all need a
// live sandbox invoice to confirm before this is trusted in the paid flows.
//
//   billing: { type:'PF'|'PJ', firstName,lastName,name, cnp?, address, locality,
//              companyName?, cui?, regCom?, companyAddress?, isVatPayer? }
//   items:   [{ name, quantity, price, code? }]   // price = per-unit RON, VAT-inclusive
export function buildInvoicePayload({
  billing = {},
  items = [],
  seriesName,
  issueDate,
  dueDate,
  paymentMethod,
  vatPercent = DEFAULT_VAT_PERCENT,
  // isDraft:true asks SmartBill NOT to fiscalize/report the document. Used by
  // the payload-verification checkpoint so a throwaway fiscal invoice never
  // reaches ANAF; real Phase 2 invoices leave this false. Ignored by /estimate
  // (proformas are non-fiscal regardless).
  isDraft = false,
}) {
  const isPJ = billing.type === 'PJ';
  const client = isPJ
    ? {
        name: billing.companyName || '',
        vatCode: billing.cui || '',
        isTaxPayer: billing.isVatPayer === true,
        address: billing.companyAddress || '',
        city: billing.locality || '',
        county: billing.county || '',
        country: 'Romania',
        email: billing.email || '',
        saveToDb: false,
      }
    : {
        name: billing.name || [billing.firstName, billing.lastName].filter(Boolean).join(' '),
        vatCode: billing.cnp || '',
        isTaxPayer: false,
        address: billing.address || '',
        city: billing.locality || '',
        country: 'Romania',
        email: billing.email || '',
        saveToDb: false,
      };

  return {
    companyVatCode: sellerCif(),
    client,
    seriesName,
    issueDate,
    ...(dueDate ? { dueDate } : {}),
    isDraft: isDraft === true,
    ...(paymentMethod ? { paymentBase: paymentMethod } : {}),
    products: items.map((it) => ({
      name: it.name,
      code: it.code || '',
      measuringUnitName: 'buc',
      currency: 'RON',
      quantity: Number(it.quantity) || 1,
      price: Number(it.price) || 0,
      isTaxIncluded: true,
      taxName: 'Normala',
      taxPercentage: vatPercent,
      saveToDb: false,
      isService: true,
    })),
  };
}
