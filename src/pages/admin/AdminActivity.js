// /admin/activity — a forward-looking feed of everything scheduled in the next
// 48 hours: which cars need checking IN (upcoming long-term reservations at
// their drop-off) or OUT (active reservations at their pick-up), and airport
// transfers. A round-trip transfer contributes TWO events — the outbound trip
// at its pick-up time and the return trip at its return time — so a Sunday
// return already surfaces here on Saturday (inside the 48h window).
//
// Commuter (credit) check-ins are intentionally excluded: they're walk-up /
// same-day with no scheduled time, so there's nothing to plan 48h ahead.

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { html, escapeHtml, delegate } from '../../utils/dom.js';
import { t, getLocale, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { subscribeCollection } from '../../firebase/db.js';
import { navigate } from '../../router/index.js';

const WINDOW_MS = 48 * 60 * 60 * 1000;

// ── Date helpers (Europe/Bucharest day grouping) ─────────────────────────
function fmtTime(iso, locale) {
  try {
    return new Date(iso).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest',
    });
  } catch { return '—'; }
}
function bucharestDate(iso) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  } catch { return String(iso); }
}
function dayLabel(iso, locale) {
  const day = bucharestDate(iso);
  const todayKey = bucharestDate(new Date().toISOString());
  const tomorrowKey = bucharestDate(new Date(Date.now() + 86_400_000).toISOString());
  if (day === todayKey) return t('activity.today');
  if (day === tomorrowKey) return t('activity.tomorrow');
  try {
    return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      weekday: 'long', day: '2-digit', month: 'short', timeZone: 'Europe/Bucharest',
    });
  } catch { return day; }
}

// ── Event rows ───────────────────────────────────────────────────────────
function eventRow(e, locale) {
  const time = fmtTime(e.at, locale);
  if (e.kind === 'checkin' || e.kind === 'checkout') {
    const b = e.booking;
    const isCheckin = e.kind === 'checkin';
    const cls = isCheckin ? 'bg-leaf/10 text-leaf' : 'bg-blueberry/10 text-blueberry';
    const label = isCheckin ? t('activity.kindCheckin') : t('activity.kindCheckout');
    const name = b.contact?.name || b.contact?.email || '—';
    return `
      <button type="button" data-go="${isCheckin ? 'checkin' : 'checkout'}" class="w-full card-solid rounded-xl p-3 flex items-center gap-3 text-left hover:bg-frost transition-colors">
        <span class="font-mono text-[14px] font-semibold text-charcoal w-12 shrink-0">${time}</span>
        <span class="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${cls} shrink-0">${label}</span>
        <span class="font-mono text-[13px] text-charcoal shrink-0">${escapeHtml(b.licensePlate || '—')}</span>
        <span class="text-[13px] text-dim truncate">${escapeHtml(name)}</span>
      </button>`;
  }
  const tr = e.transfer;
  const isReturn = e.kind === 'transfer-return';
  const label = isReturn ? t('activity.kindTransferReturn') : t('activity.kindTransferOut');
  const place = isReturn ? (tr.returnTo || tr.pickupAddress || '') : (tr.pickupAddress || '');
  return `
    <button type="button" data-go="transfers" class="w-full card-solid rounded-xl p-3 flex items-center gap-3 text-left hover:bg-frost transition-colors">
      <span class="font-mono text-[14px] font-semibold text-charcoal w-12 shrink-0">${time}</span>
      <span class="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-mango/15 text-charcoal shrink-0">${label}</span>
      <span class="text-[13px] text-charcoal truncate">${escapeHtml(tr.contactName || '—')}</span>
      <span class="text-[12px] text-dim truncate hidden sm:inline">${escapeHtml(place)}</span>
    </button>`;
}

export default function AdminActivity(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('admin.activity')} — Admin — ManGO Parking`, description: t('activity.subtitle'), lang: locale });

  let bookings = [];
  let transfers = [];
  let unsubB = null;
  let unsubT = null;

  const page = AdminLayout('/admin/activity', `
    <div class="mb-6">
      <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.activity')}</h1>
      <p class="text-dim text-[15px] mt-1">${t('activity.subtitle')}</p>
    </div>
    <div data-activity-feed></div>
  `);
  initAdminNav(page);
  container.appendChild(page);

  const feedEl = page.querySelector('[data-activity-feed]');

  function buildEvents() {
    const now = Date.now();
    const end = now + WINDOW_MS;
    const inWin = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) && ms >= now && ms <= end; };
    const events = [];

    for (const b of bookings) {
      // Scheduled (long-term / broker) only — commuters have no booked time.
      if (b.type === 'credit') continue;
      const dropoff = b.dropoffAt || b.startDate;
      const pickup = b.pickupAt || b.endDate;
      if (b.status === 'upcoming' && dropoff && inWin(dropoff)) events.push({ at: dropoff, kind: 'checkin', booking: b });
      if (b.status === 'active' && pickup && inWin(pickup)) events.push({ at: pickup, kind: 'checkout', booking: b });
    }
    for (const tr of transfers) {
      // Status is per leg — an outbound can be completed while the return is
      // still due, so each leg is gated on its own status (default scheduled).
      if (tr.pickupAt && (tr.status || 'scheduled') === 'scheduled' && inWin(tr.pickupAt)) events.push({ at: tr.pickupAt, kind: 'transfer-out', transfer: tr });
      // Round-trip return leg is its own event at the return time.
      if (tr.transferType === 'roundtrip' && tr.returnAt && (tr.returnStatus || 'scheduled') === 'scheduled' && inWin(tr.returnAt)) events.push({ at: tr.returnAt, kind: 'transfer-return', transfer: tr });
    }
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return events;
  }

  function render() {
    const events = buildEvents();
    if (!events.length) {
      feedEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('activity.empty')}</div>`;
      return;
    }
    const groups = [];
    let cur = null;
    for (const e of events) {
      const dayKey = bucharestDate(e.at);
      if (!cur || cur.dayKey !== dayKey) { cur = { dayKey, label: dayLabel(e.at, locale), items: [] }; groups.push(cur); }
      cur.items.push(e);
    }
    feedEl.innerHTML = groups.map((g) => `
      <div class="mb-6">
        <h2 class="text-[12px] font-mono uppercase tracking-wider text-dim mb-2">${g.label} <span class="text-charcoal/30">· ${g.items.length}</span></h2>
        <div class="space-y-2">${g.items.map((e) => eventRow(e, locale)).join('')}</div>
      </div>
    `).join('');
  }

  unsubB = subscribeCollection('bookings', (rows) => { bookings = rows; render(); });
  unsubT = subscribeCollection('transfers', (rows) => { transfers = rows; render(); });
  render();

  // Jump to the relevant check-in tab.
  delegate(page, 'click', '[data-go]', (_e, btn) => {
    navigate(`${localePath('/admin/checkins')}?tab=${btn.dataset.go}`);
  });

  return () => { if (unsubB) unsubB(); if (unsubT) unsubT(); };
}
