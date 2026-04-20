import { html } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { CONTACT_PHONE, CONTACT_EMAIL, CONTACT_ADDRESS } from '../../utils/constants.js';

export function Footer() {
  const year = new Date().getFullYear();

  return html`
    <footer class="py-16">
      <div class="max-w-7xl mx-auto px-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 md:gap-10 mb-16">
          <div class="col-span-1">
            <div class="flex items-center gap-2.5 mb-3">
              <img src="/images/logo.png" alt="Mango Parking" class="w-10 h-10 object-contain" />
              <div>
                <div class="font-heading font-bold text-[16px] leading-none">Mango Parking</div>
                <div class="text-[11px] text-dim mt-1">— safe &amp; smart parking —</div>
              </div>
            </div>
            <p class="text-dim text-[14px] leading-relaxed">${t('footer.description')}</p>
          </div>
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-4">${t('footer.navigate')}</p>
            <div class="space-y-2.5 text-[14px] text-dim">
              <a href="${localePath('/')}" class="block hover:text-charcoal transition-colors">${t('nav.howItWorks')}</a>
              <a href="${localePath('/pricing')}" class="block hover:text-charcoal transition-colors">${t('nav.pricing')}</a>
              <a href="${localePath('/shuttle')}" class="block hover:text-charcoal transition-colors">${t('shuttle.viewFull').replace(' →', '')}</a>
              <a href="${localePath('/about')}" class="block hover:text-charcoal transition-colors">${t('nav.faq')}</a>
            </div>
          </div>
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-4">${t('footer.contact')}</p>
            <div class="space-y-2.5 text-[14px] text-dim">
              <p><a href="tel:${CONTACT_PHONE.replace(/\s/g, '')}">${CONTACT_PHONE}</a></p>
              <p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
              <p>${CONTACT_ADDRESS}</p>
            </div>
          </div>
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-4">${t('footer.hours')}</p>
            <div class="space-y-2.5 text-[14px] text-dim">
              <p>${t('footer.parking247')}</p>
              <p>${t('footer.office')}</p>
              <p>${t('footer.shuttleEvery15')}</p>
            </div>
          </div>
        </div>
        <div class="flex flex-col md:flex-row justify-between items-center gap-4 pt-8 border-t border-frost-deep">
          <p class="text-[13px] text-charcoal/20">${t('footer.copyright', { year })}</p>
          <div class="flex gap-6 text-[13px] text-charcoal/20">
            <a href="#" class="hover:text-charcoal/40 transition-colors">${t('footer.privacy')}</a>
            <a href="#" class="hover:text-charcoal/40 transition-colors">${t('footer.terms')}</a>
          </div>
        </div>
      </div>
    </footer>
  `;
}
