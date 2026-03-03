import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getPricingTiers, getAddOns, getCommuterRate } from '../../services/pricingService.js';
import { checkIcon } from '../../components/widgets/icons.js';

export default async function Pricing(container) {
  const locale = getLocale();
  updateMeta({
    title: locale === 'ro' ? 'Tarife — Mango Parking' : 'Pricing — Mango Parking',
    description: locale === 'ro'
      ? 'Tarife parcare Otopeni. De la 25 lei/zi pentru sejururi lungi. Abonament navetiști 500 lei/lună.'
      : 'Otopeni parking pricing. From 25 lei/day for long stays. Commuter subscription 500 lei/month.',
    lang: locale,
  });

  const tiers = await getPricingTiers();
  const addons = await getAddOns();
  const commuterRate = getCommuterRate();

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-24 md:pt-32 pb-20">
      <div class="max-w-4xl mx-auto px-6">
        <div class="text-center mb-16">
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('pricing.label')}</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] mb-4">${t('pricing.pageTitle')}</h1>
          <p class="text-dim text-[17px] max-w-lg mx-auto">${t('pricing.pageSubtitle')}</p>
        </div>

        <!-- Traveler Tiers -->
        <div class="mb-16">
          <h2 class="font-heading text-2xl font-bold mb-6">${t('pricing.travelerPricing')}</h2>
          <div class="card-solid rounded-3xl overflow-hidden">
            <div class="grid grid-cols-3 text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-4 sm:px-8 py-4 border-b border-frost-deep">
              <span>${t('booking.duration')}</span>
              <span class="text-center">${t('pricing.perDay')}</span>
              <span class="text-right"></span>
            </div>
            <div class="divide-y divide-frost-deep/60">
              ${tiers.map((tier, i) => `
                <div class="grid grid-cols-3 items-center px-4 sm:px-8 py-5 ${i === tiers.length - 1 ? 'bg-mango/[0.03]' : ''}">
                  <span class="text-[15px] font-medium">${tier.minDays}–${tier.maxDays > 100 ? '∞' : tier.maxDays} ${t('pricing.days')}</span>
                  <span class="text-center font-mono font-semibold text-lg">${tier.pricePerDay} <span class="text-dim text-[13px] font-normal">lei${t('pricing.perDay')}</span></span>
                  <span class="text-right">${i === tiers.length - 1 ? `<span class="text-[11px] font-bold bg-mango/10 text-mango px-3 py-1 rounded-full uppercase">${t('pricing.bestValue')}</span>` : ''}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Add-ons -->
        <div class="mb-16">
          <h2 class="font-heading text-2xl font-bold mb-2">${t('pricing.addOns')}</h2>
          <p class="text-dim text-[15px] mb-6">${t('pricing.addOnsNote')}</p>
          <div class="grid sm:grid-cols-3 gap-4">
            ${addons.map(a => `
              <div class="card-solid rounded-2xl p-6 text-center">
                <p class="font-heading font-semibold text-[16px] mb-1">${locale === 'ro' && a.nameRo ? a.nameRo : a.name}</p>
                <p class="font-mono font-bold text-xl text-mango">${a.price} lei</p>
                <p class="text-dim text-[13px] mt-1">${a.type === 'per_day' ? t('pricing.perDayAddon') : t('pricing.oneTime')}</p>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Commuter -->
        <div class="bg-charcoal rounded-3xl p-6 sm:p-10 text-center relative overflow-hidden">
          <div class="absolute -top-3 right-8 bg-mango text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md">${t('pricing.onlyAtMango')}</div>
          <h2 class="font-heading text-2xl font-bold text-white mb-2">${t('pricing.commuterPricing')}</h2>
          <div class="flex items-baseline justify-center gap-2 mb-4">
            <span class="font-heading font-bold text-6xl text-white">${commuterRate}</span>
            <span class="text-white/40 text-lg">${t('pricing.leiMonth')}</span>
          </div>
          <p class="text-white/30 text-[15px] mb-6">${t('pricing.commuterTerms')}</p>
          <p class="text-white/20 text-[14px] mb-8">${t('pricing.commuterSavings', { amount: '600+' })}</p>
          <a href="${localePath('/booking')}" class="inline-block bg-mango hover:bg-mango-hover text-white font-semibold text-[16px] px-10 py-4 rounded-2xl transition-colors shadow-md">${t('pricing.subscribeNow')}</a>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  container.appendChild(page);
}
