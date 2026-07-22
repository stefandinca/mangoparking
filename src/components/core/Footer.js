import { html, escapeHtml } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import {
  CONTACT_PHONE, CONTACT_EMAIL, CONTACT_ADDRESS,
  COMPANY_LEGAL_NAME, CUI, REG_COM, COMPANY_ADDRESS,
  ANPC_SAL_URL, ANPC_SOL_URL,
} from '../../utils/constants.js';
import { getOpeningHours, OPENING_DAYS } from '../../services/openingHoursService.js';

// Strip everything except digits — for tel:/wa.me URLs.
const PHONE_DIGITS = CONTACT_PHONE.replace(/[^\d]/g, '');

// Collapse the per-day opening hours into grouped footer lines: contiguous days
// sharing the same hours render as one "Monday–Friday: 09:00–18:00" line, with
// the Sat+Sun run labelled "Weekends". Showing the whole week (vs only today)
// stops a closed day from reading as permanently closed.
function groupedHoursLines(hours) {
  const groups = [];
  for (const k of OPENING_DAYS) {
    const d = hours[k] || {};
    const value = d.closed ? t('openingHours.closed') : `${d.open}–${d.close}`;
    const prev = groups[groups.length - 1];
    if (prev && prev.value === value) prev.days.push(k);
    else groups.push({ value, days: [k] });
  }
  return groups.map((g) => {
    const first = g.days[0];
    const last = g.days[g.days.length - 1];
    let label;
    if (g.days.length === 1) label = t('openingHours.' + first);
    else if (first === 'sat' && last === 'sun') label = t('openingHours.weekend');
    else label = `${t('openingHours.' + first)}–${t('openingHours.' + last)}`;
    return { label, value: g.value };
  });
}

export function Footer() {
  const year = new Date().getFullYear();

  const footer = html`
    <footer class="pt-16 pb-8">
      <div class="max-w-7xl mx-auto px-6">
        <!-- Columns -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10 mb-12">
          <!-- Brand -->
          <div class="col-span-2 md:col-span-1">
            <div class="flex items-center gap-2.5 mb-3">
              <img src="/images/logo.png" alt="ManGO Parking" class="w-10 h-10 object-contain" />
              <div>
                <div class="font-heading font-bold text-[16px] leading-none">ManGO Parking</div>
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
              <div data-footer-hours class="space-y-0.5"><p>${t('openingHours.office')}</p></div>
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

          <!-- Netopia (payments) — official hosted iframe. color param
               matches our frost surface (#FFF8E8), merchant ID in secret. -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-2">${t('footer.payments')}</p>
            <iframe src="https://mny.ro/npId.html?color=%23FFF8E8&version=orizontal&secret=163420" title="NETOPIA Payments" loading="lazy" class="block w-[180px] h-[72px] border-0"></iframe>
            <p class="text-[12px] text-dim mt-1">${t('footer.netopia')}</p>
          </div>

          <!-- ANPC (mandatory consumer protection notices) — official banners -->
          <div>
            <p class="text-[11px] font-mono uppercase text-charcoal/25 tracking-[0.15em] mb-2">${t('footer.anpc')}</p>
            <div class="flex items-center gap-3 flex-wrap">
              <a href="${ANPC_SAL_URL}" target="_blank" rel="noopener noreferrer" title="${t('footer.anpcSal')}" class="inline-block hover:opacity-80 transition-opacity">
                <img src="/images/sal.png" alt="${t('footer.anpcSal')}" class="h-14 w-auto" />
              </a>
              <a href="${ANPC_SOL_URL}" target="_blank" rel="noopener noreferrer" title="${t('footer.anpcSol')}" class="inline-block hover:opacity-80 transition-opacity">
                <img src="/images/sol.png" alt="${t('footer.anpcSol')}" class="h-14 w-auto" />
              </a>
            </div>
          </div>
        </div>

        <!-- Copyright -->
        <div class="border-t border-frost-deep pt-6">
          <p class="text-[13px] text-charcoal/40 text-center">${t('footer.copyright', { year })}</p>
        </div>

        <!-- Spacer so content above the mobile contact bar isn't hidden -->
        <div class="h-16 md:hidden" aria-hidden="true"></div>
      </div>
    </footer>

    <!-- Mobile contact bar — fixed bottom, mobile only -->
    <div class="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-frost-deep shadow-lg md:hidden">
      <div class="grid grid-cols-2 gap-px bg-frost-deep">
        <a href="tel:${CONTACT_PHONE.replace(/\s/g, '')}" class="flex items-center justify-center gap-2 bg-white py-3 text-charcoal font-semibold text-[14px] active:bg-frost transition-colors">
          <svg class="w-5 h-5 text-blueberry" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/>
          </svg>
          <span>${t('contact.callBtn')}</span>
        </a>
        <a href="https://wa.me/${PHONE_DIGITS}" target="_blank" rel="noopener" class="flex items-center justify-center gap-2 bg-white py-3 text-charcoal font-semibold text-[14px] active:bg-frost transition-colors">
          <svg class="w-5 h-5 text-leaf" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          <span>WhatsApp</span>
        </a>
      </div>
    </div>
  `;

  // Patch the office block with the full grouped week once loaded (cached
  // service) — not just today, which read as permanently closed on a closed day.
  const hoursEl = footer.querySelector('[data-footer-hours]');
  if (hoursEl) {
    getOpeningHours().then((hours) => {
      const lines = groupedHoursLines(hours);
      hoursEl.innerHTML = `<p class="text-charcoal/70">${escapeHtml(t('openingHours.office'))}:</p>`
        + lines.map((l) => `<p>${escapeHtml(l.label)}: ${escapeHtml(l.value)}</p>`).join('')
        + `<p class="pt-1.5 text-charcoal/70">${escapeHtml(t('openingHours.callNote'))}`
        + ` <a class="font-medium text-blueberry hover:text-blueberry-hover transition-colors whitespace-nowrap" href="tel:${PHONE_DIGITS}">${escapeHtml(CONTACT_PHONE)}</a></p>`;
    }).catch(() => {});
  }

  return footer;
}
