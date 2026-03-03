import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';

const STATS = {
  totalSpots: 110,
  occupied: 87,
  available: 23,
  checkInsToday: 12,
  checkOutsToday: 8,
  activeSubscriptions: 15,
};

const occupancyPct = Math.round((STATS.occupied / STATS.totalSpots) * 100);

function sidebar(activePath) {
  const links = [
    { path: '/admin', labelKey: 'admin.dashboard', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>' },
    { path: '/admin/bookings', labelKey: 'admin.bookings', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>' },
    { path: '/admin/capacity', labelKey: 'admin.capacity', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/></svg>' },
    { path: '/admin/pricing', labelKey: 'admin.pricing', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/></svg>' },
    { path: '/admin/shuttle', labelKey: 'admin.shuttle', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M21 14.25h-.008"/></svg>' },
    { path: '/admin/reports', labelKey: 'admin.reports', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg>' },
    { path: '/admin/audit', labelKey: 'admin.audit', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"/></svg>' },
  ];

  return links.map(link => {
    const isActive = link.path === activePath;
    return `<a href="${localePath(link.path)}" data-link class="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-colors duration-150 ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">
      ${link.icon}
      <span>${t(link.labelKey)}</span>
    </a>`;
  }).join('');
}

export default function AdminDashboard(container) {
  updateMeta({ title: 'Admin Dashboard — Mango Parking', description: 'Admin dashboard overview.' });

  const ACTION_KEY_MAP = {
    'Check-in': 'admin.actCheckIn',
    'Booking': 'admin.actBooking',
    'Check-out': 'admin.actCheckOut',
    'Shuttle': 'admin.actShuttle',
    'Maintenance': 'admin.actMaintenance',
  };

  const page = html`<div class="flex min-h-screen bg-frost">
    <!-- Sidebar -->
    <aside class="hidden md:flex w-64 bg-charcoal flex-col shrink-0 sticky top-0 h-screen">
      <div class="p-6 border-b border-white/10">
        <a href="${localePath('/')}" data-link class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-mango flex items-center justify-center">
            <span class="text-white font-bold text-sm">M</span>
          </div>
          <span class="text-white font-heading font-bold text-lg">${t('admin.mangoAdmin')}</span>
        </a>
      </div>
      <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
        ${sidebar('/admin')}
      </nav>
      <div class="p-4 border-t border-white/10">
        <a href="${localePath('/')}" data-link class="flex items-center gap-2 text-white/40 hover:text-white/70 text-[14px] transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>
          ${t('admin.backToSite')}
        </a>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <!-- Mobile admin nav -->
      <div class="md:hidden bg-charcoal">
        <div class="flex items-center justify-between px-4 py-3">
          <div class="flex items-center gap-2">
            <a href="${localePath('/')}" data-link class="w-7 h-7 rounded-lg bg-mango flex items-center justify-center shrink-0">
              <span class="text-white font-bold text-xs">M</span>
            </a>
            <span class="text-white font-heading font-bold text-[15px]">${t('admin.mangoAdmin')}</span>
          </div>
          <button data-admin-nav-toggle class="flex items-center gap-1.5 bg-white/10 px-3 py-2 rounded-lg text-white text-[13px] font-medium transition-colors hover:bg-white/15">
            <span>${t('admin.dashboard')}</span>
            <svg data-chevron class="w-4 h-4 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
          </button>
        </div>
        <div class="hidden border-t border-white/10 px-3 py-2 space-y-0.5" data-admin-nav-dropdown>
          ${[
            { path: '/admin', labelKey: 'admin.dashboard' },
            { path: '/admin/bookings', labelKey: 'admin.bookings' },
            { path: '/admin/capacity', labelKey: 'admin.capacity' },
            { path: '/admin/pricing', labelKey: 'admin.pricing' },
            { path: '/admin/shuttle', labelKey: 'admin.shuttle' },
            { path: '/admin/reports', labelKey: 'admin.reports' },
            { path: '/admin/audit', labelKey: 'admin.audit' },
          ].map(link => {
            const isActive = link.path === '/admin';
            return `<a href="${localePath(link.path)}" data-link class="block px-4 py-3 rounded-lg text-[14px] font-medium transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">${t(link.labelKey)}</a>`;
          }).join('')}
        </div>
      </div>
      <div class="p-4 md:p-8">
      <div class="max-w-6xl mx-auto">
        <div class="mb-8">
          <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('admin.dashboard')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.dashboardSubtitle')}</p>
        </div>

        <!-- Capacity Alert -->
        ${occupancyPct >= 90 ? `
        <div class="bg-red-50 border border-red-200 rounded-2xl px-6 py-4 mb-6 flex items-center gap-3">
          <svg class="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
          <div>
            <p class="text-red-800 font-semibold text-[15px]">${t('admin.highOccupancyAlert')}</p>
            <p class="text-red-600 text-[14px]">${t('admin.occupancyAlertMsg', { pct: occupancyPct, count: STATS.available })}</p>
          </div>
        </div>` : ''}

        <!-- Stat Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.totalSpots')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono">${STATS.totalSpots}</p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.occupied')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono text-red-500">${STATS.occupied}</p>
            <div class="mt-3 h-1.5 bg-frost-deep rounded-full overflow-hidden">
              <div class="h-full rounded-full bg-red-400" style="width:${occupancyPct}%"></div>
            </div>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.available')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono text-leaf">${STATS.available}</p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.checkInsToday')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono">${STATS.checkInsToday}</p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.checkOutsToday')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono">${STATS.checkOutsToday}</p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.activeSubscriptions')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono text-mango">${STATS.activeSubscriptions}</p>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="mb-8">
          <h2 class="font-heading font-bold text-lg mb-4 text-charcoal">${t('admin.quickActions')}</h2>
          <div class="flex flex-wrap gap-3">
            <button class="bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.newBookingBtn')}</button>
            <button class="bg-mango hover:bg-mango-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.checkInVehicle')}</button>
            <button class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.checkOutVehicle')}</button>
            <button class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.dispatchShuttle')}</button>
            <button class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.exportReport')}</button>
          </div>
        </div>

        <!-- Recent Activity -->
        <div>
          <h2 class="font-heading font-bold text-lg mb-4 text-charcoal">${t('admin.recentActivity')}</h2>
          <div class="card-solid rounded-2xl overflow-hidden">
            <div class="divide-y divide-frost-deep/60">
              ${[
                { time: '14:32', actionKey: 'Check-in', detail: 'B-123-ABC — Andrei Popescu — Spot A-12' },
                { time: '14:15', actionKey: 'Booking', detail: 'New booking #MP-2024-0892 created' },
                { time: '13:58', actionKey: 'Check-out', detail: 'IF-44-XYZ — Maria Ionescu — Spot B-05' },
                { time: '13:40', actionKey: 'Shuttle', detail: 'Shuttle departed to Airport Terminal' },
                { time: '13:22', actionKey: 'Maintenance', detail: 'Spot C-08 marked for maintenance' },
              ].map(item => `
                <div class="flex items-center gap-4 px-6 py-4">
                  <span class="font-mono text-[14px] text-dim w-12 shrink-0">${item.time}</span>
                  <span class="text-[13px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                    item.actionKey === 'Check-in' ? 'bg-leaf/10 text-leaf' :
                    item.actionKey === 'Check-out' ? 'bg-blue-100 text-blue-600' :
                    item.actionKey === 'Booking' ? 'bg-mango/10 text-mango' :
                    item.actionKey === 'Shuttle' ? 'bg-purple-100 text-purple-600' :
                    'bg-gray-100 text-gray-600'
                  }">${t(ACTION_KEY_MAP[item.actionKey])}</span>
                  <span class="text-[15px] text-charcoal/70">${item.detail}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
      </div>
    </main>
  </div>`;

  // Toggle admin mobile nav dropdown
  const navToggle = page.querySelector('[data-admin-nav-toggle]');
  const navDropdown = page.querySelector('[data-admin-nav-dropdown]');
  if (navToggle && navDropdown) {
    navToggle.addEventListener('click', () => {
      navDropdown.classList.toggle('hidden');
      navToggle.querySelector('[data-chevron]').classList.toggle('rotate-180');
    });
  }

  container.appendChild(page);
}
