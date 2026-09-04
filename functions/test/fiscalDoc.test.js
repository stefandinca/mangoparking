// Which SmartBill document each moment in a booking's life produces.
// The rule is the client's, and it has moved twice in a month:
//   2026-08-05  desk card collections became fiscal invoices (decision 1b)
//   2026-09-04  an UNPAID reservation stopped getting a document at all
// Both changes touched several call sites in index.js where nothing could
// test them — #35 shipped inert for two weeks that way. Hence this module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deskDocKind, deskExtraField, orderTimeDocKind, collectionDocs } from '../src/fiscalDoc.js';

test('deskDocKind: card is fiscal, everything else is a request for money', () => {
  assert.equal(deskDocKind('card'), 'invoice');
  assert.equal(deskDocKind('cash'), 'proforma');
  assert.equal(deskDocKind(undefined), 'proforma');
  assert.equal(deskExtraField('card'), 'extraInvoices');
  assert.equal(deskExtraField('cash'), 'extraProformas');
});

test('orderTimeDocKind: an online order still gets its proforma up front', () => {
  // That proforma IS the payment request preceding the card charge, and the
  // IPN turns it into the fiscal invoice. It must not be dropped.
  assert.equal(orderTimeDocKind({ paymentMethod: 'online' }), 'proforma');
});

test('orderTimeDocKind: a pay-at-pickup reservation gets nothing until money moves', () => {
  // Client decision 2026-09-04. The document used to be issued at booking
  // time, was never emailed or shown to anyone, and was deleted again
  // whenever the reservation expired, cancelled or no-showed — 20 of the 54
  // issued on this flow were pure churn.
  assert.equal(orderTimeDocKind({ paymentMethod: 'pay-at-pickup' }), null);
  // Desk-created "pay later" is the same reservation by another door.
  assert.equal(orderTimeDocKind({ paymentMethod: 'pay-at-pickup', paidBy: 'later' }), null);
});

test('orderTimeDocKind: a desk sale documents the money it just took', () => {
  assert.equal(orderTimeDocKind({ paymentMethod: 'admin', paidBy: 'cash' }), 'proforma');
  assert.equal(orderTimeDocKind({ paymentMethod: 'admin', paidBy: 'card' }), 'invoice');
});

test('orderTimeDocKind: a broker reservation is never ours to document', () => {
  // ParkVia et al. bill the customer; no money passes through us.
  assert.equal(orderTimeDocKind({ paymentMethod: 'broker', paidBy: 'broker' }), null);
});

test('collectionDocs: cash at the desk now raises the proforma it never had', () => {
  assert.deepEqual(
    collectionDocs({ paidBy: 'cash', collected: 139, hasLiveProforma: false, discounted: false }),
    { deleteProforma: false, issueProforma: true, issueInvoice: false },
  );
});

test('collectionDocs: a card collection issues the invoice instead, never a proforma', () => {
  assert.deepEqual(
    collectionDocs({ paidBy: 'card', collected: 139, hasLiveProforma: false, discounted: false }),
    { deleteProforma: false, issueProforma: false, issueInvoice: true },
  );
});

test('collectionDocs: an order that already carries a proforma does not get a second', () => {
  // Orders created online, and every pay-at-pickup order predating the
  // 2026-09-04 change, still have their order-time proforma.
  assert.deepEqual(
    collectionDocs({ paidBy: 'cash', collected: 139, hasLiveProforma: true, discounted: false }),
    { deleteProforma: false, issueProforma: false, issueInvoice: false },
  );
});

test('collectionDocs: a discount replaces a proforma raised at the list price', () => {
  assert.deepEqual(
    collectionDocs({ paidBy: 'cash', collected: 100, hasLiveProforma: true, discounted: true }),
    { deleteProforma: true, issueProforma: true, issueInvoice: false },
  );
  // Same on card: the corrected proforma is reissued and the invoice follows,
  // exactly as it did before this change.
  assert.deepEqual(
    collectionDocs({ paidBy: 'card', collected: 100, hasLiveProforma: true, discounted: true }),
    { deleteProforma: true, issueProforma: true, issueInvoice: true },
  );
});

test('collectionDocs: a waived reservation documents nothing and drops any request', () => {
  // Nothing changed hands, and SmartBill rejects a zero total anyway. A
  // proforma still standing is a demand for money nobody will ever pay.
  assert.deepEqual(
    collectionDocs({ paidBy: 'cash', collected: 0, hasLiveProforma: true, discounted: true }),
    { deleteProforma: true, issueProforma: false, issueInvoice: false },
  );
  assert.deepEqual(
    collectionDocs({ paidBy: 'card', collected: 0, hasLiveProforma: false, discounted: true }),
    { deleteProforma: false, issueProforma: false, issueInvoice: false },
  );
});
