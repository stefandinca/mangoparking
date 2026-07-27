// In-house client error monitoring — no external service.
//
// window 'error' + 'unhandledrejection' handlers write a small record to
// the `clientErrors` collection (create-only for clients, admin-read; see
// firestore.rules). Surfaces production crashes — the 2026-07 typeBadge
// ReferenceError shipped and was only found when staff complained.
//
// Deliberately paranoid about not making things worse:
//   • hard cap per session, dedup by message — a render-loop error can't
//     hammer Firestore with writes;
//   • the write itself is .catch(() => {})-swallowed, so a failing/offline
//     Firestore can never cascade into more unhandled rejections.

import { addDocument } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';

const MAX_PER_SESSION = 10;
const seen = new Set();
let sent = 0;

const cap = (s, n) => (s == null ? '' : String(s).slice(0, n));

function report(kind, message, stack) {
  const msg = cap(message, 500) || '(no message)';
  if (sent >= MAX_PER_SESSION || seen.has(msg)) return;
  seen.add(msg);
  sent++;
  addDocument('clientErrors', {
    kind,
    message: msg,
    stack: cap(stack, 1500),
    route: cap(window.location.pathname + window.location.search, 300),
    locale: document.documentElement.lang || '',
    ua: cap(navigator.userAgent, 300),
    uid: getCurrentUser()?.uid || null,
    ts: new Date().toISOString(),
  }).catch(() => {});
}

export function installErrorLogging() {
  window.addEventListener('error', (e) => {
    report('error', e.message, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report('unhandledrejection', r?.message || String(r), r?.stack);
  });
}
