// Flight-status warnings for the admin boards.
//
// Rows that want a delay/cancellation badge render an empty slot carrying the
// flight + date + direction:
//   <span data-flight-warn data-flight="RO201" data-flight-date="2026-07-10" data-flight-dir="departure"></span>
// After the rows mount, call enhanceFlightWarnings(containerEl): it batches the
// visible flights (deduped, only those in a sensible date window), asks the
// lookupFlightStatuses callable, and fills each slot with a badge when the
// flight is delayed / cancelled / diverted. Dormant (no-op) until a flight API
// key is configured server-side — see functions/src/flightStatus.js.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';
import { t } from '../i18n/index.js';

const lookupFn = httpsCallable(functions, 'lookupFlightStatuses');

// Client memo so re-renders (live subscriptions fire often) don't re-invoke the
// callable. Keyed by FLIGHTNO_DATE → { status, at }.
const memo = new Map();
const MEMO_TTL = 10 * 60 * 1000;
let configured = true; // flips false once the server reports no provider key

export function normalizeFlightNo(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Local YYYY-MM-DD for an ISO timestamp (or Date) — the airport-local flight day.
export function flightDayKey(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateInWindow(dateStr) {
  const t0 = Date.parse(`${dateStr}T12:00:00`);
  if (!Number.isFinite(t0)) return false;
  const now = Date.now();
  return t0 >= now - 2 * 864e5 && t0 <= now + 7 * 864e5;
}

// Warning descriptor for a normalized status + leg direction, or null when fine.
function flightWarning(status, direction) {
  if (!status || !status.found) return null;
  if (status.cancelled) return { kind: 'cancelled' };
  if (status.diverted) return { kind: 'diverted' };
  const delay = direction === 'arrival' ? status.arrivalDelayMinutes : status.departureDelayMinutes;
  if (Number.isFinite(delay) && delay >= 15) return { kind: 'delayed', minutes: delay };
  return null;
}

function badgeHtml(warn) {
  if (!warn) return '';
  const base = 'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded-full';
  const hint = t('flight.statusHint');
  if (warn.kind === 'delayed') {
    return `<span class="${base} bg-amber-100 text-amber-700" title="${hint}">⚠ ${t('flight.delayed', { min: warn.minutes })}</span>`;
  }
  const label = warn.kind === 'diverted' ? t('flight.diverted') : t('flight.cancelled');
  return `<span class="${base} bg-red-100 text-red-600" title="${hint}">⚠ ${label}</span>`;
}

// Scan a container for flight-warning slots, resolve their status (memo →
// batched callable), and paint any warnings. Safe to call on every re-render.
export async function enhanceFlightWarnings(scopeEl) {
  if (!scopeEl || !configured) return;
  const targets = [...scopeEl.querySelectorAll('[data-flight-warn][data-flight][data-flight-date]')]
    .map((el) => ({
      el,
      flight: normalizeFlightNo(el.dataset.flight),
      date: el.dataset.flightDate,
      dir: el.dataset.flightDir === 'arrival' ? 'arrival' : 'departure',
    }))
    .filter((x) => x.flight && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && dateInWindow(x.date));
  if (!targets.length) return;

  const now = Date.now();
  const need = new Map();
  for (const tg of targets) {
    const cached = memo.get(`${tg.flight}_${tg.date}`);
    if (cached && now - cached.at < MEMO_TTL) tg.status = cached.status;
    else need.set(`${tg.flight}_${tg.date}`, { flightNumber: tg.flight, date: tg.date });
  }

  if (need.size) {
    let data;
    try {
      const res = await lookupFn({ items: [...need.values()] });
      data = res?.data || {};
    } catch (err) {
      console.warn('flight status lookup failed', err?.message);
      return;
    }
    if (data.configured === false) { configured = false; return; }
    const results = data.results || {};
    const at = Date.now();
    for (const key of need.keys()) memo.set(key, { status: results[key] || { found: false }, at });
    for (const tg of targets) {
      if (tg.status === undefined) tg.status = memo.get(`${tg.flight}_${tg.date}`)?.status || { found: false };
    }
  }

  for (const tg of targets) {
    tg.el.innerHTML = badgeHtml(flightWarning(tg.status, tg.dir));
  }
}
