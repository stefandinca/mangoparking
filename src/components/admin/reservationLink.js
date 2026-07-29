// Shared "reservation code → full record" behaviour for the admin side.
//
// A booking code becomes a clickable link to the reservation's full record at
// /admin/transactions?booking=<id> (the Istoric detail view: every stored
// field, the fiscal trail, the booking's own audit history, and the shared
// booking actions). One destination for every status — live rows are on the
// check-in board too, but the code always means "show me everything".
//
// Usage per page:
//   render:  reservationCodeHtml(booking)          — needs { id, code?, type? }
//   once:    wireReservationLinks(pageEl)          — one delegated handler
//
// Pass a modal's close fn as the second argument so an open overlay doesn't
// linger over the new page.

import { escapeHtml, delegate } from '../../utils/dom.js';
import { localePath } from '../../i18n/index.js';
import { navigate } from '../../router/index.js';
import { bookingDisplayCode } from '../../utils/bookingCode.js';

// A clickable reservation code.
export function reservationCodeHtml(b, { className = '' } = {}) {
  const code = bookingDisplayCode(b);
  return `<button type="button" data-reservation-link data-id="${escapeHtml(b.id)}" class="font-mono text-blueberry hover:underline ${className}">${escapeHtml(code)}</button>`;
}

// One delegated handler per page. `beforeNavigate` runs just before the
// navigation — pass a modal's close fn so the overlay doesn't linger.
export function wireReservationLinks(container, beforeNavigate) {
  delegate(container, 'click', '[data-reservation-link]', (e, btn) => {
    e.preventDefault();
    const id = btn.dataset.id;
    if (!id) return;
    if (typeof beforeNavigate === 'function') beforeNavigate();
    navigate(`${localePath('/admin/transactions')}?booking=${encodeURIComponent(id)}`);
  });
}
