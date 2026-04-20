import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getTokenPacks } from '../../services/tokenService.js';

export default async function Pricing(container) {
  const locale = getLocale();

  updateMeta({
    title: locale === 'ro' ? 'Tarife Credite — Mango Parking' : 'Credits Pricing — Mango Parking',
    description: locale === 'ro'
      ? 'Cumpără credite de parcare la Aeroportul Otopeni. Prețuri simple și transparente.'
      : 'Buy parking credits at Otopeni Airport. Simple, transparent pricing.',
    lang: locale,
  });

  const packs = await getTokenPacks().catch(() => []);
  const bestPack = packs.reduce((best, p) => (!best || p.quantity > best.quantity) ? p : best, null);

  const packCards = packs.map(p => {
    const isBest = p.id === bestPack?.id;
    const name = locale === 'ro' && p.nameRo ? p.nameRo : p.name;
    return `
      <div class="relative card-solid rounded-2xl p-8 text-center ${isBest ? 'ring-2 ring-mango shadow-lg' : ''}">
        ${isBest ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold bg-mango text-charcoal px-4 py-1 rounded-full">${t('credit.bestValue')}</span>` : ''}
        <p class="font-heading font-bold text-4xl tracking-tight mb-1">${p.quantity}</p>
        <p class="text-dim text-[14px] mb-4">${t('credit.plural')}</p>
        <p class="font-mono text-2xl font-bold text-mango mb-4">${p.price} lei</p>
        <a href="${localePath('/booking')}" class="inline-block w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('credit.buyTokens')}</a>
      </div>
    `;
  }).join('');

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-32 pb-20">
      <div class="max-w-5xl mx-auto px-6">
        <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${t('credit.pricingTitle')}</h1>
        <p class="text-dim text-[17px] mb-12 max-w-2xl">${t('credit.pricingSubtitle')}</p>

        <!-- Pack cards -->
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          ${packCards}
        </div>

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
          <a href="${localePath('/booking')}" class="inline-block bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-8 py-4 rounded-2xl transition-colors shadow-md">${t('credit.buyTokens')}</a>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  container.appendChild(page);
}
