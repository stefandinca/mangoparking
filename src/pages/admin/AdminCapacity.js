import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';

const ZONES = [
  { name: 'A', labelKey: 'admin.zoneACovered', spots: 30 },
  { name: 'B', labelKey: 'admin.zoneBOpen', spots: 30 },
  { name: 'C', labelKey: 'admin.zoneCPremium', spots: 25 },
  { name: 'D', labelKey: 'admin.zoneDLongterm', spots: 25 },
];

const SPOT_STATES = ['available', 'occupied', 'reserved', 'maintenance'];
const SPOT_COLORS = {
  available: 'bg-leaf hover:bg-leaf/80',
  occupied: 'bg-red-400 hover:bg-red-500',
  reserved: 'bg-blue-400 hover:bg-blue-500',
  maintenance: 'bg-gray-400 hover:bg-gray-500',
};

// Generate mock spot data
function generateSpots() {
  const spots = {};
  ZONES.forEach(zone => {
    spots[zone.name] = [];
    for (let i = 1; i <= zone.spots; i++) {
      const rand = Math.random();
      let status;
      if (rand < 0.6) status = 'occupied';
      else if (rand < 0.85) status = 'available';
      else if (rand < 0.95) status = 'reserved';
      else status = 'maintenance';
      spots[zone.name].push({ id: `${zone.name}-${String(i).padStart(2, '0')}`, status });
    }
  });
  return spots;
}

const spotData = generateSpots();

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

export default function AdminCapacity(container) {
  updateMeta({ title: 'Capacity — Admin — Mango Parking', description: 'Manage parking spot capacity.' });

  // Count totals
  let totalAvailable = 0, totalOccupied = 0, totalReserved = 0, totalMaintenance = 0;
  Object.values(spotData).forEach(spots => {
    spots.forEach(s => {
      if (s.status === 'available') totalAvailable++;
      else if (s.status === 'occupied') totalOccupied++;
      else if (s.status === 'reserved') totalReserved++;
      else totalMaintenance++;
    });
  });

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
        ${sidebar('/admin/capacity')}
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
            <span>${t('admin.capacity')}</span>
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
            const isActive = link.path === '/admin/capacity';
            return `<a href="${localePath(link.path)}" data-link class="block px-4 py-3 rounded-lg text-[14px] font-medium transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">${t(link.labelKey)}</a>`;
          }).join('')}
        </div>
      </div>
      <div class="p-4 md:p-8">
      <div class="max-w-6xl mx-auto">
        <div class="mb-8">
          <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('admin.capacityMap')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.capacityMapSubtitle')}</p>
        </div>

        <!-- Legend & Summary -->
        <div class="flex flex-wrap items-center gap-6 mb-6">
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded bg-leaf"></div>
            <span class="text-[14px] text-dim">${t('admin.available')} (<span class="font-mono font-semibold" data-count-available>${totalAvailable}</span>)</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded bg-red-400"></div>
            <span class="text-[14px] text-dim">${t('admin.occupied')} (<span class="font-mono font-semibold" data-count-occupied>${totalOccupied}</span>)</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded bg-blue-400"></div>
            <span class="text-[14px] text-dim">${t('admin.reserved')} (<span class="font-mono font-semibold" data-count-reserved>${totalReserved}</span>)</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded bg-gray-400"></div>
            <span class="text-[14px] text-dim">${t('admin.maintenance')} (<span class="font-mono font-semibold" data-count-maintenance>${totalMaintenance}</span>)</span>
          </div>
        </div>

        <!-- Zone Grids -->
        <div class="space-y-6">
          ${ZONES.map(zone => `
            <div class="card-solid rounded-2xl p-6">
              <div class="flex items-center justify-between mb-4">
                <h2 class="font-heading font-bold text-lg text-charcoal">${t(zone.labelKey)}</h2>
                <span class="text-[13px] font-mono text-dim">${zone.spots} ${t('admin.spots')}</span>
              </div>
              <div class="grid grid-cols-10 sm:grid-cols-15 gap-1.5" data-zone="${zone.name}">
                ${spotData[zone.name].map(spot => `
                  <button
                    class="w-full aspect-square rounded-md ${SPOT_COLORS[spot.status]} transition-colors duration-150 cursor-pointer relative group"
                    data-spot="${spot.id}"
                    data-spot-status="${spot.status}"
                    title="${spot.id} — ${spot.status}"
                  >
                    <span class="absolute -top-8 left-1/2 -translate-x-1/2 bg-charcoal text-white text-[11px] font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">${spot.id}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      </div>
    </main>
  </div>`;

  // Click to toggle spot status
  delegate(page, 'click', '[data-spot]', (e, btn) => {
    const currentStatus = btn.dataset.spotStatus;
    const currentIdx = SPOT_STATES.indexOf(currentStatus);
    const nextStatus = SPOT_STATES[(currentIdx + 1) % SPOT_STATES.length];

    // Remove old color classes, add new
    SPOT_STATES.forEach(s => {
      SPOT_COLORS[s].split(' ').forEach(cls => btn.classList.remove(cls));
    });
    SPOT_COLORS[nextStatus].split(' ').forEach(cls => btn.classList.add(cls));
    btn.dataset.spotStatus = nextStatus;
    btn.title = `${btn.dataset.spot} — ${nextStatus}`;

    // Update counts
    const counts = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
    page.querySelectorAll('[data-spot-status]').forEach(el => {
      counts[el.dataset.spotStatus]++;
    });
    page.querySelector('[data-count-available]').textContent = counts.available;
    page.querySelector('[data-count-occupied]').textContent = counts.occupied;
    page.querySelector('[data-count-reserved]').textContent = counts.reserved;
    page.querySelector('[data-count-maintenance]').textContent = counts.maintenance;
  });

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
