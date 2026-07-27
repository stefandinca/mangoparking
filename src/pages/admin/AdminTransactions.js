import { html, qs, delegate, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllRecentTransactions } from '../../services/tokenService.js';
import { getCollection } from '../../firebase/db.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { openCreateTransactionModal } from '../../components/admin/CreateTransactionModal.js';
import { userNameButton, wireUserLinks } from '../../components/admin/UserDetailModal.js';
import { reservationCodeHtml, wireReservationLinks } from '../../components/admin/reservationLink.js';
import { navigate } from '../../router/index.js';
import { localePath } from '../../i18n/index.js';
import { pagerHtml } from '../../components/admin/ListControls.js';
import { fmtDateTime, reservationStatusLabel } from '../../components/admin/bookingActions.js';
import { buildCsv, downloadCsv, todayStamp } from '../../utils/csv.js';
import { anyToIso } from '../../utils/date.js';

// /admin/transactions — unified ledger.
//
// Merges two source collections into a single sortable table:
//   - tokenTransactions  (credit purchase / use / refund / lateFee)
//   - bookings (type === 'longTerm')  — rendered as "booking" rows
//
// Columns: date/time · type · status · sum · plate · email · code
// Search filters across email, plate, and reservation code.
//
// All data is fetched once on mount; pagination is client-side, sorted
// newest-first. At our scale (~thousands of rows max) this stays fast.

const TYPE_LABEL_KEYS = {
  purchase: 'credit.typePurchase',
  use: 'credit.typeUse',
  refund: 'credit.typeRefund',
  lateFee: 'credit.typeLateFee',
  adjustment: 'credit.typeAdjustment',
  extension: 'transactions.typeExtension',
  longTerm: 'transactions.typeLongTerm',
};

const TYPE_STYLES = {
  purchase: 'bg-leaf/10 text-leaf',
  use: 'bg-blue-100 text-blue-600',
  refund: 'bg-mango/10 text-mango',
  lateFee: 'bg-danger/10 text-danger',
  adjustment: 'bg-gray-100 text-gray-600',
  extension: 'bg-blueberry/10 text-blueberry',
  longTerm: 'bg-blueberry/10 text-blueberry',
};

const STATUS_STYLES = {
  paid: 'bg-leaf/10 text-leaf',
  unpaid: 'bg-danger/10 text-danger',
  used: 'bg-blue-100 text-blue-600',
  refunded: 'bg-mango/10 text-mango',
  active: 'bg-leaf/10 text-leaf',
  upcoming: 'bg-blueberry/10 text-blueberry',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-danger/10 text-danger',
};

export default async function AdminTransactions(container) {
  // /admin/transactions?booking=<id> is the reservation detail view. Same
  // in-route trick as the user profile: the router matches on path only, so
  // both live behind this entry and the sidebar item stays highlighted.
  const search = new URLSearchParams(window.location.search);
  const bookingParam = search.get('booking');
  if (bookingParam) {
    const { default: AdminReservationDetail } = await import('./AdminReservationDetail.js');
    return AdminReservationDetail(container, { bookingId: bookingParam });
  }

  const locale = getLocale();
  updateMeta({ title: `${t('transactions.pageTitle')} — Admin — ManGO Parking`, description: t('transactions.subtitle'), lang: locale });

  const [txns, bookings, users] = await Promise.all([
    getAllRecentTransactions(500).catch(() => []),
    getCollection('bookings').catch(() => []),
    getCollection('users').catch(() => []),
  ]);

  // Build uid → email map so tokenTransactions tied to a customerId
  // can be displayed with the owner's email (the transaction doc itself
  // doesn't carry it for the auth path).
  const emailByUid = new Map();
  for (const u of users) {
    if (u.id && u.email) emailByUid.set(u.id, u.email);
  }

  const rows = [];

  for (const tx of txns) {
    rows.push({
      // Normalized to ISO — a Firestore Timestamp here used to render as
      // "Timestamp(seconds=…, nanoseconds=…)" and break the string sort.
      timestamp: anyToIso(tx.timestamp) || '',
      type: tx.type || 'purchase',
      status: tx.type === 'use' ? 'used'
            : tx.type === 'refund' ? 'refunded'
            : tx.type === 'purchase' ? 'paid'
            : tx.type === 'extension' ? 'paid'
            : tx.type === 'adjustment' ? 'used'
            : (tx.type || '—'),
      sum: (tx.type === 'lateFee' || tx.type === 'extension')
        ? `${tx.amount ?? tx.feeAmount ?? 0} ${t('common.lei')}`
        : (tx.type === 'use' || tx.type === 'adjustment') ? String(tx.quantity || 0)
        : `+${tx.quantity || 0}`,
      plate: tx.licensePlate || '',
      customerId: tx.customerId || null,
      email: (tx.customerId && emailByUid.get(tx.customerId)) || tx.billing?.email || '',
      code: '',
    });
  }

  for (const b of bookings) {
    if (b.type !== 'longTerm') continue;
    rows.push({
      timestamp: anyToIso(b.createdAt) || b.startDate || b.dropoffAt || '',
      type: 'longTerm',
      status: b.status || 'upcoming',
      sum: typeof b.totalPrice === 'number' ? `${b.totalPrice} ${t('common.lei')}` : '',
      plate: b.licensePlate || '',
      customerId: b.customerId || null,
      email: b.contact?.email || (b.customerId && emailByUid.get(b.customerId)) || '',
      code: b.code || '',
      // Kept so the code can deep-link to the reservation (reservationCodeHtml
      // / liveTarget). Only longTerm booking rows carry a bookingId.
      bookingId: b.id,
      dropoffAt: b.dropoffAt || null,
      startDate: b.startDate || null,
      pickupAt: b.pickupAt || null,
      endDate: b.endDate || null,
    });
  }

  rows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  const page = AdminLayout('/admin/transactions', `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('transactions.pageTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('transactions.subtitle')}</p>
      </div>
      <button data-create class="shrink-0 bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">
        ${t('transactions.createBtn')}
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-5" data-tabs></div>

    <div data-ledger>
    <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
      <input data-filter type="search" placeholder="${t('transactions.searchPlaceholder')}"
        class="flex-1 max-w-md px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
      <select data-filter-type class="px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40 transition-colors">
        <option value="">${t('transactions.filterTypeAll')}</option>
        <option value="purchase">${t('credit.typePurchase')}</option>
        <option value="use">${t('credit.typeUse')}</option>
        <option value="refund">${t('credit.typeRefund')}</option>
        <option value="lateFee">${t('credit.typeLateFee')}</option>
        <option value="adjustment">${t('credit.typeAdjustment')}</option>
        <option value="extension">${t('transactions.typeExtension')}</option>
        <option value="longTerm">${t('transactions.typeLongTerm')}</option>
      </select>
      <select data-filter-status class="px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40 transition-colors">
        <option value="">${t('transactions.filterStatusAll')}</option>
        <option value="paid">${t('admin.paid')}</option>
        <option value="unpaid">${t('admin.unpaid')}</option>
        <option value="used">${t('admin.used')}</option>
        <option value="refunded">${t('admin.refunded')}</option>
        <option value="active">${t('admin.active')}</option>
        <option value="upcoming">${t('admin.upcoming')}</option>
        <option value="completed">${t('admin.completed')}</option>
        <option value="cancelled">${t('admin.cancelled')}</option>
      </select>
    </div>

    <div class="card-solid rounded-2xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-[14px]">
          <thead class="bg-frost text-charcoal/70 text-[12px] uppercase tracking-wider">
            <tr>
              <th class="text-left px-4 py-3">${t('transactions.colDate')}</th>
              <th class="text-left px-4 py-3">${t('transactions.colType')}</th>
              <th class="text-left px-4 py-3">${t('transactions.colStatus')}</th>
              <th class="text-right px-4 py-3">${t('transactions.colSum')}</th>
              <th class="text-left px-4 py-3">${t('transactions.colPlate')}</th>
              <th class="text-left px-4 py-3">${t('transactions.colEmail')}</th>
              <th class="text-left px-4 py-3">${t('transactions.colCode')}</th>
            </tr>
          </thead>
          <tbody data-rows></tbody>
        </table>
      </div>
    </div>
    </div>

    <div data-reservations class="hidden"></div>
  `);

  initAdminNav(page);
  wireUserLinks(page);
  // Ledger rows are thin projections, not full bookings — let the handler fetch
  // the booking by id so a historical row opens a complete detail modal.
  wireReservationLinks(page);
  container.appendChild(page);

  const tbody = qs('[data-rows]', page);
  const filterInput = qs('[data-filter]', page);
  const typeSelect = qs('[data-filter-type]', page);
  const statusSelect = qs('[data-filter-status]', page);

  let filterQ = '';
  let filterType = '';
  let filterStatus = '';

  // ── Reservations archive ────────────────────────────────────────────────
  // Every bookings doc (long-term AND credit check-ins) — the check-in board
  // is windowed and status-scoped, so this is the only place a completed
  // booking from months ago can be found.
  const RES_PAGE_SIZE = 25;
  let tab = ['credits', 'reservations'].includes(search.get('tab')) ? search.get('tab') : 'all';
  let resQ = search.get('q') || '';
  let resStatus = '';
  let resPayment = '';
  let resType = '';
  let resSource = '';
  let resPage = 1;

  const tabsEl = qs('[data-tabs]', page);
  const ledgerEl = qs('[data-ledger]', page);
  const resEl = qs('[data-reservations]', page);

  function setTabUrl() {
    const p2 = new URLSearchParams();
    if (tab !== 'all') p2.set('tab', tab);
    if (resQ) p2.set('q', resQ);
    const qsStr = p2.toString();
    window.history.replaceState(null, '', qsStr ? `${window.location.pathname}?${qsStr}` : window.location.pathname);
  }

  function renderTabs() {
    const pill = (key, label) => {
      const active = key === tab;
      return `<button type="button" data-tab="${key}" class="px-4 py-2 rounded-xl text-[14px] font-semibold transition-colors ${active ? 'bg-blueberry text-white' : 'bg-frost text-charcoal/70 hover:bg-frost-deep'}">${escapeHtml(label)}</button>`;
    };
    tabsEl.innerHTML = pill('all', t('transactions.tabAll'))
      + pill('credits', t('transactions.tabCredits'))
      + pill('reservations', t('transactions.tabReservations'));
  }

  function reservationMatches(b) {
    const q = resQ.trim().toLowerCase();
    if (resStatus && b.status !== resStatus) return false;
    if (resPayment && b.paymentStatus !== resPayment) return false;
    if (resType && (b.type || 'longTerm') !== resType) return false;
    if (resSource && (b.source || 'web') !== resSource) return false;
    if (!q) return true;
    return `${b.code || ''} ${b.licensePlate || ''} ${b.contact?.email || ''} ${b.contact?.phone || ''} ${b.contact?.name || ''}`
      .toLowerCase().includes(q);
  }

  const sortKey = (b) => anyToIso(b.createdAt) || b.dropoffAt || b.startDate || '';
  const sortedBookings = bookings.slice().sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  function renderReservations() {
    const filtered = sortedBookings.filter(reservationMatches);
    const pages = Math.max(1, Math.ceil(filtered.length / RES_PAGE_SIZE));
    if (resPage > pages) resPage = pages;
    const start = (resPage - 1) * RES_PAGE_SIZE;
    const slice = filtered.slice(start, start + RES_PAGE_SIZE);
    const selCls = 'px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40 transition-colors';
    const opts = (name, values, current) => `<option value="">${escapeHtml(t(`reservations.filter${name}All`))}</option>`
      + values.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${escapeHtml(t(`reservations.${name === 'Source' ? 'source' : name === 'Type' ? 'type' : 'status'}.${v}`) || v)}</option>`).join('');

    resEl.innerHTML = `
      <div class="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <input data-res-q type="search" value="${escapeHtml(resQ)}" placeholder="${escapeHtml(t('reservations.searchPlaceholder'))}"
          class="flex-1 max-w-md px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
        <select data-res-status class="${selCls}">${opts('Status', ['upcoming', 'active', 'completed', 'cancelled', 'no-show'], resStatus)}</select>
        <select data-res-payment class="${selCls}">${opts('Payment', ['paid', 'unpaid', 'refund-pending', 'refunded'], resPayment)}</select>
        <select data-res-type class="${selCls}">${opts('Type', ['longTerm', 'credit'], resType)}</select>
        <select data-res-source class="${selCls}">${opts('Source', ['web', 'admin', 'broker', 'walk-in'], resSource)}</select>
        <button type="button" data-res-export class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[14px] px-4 py-2.5 rounded-xl transition-colors">${escapeHtml(t('reservations.export'))}</button>
      </div>

      ${filtered.length ? `
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-[14px]">
            <thead class="bg-frost text-charcoal/70 text-[12px] uppercase tracking-wider">
              <tr>
                <th class="text-left px-4 py-3">${t('reservations.code')}</th>
                <th class="text-left px-4 py-3">${t('reservations.customer')}</th>
                <th class="text-left px-4 py-3">${t('reservations.plate')}</th>
                <th class="text-left px-4 py-3">${t('reservations.period')}</th>
                <th class="text-left px-4 py-3">${t('reservations.statusLabel')}</th>
                <th class="text-left px-4 py-3">${t('reservations.paymentLabel')}</th>
                <th class="text-right px-4 py-3">${t('reservations.total')}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-frost-deep/60">
              ${slice.map((b) => `
                <tr data-res-row="${escapeHtml(b.id)}" class="hover:bg-frost transition-colors cursor-pointer">
                  <td class="px-4 py-3 font-mono font-semibold text-blueberry">${escapeHtml(b.code || b.id.slice(0, 6))}</td>
                  <td class="px-4 py-3">${escapeHtml(b.contact?.name || '—')}</td>
                  <td class="px-4 py-3 font-mono">${escapeHtml(b.licensePlate || '—')}</td>
                  <td class="px-4 py-3 text-charcoal/70 whitespace-nowrap">${escapeHtml(fmtDateTime(b.dropoffAt || b.startDate, locale))} → ${escapeHtml(fmtDateTime(b.pickupAt || b.endDate, locale))}</td>
                  <td class="px-4 py-3"><span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[b.status] || 'bg-gray-100 text-gray-600'}">${escapeHtml(reservationStatusLabel(b.status))}</span></td>
                  <td class="px-4 py-3"><span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[b.paymentStatus] || 'bg-gray-100 text-gray-600'}">${escapeHtml(reservationStatusLabel(b.paymentStatus))}</span></td>
                  <td class="px-4 py-3 text-right font-semibold whitespace-nowrap">${b.totalPrice != null ? `${Number(b.totalPrice)} ${escapeHtml(t('common.lei'))}` : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${pagerHtml({ page: resPage, pages, from: start + 1, to: start + slice.length, total: filtered.length })}
      </div>`
      : `<div class="card-solid rounded-2xl p-10 text-center text-dim">${escapeHtml(t('reservations.empty'))}</div>`}
    `;
  }

  function renderTab() {
    renderTabs();
    const isRes = tab === 'reservations';
    ledgerEl.classList.toggle('hidden', isRes);
    resEl.classList.toggle('hidden', !isRes);
    if (isRes) renderReservations(); else render();
  }

  delegate(page, 'click', '[data-tab]', (_e, btn) => {
    tab = btn.dataset.tab;
    resPage = 1;
    setTabUrl();
    renderTab();
  });
  delegate(page, 'click', '[data-res-row]', (_e, tr) => {
    navigate(localePath(`/admin/transactions?booking=${encodeURIComponent(tr.dataset.resRow)}`));
  });
  delegate(page, 'input', '[data-res-q]', (_e, input) => { resQ = input.value; resPage = 1; setTabUrl(); renderReservations(); });
  delegate(page, 'change', '[data-res-status]', (_e, sel) => { resStatus = sel.value; resPage = 1; renderReservations(); });
  delegate(page, 'change', '[data-res-payment]', (_e, sel) => { resPayment = sel.value; resPage = 1; renderReservations(); });
  delegate(page, 'change', '[data-res-type]', (_e, sel) => { resType = sel.value; resPage = 1; renderReservations(); });
  delegate(page, 'change', '[data-res-source]', (_e, sel) => { resSource = sel.value; resPage = 1; renderReservations(); });
  delegate(page, 'click', '[data-page-prev]', () => { if (resPage > 1) { resPage--; renderReservations(); } });
  delegate(page, 'click', '[data-page-next]', () => { resPage++; renderReservations(); });
  delegate(page, 'click', '[data-res-export]', () => {
    const filtered = sortedBookings.filter(reservationMatches);
    const headers = ['code', 'type', 'status', 'payment', 'customer', 'email', 'phone', 'plate', 'dropoff', 'pickup', 'days', 'total', 'source'];
    const csvRows = filtered.map((b) => [
      b.code || b.id, b.type || 'longTerm', b.status || '', b.paymentStatus || '',
      b.contact?.name || '', b.contact?.email || '', b.contact?.phone || '', b.licensePlate || '',
      b.dropoffAt || b.startDate || '', b.pickupAt || b.endDate || '', b.days ?? '',
      b.totalPrice ?? '', b.source || '',
    ]);
    downloadCsv(`mango-reservations-${todayStamp()}.csv`, buildCsv(headers, csvRows));
  });

  function render() {
    const q = filterQ.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (q && !`${r.email} ${r.plate} ${r.code}`.toLowerCase().includes(q)) return false;
      if (filterType && r.type !== filterType) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-dim">${t('transactions.empty')}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(r => `
      <tr class="border-t border-frost-deep">
        <td class="px-4 py-3 font-mono text-[12px] text-dim whitespace-nowrap">${fmtMoment(r.timestamp, locale)}</td>
        <td class="px-4 py-3"><span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${TYPE_STYLES[r.type] || 'bg-gray-100 text-gray-600'}">${t(TYPE_LABEL_KEYS[r.type] || 'credit.typePurchase')}</span></td>
        <td class="px-4 py-3"><span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[r.status] || 'bg-gray-100 text-gray-600'}">${r.status || '—'}</span></td>
        <td class="px-4 py-3 text-right font-mono font-semibold">${escapeHtml(r.sum)}</td>
        <td class="px-4 py-3 font-mono">${escapeHtml(r.plate || '—')}</td>
        <td class="px-4 py-3 font-mono text-[13px] text-dim">${userNameButton({ customerId: r.customerId, email: r.email, name: r.email })}</td>
        <td class="px-4 py-3 text-[13px]">${r.bookingId
          ? reservationCodeHtml({ id: r.bookingId, code: r.code, status: r.status, type: 'longTerm', dropoffAt: r.dropoffAt, startDate: r.startDate, pickupAt: r.pickupAt, endDate: r.endDate })
          : `<span class="font-mono">${escapeHtml(r.code || '—')}</span>`}</td>
      </tr>
    `).join('');
  }

  filterInput.addEventListener('input', (e) => { filterQ = String(e.target.value || ''); render(); });
  typeSelect.addEventListener('change', (e) => { filterType = String(e.target.value || ''); render(); });
  statusSelect.addEventListener('change', (e) => { filterStatus = String(e.target.value || ''); render(); });
  renderTab();

  // ── Create-transaction modal ──────────────────────────────────────
  // Modal lives in src/components/admin/CreateTransactionModal.js so the
  // Check-in / Check-out page (v1.7) can mount the same widget for walk-ins.
  qs('[data-create]', page).addEventListener('click', () => {
    openCreateTransactionModal(users, async () => {
      window.location.reload();
    });
  });
}


function fmtMoment(iso, locale) {
  iso = anyToIso(iso);
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Pinned to the lot's timezone, like every other admin board.
    return d.toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Bucharest',
    });
  } catch {
    return iso;
  }
}
