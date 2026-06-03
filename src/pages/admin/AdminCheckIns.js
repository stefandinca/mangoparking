// Admin Check-in / Check-out — v1.7 redesign.
//
// Three tabs, each scoped to a specific workflow:
//   1. Check-in — upcoming bookings whose drop-off falls inside the
//      selected window (today / this week / this month). Per-row
//      action: Check-in. Plus Cancel reservation (admin/agent) and
//      Collect payment (when unpaid).
//   2. Check-out — active bookings whose pick-up falls inside the
//      selected window. Per-row action: Check-out.
//   3. Overdue — all active bookings past their pick-up by ≥2 hours.
//      Rows expand on click to show full booking details + actions
//      (Check-out now / Charge overstay / Cancel reservation).
//
// Top of page: a Walk-in CTA that opens the shared create-transaction
// modal (lifted from AdminTransactions), and a quick plate-lookup bar
// for the fast path when an agent knows the plate.
//
// No-show is detected automatically by the `markNoShows` scheduled
// function. No manual UI for it — rows simply drop off the Check-in
// tab when their status flips.

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { html, qs, delegate, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { subscribeCollection, getCollection, where } from '../../firebase/db.js';
import { showToast } from '../../components/core/Toast.js';
import { openModal, confirmModal } from '../../components/core/Modal.js';
import { checkInBooking, checkOutBooking } from '../../services/bookingService.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { getUserProfile } from '../../firebase/auth.js';
import { hasPermission, PERM } from '../../utils/permissions.js';
import { openCreateTransactionModal } from '../../components/admin/CreateTransactionModal.js';
import flatpickr from 'flatpickr';
import { Romanian } from 'flatpickr/dist/l10n/ro.js';

const adminMarkOrderPaidFn = httpsCallable(functions, 'adminMarkOrderPaid');
const cancelBookingFn = httpsCallable(functions, 'cancelBookingWithRefund');

const OVERDUE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// ── Date helpers ────────────────────────────────────────────────────────

function fmtDateTime(iso, locale) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function bucharestDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch { return null; }
}

// Returns [startISO, endISO] for the active window. Accepts either a
// preset name ('today' | 'week' | 'month') or a custom range tuple
// already in `[YYYY-MM-DD, YYYY-MM-DD]` form (inclusive on both ends —
// the end day is expanded to next-day-midnight so isInWindow's strict
// `< end` keeps the last day inside the bucket).
function windowRange(window) {
  const fmt = (d) => d.toISOString();
  if (Array.isArray(window) && window.length === 2 && window[0] && window[1]) {
    const start = new Date(window[0] + 'T00:00:00');
    const end = new Date(window[1] + 'T00:00:00');
    end.setDate(end.getDate() + 1);
    return [fmt(start), fmt(end)];
  }
  const now = new Date();
  if (window === 'week') {
    const start = new Date(now);
    const day = start.getDay() || 7; // Mon=1..Sun=7
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return [fmt(start), fmt(end)];
  }
  if (window === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return [fmt(start), fmt(end)];
  }
  // today
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return [fmt(start), fmt(end)];
}

function isInWindow(iso, [startIso, endIso]) {
  if (!iso) return false;
  return iso >= startIso && iso < endIso;
}

// URL window param: presets stay as their key, custom range serializes
// as 'YYYY-MM-DD..YYYY-MM-DD'. Anything else falls back to 'today'.
function parseWindowParam(raw) {
  if (['today', 'week', 'month'].includes(raw)) return raw;
  const m = String(raw || '').match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (m) return [m[1], m[2]];
  return 'today';
}
function encodeWindow(w) {
  if (Array.isArray(w)) return `${w[0]}..${w[1]}`;
  return w;
}

// Lowercased plate/name/code/email match. Returns true on empty query so
// the filter is identity when search isn't in use.
function matchesSearch(b, q) {
  if (!q) return true;
  const haystacks = [
    b.licensePlate,
    b.code,
    b.contact?.name,
    b.contact?.email,
    b.id,
  ];
  return haystacks.some((h) => h && String(h).toLowerCase().includes(q));
}

function isOverdue(booking) {
  if (booking.status !== 'active') return false;
  if (!booking.pickupAt && !booking.endDate) return false;
  const pickup = booking.pickupAt || booking.endDate;
  return Date.now() > new Date(pickup).getTime() + OVERDUE_THRESHOLD_MS;
}

function hoursOver(booking) {
  const pickup = booking.pickupAt || booking.endDate;
  if (!pickup) return 0;
  const diffMs = Date.now() - new Date(pickup).getTime();
  return Math.max(0, Math.floor(diffMs / 3_600_000));
}

// ── Badges ──────────────────────────────────────────────────────────────

function paymentStatusBadge(b) {
  const status = b.paymentStatus || 'paid';
  const paidBy = b.paidBy || '';
  const labelMap = {
    paid: t('checkins.payPaid'),
    unpaid: t('checkins.payUnpaid'),
    'refund-pending': t('checkins.payRefundPending'),
    refunded: t('checkins.payRefunded'),
  };
  const styleMap = {
    paid: 'bg-leaf/10 text-leaf',
    unpaid: 'bg-red-100 text-red-600',
    'refund-pending': 'bg-mango/10 text-mango',
    refunded: 'bg-gray-100 text-dim',
  };
  const cls = styleMap[status] || styleMap.paid;
  const label = labelMap[status] || status;
  const partnerChip = (paidBy === 'broker' || paidBy === 'partner')
    ? `<span class="ml-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-blueberry/10 text-blueberry">${paidBy}</span>`
    : '';
  return `<span class="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${cls}">${label}${partnerChip}</span>`;
}

// ── Row builders ────────────────────────────────────────────────────────

function tabPill(key, activeKey, label, count) {
  const isActive = key === activeKey;
  const cls = isActive
    ? 'bg-blueberry text-white'
    : 'bg-frost text-charcoal/70 hover:bg-frost-deep';
  return `<button type="button" data-tab="${key}" class="px-4 py-2 rounded-xl text-[14px] font-semibold transition-colors ${cls}">${label}<span class="ml-1.5 text-[11px] opacity-75">${count}</span></button>`;
}

function windowPill(key, activeKey, label) {
  const isActive = key === activeKey;
  const cls = isActive
    ? 'bg-mango text-charcoal'
    : 'bg-white text-charcoal/70 hover:bg-frost';
  return `<button type="button" data-window="${key}" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${cls}">${label}</button>`;
}

function actionButton({ key, label, variant = 'neutral', dataAttrs = '' }) {
  const styles = {
    neutral: 'bg-frost hover:bg-frost-deep text-charcoal/80',
    primary: 'bg-leaf hover:bg-leaf/90 text-white',
    warning: 'bg-mango hover:bg-mango-hover text-charcoal',
    danger:  'bg-red-100 hover:bg-red-200 text-red-700',
  };
  return `<button type="button" data-action="${key}" ${dataAttrs} class="${styles[variant] || styles.neutral} font-semibold text-[12px] px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">${label}</button>`;
}

function rowHtml(b, { tab, locale, canCancel }) {
  const code = b.code || `LT-${String(b.id).slice(0, 5).toUpperCase()}`;
  const dropoff = b.dropoffAt || b.startDate;
  const pickup = b.pickupAt || b.endDate;
  const name = b.contact?.name || b.contact?.email || '—';
  const plate = b.licensePlate || '—';
  const unpaid = b.paymentStatus === 'unpaid';
  const cancellable = ['upcoming', 'active'].includes(b.status)
    && b.paymentStatus !== 'refund-pending'
    && b.paymentStatus !== 'refunded';

  const actions = [];
  if (tab === 'checkin') {
    actions.push(actionButton({ key: 'checkin', label: t('checkins.actionCheckIn'), variant: 'primary', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }));
  } else if (tab === 'checkout') {
    actions.push(actionButton({ key: 'checkout', label: t('checkins.actionCheckOut'), variant: 'primary', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }));
  }
  if (unpaid) {
    actions.push(actionButton({ key: 'collect', label: t('checkins.actionCollect'), variant: 'warning', dataAttrs: `data-booking="${escapeHtml(b.id)}" data-order="${escapeHtml(b.paymentId || '')}"` }));
  }
  if (canCancel && cancellable) {
    actions.push(actionButton({ key: 'cancel', label: t('checkins.actionCancelReservation'), variant: 'danger', dataAttrs: `data-booking="${escapeHtml(b.id)}" data-code="${escapeHtml(code)}"` }));
  }

  const statusCell = tab === 'checkin'
    ? `<span class="text-[12px] text-dim">${t('checkins.statusWaiting')}</span>`
    : `<span class="text-[12px] uppercase tracking-wider font-mono font-semibold text-leaf">${t('checkins.statusActive')}</span>`;

  return `
    <tr class="border-t border-frost-deep" data-row data-booking-id="${escapeHtml(b.id)}">
      <td class="px-4 py-3 align-top">
        <div class="text-[13px] font-mono">${fmtDateTime(dropoff, locale)}</div>
        <div class="text-[12px] text-dim font-mono mt-0.5">→ ${fmtDateTime(pickup, locale)}</div>
      </td>
      <td class="px-4 py-3 align-top text-[13px]">
        <div class="font-medium">${escapeHtml(name)}</div>
        <div class="text-[11px] text-dim truncate" title="${escapeHtml(b.contact?.email || '')}">${escapeHtml(b.contact?.email || '')}</div>
      </td>
      <td class="px-4 py-3 align-top text-[13px] font-mono">${escapeHtml(plate)}</td>
      <td class="px-4 py-3 align-top">${paymentStatusBadge(b)}</td>
      <td class="px-4 py-3 align-top">${statusCell}</td>
      <td class="px-4 py-3 align-top text-right">
        <div class="inline-flex flex-wrap gap-1.5 justify-end">${actions.join('')}</div>
      </td>
    </tr>
  `;
}

function overdueRowHtml(b, { locale, canCancel }) {
  const code = b.code || `LT-${String(b.id).slice(0, 5).toUpperCase()}`;
  const overHrs = hoursOver(b);
  const severity = overHrs >= 24 ? 'red' : overHrs >= 4 ? 'orange' : 'mango';
  const sevClass = severity === 'red'
    ? 'text-red-600 bg-red-100'
    : severity === 'orange'
      ? 'text-orange-600 bg-orange-100'
      : 'text-mango bg-mango/10';

  const cancellable = b.paymentStatus !== 'refund-pending' && b.paymentStatus !== 'refunded';
  const actions = [
    actionButton({ key: 'checkout', label: t('checkins.actionCheckOut'), variant: 'primary', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }),
    actionButton({ key: 'overstay', label: t('checkins.actionChargeOverstay'), variant: 'warning', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }),
  ];
  if (canCancel && cancellable) {
    actions.push(actionButton({ key: 'cancel', label: t('checkins.actionCancelReservation'), variant: 'danger', dataAttrs: `data-booking="${escapeHtml(b.id)}" data-code="${escapeHtml(code)}"` }));
  }

  const detail = (label, value) => `
    <div class="flex justify-between gap-3 py-1 border-b border-frost-deep/60 last:border-0">
      <span class="text-[12px] text-dim font-mono uppercase tracking-wider">${label}</span>
      <span class="text-[13px] text-charcoal text-right">${value}</span>
    </div>
  `;

  return `
    <div class="card-solid rounded-2xl overflow-hidden mb-3" data-overdue-row data-booking-id="${escapeHtml(b.id)}">
      <button type="button" data-overdue-toggle class="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-frost transition-colors text-left">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <span class="font-mono text-[14px] font-bold text-blueberry-deep">${escapeHtml(code)}</span>
          <span class="font-mono text-[14px] text-charcoal">${escapeHtml(b.licensePlate || '—')}</span>
          <span class="text-[13px] text-charcoal/70 truncate">${escapeHtml(b.contact?.name || b.contact?.email || '—')}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full ${sevClass}">+${overHrs}h</span>
          ${paymentStatusBadge(b)}
          <svg data-overdue-chevron class="w-4 h-4 text-dim transition-transform" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
        </div>
      </button>
      <div class="hidden border-t border-frost-deep px-4 py-4 bg-frost/30" data-overdue-body>
        <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 mb-4">
          ${detail(t('checkins.detailDropoff'), fmtDateTime(b.dropoffAt || b.startDate, locale))}
          ${detail(t('checkins.detailPickup'), fmtDateTime(b.pickupAt || b.endDate, locale))}
          ${detail(t('checkins.detailDays'), String(b.days || '—'))}
          ${detail(t('checkins.detailTotal'), `${Number(b.totalPrice || 0)} ${t('common.lei')}`)}
          ${detail(t('checkins.detailEmail'), escapeHtml(b.contact?.email || '—'))}
          ${detail(t('checkins.detailPhone'), escapeHtml(b.contact?.phone || '—'))}
          ${detail(t('checkins.detailSpot'), escapeHtml(b.spotId || '—'))}
          ${detail(t('checkins.detailPaidBy'), escapeHtml(b.paidBy || '—'))}
        </div>
        <div class="flex flex-wrap gap-2 justify-end">${actions.join('')}</div>
      </div>
    </div>
  `;
}

// ── Page entry ──────────────────────────────────────────────────────────

export default async function AdminCheckIns(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('checkins.pageTitle')} — Admin — Mango Parking`, description: t('checkins.subtitle'), lang: locale });

  const profile = getUserProfile();
  const role = profile?.role || 'customer';
  const canCancel = hasPermission(role, PERM.REFUNDS);

  // Initial state from URL — preserves tab, window, and search across
  // reloads. Window can be 'today' | 'week' | 'month' or a custom
  // 'YYYY-MM-DD..YYYY-MM-DD' range string.
  const params = new URLSearchParams(window.location.search);
  let activeTab = params.get('tab') || 'checkin';
  if (!['checkin', 'checkout', 'overdue'].includes(activeTab)) activeTab = 'checkin';
  const rawWindow = params.get('window') || 'today';
  let activeWindow = parseWindowParam(rawWindow);
  let searchQuery = (params.get('q') || '').trim().toLowerCase();

  // Pull users once for the walk-in modal (matches the AdminTransactions pattern).
  const users = await getCollection('users').catch(() => []);

  // Live booking data — single subscription, filtered client-side per tab.
  let bookings = [];
  let unsub = null;

  const page = AdminLayout('/admin/checkins', `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('checkins.pageTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('checkins.subtitle')}</p>
      </div>
      <button type="button" data-walkin class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors shadow-sm">${t('checkins.walkInCta')}</button>
    </div>

    <div class="card-solid rounded-2xl p-3 mb-4 flex items-center gap-2">
      <svg class="w-5 h-5 text-dim shrink-0 ml-1" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
      <input type="text" data-search value="${escapeHtml(searchQuery)}" placeholder="${t('checkins.searchPlaceholder')}" class="flex-1 min-w-0 px-2 py-2 bg-transparent text-[15px] focus:outline-none placeholder:text-dim/70">
      <button type="button" data-search-clear class="${searchQuery ? '' : 'hidden'} text-dim hover:text-charcoal p-1.5 rounded-lg hover:bg-frost transition-colors" aria-label="${t('checkins.searchClear')}">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="flex flex-wrap gap-2 mb-4" data-tabs></div>
    <div class="flex flex-wrap items-center gap-2 mb-4" data-window-bar></div>
    <div data-tab-body></div>
  `);

  initAdminNav(page);
  container.appendChild(page);

  const tabsEl = page.querySelector('[data-tabs]');
  const windowBarEl = page.querySelector('[data-window-bar]');
  const bodyEl = page.querySelector('[data-tab-body]');

  function setUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', activeTab);
    if (activeTab === 'overdue') url.searchParams.delete('window');
    else url.searchParams.set('window', encodeWindow(activeWindow));
    if (searchQuery) url.searchParams.set('q', searchQuery);
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
  }

  function counts() {
    const range = windowRange(activeWindow);
    const q = searchQuery;
    const checkin = bookings.filter((b) => b.status === 'upcoming' && isInWindow(b.dropoffAt || b.startDate, range) && matchesSearch(b, q)).length;
    const checkout = bookings.filter((b) => b.status === 'active' && isInWindow(b.pickupAt || b.endDate, range) && matchesSearch(b, q)).length;
    const overdue = bookings.filter((b) => isOverdue(b) && matchesSearch(b, q)).length;
    return { checkin, checkout, overdue };
  }

  function renderTabs() {
    const { checkin, checkout, overdue } = counts();
    tabsEl.innerHTML = [
      tabPill('checkin', activeTab, t('checkins.tabCheckIn'), checkin),
      tabPill('checkout', activeTab, t('checkins.tabCheckOut'), checkout),
      tabPill('overdue', activeTab, t('checkins.tabOverdue'), overdue),
    ].join('');
  }

  function renderWindowBar() {
    if (activeTab === 'overdue') {
      windowBarEl.innerHTML = `<p class="text-[13px] text-dim">${t('checkins.overdueSubtitle')}</p>`;
      return;
    }
    // Preset highlight is "off" whenever activeWindow is a custom range —
    // calendar value carries the active state in that case.
    const presetActive = Array.isArray(activeWindow) ? null : activeWindow;
    const rangeValue = Array.isArray(activeWindow)
      ? `${activeWindow[0]} to ${activeWindow[1]}`
      : '';
    windowBarEl.innerHTML = `
      <span class="text-[12px] uppercase tracking-wider text-dim font-mono mr-1">${t('checkins.windowLabel')}</span>
      ${windowPill('today', presetActive, t('checkins.windowToday'))}
      ${windowPill('week', presetActive, t('checkins.windowWeek'))}
      ${windowPill('month', presetActive, t('checkins.windowMonth'))}
      <span class="text-[12px] text-dim mx-1">${t('checkins.windowOr')}</span>
      <input type="text" data-range-picker value="${escapeHtml(rangeValue)}" placeholder="${t('checkins.windowCustom')}"
        class="px-3 py-1.5 rounded-lg border border-frost-deep bg-white text-[13px] font-mono cursor-pointer hover:bg-frost transition-colors min-w-[180px] focus:outline-none focus:border-blueberry">
    `;
    // (Re-)mount flatpickr range picker.
    const rangeInput = windowBarEl.querySelector('[data-range-picker]');
    if (rangeInput) {
      if (rangeInput._fp) { try { rangeInput._fp.destroy(); } catch {} }
      const fp = flatpickr(rangeInput, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: locale === 'en' ? 'M j, Y' : 'j M Y',
        altInputClass: 'flatpickr-alt-input px-3 py-1.5 rounded-lg border border-frost-deep bg-white text-[13px] font-mono cursor-pointer hover:bg-frost transition-colors min-w-[180px] focus:outline-none focus:border-blueberry',
        locale: locale === 'ro' ? Romanian : 'default',
        clickOpens: true,
        allowInput: false,
        defaultDate: Array.isArray(activeWindow) ? activeWindow : null,
        onClose: (dates) => {
          if (dates.length === 2) {
            const fmt = (d) => {
              const pad = (n) => String(n).padStart(2, '0');
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            };
            activeWindow = [fmt(dates[0]), fmt(dates[1])];
            setUrl();
            rerender();
          }
        },
      });
      rangeInput._fp = fp;
    }
  }

  function renderTable(rows) {
    if (!rows.length) {
      return `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('checkins.emptyTab')}</div>`;
    }
    return `
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
                <th class="px-4 py-3 font-medium">${t('checkins.colTimes')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colCustomer')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colPlate')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colPayment')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colStatus')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('checkins.colActions')}</th>
              </tr>
            </thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderBody() {
    const q = searchQuery;
    if (activeTab === 'checkin') {
      const range = windowRange(activeWindow);
      const rows = bookings
        .filter((b) => b.status === 'upcoming' && isInWindow(b.dropoffAt || b.startDate, range) && matchesSearch(b, q))
        .sort((a, b) => String(a.dropoffAt || a.startDate || '').localeCompare(String(b.dropoffAt || b.startDate || '')))
        .map((b) => rowHtml(b, { tab: 'checkin', locale, canCancel }));
      bodyEl.innerHTML = renderTable(rows);
      return;
    }
    if (activeTab === 'checkout') {
      const range = windowRange(activeWindow);
      const rows = bookings
        .filter((b) => b.status === 'active' && isInWindow(b.pickupAt || b.endDate, range) && matchesSearch(b, q))
        .sort((a, b) => String(a.pickupAt || a.endDate || '').localeCompare(String(b.pickupAt || b.endDate || '')))
        .map((b) => rowHtml(b, { tab: 'checkout', locale, canCancel }));
      bodyEl.innerHTML = renderTable(rows);
      return;
    }
    // overdue
    const rows = bookings
      .filter((b) => isOverdue(b) && matchesSearch(b, q))
      .sort((a, b) => hoursOver(b) - hoursOver(a))
      .map((b) => overdueRowHtml(b, { locale, canCancel }));
    if (!rows.length) {
      bodyEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('checkins.overdueEmpty')}</div>`;
      return;
    }
    bodyEl.innerHTML = rows.join('');
  }

  function rerender() {
    renderTabs();
    renderWindowBar();
    renderBody();
  }

  // ── Subscriptions ──
  // Subscribe once to all bookings; filter per tab in memory. The
  // collection is small at our scale (thousands of rows tops).
  unsub = subscribeCollection('bookings', (rows) => {
    bookings = rows;
    rerender();
  });

  // Tear down subscription on navigation away.
  window.addEventListener('popstate', () => { if (unsub) unsub(); });

  setUrl();
  rerender();

  // ── Tab switcher ──
  delegate(page, 'click', '[data-tab]', (_e, btn) => {
    activeTab = btn.dataset.tab;
    setUrl();
    rerender();
  });

  // ── Window selector ──
  // Picking a preset pill (Today/Week/Month) clears any custom range.
  // The flatpickr range input has its own onClose handler that flips
  // activeWindow back to a tuple.
  delegate(page, 'click', '[data-window]', (_e, btn) => {
    activeWindow = btn.dataset.window;
    setUrl();
    rerender();
  });

  // ── Overdue accordion ──
  delegate(page, 'click', '[data-overdue-toggle]', (_e, btn) => {
    const wrap = btn.closest('[data-overdue-row]');
    const body = wrap.querySelector('[data-overdue-body]');
    const chev = btn.querySelector('[data-overdue-chevron]');
    body.classList.toggle('hidden');
    chev?.classList.toggle('rotate-180');
  });

  // ── Walk-in CTA ──
  delegate(page, 'click', '[data-walkin]', () => {
    openCreateTransactionModal(users, (result) => {
      const checkedIn = !!result?.checkedIn;
      if (checkedIn) {
        activeTab = 'checkout';
        setUrl();
      }
      // Subscription will refresh the list within seconds; force one
      // pass of rerender so the UI is responsive immediately.
      rerender();
    });
  });

  // ── Row actions ──
  delegate(page, 'click', '[data-action]', async (_e, btn) => {
    const action = btn.dataset.action;
    const bookingId = btn.dataset.booking;
    if (!bookingId) return;
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    btn.disabled = true;

    try {
      if (action === 'checkin') {
        await checkInBooking(bookingId);
        showToast(t('checkins.toastCheckedIn'), 'success');
      } else if (action === 'checkout') {
        await checkOutBooking(bookingId);
        showToast(t('checkins.toastCheckedOut'), 'success');
      } else if (action === 'collect') {
        const orderId = btn.dataset.order || booking.paymentId;
        if (!orderId) {
          showToast(t('checkins.errorNoOrderId'), 'error');
          return;
        }
        await openCollectPaymentDialog({ orderId, booking });
      } else if (action === 'cancel') {
        const code = btn.dataset.code || bookingId.slice(0, 5);
        const ok = await confirmModal(t('checkins.cancelConfirm', { code }), {
          danger: true, confirmText: t('checkins.actionCancelReservation'),
        });
        if (!ok) return;
        await cancelBookingFn({ bookingId });
        showToast(t('checkins.toastCancelled'), 'success');
      } else if (action === 'overstay') {
        showToast(t('checkins.overstayPlaceholder'), 'info');
      }
    } catch (err) {
      console.error(action, err);
      showToast(err?.message || t('common.error'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Search filter ──
  // Live filter across plate / customer name / email / booking code.
  // Debounce keeps re-renders snappy on long lists.
  const searchInput = page.querySelector('[data-search]');
  const searchClearBtn = page.querySelector('[data-search-clear]');
  let searchTimer = null;
  searchInput?.addEventListener('input', (e) => {
    const v = String(e.target.value || '').trim().toLowerCase();
    searchQuery = v;
    searchClearBtn?.classList.toggle('hidden', !v);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { setUrl(); rerender(); }, 120);
  });
  searchClearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClearBtn.classList.add('hidden');
    setUrl();
    rerender();
  });
}

// ── Collect payment dialog ──────────────────────────────────────────────
function openCollectPaymentDialog({ orderId, booking }) {
  return new Promise((resolve) => {
    const initialBilling = booking?.billing || {};
    const form = html`<form class="space-y-3" data-collect-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('checkins.collectTitle')}</h3>
      <p class="text-[13px] text-charcoal/70">${t('checkins.collectHint', { plate: booking?.licensePlate || '—', amount: Number(booking?.totalPrice || 0) })}</p>

      <div class="grid sm:grid-cols-2 gap-2">
        <input name="firstName" type="text" placeholder="${escapeHtml(t('billing.firstName'))} *" value="${escapeHtml(initialBilling.firstName || '')}" required class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">
        <input name="lastName" type="text" placeholder="${escapeHtml(t('billing.lastName'))} *" value="${escapeHtml(initialBilling.lastName || '')}" required class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">
      </div>
      <input name="locality" type="text" placeholder="${escapeHtml(t('billing.locality'))} *" value="${escapeHtml(initialBilling.locality || '')}" required class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">
      <input name="address" type="text" placeholder="${escapeHtml(t('billing.personalAddress'))} *" value="${escapeHtml(initialBilling.address || initialBilling.personalAddress || '')}" required class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('checkins.paidBy')}</label>
        <div class="grid grid-cols-2 gap-2" data-paidby>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-mango bg-mango/5 cursor-pointer">
            <input type="radio" name="paidBy" value="cash" checked class="accent-mango">
            <span class="text-[14px] font-medium">${t('checkins.payCash')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="paidBy" value="card" class="accent-mango">
            <span class="text-[14px] font-medium">${t('checkins.payCard')}</span>
          </label>
        </div>
      </div>

      <button type="submit" class="w-full bg-leaf hover:bg-leaf/90 text-white font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('checkins.confirmPayment')}</button>
    </form>`;
    const modal = openModal(form, { onClose: () => resolve() });

    form.querySelector('[data-paidby]').addEventListener('change', (e) => {
      if (!e.target.matches('input[name="paidBy"]')) return;
      form.querySelectorAll('[data-paidby] label').forEach((lbl) => {
        const inp = lbl.querySelector('input');
        lbl.classList.toggle('border-mango', inp.checked);
        lbl.classList.toggle('bg-mango/5', inp.checked);
        lbl.classList.toggle('border-frost-deep', !inp.checked);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstName = form.firstName.value.trim();
      const lastName = form.lastName.value.trim();
      const locality = form.locality.value.trim();
      const address = form.address.value.trim();
      const paidBy = form.querySelector('input[name="paidBy"]:checked')?.value || 'cash';
      if (!firstName || !lastName || !locality || !address) {
        showToast(t('common.error'), 'error');
        return;
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = t('common.loading');
      try {
        await adminMarkOrderPaidFn({
          orderId,
          paidBy,
          payerDetails: { firstName, lastName, locality, address },
        });
        showToast(t('checkins.toastMarkedPaid'), 'success');
        modal.close();
        resolve();
      } catch (err) {
        console.error('markPaid', err);
        showToast(err?.message || t('common.error'), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = t('checkins.confirmPayment');
      }
    });
  });
}
