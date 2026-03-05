import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getPricingTiers, getAddOns, getCommuterRate, updateTier, updateAddOn } from '../../services/pricingService.js';
import { updateDocument } from '../../firebase/db.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';

export default async function AdminPricing(container) {
  updateMeta({ title: `${t('admin.pricing')} — Admin — Mango Parking`, description: t('admin.pricingSubtitle') });

  const [tiers, addons, commuterRate] = await Promise.all([
    getPricingTiers(),
    getAddOns(),
    getCommuterRate(),
  ]);

  const page = AdminLayout('/admin/pricing', `
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
                ${tiers.map((tier, i) => {
                  const range = tier.maxDays >= 999 ? `${tier.minDays}+ days` : `${tier.minDays}–${tier.maxDays} days`;
                  const exampleDays = [2, 5, 10, 20, 45][i] || tier.minDays;
                  return `
                  <tr class="hover:bg-frost/50 transition-colors">
                    <td class="px-6 py-4 text-[15px] font-medium text-charcoal">${range}</td>
                    <td class="px-6 py-4">
                      <input type="number" value="${tier.pricePerDay}" class="w-24 px-3 py-1.5 rounded-lg border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-tier-id="${tier.id}" data-tier-price="${i}">
                    </td>
                    <td class="px-6 py-4 font-mono text-[14px] text-dim">${exampleDays} ${t('admin.daysEquals')} <span class="font-semibold text-charcoal">${exampleDays * tier.pricePerDay} lei</span></td>
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
                <input type="number" value="${commuterRate}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-commuter-monthly>
              </div>
              <div>
                <label class="text-[13px] font-mono uppercase tracking-[0.12em] text-dim mb-2 block">${t('admin.annualRateLei')}</label>
                <input type="number" value="${commuterRate * 10}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-commuter-annual>
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
                ${addons.map((addon, i) => `
                  <tr class="hover:bg-frost/50 transition-colors">
                    <td class="px-6 py-4 text-[15px] font-medium text-charcoal">${addon.name}</td>
                    <td class="px-6 py-4">
                      <input type="number" value="${addon.price}" step="0.5" class="w-24 px-3 py-1.5 rounded-lg border border-frost-deep bg-white text-[15px] font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-addon-id="${addon.id}" data-addon-price="${i}">
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
  `);

  // Save button — persist all changes
  delegate(page, 'click', '[data-save-pricing]', async () => {
    let hasError = false;
    // Update tiers
    for (const tier of tiers) {
      const input = page.querySelector(`[data-tier-id="${tier.id}"]`);
      if (input) {
        const newPrice = Number(input.value);
        if (newPrice !== tier.pricePerDay) {
          try { await updateTier(tier.id, { pricePerDay: newPrice }); }
          catch { hasError = true; }
        }
      }
    }
    // Update add-ons
    for (const addon of addons) {
      const input = page.querySelector(`[data-addon-id="${addon.id}"]`);
      if (input) {
        const newPrice = Number(input.value);
        if (newPrice !== addon.price) {
          try { await updateAddOn(addon.id, { price: newPrice }); }
          catch { hasError = true; }
        }
      }
    }
    // Update commuter rate
    const monthlyInput = page.querySelector('[data-commuter-monthly]');
    if (monthlyInput) {
      const newRate = Number(monthlyInput.value);
      if (newRate !== commuterRate) {
        try { await updateDocument('settings', 'global', { commuterMonthlyRate: newRate }); }
        catch { hasError = true; }
      }
    }
    if (!hasError) {
      const confirm = page.querySelector('[data-save-confirm]');
      confirm.classList.remove('hidden');
      confirm.classList.add('flex');
      setTimeout(() => {
        confirm.classList.add('hidden');
        confirm.classList.remove('flex');
      }, 3000);
    }
  });

  // Wire mobile admin nav
  initAdminNav(page);

  container.appendChild(page);
}
