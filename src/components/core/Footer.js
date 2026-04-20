import { html } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import {
  CONTACT_PHONE, CONTACT_EMAIL, CONTACT_ADDRESS,
  COMPANY_LEGAL_NAME, CUI, REG_COM, COMPANY_ADDRESS,
  ANPC_SAL_URL, ANPC_SOL_URL,
} from '../../utils/constants.js';

export function Footer() {
  const year = new Date().getFullYear();

  return html`
    <footer class="pt-16 pb-8">
      <div class="max-w-7xl mx-auto px-6">
        <!-- Columns -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10 mb-12">
          <!-- Brand -->
          <div class="col-span-2 md:col-span-1">
            <div class="flex items-center gap-2.5 mb-3">
              <img src="/images/logo.png" alt="Mango Parking" class="w-10 h-10 object-contain" />
              <div>
                <div class="font-heading font-bold text-[16px] leading-none">Mango Parking</div>
                <div class="text-[11px] text-dim mt-1">— safe &amp; smart parking —</div>
              </div>
            </div>
            <p class="text-dim text-[14px] leading-relaxed">${t('footer.description')}</p>
          </div>

          <!-- Navigate -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-4">${t('footer.navigate')}</p>
            <div class="space-y-2.5 text-[14px] text-dim">
              <a href="${localePath('/')}" class="block hover:text-blueberry transition-colors">${t('nav.howItWorks')}</a>
              <a href="${localePath('/pricing')}" class="block hover:text-blueberry transition-colors">${t('nav.pricing')}</a>
              <a href="${localePath('/shuttle')}" class="block hover:text-blueberry transition-colors">${t('shuttle.viewFull').replace(' →', '')}</a>
              <a href="${localePath('/about')}" class="block hover:text-blueberry transition-colors">${t('nav.faq')}</a>
              <a href="${localePath('/contact')}" class="block hover:text-blueberry transition-colors">${t('footer.contact')}</a>
            </div>
          </div>

          <!-- Legal -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-4">${t('footer.legal')}</p>
            <div class="space-y-2.5 text-[14px] text-dim">
              <a href="${localePath('/terms')}" class="block hover:text-blueberry transition-colors">${t('footer.terms')}</a>
              <a href="${localePath('/privacy')}" class="block hover:text-blueberry transition-colors">${t('footer.privacy')}</a>
              <a href="${localePath('/gdpr')}" class="block hover:text-blueberry transition-colors">${t('footer.gdpr')}</a>
              <a href="${localePath('/delivery')}" class="block hover:text-blueberry transition-colors">${t('footer.delivery')}</a>
              <a href="${localePath('/cancellation')}" class="block hover:text-blueberry transition-colors">${t('footer.cancellation')}</a>
            </div>
          </div>

          <!-- Contact + Hours -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-4">${t('footer.contact')}</p>
            <div class="space-y-2 text-[14px] text-dim">
              <p><a class="hover:text-blueberry transition-colors" href="tel:${CONTACT_PHONE.replace(/\s/g, '')}">${CONTACT_PHONE}</a></p>
              <p><a class="hover:text-blueberry transition-colors" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
              <p>${CONTACT_ADDRESS}</p>
              <p class="pt-2">${t('footer.parking247')}</p>
              <p>${t('footer.shuttleEvery15')}</p>
            </div>
          </div>
        </div>

        <!-- Compliance band: company info + payments + ANPC -->
        <div class="border-t border-frost-deep pt-8 pb-6 grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          <!-- Company identification (Netopia/ANPC requirement) -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-3">${t('footer.company')}</p>
            <div class="text-[13px] text-dim leading-relaxed">
              <p class="font-semibold text-charcoal">${COMPANY_LEGAL_NAME}</p>
              <p>${t('footer.cui')}: ${CUI} &nbsp;·&nbsp; ${t('footer.regCom')}: ${REG_COM}</p>
              <p>${COMPANY_ADDRESS}</p>
            </div>
          </div>

          <!-- Netopia (payments) -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-3">${t('footer.payments')}</p>
            <a href="https://netopia-payments.com" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/images/netopia-logo.svg" alt="Netopia Payments" class="h-8 w-auto" onerror="this.style.display='none'; this.nextElementSibling?.classList.remove('hidden')" />
              <span class="hidden font-heading font-bold text-blueberry-deep text-[15px]">NETOPIA Payments</span>
            </a>
            <p class="text-[12px] text-dim mt-2">${t('footer.netopia')}</p>
          </div>

          <!-- ANPC (mandatory consumer protection notices) -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-3">${t('footer.anpc')}</p>
            <div class="flex items-center gap-4 flex-wrap">
              <a href="${ANPC_SAL_URL}" target="_blank" rel="noopener noreferrer" title="${t('footer.anpcSal')}" class="inline-flex items-center gap-2 text-[12px] text-dim hover:text-blueberry transition-colors">
                <img src="/images/anpc-sal.png" alt="" class="h-8 w-auto" onerror="this.style.display='none'" />
                <span>${t('footer.anpcSal')}</span>
              </a>
              <a href="${ANPC_SOL_URL}" target="_blank" rel="noopener noreferrer" title="${t('footer.anpcSol')}" class="inline-flex items-center gap-2 text-[12px] text-dim hover:text-blueberry transition-colors">
                <img src="/images/anpc-sol.png" alt="" class="h-8 w-auto" onerror="this.style.display='none'" />
                <span>${t('footer.anpcSol')}</span>
              </a>
            </div>
          </div>
        </div>

        <!-- Copyright -->
        <div class="border-t border-frost-deep pt-6">
          <p class="text-[13px] text-charcoal/40 text-center">${t('footer.copyright', { year })}</p>
        </div>
      </div>
    </footer>
  `;
}
