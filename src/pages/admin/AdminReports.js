import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllBookings } from '../../services/bookingService.js';
import { getAllSubscriptions } from '../../services/subscriptionService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';

export default async function AdminReports(container) {
  updateMeta({ title: 'Reports — Admin — Mango Parking', description: 'Revenue and analytics reports.' });

  const [bookings, subscriptions] = await Promise.all([
    getAllBookings().catch(() => []),
    getAllSubscriptions().catch(() => []),
  ]);

  // Compute revenue from real data
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const monthStart = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = lastMonthDate.toISOString().slice(0, 7);

  const completedBookings = bookings.filter(b => b.status === 'completed' || b.status === 'active');
  const getDateStr = b => b.dates?.dropOff || b.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || '';

  const todayRevenue = completedBookings.filter(b => getDateStr(b).startsWith(todayStr)).reduce((s, b) => s + (b.estimatedPrice || 0), 0);
  const weekRevenue = completedBookings.filter(b => getDateStr(b) >= weekAgo).reduce((s, b) => s + (b.estimatedPrice || 0), 0);
  const monthRevenue = completedBookings.filter(b => getDateStr(b).startsWith(monthStart)).reduce((s, b) => s + (b.estimatedPrice || 0), 0);
  const lastMonthRevenue = completedBookings.filter(b => getDateStr(b).startsWith(lastMonthStr)).reduce((s, b) => s + (b.estimatedPrice || 0), 0);
  const subRevenue = subscriptions.filter(s => s.status === 'active').reduce((s, sub) => s + (sub.monthlyRate || 0), 0);
  const totalMonth = monthRevenue + subRevenue;
  const totalLastMonth = lastMonthRevenue || 1;
  const monthlyGrowth = Math.round(((totalMonth - totalLastMonth) / totalLastMonth) * 100);

  // Breakdown
  const shortTerm = completedBookings.filter(b => {
    const d1 = new Date(b.dates?.dropOff), d2 = new Date(b.dates?.pickUp);
    return (d2 - d1) / 86400000 <= 7;
  });
  const longTerm = completedBookings.filter(b => {
    const d1 = new Date(b.dates?.dropOff), d2 = new Date(b.dates?.pickUp);
    return (d2 - d1) / 86400000 > 7;
  });
  const shortTermRev = shortTerm.reduce((s, b) => s + (b.estimatedPrice || 0), 0);
  const longTermRev = longTerm.reduce((s, b) => s + (b.estimatedPrice || 0), 0);

  const breakdownRows = [
    { cat: t('admin.shortTermParking'), rev: shortTermRev, txn: shortTerm.length, avg: shortTerm.length ? Math.round(shortTermRev / shortTerm.length) : 0 },
    { cat: t('admin.longTermParking'), rev: longTermRev, txn: longTerm.length, avg: longTerm.length ? Math.round(longTermRev / longTerm.length) : 0 },
    { cat: t('admin.commuterSubs'), rev: subRevenue, txn: subscriptions.filter(s => s.status === 'active').length, avg: subRevenue ? Math.round(subRevenue / (subscriptions.filter(s => s.status === 'active').length || 1)) : 0 },
  ];
  const totalRev = breakdownRows.reduce((s, r) => s + r.rev, 0);
  const totalTxn = breakdownRows.reduce((s, r) => s + r.txn, 0);

  const months = t('admin.months');

  const page = AdminLayout('/admin/reports', `
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.reports')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('admin.reportsSubtitle')}</p>
          </div>
          <button class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2" data-export-csv>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
            ${t('admin.exportCsv')}
          </button>
        </div>

        <!-- Revenue Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.today')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${todayRevenue.toLocaleString()} <span class="text-dim text-sm font-normal">lei</span></p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.thisWeek')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${weekRevenue.toLocaleString()} <span class="text-dim text-sm font-normal">lei</span></p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.thisMonth')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${totalMonth.toLocaleString()} <span class="text-dim text-sm font-normal">lei</span></p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.monthlyGrowth')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono ${monthlyGrowth >= 0 ? 'text-leaf' : 'text-red-500'}">${monthlyGrowth >= 0 ? '+' : ''}${monthlyGrowth}%</p>
          </div>
        </div>

        <!-- Charts Placeholder -->
        <div class="grid lg:grid-cols-2 gap-6 mb-8">
          <div class="card-solid rounded-2xl p-6">
            <h2 class="font-heading font-bold text-lg text-charcoal mb-4">${t('admin.revenueLast12')}</h2>
            <div class="h-64 bg-frost rounded-xl flex items-end justify-between px-4 pb-4 gap-2" data-chart-revenue>
              ${Array.from({ length: 12 }, (_, i) => {
                const m = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
                const mStr = m.toISOString().slice(0, 7);
                const mRev = completedBookings.filter(b => getDateStr(b).startsWith(mStr)).reduce((s, b) => s + (b.estimatedPrice || 0), 0);
                const maxH = 180;
                const h = Math.max(4, Math.min(maxH, mRev / 100));
                return `<div class="flex flex-col items-center gap-1 flex-1">
                  <div class="w-full bg-mango/80 rounded-t-md transition-all hover:bg-mango" style="height:${h}px" title="${months[m.getMonth()] || ''}: ${mRev} lei"></div>
                  <span class="text-[10px] font-mono text-dim">${months[m.getMonth()] || ''}</span>
                </div>`;
              }).join('')}
            </div>
            <p class="text-[12px] text-dim mt-3 text-center">${t('admin.chartPlaceholder')}</p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <h2 class="font-heading font-bold text-lg text-charcoal mb-4">${t('admin.occupancyLast30')}</h2>
            <div class="h-64 bg-frost rounded-xl flex items-end px-2 pb-4 gap-px" data-chart-occupancy>
              ${Array.from({ length: 30 }, (_, i) => {
                const val = 60 + Math.round(Math.random() * 35);
                return `<div class="flex-1 ${val > 90 ? 'bg-red-400' : val > 75 ? 'bg-mango/70' : 'bg-leaf/60'} rounded-t-sm transition-all hover:opacity-80" style="height:${val * 2}px" title="Day ${i + 1}: ${val}%"></div>`;
              }).join('')}
            </div>
            <p class="text-[12px] text-dim mt-3 text-center">${t('admin.chartPlaceholder')}</p>
          </div>
        </div>

        <!-- Revenue Breakdown -->
        <div class="card-solid rounded-2xl overflow-hidden">
          <div class="px-6 py-4 border-b border-frost-deep">
            <h2 class="font-heading font-bold text-lg text-charcoal">${t('admin.revenueBreakdown')}</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-frost-deep">
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.category')}</th>
                  <th class="text-right text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.revenueLei')}</th>
                  <th class="text-right text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.transactions')}</th>
                  <th class="text-right text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.avgValue')}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-frost-deep/60">
                ${breakdownRows.map(row => `
                  <tr class="hover:bg-frost transition-colors">
                    <td class="px-6 py-4 text-[15px] font-medium text-charcoal">${row.cat}</td>
                    <td class="px-6 py-4 text-right font-mono text-[15px] font-semibold">${row.rev.toLocaleString()}</td>
                    <td class="px-6 py-4 text-right font-mono text-[14px] text-dim">${row.txn}</td>
                    <td class="px-6 py-4 text-right font-mono text-[14px] text-dim">${row.avg}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-frost-deep bg-frost">
                  <td class="px-6 py-4 text-[15px] font-bold text-charcoal">${t('admin.total')}</td>
                  <td class="px-6 py-4 text-right font-mono text-[15px] font-bold">${totalRev.toLocaleString()}</td>
                  <td class="px-6 py-4 text-right font-mono text-[14px] font-semibold">${totalTxn}</td>
                  <td class="px-6 py-4 text-right font-mono text-[14px] font-semibold">${totalTxn ? Math.round(totalRev / totalTxn) : 0}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
  `);

  // Export CSV with real data
  delegate(page, 'click', '[data-export-csv]', () => {
    const header = 'Category,Revenue,Transactions,AvgValue';
    const rows = breakdownRows.map(r => `${r.cat},${r.rev},${r.txn},${r.avg}`);
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mango-parking-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Wire mobile admin nav
  initAdminNav(page);

  container.appendChild(page);
}
