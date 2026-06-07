import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getCommuterRate } from '../../services/pricingService.js';
import { checkIcon } from '../../components/widgets/icons.js';

export default function Commuter(container) {
  const locale = getLocale();
  const rate = getCommuterRate();

  updateMeta({
    title: locale === 'ro' ? 'Abonament Navetiști — ManGO Parking' : 'Commuter Plan — ManGO Parking',
    description: locale === 'ro'
      ? 'Singura parcare cu abonament pentru navetiști la Otopeni. 500 lei/lună, microbuz sincronizat cu trenurile.'
      : 'The only commuter parking subscription at Otopeni. 500 lei/month, shuttle synced with trains.',
    lang: locale,
  });

  const benefits = [
    { key: 'flatRate', icon: '💰' },
    { key: 'shuttle', icon: '🚐' },
    { key: 'guaranteed', icon: '✅' },
    { key: 'security', icon: '🛡️' },
  ];

  const page = html`<div>
    <div data-navbar></div>

    <!-- Hero -->
    <section class="pt-32 pb-20 relative overflow-hidden">
      <div class="hero-glow bg-mango top-20 -left-40"></div>
      <div class="max-w-4xl mx-auto px-6 text-center relative z-10">
        <div class="inline-flex items-center gap-2 bg-mango/10 border border-mango/20 rounded-full px-4 py-1.5 mb-8">
          <span class="text-mango text-[14px] font-semibold">${t('pricing.onlyAtMango')}</span>
        </div>
        <h1 class="font-heading text-4xl md:text-6xl font-bold tracking-[-0.02em] mb-6">${t('commuterPage.heroTitle')}</h1>
        <p class="text-dim text-[18px] max-w-xl mx-auto mb-10">${t('commuterPage.heroSubtitle')}</p>
        <div class="flex items-baseline justify-center gap-2 mb-8">
          <span class="font-heading font-bold text-6xl">${rate}</span>
          <span class="text-dim text-lg">${t('pricing.leiMonth')}</span>
        </div>
        <a href="${localePath('/booking')}" class="inline-block bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-10 py-4 rounded-2xl transition-colors shadow-md">${t('commuterPage.cta')}</a>
      </div>
    </section>

    <!-- Benefits -->
    <section class="py-20">
      <div class="max-w-4xl mx-auto px-6">
        <h2 class="font-heading text-3xl font-bold text-center mb-12">${t('commuterPage.benefits.title')}</h2>
        <div class="grid md:grid-cols-2 gap-6">
          ${benefits.map(b => `
            <div class="card-solid rounded-2xl p-8">
              <h3 class="font-heading font-bold text-lg mb-2">${t('commuterPage.benefits.' + b.key)}</h3>
              <p class="text-dim text-[15px] leading-relaxed">${t('commuterPage.benefits.' + b.key + 'Desc')}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- How It Works -->
    <section class="py-20 bg-frost">
      <div class="max-w-3xl mx-auto px-6">
        <h2 class="font-heading text-3xl font-bold text-center mb-12">${t('commuterPage.howItWorks')}</h2>
        <div class="space-y-4">
          ${[1, 2, 3].map((n, i) => `
            <div class="card-solid rounded-2xl p-6 flex items-center gap-6">
              <div class="w-12 h-12 rounded-2xl bg-mango/10 flex items-center justify-center flex-shrink-0">
                <span class="font-heading font-bold text-lg text-mango">${i + 1}</span>
              </div>
              <p class="text-[16px] font-medium">${t('commuterPage.step' + n)}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="py-20">
      <div class="max-w-2xl mx-auto px-6">
        <h2 class="font-heading text-3xl font-bold text-center mb-12">${t('commuterPage.faq')}</h2>
        <div class="space-y-3">
          ${[5].map(n => `
            <div class="card-solid rounded-2xl overflow-hidden">
              <button class="faq-toggle w-full flex items-center justify-between px-7 py-5 text-left">
                <span class="font-heading font-semibold text-[16px]">${t('faq.q' + n)}</span>
                <span class="text-dim/40 text-xl leading-none" data-icon>+</span>
              </button>
              <div class="faq-body"><div><p class="px-7 pb-5 text-dim text-[15px] leading-relaxed">${t('faq.a' + n)}</p></div></div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="py-16">
      <div class="max-w-3xl mx-auto px-6 text-center">
        <div class="bg-blueberry-deep rounded-3xl p-12">
          <h2 class="font-heading text-3xl font-bold text-white mb-4">${t('cta.title')}</h2>
          <p class="text-white/50 mb-8">${t('cta.subtitle')}</p>
          <a href="${localePath('/booking')}" class="inline-block bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-10 py-4 rounded-2xl transition-colors shadow-md">${t('commuterPage.cta')}</a>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  delegate(page, 'click', '.faq-toggle', (e, btn) => {
    const body = btn.nextElementSibling;
    const icon = btn.querySelector('[data-icon]');
    const isOpen = body.classList.contains('open');
    page.querySelectorAll('.faq-body').forEach(el => el.classList.remove('open'));
    page.querySelectorAll('[data-icon]').forEach(el => el.textContent = '+');
    if (!isOpen) { body.classList.add('open'); icon.textContent = '−'; }
  });

  container.appendChild(page);
}
