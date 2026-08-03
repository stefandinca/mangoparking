// Shared row cells for the admin boards (check-in board + activity feed).
//
// Both surfaces show the same two facts about a reservation — who to call and
// which flight brings the customer back — so they render them the same way
// rather than each growing its own copy. The activity page previously had a
// `telLink` that put the raw value straight into the href; spaces and dashes
// break some dialers, so that behaviour is now the check-in board's
// (digits-and-plus only) everywhere.

import { escapeHtml } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';

const PHONE_ICON = '<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>';

/** Dialable form of a phone number — `+` and digits only. '' when unusable. */
export function telHref(raw) {
  return String(raw || '').replace(/[^\d+]/g, '');
}

/**
 * Clickable phone number.
 *
 * Carries `data-tel` so row-level click handlers can recognise it and let the
 * call through instead of treating it as a click on the row (the activity
 * rows navigate; its history rows are <details> that would otherwise toggle).
 *
 * @param {string} raw            the stored number, shown as entered
 * @param {object} [opts]
 * @param {boolean} [opts.icon]   prefix a small handset glyph
 * @param {string} [opts.className] extra classes on the anchor
 * @param {string} [opts.empty]   markup when there is no number
 */
export function phoneLinkHtml(raw, { icon = false, className = '', empty = '' } = {}) {
  const value = String(raw || '').trim();
  if (!value) return empty;
  const dial = telHref(value);
  const shown = escapeHtml(value);
  // No dialable digits (someone typed a note in the field) — show, don't link.
  if (!dial) return `<span class="text-[13px] font-mono ${className}">${shown}</span>`;
  return `<a href="tel:${escapeHtml(dial)}" data-tel title="${escapeHtml(t('checkins.callHint', { phone: value }))}" class="text-[13px] font-mono text-blueberry hover:text-blueberry-hover hover:underline inline-flex items-center gap-1 whitespace-nowrap ${className}">${icon ? PHONE_ICON : ''}<span>${shown}</span></a>`;
}

/**
 * The return flight — the one that decides when the customer comes back for
 * the car. `flightNumberPickup` on a booking, `returnFlightNumber` on a
 * transfer; callers pass whichever applies.
 */
export function returnFlightHtml(flight, { className = '', empty = '' } = {}) {
  const value = String(flight || '').trim();
  if (!value) return empty;
  return `<span class="text-[13px] font-mono font-semibold text-charcoal whitespace-nowrap ${className}">${escapeHtml(value)}</span>`;
}
