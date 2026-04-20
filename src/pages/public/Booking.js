import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { checkIcon } from '../../components/widgets/icons.js';

// Funnel picker. Landed at /booking. The two CTAs also live in the home
// hero and route directly to the deep-linked sub-flows.
export default function Booking(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('funnel.pageTitle')} — Mango Parking`,
    description: t('funnel.pageSubtitle'),
    lang: locale,
  });

  const card = (variant) => {
    const data = t('funnel.' + variant);
    const route = variant === 'longTerm' ? '/booking/long-term' : '/booking/credits';
    return `
      <a href="${localePath(route)}" class="group block bg-white rounded-3xl p-8 md:p-10 shadow-lg hover:shadow-2xl transition-shadow border-2 border-transparent hover:border-blueberry">
        <div class="flex items-start gap-3 mb-4">
          <div class="w-12 h-12 rounded-2xl bg-blueberry/10 flex items-center justify-center shrink-0">
            <span class="font-heading font-bold text-blueberry text-xl">${variant === 'longTerm' ? '✈' : '⟲'}</span>
          </div>
          <div>
            <h2 class="font-heading font-bold text-2xl text-blueberry-deep tracking-tight">${data.title}</h2>
            <p class="text-dim text-[14px] mt-0.5">${data.tagline}</p>
          </div>
        </div>
        <p class="text-charcoal text-[15px] leading-relaxed mb-6">${data.description}</p>
        <ul class="space-y-2 mb-8">
          ${data.features.map(f => `
            <li class="flex items-center gap-2 text-[14px] text-charcoal/70">
              <span class="text-leaf">${checkIcon}</span>${f}
            </li>
          `).join('')}
        </ul>
        <span class="inline-block bg-mango group-hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-6 py-3 rounded-2xl transition-colors">${data.cta} →</span>
      </a>
    `;
  };

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-20 bg-frost min-h-screen">
      <div class="max-w-5xl mx-auto px-6">
        <div class="text-center mb-12">
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${t('funnel.pageTitle')}</h1>
          <p class="text-dim text-[17px]">${t('funnel.pageSubtitle')}</p>
        </div>
        <div class="grid md:grid-cols-2 gap-6">
          ${card('longTerm')}
          ${card('commuter')}
        </div>
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  container.appendChild(page);
}
