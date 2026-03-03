import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';

/* ── Sidebar (shared pattern) ── */
const ACCOUNT_NAV = [
  { path: '/account',              icon: 'dashboard', labelKey: 'account.dashboard' },
  { path: '/account/bookings',     icon: 'bookings',  labelKey: 'account.bookings' },
  { path: '/account/subscription', icon: 'sub',       labelKey: 'account.subscription' },
  { path: '/account/vehicles',     icon: 'vehicles',  labelKey: 'account.vehicles' },
  { path: '/account/loyalty',      icon: 'loyalty',   labelKey: 'account.loyalty' },
];

const NAV_ICONS = {
  dashboard: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"/></svg>`,
  bookings: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>`,
  sub: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/></svg>`,
  vehicles: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M3.375 14.25c-.621 0-1.125.504-1.125 1.125v2.25c0 .621.504 1.125 1.125 1.125m0-4.5V6.375c0-.621.504-1.125 1.125-1.125h8.25c.621 0 1.125.504 1.125 1.125v8.25"/></svg>`,
  loyalty: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>`,
};

function accountSidebar(activePath) {
  return ACCOUNT_NAV.map(link => {
    const isActive = link.path === activePath;
    const cls = isActive
      ? 'flex items-center gap-3 px-4 py-3 rounded-xl bg-mango/10 text-mango font-semibold text-[15px] transition-colors'
      : 'flex items-center gap-3 px-4 py-3 rounded-xl text-dim hover:bg-frost hover:text-charcoal text-[15px] transition-colors';
    return `<a href="${localePath(link.path)}" class="${cls}">${NAV_ICONS[link.icon]}<span>${t(link.labelKey)}</span></a>`;
  }).join('');
}

function accountLayout(activePath, contentHtml) {
  const activeLabel = ACCOUNT_NAV.find(l => l.path === activePath)?.labelKey || 'account.dashboard';
  return `
    <div class="md:hidden mb-6">
      <button data-account-nav-toggle class="flex items-center justify-between w-full card-solid rounded-2xl px-5 py-3.5 text-[15px] font-semibold transition-colors">
        <span>${t(activeLabel)}</span>
        <svg data-chevron class="w-4 h-4 text-dim transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
      </button>
      <div class="hidden card-solid rounded-2xl mt-2 p-2 space-y-0.5" data-account-nav-dropdown>
        ${ACCOUNT_NAV.map(link => {
          const isActive = link.path === activePath;
          const cls = isActive
            ? 'flex items-center gap-3 px-4 py-3 rounded-xl bg-mango/10 text-mango font-semibold text-[14px]'
            : 'flex items-center gap-3 px-4 py-3 rounded-xl text-dim hover:bg-frost text-[14px] transition-colors';
          return `<a href="${localePath(link.path)}" class="${cls}">${NAV_ICONS[link.icon]}<span>${t(link.labelKey)}</span></a>`;
        }).join('')}
      </div>
    </div>
    <div class="flex gap-4 md:gap-8">
      <aside class="hidden md:block w-56 flex-shrink-0">
        <div class="card-solid rounded-2xl p-3 space-y-1 sticky top-28">
          ${accountSidebar(activePath)}
        </div>
      </aside>
      <div class="flex-1 min-w-0">${contentHtml}</div>
    </div>
  `;
}

/* ── Mock bookings ── */
const MOCK_BOOKINGS = [
  { id: 'BK-2026-0042', vehicle: 'B 123 ABC', spot: 'A-17', checkIn: '2026-03-01T08:30', checkOut: '2026-03-08T18:00', status: 'active',    total: '203 lei' },
  { id: 'BK-2026-0045', vehicle: 'B 123 ABC', spot: 'C-03', checkIn: '2026-03-15T06:00', checkOut: '2026-03-20T22:00', status: 'upcoming',  total: '145 lei' },
  { id: 'BK-2026-0038', vehicle: 'IF 99 XYZ', spot: 'B-05', checkIn: '2026-02-10T09:00', checkOut: '2026-02-17T17:00', status: 'completed', total: '203 lei' },
  { id: 'BK-2026-0031', vehicle: 'B 123 ABC', spot: 'A-22', checkIn: '2026-01-20T07:00', checkOut: '2026-01-25T19:00', status: 'completed', total: '145 lei' },
  { id: 'BK-2025-0119', vehicle: 'IF 99 XYZ', spot: 'D-11', checkIn: '2025-12-18T10:00', checkOut: '2025-12-20T08:00', status: 'cancelled', total: '58 lei'  },
  { id: 'BK-2025-0098', vehicle: 'B 123 ABC', spot: 'B-14', checkIn: '2025-11-05T08:00', checkOut: '2025-11-12T16:00', status: 'completed', total: '203 lei' },
];

const STATUS_STYLES = {
  upcoming:  'bg-blue-50 text-blue-600',
  active:    'bg-leaf/10 text-leaf',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-50 text-danger',
};

export default function BookingHistory(container) {
  const locale = getLocale();
  const dateFmt = { day: 'numeric', month: 'short', year: 'numeric' };
  const loc = locale === 'ro' ? 'ro-RO' : 'en-GB';

  updateMeta({
    title: `${t('account.bookings')} — Mango Parking`,
    description: t('account.bookingsSubtitle'),
    lang: locale,
  });

  const bookingRows = MOCK_BOOKINGS.map(b => {
    const statusCls = STATUS_STYLES[b.status] || STATUS_STYLES.completed;
    return `
      <div class="card-solid rounded-2xl p-5 mb-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-xl bg-frost flex items-center justify-center text-[13px] font-bold font-mono text-dim">${b.spot}</div>
            <div>
              <p class="font-semibold text-[15px]">${b.id}</p>
              <p class="text-dim text-[13px]">${b.vehicle} &middot; ${new Date(b.checkIn).toLocaleDateString(loc, dateFmt)} → ${new Date(b.checkOut).toLocaleDateString(loc, dateFmt)}</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="font-heading font-semibold text-[15px]">${b.total}</span>
            <span class="text-[12px] font-bold ${statusCls} px-3 py-1 rounded-full capitalize">${t('account.status_' + b.status)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

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

  // Toggle account mobile nav dropdown
  const navToggle = page.querySelector('[data-account-nav-toggle]');
  const navDropdown = page.querySelector('[data-account-nav-dropdown]');
  if (navToggle && navDropdown) {
    navToggle.addEventListener('click', () => {
      navDropdown.classList.toggle('hidden');
      navToggle.querySelector('[data-chevron]').classList.toggle('rotate-180');
    });
  }

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
    const filtered = filter === 'all' ? MOCK_BOOKINGS : MOCK_BOOKINGS.filter(b => b.status === filter);
    list.innerHTML = filtered.map(b => {
      const statusCls = STATUS_STYLES[b.status] || STATUS_STYLES.completed;
      return `
        <div class="card-solid rounded-2xl p-5 mb-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-4">
              <div class="w-10 h-10 rounded-xl bg-frost flex items-center justify-center text-[13px] font-bold font-mono text-dim">${b.spot}</div>
              <div>
                <p class="font-semibold text-[15px]">${b.id}</p>
                <p class="text-dim text-[13px]">${b.vehicle} &middot; ${new Date(b.checkIn).toLocaleDateString(loc, dateFmt)} → ${new Date(b.checkOut).toLocaleDateString(loc, dateFmt)}</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="font-heading font-semibold text-[15px]">${b.total}</span>
              <span class="text-[12px] font-bold ${statusCls} px-3 py-1 rounded-full capitalize">${t('account.status_' + b.status)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('') || `<p class="text-dim text-center py-8">${t('account.noBookings')}</p>`;
  });

  container.appendChild(page);
}
