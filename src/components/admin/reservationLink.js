// Shared "reservation number → jump to it" behaviour for the admin side.
//
// A booking code becomes a clickable link. A LIVE reservation (upcoming /
// active / no-show) navigates to the check-in page on the right tab, scoped to
// the reservation's day, and asks that page to scroll to + flash the row — the
// same tab/window/focus contract the Activity feed already uses. A HISTORICAL
// reservation (completed / cancelled / refunded / expired) has no row on the
// check-in page, so it opens the read-only booking-detail modal instead.
//
// Usage per page:
//   render:  reservationCodeHtml(booking)
//   once:    wireReservationLinks(pageEl, id => bookingsById.get(id))

import { escapeHtml, delegate } from '../../utils/dom.js';
import { localePath } from '../../i18n/index.js';
import { navigate } from '../../router/index.js';
import { getDocument } from '../../firebase/db.js';
// openBookingDetail is imported dynamically in the handler: BookingDetailModal
// imports openUserDetail from UserDetailModal, which imports this module, so a
// static import would form a load-time cycle. Deferring it sidesteps that.

// Long-term bookings keep a 2h end-of-booking grace before showing as overdue
// (mirrors OVERDUE_THRESHOLD_MS / isOverdue in AdminCheckIns).
const OVERDUE_GRACE_MS = 2 * 60 * 60 * 1000;

// Device-local day key — identical to the Activity feed's deep-link derivation
// and the check-in page's window filter, kept in lockstep on purpose so the
// row lands inside the requested window.
function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Where a booking currently lives on the check-in page, or null when it isn't
// there at all (completed / cancelled / refunded / expired).
function liveTarget(b) {
  if (b.status === 'upcoming') return { tab: 'checkin', day: dayKey(b.dropoffAt || b.startDate) };
  if (b.status === 'no-show') return { tab: 'noshow', day: dayKey(b.dropoffAt || b.startDate) };
  if (b.status === 'active') {
    // A commuter (credit) is checked out on their check-in day; a long-term
    // booking on its scheduled pick-up. Same split checkoutDate() uses.
    const pickup = b.type === 'credit' ? (b.checkinTimestamp || b.startDate) : (b.pickupAt || b.endDate);
    const dl = new Date(pickup).getTime();
    const grace = b.type === 'credit' ? 0 : OVERDUE_GRACE_MS;
    if (Number.isFinite(dl) && Date.now() > dl + grace) return { tab: 'overdue', day: null };
    return { tab: 'checkout', day: dayKey(pickup) };
  }
  return null;
}

// A clickable reservation code. `b` needs { id, code, status, type,
// dropoffAt|startDate, pickupAt|endDate }.
export function reservationCodeHtml(b, { className = '' } = {}) {
  const code = b.code || `LT-${String(b.id).slice(0, 5).toUpperCase()}`;
  return `<button type="button" data-reservation-link data-id="${escapeHtml(b.id)}" class="font-mono text-blueberry hover:underline ${className}">${escapeHtml(code)}</button>`;
}

// One delegated handler per page. `resolve(id)` returns the in-memory booking
// for an id (each page already holds its list); it falls back to a fetch when
// the booking isn't in hand. `beforeNavigate` runs just before a navigation —
// pass a modal's close fn so an open overlay doesn't linger over the new page.
export function wireReservationLinks(container, resolve, beforeNavigate) {
  delegate(container, 'click', '[data-reservation-link]', async (e, btn) => {
    e.preventDefault();
    const id = btn.dataset.id;
    if (!id) return;
    let b = resolve ? resolve(id) : null;
    if (!b) b = await getDocument('bookings', id).catch(() => null);
    if (!b) return;
    if (!b.id) b.id = id;

    const target = liveTarget(b);
    if (target) {
      const p = new URLSearchParams({ tab: target.tab });
      if (target.day) p.set('window', `${target.day}..${target.day}`);
      p.set('focus', id);
      if (typeof beforeNavigate === 'function') beforeNavigate();
      navigate(`${localePath('/admin/checkins')}?${p.toString()}`);
    } else {
      const { openBookingDetail } = await import('./BookingDetailModal.js');
      openBookingDetail(b);
    }
  });
}
