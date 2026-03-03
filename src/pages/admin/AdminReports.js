import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';

const REVENUE_DATA = {
  today: 2340,
  thisWeek: 14580,
  thisMonth: 58920,
  lastMonth: 52100,
};

const monthlyGrowth = Math.round(((REVENUE_DATA.thisMonth - REVENUE_DATA.lastMonth) / REVENUE_DATA.lastMonth) * 100);

function sidebar(activePath) {
  const links = [
    { path: '/admin', label: t('admin.dashboard'), icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>' },
    { path: '/admin/bookings', label: t('admin.bookings'), icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>' },
    { path: '/admin/capacity', label: t('admin.capacity'), icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/></svg>' },
    { path: '/admin/pricing', label: t('admin.pricing'), icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/></svg>' },
    { path: '/admin/shuttle', label: t('admin.shuttle'), icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M21 14.25h-.008"/></svg>' },
    { path: '/admin/reports', label: t('admin.reports'), icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg>' },
    { path: '/admin/audit', label: t('admin.audit'), icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"/></svg>' },
  ];

  return links.map(link => {
    const isActive = link.path === activePath;
    return `<a href="${localePath(link.path)}" data-link class="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-colors duration-150 ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">
      ${link.icon}
      <span>${link.label}</span>
    </a>`;
  }).join('');
}

export default function AdminReports(container) {
  updateMeta({ title: 'Reports — Admin — Mango Parking', description: 'Revenue and analytics reports.' });

  const months = t('admin.months');

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
        ${sidebar('/admin/reports')}
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
            <span>${t('admin.reports')}</span>
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
            const isActive = link.path === '/admin/reports';
            return `<a href="${localePath(link.path)}" data-link class="block px-4 py-3 rounded-lg text-[14px] font-medium transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">${t(link.labelKey)}</a>`;
          }).join('')}
        </div>
      </div>
      <div class="p-4 md:p-8">
      <div class="max-w-6xl mx-auto">
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('admin.reports')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('admin.reportsSubtitle')}</p>
          </div>
          <button class="bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2" data-export-csv>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
            ${t('admin.exportCsv')}
          </button>
        </div>

        <!-- Revenue Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.today')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${REVENUE_DATA.today.toLocaleString()} <span class="text-dim text-sm font-normal">lei</span></p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.thisWeek')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${REVENUE_DATA.thisWeek.toLocaleString()} <span class="text-dim text-sm font-normal">lei</span></p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.thisMonth')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${REVENUE_DATA.thisMonth.toLocaleString()} <span class="text-dim text-sm font-normal">lei</span></p>
          </div>
          <div class="card-solid rounded-2xl p-6">
            <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('admin.monthlyGrowth')}</p>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono ${monthlyGrowth >= 0 ? 'text-leaf' : 'text-red-500'}">+${monthlyGrowth}%</p>
          </div>
        </div>

        <!-- Charts Placeholder -->
        <div class="grid lg:grid-cols-2 gap-6 mb-8">
          <div class="card-solid rounded-2xl p-6">
            <h2 class="font-heading font-bold text-lg text-charcoal mb-4">${t('admin.revenueLast12')}</h2>
            <div class="h-64 bg-frost rounded-xl flex items-end justify-between px-4 pb-4 gap-2" data-chart-revenue>
              ${[35, 42, 38, 45, 52, 48, 55, 60, 58, 65, 59, 68].map((val, i) => {
                return `<div class="flex flex-col items-center gap-1 flex-1">
                  <div class="w-full bg-mango/80 rounded-t-md transition-all hover:bg-mango" style="height:${val * 3}px" title="${months[i]}: ${val}k lei"></div>
                  <span class="text-[10px] font-mono text-dim">${months[i]}</span>
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
                ${[
                  { cat: t('admin.shortTermParking'), rev: 28450, txn: 142, avg: 200 },
                  { cat: t('admin.longTermParking'), rev: 18200, txn: 45, avg: 404 },
                  { cat: t('admin.commuterSubs'), rev: 7500, txn: 15, avg: 500 },
                  { cat: t('admin.addOnServicesCat'), rev: 3120, txn: 68, avg: 46 },
                  { cat: t('admin.evCharging'), rev: 1650, txn: 320, avg: 5 },
                ].map(row => `
                  <tr class="hover:bg-frost/50 transition-colors">
                    <td class="px-6 py-4 text-[15px] font-medium text-charcoal">${row.cat}</td>
                    <td class="px-6 py-4 text-right font-mono text-[15px] font-semibold">${row.rev.toLocaleString()}</td>
                    <td class="px-6 py-4 text-right font-mono text-[14px] text-dim">${row.txn}</td>
                    <td class="px-6 py-4 text-right font-mono text-[14px] text-dim">${row.avg}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-frost-deep bg-frost/30">
                  <td class="px-6 py-4 text-[15px] font-bold text-charcoal">${t('admin.total')}</td>
                  <td class="px-6 py-4 text-right font-mono text-[15px] font-bold">${REVENUE_DATA.thisMonth.toLocaleString()}</td>
                  <td class="px-6 py-4 text-right font-mono text-[14px] font-semibold">590</td>
                  <td class="px-6 py-4 text-right font-mono text-[14px] font-semibold">100</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
      </div>
    </main>
  </div>`;

  // Export CSV mock
  delegate(page, 'click', '[data-export-csv]', () => {
    const csvContent = 'Category,Revenue,Transactions,AvgValue\nShort-term,28450,142,200\nLong-term,18200,45,404\nSubscriptions,7500,15,500\nAdd-ons,3120,68,46\nEV Charging,1650,320,5';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mango-parking-report.csv';
    a.click();
    URL.revokeObjectURL(url);
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
