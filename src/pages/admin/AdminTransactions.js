import { html, qs, delegate, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllRecentTransactions } from '../../services/tokenService.js';
import { getCollection } from '../../firebase/db.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { openCreateTransactionModal } from '../../components/admin/CreateTransactionModal.js';
import { userNameButton, wireUserLinks } from '../../components/admin/UserDetailModal.js';

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
      timestamp: tx.timestamp,
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
      timestamp: b.createdAt || b.startDate || b.dropoffAt,
      type: 'longTerm',
      status: b.status || 'upcoming',
      sum: typeof b.totalPrice === 'number' ? `${b.totalPrice} ${t('common.lei')}` : '',
      plate: b.licensePlate || '',
      customerId: b.customerId || null,
      email: b.contact?.email || (b.customerId && emailByUid.get(b.customerId)) || '',
      code: b.code || '',
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
  `);

  initAdminNav(page);
  wireUserLinks(page);
  container.appendChild(page);

  const tbody = qs('[data-rows]', page);
  const filterInput = qs('[data-filter]', page);
  const typeSelect = qs('[data-filter-type]', page);
  const statusSelect = qs('[data-filter-status]', page);

  let filterQ = '';
  let filterType = '';
  let filterStatus = '';

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
        <td class="px-4 py-3 font-mono text-[13px]">${escapeHtml(r.code || '—')}</td>
      </tr>
    `).join('');
  }

  filterInput.addEventListener('input', (e) => { filterQ = String(e.target.value || ''); render(); });
  typeSelect.addEventListener('change', (e) => { filterType = String(e.target.value || ''); render(); });
  statusSelect.addEventListener('change', (e) => { filterStatus = String(e.target.value || ''); render(); });
  render();

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
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
