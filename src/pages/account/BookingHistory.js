import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { getMyBookings } from '../../services/bookingService.js';
import { formatDate } from '../../utils/date.js';
import { accountLayout, initAccountNav } from '../../components/account/AccountLayout.js';

/* ── Map Firestore bookings to display shape ── */
function mapBooking(b) {
  const dropOff = b.dates?.dropOff || b.checkIn || '';
  const pickUp  = b.dates?.pickUp  || b.checkOut || '';
  return {
    id:       b.code || b.id,
    vehicle:  b.vehicle?.licensePlate || '—',
    spot:     b.spotId || '—',
    checkIn:  dropOff,
    checkOut: pickUp,
    status:   b.status || 'completed',
    total:    b.estimatedPrice ? `${b.estimatedPrice} lei` : '—',
  };
}

const STATUS_STYLES = {
  upcoming:  'bg-blue-50 text-blue-600',
  active:    'bg-leaf/10 text-leaf',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-50 text-danger',
};

function renderBookingCard(b, locale) {
  const statusCls = STATUS_STYLES[b.status] || STATUS_STYLES.completed;
  return `
    <div class="card-solid rounded-2xl p-5 mb-3">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-xl bg-frost flex items-center justify-center text-[13px] font-bold font-mono text-dim">${b.spot}</div>
          <div>
            <p class="font-semibold text-[15px]">${b.id}</p>
            <p class="text-dim text-[13px]">${b.vehicle} &middot; ${formatDate(b.checkIn, locale)} → ${formatDate(b.checkOut, locale)}</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="font-heading font-semibold text-[15px]">${b.total}</span>
          <span class="text-[12px] font-bold ${statusCls} px-3 py-1 rounded-full capitalize">${t('account.status_' + b.status)}</span>
        </div>
      </div>
    </div>
  `;
}

export default async function BookingHistory(container) {
  const locale = getLocale();

  updateMeta({
    title: `${t('account.bookings')} — Mango Parking`,
    description: t('account.bookingsSubtitle'),
    lang: locale,
  });

  /* Fetch real bookings */
  const rawBookings = await getMyBookings().catch(() => []);
  const bookings = rawBookings.map(mapBooking);

  const bookingRows = bookings.map(b => renderBookingCard(b, locale)).join('');

  const content = `
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.bookings')}</h1>
        <p class="text-dim text-[16px]">${t('account.bookingsSubtitle')}</p>
      </div>
      <a href="${localePath('/booking')}" class="hidden sm:inline-block bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('account.newBooking')}</a>
    </div>

    <!-- Filter tabs -->
    <div class="flex gap-2 mb-6 flex-wrap">
      ${['all', 'upcoming', 'active', 'completed', 'cancelled'].map((f, i) => {
        const cls = i === 0
          ? 'px-4 py-3 rounded-xl bg-charcoal text-white text-[14px] font-semibold'
          : 'px-4 py-3 rounded-xl bg-frost text-dim text-[14px] hover:bg-frost-deep transition-colors';
        return `<button class="${cls}" data-filter="${f}">${t('account.filter_' + f)}</button>`;
      }).join('')}
    </div>

    <!-- Booking list -->
    <div data-booking-list>
      ${bookingRows}
    </div>

    <!-- Mobile CTA -->
    <div class="sm:hidden mt-6">
      <a href="${localePath('/booking')}" class="block text-center bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('account.newBooking')}</a>
    </div>
  `;

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16">
      <div class="max-w-7xl mx-auto px-6">
        ${accountLayout('/account/bookings', content)}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  initAccountNav(page);

  // Filter logic
  delegate(page, 'click', '[data-filter]', (e, btn) => {
    const filter = btn.dataset.filter;
    // Update active button style
    page.querySelectorAll('[data-filter]').forEach(b => {
      b.className = b.dataset.filter === filter
        ? 'px-4 py-3 rounded-xl bg-charcoal text-white text-[14px] font-semibold'
        : 'px-4 py-3 rounded-xl bg-frost text-dim text-[14px] hover:bg-frost-deep transition-colors';
    });
    // Filter cards
    const list = page.querySelector('[data-booking-list]');
    const filtered = filter === 'all' ? bookings : bookings.filter(b => b.status === filter);
    list.innerHTML = filtered.map(b => renderBookingCard(b, locale)).join('') || `<p class="text-dim text-center py-8">${t('account.noBookings')}</p>`;
  });

  container.appendChild(page);
}
