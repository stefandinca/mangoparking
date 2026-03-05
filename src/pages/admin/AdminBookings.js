import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllBookings, checkInBooking, checkOutBooking, cancelBooking } from '../../services/bookingService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';

const STATUS_STYLES = {
  active: 'bg-leaf/10 text-leaf',
  upcoming: 'bg-blue-100 text-blue-600',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-500',
};

function renderRow(b) {
  const code = b.code || b.id;
  const customer = b.customerName || '—';
  const vehicle = b.vehicle?.licensePlate || '—';
  const checkIn = b.dates?.dropOff || '—';
  const checkOut = b.dates?.pickUp || '—';
  const status = b.status || 'upcoming';
  return `
    <tr class="hover:bg-frost/50 transition-colors" data-status="${status}" data-booking-id="${b.id}">
      <td class="px-6 py-4 font-mono text-[14px] font-semibold text-charcoal">${code}</td>
      <td class="px-6 py-4 text-[15px]">${customer}</td>
      <td class="px-6 py-4 font-mono text-[14px] text-dim">${vehicle}</td>
      <td class="px-6 py-4 font-mono text-[14px]">${checkIn}</td>
      <td class="px-6 py-4 font-mono text-[14px]">${checkOut}</td>
      <td class="px-6 py-4">
        <span class="text-[12px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${STATUS_STYLES[status] || STATUS_STYLES.upcoming}">${status}</span>
      </td>
      <td class="px-6 py-4 text-right">
        <div class="flex items-center justify-end gap-2">
          ${status === 'upcoming' ? `<button class="text-[13px] font-semibold text-leaf hover:text-leaf/80 transition-colors" data-action="checkin" data-id="${b.id}">${t('admin.checkIn')}</button>` : ''}
          ${status === 'active' ? `<button class="text-[13px] font-semibold text-blue-600 hover:text-blue-500 transition-colors" data-action="checkout" data-id="${b.id}">${t('admin.checkOut')}</button>` : ''}
          ${status === 'upcoming' || status === 'active' ? `<button class="text-[13px] font-semibold text-red-500 hover:text-red-400 transition-colors" data-action="cancel" data-id="${b.id}">${t('admin.cancel')}</button>` : ''}
          <button class="text-[13px] font-semibold text-dim hover:text-charcoal transition-colors" data-action="view" data-id="${b.id}">${t('admin.view')}</button>
        </div>
      </td>
    </tr>`;
}

export default async function AdminBookings(container) {
  updateMeta({ title: 'Bookings — Admin — Mango Parking', description: 'Manage parking bookings.' });

  let bookings = await getAllBookings().catch(() => []);

  const page = AdminLayout('/admin/bookings', `
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('admin.bookings')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('admin.bookingsSubtitle')}</p>
          </div>
          <button class="bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.newBookingBtn')}</button>
        </div>

        <!-- Search & Filters -->
        <div class="flex flex-col sm:flex-row gap-4 mb-6">
          <div class="flex-1 relative">
            <svg class="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-dim" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
            <input type="text" placeholder="${t('admin.searchBookings')}" class="w-full pl-11 pr-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-search>
          </div>
        </div>

        <div class="flex gap-2 mb-6 flex-wrap" data-filters>
          ${[{key: 'admin.all', filter: 'all'}, {key: 'admin.upcoming', filter: 'upcoming'}, {key: 'admin.active', filter: 'active'}, {key: 'admin.completed', filter: 'completed'}, {key: 'admin.cancelled', filter: 'cancelled'}].map((f, i) => `
            <button class="px-4 py-3 rounded-full text-[14px] font-semibold transition-colors ${i === 0 ? 'bg-charcoal text-white' : 'bg-white border border-frost-deep text-dim hover:bg-frost'}" data-filter="${f.filter}">${t(f.key)}</button>
          `).join('')}
        </div>

        <!-- Table -->
        <div class="card-solid rounded-2xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-frost-deep">
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.code')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.customer')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.vehicle')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.checkInCol')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.checkOutCol')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.statusCol')}</th>
                  <th class="text-right text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.actionsCol')}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-frost-deep/60" data-table-body>
                ${bookings.map(renderRow).join('')}
              </tbody>
            </table>
          </div>
        </div>
  `);

  function rerenderTable(filtered) {
    const tbody = page.querySelector('[data-table-body]');
    tbody.innerHTML = filtered.map(renderRow).join('');
  }

  // Booking actions
  delegate(page, 'click', '[data-action]', async (e, btn) => {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'checkin') {
      const spotId = prompt(t('admin.enterSpotId') || 'Enter spot ID (e.g. A-01):');
      if (!spotId) return;
      await checkInBooking(id, spotId);
      bookings = await getAllBookings().catch(() => bookings);
      rerenderTable(bookings);
    } else if (action === 'checkout') {
      await checkOutBooking(id);
      bookings = await getAllBookings().catch(() => bookings);
      rerenderTable(bookings);
    } else if (action === 'cancel') {
      if (!confirm(t('admin.confirmCancel') || 'Cancel this booking?')) return;
      await cancelBooking(id);
      bookings = await getAllBookings().catch(() => bookings);
      rerenderTable(bookings);
    } else if (action === 'view') {
      const b = bookings.find(bk => bk.id === id);
      if (b) alert(JSON.stringify(b, null, 2));
    }
  });

  // Filter functionality
  delegate(page, 'click', '[data-filter]', (e, btn) => {
    const filter = btn.dataset.filter;
    page.querySelectorAll('[data-filter]').forEach(b => {
      b.className = `px-4 py-3 rounded-full text-[14px] font-semibold transition-colors ${b.dataset.filter === filter ? 'bg-charcoal text-white' : 'bg-white border border-frost-deep text-dim hover:bg-frost'}`;
    });
    const filtered = filter === 'all' ? bookings : bookings.filter(b => b.status === filter);
    rerenderTable(filtered);
  });

  // Search functionality
  const searchInput = page.querySelector('[data-search]');
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    page.querySelectorAll('[data-status]').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(query) ? '' : 'none';
    });
  });

  // Wire mobile admin nav
  initAdminNav(page);

  container.appendChild(page);
}
