import { html, delegate } from '../../utils/dom.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getCapacity } from '../../services/capacityService.js';
import { getAllRecentTransactions } from '../../services/tokenService.js';
import { getAuditLog } from '../../services/auditService.js';
import { navigate } from '../../router/index.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';

export default async function AdminDashboard(container) {
  const locale = getLocale();
  updateMeta({ title: 'Admin Dashboard — Mango Parking', description: 'Admin dashboard overview.' });

  // Fetch real data
  const [capacity, tokenTx, recentActivity] = await Promise.all([
    getCapacity().catch(() => ({ total: 110, occupied: 0, available: 110 })),
    getAllRecentTransactions(200).catch(() => []),
    getAuditLog(5).catch(() => []),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const tokensUsedToday = tokenTx.filter(tx => tx.type === 'use' && tx.timestamp?.slice(0, 10) === today).length;
  const tokensPurchasedToday = tokenTx.filter(tx => tx.type === 'purchase' && tx.timestamp?.slice(0, 10) === today).reduce((sum, tx) => sum + (tx.quantity || 0), 0);

  const STATS = {
    totalSpots: capacity.total,
    occupied: capacity.occupied,
    available: capacity.available,
    tokensUsedToday,
    tokensPurchasedToday,
  };

  const occupancyPct = STATS.totalSpots > 0 ? Math.round((STATS.occupied / STATS.totalSpots) * 100) : 0;

  const ACTION_STYLES = {
    booking_checkin: 'bg-leaf/10 text-leaf',
    booking_checkout: 'bg-blue-100 text-blue-600',
    booking_created: 'bg-mango/10 text-mango',
    spot_updated: 'bg-purple-100 text-purple-600',
    shuttle_updated: 'bg-purple-100 text-purple-600',
    booking_cancelled: 'bg-red-100 text-red-500',
    pricing_updated: 'bg-yellow-100 text-yellow-700',
    addon_updated: 'bg-yellow-100 text-yellow-700',
    subscription_created: 'bg-mango/10 text-mango',
    token_purchase: 'bg-leaf/10 text-leaf',
    token_used: 'bg-blue-100 text-blue-600',
    token_checkout: 'bg-purple-100 text-purple-600',
    token_refund: 'bg-mango/10 text-mango',
    token_pack_created: 'bg-yellow-100 text-yellow-700',
    token_pack_updated: 'bg-yellow-100 text-yellow-700',
  };

  const page = AdminLayout('/admin', `
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
        <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
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
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${locale === 'ro' ? 'Tokens Folosite Azi' : 'Tokens Used Today'}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono">${STATS.tokensUsedToday}</p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${locale === 'ro' ? 'Tokens Cumpărate Azi' : 'Tokens Purchased Today'}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono text-mango">${STATS.tokensPurchasedToday}</p>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="mb-8">
          <h2 class="font-heading font-bold text-lg mb-4 text-charcoal">${t('admin.quickActions')}</h2>
          <div class="flex flex-wrap gap-3">
            <button class="bg-charcoal hover:bg-charcoal-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors" data-quick="bookings">${t('admin.newBookingBtn')}</button>
            <button class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors" data-quick="bookings">${t('admin.checkInVehicle')}</button>
            <button class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors" data-quick="pricing">${t('admin.exportReport')}</button>
            <button class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors" data-quick="shuttle">${t('admin.dispatchShuttle')}</button>
          </div>
        </div>

        <!-- Recent Activity -->
        <div>
          <h2 class="font-heading font-bold text-lg mb-4 text-charcoal">${t('admin.recentActivity')}</h2>
          <div class="card-solid rounded-2xl overflow-hidden">
            <div class="divide-y divide-frost-deep/60">
              ${recentActivity.length > 0 ? recentActivity.map(item => {
                const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                const actionStyle = ACTION_STYLES[item.action] || 'bg-gray-100 text-gray-600';
                return `
                <div class="flex items-center gap-4 px-6 py-4">
                  <span class="font-mono text-[14px] text-dim w-12 shrink-0">${time}</span>
                  <span class="text-[13px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${actionStyle}">${item.action.replace(/_/g, ' ')}</span>
                  <span class="text-[15px] text-charcoal/70 truncate">${item.entity} ${item.details ? '— ' + item.details : ''}</span>
                </div>`;
              }).join('') : `
              <div class="px-6 py-8 text-center text-dim text-[15px]">${t('admin.noRecentActivity') || 'No recent activity'}</div>`}
            </div>
          </div>
        </div>
  `);

  // Quick action navigation
  delegate(page, 'click', '[data-quick]', (e, btn) => {
    navigate(localePath('/admin/' + btn.dataset.quick));
  });

  // Wire mobile admin nav
  initAdminNav(page);

  container.appendChild(page);
}
