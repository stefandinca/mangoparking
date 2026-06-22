// Office opening hours — structured per-day, admin-editable.
//
// Stored on `settings/global.openingHours` as:
//   { mon:{open,close,closed}, tue:{…}, …, sun:{…} }
// Shown on the Contact page (full week table) and the Footer (today's line).
// The lot itself is 24/7 — these are the office / front-desk hours. Display
// only; not wired into the commuter booking cutoffs. Mirrors discountService.

import { getDocument, setDocument } from '../firebase/db.js';
import { auditLog } from './auditService.js';

export const OPENING_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function normDay(d) {
  return {
    open: typeof d?.open === 'string' && d.open ? d.open : '08:00',
    close: typeof d?.close === 'string' && d.close ? d.close : '20:00',
    closed: !!d?.closed,
  };
}

function normalize(hours) {
  const out = {};
  for (const k of OPENING_DAYS) out[k] = normDay(hours?.[k]);
  return out;
}

export const DEFAULT_HOURS = normalize({});

let cached = null;

export async function getOpeningHours() {
  if (cached) return cached;
  try {
    const doc = await getDocument('settings', 'global');
    cached = normalize(doc?.openingHours);
  } catch {
    cached = DEFAULT_HOURS;
  }
  return cached;
}

export async function saveOpeningHours(hours) {
  const clean = normalize(hours);
  // setDocument merges, so other settings/global fields are preserved.
  await setDocument('settings', 'global', { openingHours: clean });
  cached = clean;
  await auditLog('opening_hours_updated', 'settings', 'global', null, { openingHours: clean });
  return clean;
}

// 'mon'..'sun' for the current Europe/Bucharest day (drives the footer line).
export function bucharestTodayKey() {
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', weekday: 'short' }).format(new Date());
  const map = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };
  return map[wd] || 'mon';
}
