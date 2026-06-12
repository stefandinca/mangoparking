import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { checkIcon } from '../../components/widgets/icons.js';

export default function About(container) {
  const locale = getLocale();

  updateMeta({
    title: locale === 'ro' ? 'Despre Noi — ManGO Parking' : 'About Us — ManGO Parking',
    description: locale === 'ro'
      ? 'Despre ManGO Parking — parcare securizată lângă Aeroportul Otopeni cu microbuz gratuit și acces cu barieră.'
      : 'About ManGO Parking — secure parking near Otopeni Airport with free shuttle and gated access.',
    lang: locale,
  });

  const securityFeatures = t('about.securityFeatures');

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-32 pb-20">
      <div class="max-w-4xl mx-auto px-6">
        <!-- Hero -->
        <div class="text-center mb-20">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('about.pageTitle')}</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-6">${t('about.heroTitle')}</h1>
          <p class="text-dim text-[18px] max-w-xl mx-auto">${t('about.heroSubtitle')}</p>
        </div>

        <!-- Story -->
        <div class="mb-20">
          <h2 class="font-heading text-2xl font-bold mb-6">${t('about.story')}</h2>
          <p class="text-dim text-[16px] leading-relaxed">${t('about.storyText')}</p>
        </div>

        <!-- Security -->
        <div class="mb-20">
          <h2 class="font-heading text-2xl font-bold mb-6">${t('about.securityTitle')}</h2>
          <div class="card-solid rounded-3xl p-8">
            <div class="grid md:grid-cols-2 gap-4">
              ${(Array.isArray(securityFeatures) ? securityFeatures : []).map(f => `
                <div class="flex items-center gap-3">
                  <span class="text-leaf">${checkIcon}</span>
                  <span class="text-[16px]">${f}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Amenities -->
        <div class="mb-20">
          <h2 class="font-heading text-2xl font-bold mb-6">${t('about.amenitiesTitle')}</h2>
          <div class="grid sm:grid-cols-3 gap-4">
            ${[
              { label: t('amenities.shuttle'), sub: t('amenities.shuttleSub') },
              { label: t('amenities.security'), sub: t('amenities.securitySub') },
              { label: t('amenities.luggage'), sub: t('amenities.luggageSub') },
            ].map(a => `
              <div class="card-solid rounded-2xl p-5">
                <p class="font-heading font-semibold text-[16px]">${a.label}</p>
                <p class="text-dim text-[14px] mt-1">${a.sub}</p>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Gallery -->
        <div>
          <h2 class="font-heading text-2xl font-bold mb-6">${t('gallery.label')}</h2>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
            ${[
              { src: '/images/welcome.jpg', alt: 'ManGO Parking facility' },
              { src: '/images/gate.jpg', alt: 'Automatic gate access' },
              { src: '/images/bus.jpg', alt: 'Free ManGO shuttle' },
            ].map(({ src, alt }) => `
              <div class="rounded-2xl overflow-hidden h-48">
                <img src="${src}" alt="${alt}" class="img-cover hover:scale-105 transition-transform duration-700" loading="lazy">
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  container.appendChild(page);
}
