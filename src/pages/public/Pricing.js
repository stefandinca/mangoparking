import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getTokenPacks } from '../../services/tokenService.js';
import { getLongTermRates } from '../../services/longTermService.js';
import { getOnlineDiscountPercent, originalFromOnline } from '../../services/discountService.js';

export default async function Pricing(container) {
  const locale = getLocale();

  updateMeta({
    title: locale === 'ro' ? 'Tarife — ManGO Parking' : 'Pricing — ManGO Parking',
    description: locale === 'ro'
      ? 'Tarife parcare aeroport pe tranșe și parcare navetiști la Aeroportul Otopeni.'
      : 'Airport parking tiered rates and commuter credits at Otopeni Airport.',
    lang: locale,
  });

  const [packs, rates, discount] = await Promise.all([
    getTokenPacks().catch(() => []),
    getLongTermRates().catch(() => ({ tiers: [] })),
    getOnlineDiscountPercent().catch(() => 0),
  ]);
  const bestPack = packs.reduce((best, p) => (!best || p.quantity > best.quantity) ? p : best, null);

  // Render an online price with an optional strikethrough "original" anchor.
  // The discount is explained once per section (below), not crammed into
  // each card, so the cards stay clean.
  function priceBlock(online, suffix = 'lei') {
    const original = originalFromOnline(online, discount);
    const hasAnchor = original != null && original !== online;
    return `
      ${hasAnchor ? `<p class="font-mono text-[14px] text-dim line-through leading-none mb-1">${original} ${suffix}</p>` : ''}
      <p class="font-mono text-2xl font-bold text-blueberry-deep leading-none">${online} ${suffix}</p>
    `;
  }

  // A single green "online discount" caption, shown under each priced grid.
  const discountNote = discount > 0
    ? `<p class="text-[13px] text-leaf font-medium mb-6 flex items-center gap-1.5">
         <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
         <span>${t('discount.online', { percent: discount })}</span>
       </p>`
    : '';

  const packCards = packs.map(p => {
    const isBest = p.id === bestPack?.id;
    const name = locale === 'ro' && p.nameRo ? p.nameRo : p.name;
    const perDay = p.quantity > 0 ? Math.round(p.price / p.quantity) : p.price;
    return `
      <div class="relative overflow-hidden rounded-2xl bg-white border ${isBest ? 'border-mango ring-1 ring-mango' : 'border-frost-deep'} shadow-sm flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <div class="absolute inset-y-0 left-0 w-1.5 ${isBest ? 'bg-mango' : 'bg-blueberry'}"></div>
        ${isBest ? `<span class="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-wider bg-mango text-charcoal px-2.5 py-1 rounded-full">${t('credit.bestValue')}</span>` : ''}
        <div class="p-6 pl-7 flex flex-col flex-1">
          ${name ? `<p class="text-[11px] uppercase tracking-wider text-dim font-mono truncate ${isBest ? 'pr-24' : ''}">${name}</p>` : ''}
          <div class="flex items-baseline gap-1.5 mt-0.5">
            <span class="font-heading font-bold text-5xl text-blueberry-deep leading-none">${p.quantity}</span>
            <span class="text-dim text-[15px] font-medium">${t('credit.plural')}</span>
          </div>
          <p class="text-dim text-[13px] mt-2">≈ ${perDay} ${t('longTerm.perDay')}</p>
          <div class="mt-5 pt-5 border-t border-frost-deep">${priceBlock(p.price)}</div>
          <a href="${localePath('/booking/credits')}" class="mt-6 block text-center bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('credit.buyTokens')}</a>
        </div>
      </div>
    `;
  }).join('');

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-32 pb-20">
      <div class="max-w-5xl mx-auto px-6">
        <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${locale === 'ro' ? 'Tarife' : 'Pricing'}</h1>
        <p class="text-dim text-[17px] mb-12 max-w-2xl">${locale === 'ro' ? 'Două planuri. Alegi ce ți se potrivește.' : 'Two plans. Pick what fits.'}</p>

        <!-- Long-term tiers -->
        <h2 class="font-heading font-bold text-2xl text-blueberry-deep mb-2">${t('funnel.longTerm.title')}</h2>
        <p class="text-dim text-[15px] mb-6">${t('longTerm.tierNote')}</p>
        <div class="grid sm:grid-cols-3 gap-4 mb-6">
          ${rates.tiers.map((tier) => {
            const original = originalFromOnline(tier.perDay, discount);
            const showAnchor = original != null && original !== tier.perDay;
            const range = `${tier.minDays}${tier.maxDays ? `–${tier.maxDays}` : '+'} ${t('longTerm.days')}`;
            return `
            <div class="relative overflow-hidden rounded-2xl bg-white border border-frost-deep shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div class="absolute inset-y-0 left-0 w-1.5 bg-blueberry"></div>
              <div class="p-5 pl-6">
                <p class="text-[11px] uppercase tracking-wider text-dim font-mono">${range}</p>
                ${showAnchor ? `<p class="font-mono text-[13px] text-dim line-through leading-none mt-2.5">${original}</p>` : ''}
                <div class="flex items-baseline gap-1 ${showAnchor ? 'mt-0.5' : 'mt-2.5'}">
                  <span class="font-heading font-bold text-4xl text-blueberry-deep leading-none">${tier.perDay}</span>
                  <span class="text-dim text-[14px]">${t('longTerm.perDay')}</span>
                </div>
              </div>
            </div>
          `;}).join('')}
        </div>
        ${discountNote}
        <a href="${localePath('/booking/long-term')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-8 py-3.5 rounded-xl transition-colors shadow-sm mb-14">${t('funnel.longTerm.cta')} →</a>

        <!-- Credit packs -->
        <h2 class="font-heading font-bold text-2xl text-blueberry-deep mb-2">${t('funnel.commuter.title')}</h2>
        <p class="text-dim text-[15px] mb-6">${t('credit.pricingSubtitle')}</p>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          ${packCards}
        </div>
        ${discountNote}
        <div class="mb-12"></div>

        <!-- How tokens work -->
        <div class="card-solid rounded-2xl p-8 mb-16">
          <h2 class="font-heading font-bold text-2xl mb-6">${t('credit.howItWorks')}</h2>
          <div class="grid sm:grid-cols-2 gap-4">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-mango/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg class="w-4 h-4 text-mango" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <p class="text-[15px]">${t('credit.rule1')}</p>
            </div>
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-mango/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg class="w-4 h-4 text-mango" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <p class="text-[15px]">${t('credit.rule2')}</p>
            </div>
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-leaf/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg class="w-4 h-4 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>
              </div>
              <p class="text-[15px]">${t('credit.rule3')}</p>
            </div>
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-leaf/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg class="w-4 h-4 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21"/></svg>
              </div>
              <p class="text-[15px]">${t('credit.rule4')}</p>
            </div>
          </div>
        </div>

        <!-- CTA -->
        <div class="text-center">
          <a href="${localePath('/booking/credits')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[16px] px-8 py-4 rounded-2xl transition-colors shadow-md">${t('credit.buyTokens')}</a>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  container.appendChild(page);
}
