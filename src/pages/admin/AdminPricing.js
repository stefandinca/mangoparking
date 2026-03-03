import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';

const PRICING_TIERS = [
  { range: '1–3 days', perDay: 49 },
  { range: '4–7 days', perDay: 39 },
  { range: '8–14 days', perDay: 34 },
  { range: '15–30 days', perDay: 29 },
  { range: '30+ days', perDay: 25 },
];

const ADDONS = [
  { name: 'Car Wash (Exterior)', price: 35 },
  { name: 'Car Wash (Full)', price: 60 },
  { name: 'EV Charging (per kWh)', price: 2.5 },
  { name: 'Covered Spot Upgrade', price: 10 },
];

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

export default function AdminPricing(container) {
  updateMeta({ title: `${t('admin.pricing')} — Admin — Mango Parking`, description: t('admin.pricingSubtitle') });

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
        ${sidebar('/admin/pricing')}
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
            <span>${t('admin.pricing')}</span>
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
            const isActive = link.path === '/admin/pricing';
            return `<a href="${localePath(link.path)}" data-link class="block px-4 py-3 rounded-lg text-[14px] font-medium transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">${t(link.labelKey)}</a>`;
          }).join('')}
        </div>
      </div>
      <div class="p-4 md:p-8">
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('admin.pricing')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('admin.pricingSubtitle')}</p>
          </div>
          <button class="bg-mango hover:bg-mango-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors" data-save-pricing>${t('admin.saveChanges')}</button>
        </div>

        <!-- Traveler Pricing Tiers -->
        <div class="card-solid rounded-2xl overflow-hidden mb-8">
          <div class="px-6 py-4 border-b border-frost-deep">
            <h2 class="font-heading font-bold text-lg text-charcoal">${t('admin.travelerRates')}</h2>
            <p class="text-dim text-[14px]">${t('admin.travelerRatesSubtitle')}</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-frost-deep">
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.duration')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.pricePerDayLei')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.exampleTotal')}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-frost-deep/60">
                ${PRICING_TIERS.map((tier, i) => {
                  const exampleDays = [2, 5, 10, 20, 45][i];
                  return `
                  <tr class="hover:bg-frost/50 transition-colors">
                    <td class="px-6 py-4 text-[15px] font-medium text-charcoal">${tier.range}</td>
                    <td class="px-6 py-4">
                      <input type="number" value="${tier.perDay}" class="w-24 px-3 py-1.5 rounded-lg border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-tier-price="${i}">
                    </td>
                    <td class="px-6 py-4 font-mono text-[14px] text-dim">${exampleDays} ${t('admin.daysEquals')} <span class="font-semibold text-charcoal">${exampleDays * tier.perDay} lei</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Commuter Subscription -->
        <div class="card-solid rounded-2xl overflow-hidden mb-8">
          <div class="px-6 py-4 border-b border-frost-deep">
            <h2 class="font-heading font-bold text-lg text-charcoal">${t('admin.commuterSubscription')}</h2>
            <p class="text-dim text-[14px]">${t('admin.commuterSubSubtitle')}</p>
          </div>
          <div class="p-6">
            <div class="grid grid-cols-2 gap-6">
              <div>
                <label class="text-[13px] font-mono uppercase tracking-[0.12em] text-dim mb-2 block">${t('admin.monthlyRateLei')}</label>
                <input type="number" value="500" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all">
              </div>
              <div>
                <label class="text-[13px] font-mono uppercase tracking-[0.12em] text-dim mb-2 block">${t('admin.annualRateLei')}</label>
                <input type="number" value="5000" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all">
              </div>
            </div>
            <div class="mt-4 p-4 bg-mango/5 rounded-xl border border-mango/10">
              <p class="text-[14px] text-charcoal/70">${t('admin.commuterNote')}</p>
            </div>
          </div>
        </div>

        <!-- Add-ons -->
        <div class="card-solid rounded-2xl overflow-hidden mb-8">
          <div class="px-6 py-4 border-b border-frost-deep">
            <h2 class="font-heading font-bold text-lg text-charcoal">${t('admin.addOnServices')}</h2>
            <p class="text-dim text-[14px]">${t('admin.addOnServicesSubtitle')}</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-frost-deep">
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.service')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.priceLei')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-3">${t('admin.activeCol')}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-frost-deep/60">
                ${ADDONS.map((addon, i) => `
                  <tr class="hover:bg-frost/50 transition-colors">
                    <td class="px-6 py-4 text-[15px] font-medium text-charcoal">${addon.name}</td>
                    <td class="px-6 py-4">
                      <input type="number" value="${addon.price}" step="0.5" class="w-24 px-3 py-1.5 rounded-lg border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all">
                    </td>
                    <td class="px-6 py-4">
                      <button class="w-10 h-6 rounded-full bg-leaf relative transition-colors" data-toggle-addon="${i}">
                        <span class="absolute top-0.5 left-4.5 w-5 h-5 rounded-full bg-white shadow transition-all"></span>
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Save confirmation -->
        <div class="hidden bg-leaf/10 border border-leaf/20 rounded-2xl px-6 py-4 flex items-center gap-3" data-save-confirm>
          <svg class="w-5 h-5 text-leaf shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <p class="text-leaf font-semibold text-[15px]">${t('admin.pricingUpdated')}</p>
        </div>
      </div>
      </div>
    </main>
  </div>`;

  // Save button mock
  delegate(page, 'click', '[data-save-pricing]', () => {
    const confirm = page.querySelector('[data-save-confirm]');
    confirm.classList.remove('hidden');
    confirm.classList.add('flex');
    setTimeout(() => {
      confirm.classList.add('hidden');
      confirm.classList.remove('flex');
    }, 3000);
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
