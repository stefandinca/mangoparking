import { delegate, escapeHtml } from '../../utils/dom.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getCapacity } from '../../services/capacityService.js';
import { getAllRecentTransactions } from '../../services/tokenService.js';
import { getAuditLog } from '../../services/auditService.js';
import { getCollection } from '../../firebase/db.js';
import { attachRefundDue } from '../../services/bookingService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
// Shared with /admin/audit so the same action reads identically in both places.
import { actionStyle, actionLabel, describeAction, fmtAuditTime } from '../../components/admin/auditFormat.js';

// Reusable: get a YYYY-MM-DD string in Europe/Bucharest TZ.
function localDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
}

// Build N most-recent day buckets (oldest → newest) with credit-use count
// and longterm check-in count per day. Used by the activity chart.
function buildDailyBuckets(days, txns, bookings) {
  const buckets = [];
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
  const todayMs = Date.parse(todayLocal + 'T12:00:00');
  for (let i = days - 1; i >= 0; i--) {
    const dayMs = todayMs - i * 86_400_000;
    const ymd = new Date(dayMs).toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
    buckets.push({ ymd, credits: 0, longterm: 0 });
  }
  const idx = new Map(buckets.map((b, i) => [b.ymd, i]));
  for (const tx of txns) {
    if (tx.type !== 'use') continue;
    const k = localDay(tx.timestamp);
    if (idx.has(k)) buckets[idx.get(k)].credits++;
  }
  for (const b of bookings) {
    const k = localDay(b.checkinTimestamp);
    if (idx.has(k)) buckets[idx.get(k)].longterm++;
  }
  return buckets;
}

// Render an SVG bar chart: stacked bars (credits below, longterm on top).
function renderChartSvg(buckets) {
  const width = 1000;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 24, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...buckets.map(b => b.credits + b.longterm));
  const slot = innerW / buckets.length;
  const barW = Math.max(2, slot * 0.7);
  const yScale = v => innerH - (v / max) * innerH;

  const bars = buckets.map((b, i) => {
    const x = padding.left + i * slot + (slot - barW) / 2;
    const total = b.credits + b.longterm;
    const yTotal = padding.top + yScale(total);
    const hTotal = padding.top + innerH - yTotal;
    const yCredits = padding.top + yScale(b.credits);
    const hCredits = padding.top + innerH - yCredits;
    return `
      <g>
        <rect x="${x}" y="${yTotal}" width="${barW}" height="${hTotal}" fill="#1E5BD6" rx="2"></rect>
        <rect x="${x}" y="${yCredits}" width="${barW}" height="${hCredits}" fill="#FDBB30" rx="2"></rect>
        <title>${b.ymd}: ${b.credits} credite, ${b.longterm} termen lung</title>
      </g>
    `;
  }).join('');

  // Sparse X-axis tick labels (~6 evenly spaced).
  const tickCount = 6;
  const tickStep = Math.max(1, Math.floor(buckets.length / tickCount));
  const ticks = [];
  for (let i = 0; i < buckets.length; i += tickStep) {
    const x = padding.left + i * slot + slot / 2;
    const label = buckets[i].ymd.slice(5); // MM-DD
    ticks.push(`<text x="${x}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#666" font-family="monospace">${label}</text>`);
  }

  // Y-axis labels: 0 and max only.
  const yLabels = `
    <text x="${padding.left - 6}" y="${padding.top + innerH}" text-anchor="end" font-size="10" fill="#666" font-family="monospace">0</text>
    <text x="${padding.left - 6}" y="${padding.top + 8}" text-anchor="end" font-size="10" fill="#666" font-family="monospace">${max}</text>
  `;

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="w-full h-[220px]" role="img">
      ${bars}
      ${ticks.join('')}
      ${yLabels}
    </svg>
  `;
}

export default async function AdminDashboard(container) {
  const locale = getLocale();
  updateMeta({ title: 'Admin Dashboard — ManGO Parking', description: 'Admin dashboard overview.' });

  // Fetch real data. Pull 90 days of token transactions + bookings up front
  // so the chart tab switcher is instant (re-buckets in memory).
  //
  // The bookings fetch is deliberately UNSCOPED: `createdAt` is mixed-typed
  // across the collection (Firestore Timestamp on client writes via
  // addDocument's serverTimestamp, ISO string on Cloud Function writes), and
  // Firestore range/orderBy constraints only match one type — a server-side
  // 90-day window would silently drop half the rows. Until the stored field
  // is migrated to one type, filter client-side; the read boundary
  // (db.js normalizeDocDates) at least guarantees uniform values in memory.
  const [capacity, tokenTx, recentActivity, allBookings] = await Promise.all([
    getCapacity().catch(() => ({ total: 110, occupied: 0, available: 110 })),
    getAllRecentTransactions(2000).catch(() => []),
    getAuditLog(8).catch(() => []),
    getCollection('bookings').catch(() => []),
  ]);

  // Refund queue — bookings cancelled but money not yet returned.
  // Surfaces here so the count stays in admins' face every time they
  // open the dashboard. Click-through goes to /admin/refunds.
  // Only count genuinely-paid bookings (paidBy = real captured payment);
  // unpaid "cash on arrival" rows have nothing to refund. Must match the
  // filter in AdminRefunds.js so the dashboard tally and the queue agree.
  const PAID_CHANNELS = new Set(['netopia', 'admin-cash', 'admin-card']);
  const refundPending = allBookings.filter(
    (b) => b.paymentStatus === 'refund-pending' && PAID_CHANNELS.has(b.paidBy),
  );
  // Resolve what is genuinely owed back before summing. `totalPrice` is the
  // gross list price, so summing it overstated the queue on every discounted
  // or voucher booking — and disagreed with the queue's own total.
  await attachRefundDue(refundPending);
  const refundPendingTotal = refundPending.reduce((acc, b) => acc + (Number(b.refundDue) || 0), 0);

  // Bucket "today" in Europe/Bucharest (same as the activity chart's
  // localDay), not UTC — otherwise rows between local midnight and 02:00–03:00
  // get mis-dated and the stat cards disagree with the chart.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
  const tokensUsedToday = tokenTx.filter(tx => tx.type === 'use' && localDay(tx.timestamp) === today).length;
  const tokensPurchasedToday = tokenTx.filter(tx => tx.type === 'purchase' && localDay(tx.timestamp) === today).reduce((sum, tx) => sum + (tx.quantity || 0), 0);

  const STATS = {
    totalSpots: capacity.total,
    occupied: capacity.occupied,
    available: capacity.available,
    tokensUsedToday,
    tokensPurchasedToday,
  };

  const occupancyPct = STATS.totalSpots > 0 ? Math.round((STATS.occupied / STATS.totalSpots) * 100) : 0;

  // getAuditLog now exposes `newValueObj` as the typed object so
  // describeAction can pluck fields like .spotId or .licensePlate.
  const activityRows = recentActivity;

  // Default chart window: 30 days.
  const initialBuckets = buildDailyBuckets(30, tokenTx, allBookings);
  const chartSvg = renderChartSvg(initialBuckets);

  const page = AdminLayout('/admin', `
        <div class="mb-8">
          <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.dashboard')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.dashboardSubtitle')}</p>
        </div>

        ${refundPending.length > 0 ? `
        <a href="${localePath('/admin/refunds')}" data-link class="block bg-mango/10 border border-mango/40 rounded-2xl px-6 py-4 mb-4 flex items-center justify-between gap-3 hover:bg-mango/15 transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <svg class="w-5 h-5 text-mango shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/></svg>
            <div class="min-w-0">
              <p class="text-charcoal font-semibold text-[15px]">${t('refunds.pageTitle')} · ${refundPending.length}</p>
              <p class="text-charcoal/60 text-[13px]">${t('refunds.totalPending')}: ${refundPendingTotal} ${t('common.lei')}</p>
            </div>
          </div>
          <span class="text-mango font-mono text-[12px] uppercase tracking-wider shrink-0">${t('refunds.markRefunded')} →</span>
        </a>
        ` : ''}

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
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.creditsUsedToday')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono">${STATS.tokensUsedToday}</p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.creditsPurchasedToday')}</p>
            <p class="font-heading font-bold text-3xl tracking-tight font-mono text-mango">${STATS.tokensPurchasedToday}</p>
          </div>
        </div>

        <!-- Activity chart -->
        <div class="card-solid rounded-2xl p-6 mb-8">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 class="font-heading font-bold text-lg text-charcoal">${t('admin.chartTitle')}</h2>
              <p class="text-dim text-[13px] mt-1">${t('admin.chartSubtitle')}</p>
            </div>
            <div class="flex gap-1 shrink-0" data-chart-tabs>
              <button data-range="30" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-blueberry text-white">30</button>
              <button data-range="60" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-frost text-dim hover:bg-frost-deep transition-colors">60</button>
              <button data-range="90" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-frost text-dim hover:bg-frost-deep transition-colors">90</button>
            </div>
          </div>
          <div class="flex gap-4 mb-3 text-[12px] text-dim">
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded bg-mango"></span> ${t('admin.chartCredits')}</span>
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded bg-blueberry"></span> ${t('admin.chartLongterm')}</span>
          </div>
          <div data-chart>${chartSvg}</div>
        </div>

        <!-- Recent Activity -->
        <div>
          <div class="flex items-center justify-between gap-3 mb-4">
            <h2 class="font-heading font-bold text-lg text-charcoal">${t('admin.recentActivity')}</h2>
            <a href="${localePath('/admin/audit')}" data-link class="text-[13px] font-semibold text-blueberry hover:text-blueberry-hover hover:underline transition-colors shrink-0">${t('audit.seeAll')} →</a>
          </div>
          <div class="card-solid rounded-2xl overflow-hidden">
            <div class="divide-y divide-frost-deep/60">
              ${activityRows.length > 0 ? activityRows.map(item => {
                const actor = (item.user || '').split('@')[0] || '—';
                // Both the description and the actor carry user-supplied data
                // (audit payloads hold plates / codes / names; the actor
                // resolves to an account's email or display name, and a
                // customer self-cancel makes the CUSTOMER the actor) and land
                // in innerHTML — escape before rendering.
                return `
                <div class="flex flex-wrap items-center gap-3 px-6 py-4">
                  <span class="font-mono text-[12px] text-dim w-24 shrink-0">${escapeHtml(fmtAuditTime(item.timestamp, locale))}</span>
                  <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${actionStyle(item.action)}">${escapeHtml(actionLabel(item.action))}</span>
                  <span class="text-[14px] text-charcoal/80 flex-1 min-w-0 truncate">${escapeHtml(describeAction(item, locale))}</span>
                  <span class="text-[12px] text-dim font-mono shrink-0 hidden sm:inline" title="${escapeHtml(item.user || '')}">${escapeHtml(actor)}</span>
                </div>`;
              }).join('') : `
              <div class="px-6 py-8 text-center text-dim text-[15px]">${t('admin.noRecentActivity') || 'No recent activity'}</div>`}
            </div>
          </div>
        </div>
  `);

  // Chart tab switcher — rebuild buckets in memory.
  const chartEl = page.querySelector('[data-chart]');
  const tabsEl = page.querySelector('[data-chart-tabs]');
  delegate(tabsEl, 'click', '[data-range]', (e, btn) => {
    const days = Number(btn.dataset.range) || 30;
    tabsEl.querySelectorAll('[data-range]').forEach((b) => {
      b.className = b === btn
        ? 'px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-blueberry text-white'
        : 'px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-frost text-dim hover:bg-frost-deep transition-colors';
    });
    chartEl.innerHTML = renderChartSvg(buildDailyBuckets(days, tokenTx, allBookings));
  });

  initAdminNav(page);

  container.appendChild(page);
}
