import { Navbar } from './Navbar.js';
import { Footer } from './Footer.js';
import { html } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { SITE_NAME, COMPANY_LEGAL_NAME, COMPANY_ADDRESS, CUI, REG_COM, CONTACT_EMAIL, DPO_EMAIL, SITE_URL } from '../../utils/constants.js';

// Interpolate {site}, {company}, {address}, {cui}, {regcom}, {email}, {dpo} in body text.
function interp(str) {
  return str
    .replaceAll('{site}', SITE_NAME)
    .replaceAll('{company}', COMPANY_LEGAL_NAME)
    .replaceAll('{address}', COMPANY_ADDRESS)
    .replaceAll('{cui}', CUI)
    .replaceAll('{regcom}', REG_COM)
    .replaceAll('{email}', CONTACT_EMAIL)
    .replaceAll('{dpo}', DPO_EMAIL);
}

/**
 * Shared layout for all legal pages (Terms, Privacy, GDPR, Delivery, Cancellation).
 * Caller passes a title, an intro paragraph, and a list of { heading, body } sections.
 * All strings are already resolved via t() by the caller; this component only interpolates
 * company/contact placeholders.
 */
export function renderLegalPage(container, { title, intro, sections, lastUpdatedISO = '2026-04-20' }) {
  const sectionsHtml = sections.map(s => `
    <section class="mb-8">
      <h2 class="font-heading font-bold text-2xl text-blueberry-deep mb-3">${s.heading}</h2>
      <p class="text-charcoal leading-relaxed">${interp(s.body)}</p>
    </section>
  `).join('');

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-28 pb-16 bg-frost min-h-screen">
      <div class="max-w-3xl mx-auto px-6">
        <a href="${localePath('/')}" class="text-dim hover:text-blueberry text-[14px] inline-block mb-6">${t('legal.backHome')}</a>

        <div class="bg-mango/15 border-2 border-mango rounded-2xl p-4 mb-8 text-[14px] text-charcoal">
          <strong>⚠ ${t('legal.draftBanner')}</strong>
        </div>

        <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${title}</h1>
        <p class="text-dim text-[13px] mb-10">${t('legal.lastUpdated')}: ${lastUpdatedISO}</p>

        <p class="text-charcoal leading-relaxed text-[16px] mb-10">${interp(intro)}</p>

        ${sectionsHtml}

        <div class="mt-12 pt-8 border-t border-frost-deep text-[14px] text-dim">
          ${t('legal.contactForQuestions')} <a href="mailto:${CONTACT_EMAIL}" class="text-blueberry hover:text-blueberry-hover font-semibold">${CONTACT_EMAIL}</a>.
          <div class="mt-3">${COMPANY_LEGAL_NAME} · CUI ${CUI} · ${REG_COM} · ${COMPANY_ADDRESS}</div>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  container.appendChild(page);
}

export { interp, SITE_URL };
