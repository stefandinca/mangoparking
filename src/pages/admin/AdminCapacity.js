import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllSpots, updateSpotStatus, subscribeCapacity } from '../../services/capacityService.js';
import { TOTAL_CAPACITY } from '../../utils/constants.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';

const SPOT_STATES = ['available', 'occupied', 'reserved', 'maintenance'];
const SPOT_COLORS = {
  available: 'bg-leaf hover:bg-leaf/80',
  occupied: 'bg-red-400 hover:bg-red-500',
  reserved: 'bg-blue-400 hover:bg-blue-500',
  maintenance: 'bg-gray-400 hover:bg-gray-500',
};

const ZONE_META = [
  { name: 'A', labelKey: 'admin.zoneACovered' },
  { name: 'B', labelKey: 'admin.zoneBOpen' },
  { name: 'C', labelKey: 'admin.zoneCPremium' },
  { name: 'D', labelKey: 'admin.zoneDLongterm' },
];

export default async function AdminCapacity(container) {
  updateMeta({ title: 'Capacity — Admin — Mango Parking', description: 'Manage parking spot capacity.' });

  // Fetch real spots from Firestore
  const allSpots = await getAllSpots().catch(() => []);

  // Group by zone (extract zone letter from spot id like "A-01")
  const spotData = {};
  for (const zone of ZONE_META) {
    spotData[zone.name] = allSpots.filter(s => s.id?.startsWith(zone.name + '-') || s.zone === zone.name);
  }

  // Count totals
  let totalAvailable = 0, totalOccupied = 0, totalReserved = 0, totalMaintenance = 0;
  allSpots.forEach(s => {
    if (s.status === 'available') totalAvailable++;
    else if (s.status === 'occupied') totalOccupied++;
    else if (s.status === 'reserved') totalReserved++;
    else totalMaintenance++;
  });

  const page = AdminLayout('/admin/capacity', `
        <div class="mb-8">
          <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('admin.capacityMap')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.capacityMapSubtitle')}</p>
        </div>

        <!-- Live Capacity -->
        <div class="card-solid rounded-2xl p-6 mb-6">
          <div class="flex items-center gap-3 mb-3">
            <span class="w-2.5 h-2.5 rounded-full bg-leaf animate-pulse"></span>
            <h2 class="font-heading font-bold text-lg text-charcoal">${t('hero.liveCapacity')}</h2>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <p class="text-[12px] font-mono uppercase text-dim tracking-wider mb-1">${t('admin.totalSpots')}</p>
              <p class="font-heading font-bold text-3xl tracking-tight font-mono" data-live-total>${TOTAL_CAPACITY}</p>
            </div>
            <div>
              <p class="text-[12px] font-mono uppercase text-dim tracking-wider mb-1">${t('admin.occupied')}</p>
              <p class="font-heading font-bold text-3xl tracking-tight font-mono text-red-500" data-live-occupied>0</p>
            </div>
            <div>
              <p class="text-[12px] font-mono uppercase text-dim tracking-wider mb-1">${t('admin.available')}</p>
              <p class="font-heading font-bold text-3xl tracking-tight font-mono text-leaf" data-live-available>${TOTAL_CAPACITY}</p>
            </div>
          </div>
          <div class="mt-3 h-2 bg-frost-deep rounded-full overflow-hidden">
            <div class="h-full rounded-full bg-gradient-to-r from-leaf to-mango transition-all duration-500" data-live-bar style="width:0%"></div>
          </div>
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
          ${ZONE_META.map(zone => {
            const zoneSpots = spotData[zone.name] || [];
            return `
            <div class="card-solid rounded-2xl p-6">
              <div class="flex items-center justify-between mb-4">
                <h2 class="font-heading font-bold text-lg text-charcoal">${t(zone.labelKey)}</h2>
                <span class="text-[13px] font-mono text-dim">${zoneSpots.length} ${t('admin.spots')}</span>
              </div>
              <div class="grid grid-cols-10 sm:grid-cols-15 gap-1.5" data-zone="${zone.name}">
                ${zoneSpots.map(spot => `
                  <button
                    class="w-full aspect-square rounded-md ${SPOT_COLORS[spot.status] || SPOT_COLORS.available} transition-colors duration-150 cursor-pointer relative group"
                    data-spot="${spot.id}"
                    data-spot-status="${spot.status || 'available'}"
                    title="${spot.id} — ${spot.status || 'available'}"
                  >
                    <span class="absolute -top-8 left-1/2 -translate-x-1/2 bg-charcoal text-white text-[11px] font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">${spot.id}</span>
                  </button>
                `).join('')}
              </div>
            </div>`;
          }).join('')}
        </div>
  `);

  // Click to toggle spot status + persist to Firestore (with rollback on failure)
  delegate(page, 'click', '[data-spot]', async (e, btn) => {
    const currentStatus = btn.dataset.spotStatus;
    const currentIdx = SPOT_STATES.indexOf(currentStatus);
    const nextStatus = SPOT_STATES[(currentIdx + 1) % SPOT_STATES.length];
    const spotId = btn.dataset.spot;

    // Update UI immediately (optimistic)
    SPOT_STATES.forEach(s => {
      SPOT_COLORS[s].split(' ').forEach(cls => btn.classList.remove(cls));
    });
    SPOT_COLORS[nextStatus].split(' ').forEach(cls => btn.classList.add(cls));
    btn.dataset.spotStatus = nextStatus;
    btn.title = `${spotId} — ${nextStatus}`;

    // Update counts
    const counts = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
    page.querySelectorAll('[data-spot-status]').forEach(el => {
      counts[el.dataset.spotStatus]++;
    });
    page.querySelector('[data-count-available]').textContent = counts.available;
    page.querySelector('[data-count-occupied]').textContent = counts.occupied;
    page.querySelector('[data-count-reserved]').textContent = counts.reserved;
    page.querySelector('[data-count-maintenance]').textContent = counts.maintenance;

    // Persist to Firestore (rollback on failure)
    try {
      await updateSpotStatus(spotId, nextStatus);
    } catch (err) {
      console.error(err);
      // Rollback UI
      SPOT_STATES.forEach(s => {
        SPOT_COLORS[s].split(' ').forEach(cls => btn.classList.remove(cls));
      });
      SPOT_COLORS[currentStatus].split(' ').forEach(cls => btn.classList.add(cls));
      btn.dataset.spotStatus = currentStatus;
      btn.title = `${spotId} — ${currentStatus}`;
      // Rollback counts
      const rollbackCounts = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
      page.querySelectorAll('[data-spot-status]').forEach(el => {
        rollbackCounts[el.dataset.spotStatus]++;
      });
      page.querySelector('[data-count-available]').textContent = rollbackCounts.available;
      page.querySelector('[data-count-occupied]').textContent = rollbackCounts.occupied;
      page.querySelector('[data-count-reserved]').textContent = rollbackCounts.reserved;
      page.querySelector('[data-count-maintenance]').textContent = rollbackCounts.maintenance;
    }
  });

  // Real-time capacity subscription
  const unsubCapacity = subscribeCapacity((cap) => {
    const liveTotal = page.querySelector('[data-live-total]');
    const liveOccupied = page.querySelector('[data-live-occupied]');
    const liveAvailable = page.querySelector('[data-live-available]');
    const liveBar = page.querySelector('[data-live-bar]');
    if (liveTotal) liveTotal.textContent = cap.total;
    if (liveOccupied) liveOccupied.textContent = cap.occupied;
    if (liveAvailable) liveAvailable.textContent = cap.available;
    if (liveBar) liveBar.style.width = (cap.total > 0 ? Math.round((cap.occupied / cap.total) * 100) : 0) + '%';
  });

  // Wire mobile admin nav
  initAdminNav(page);

  container.appendChild(page);

  // Return cleanup function
  return () => {
    if (unsubCapacity) unsubCapacity();
  };
}
