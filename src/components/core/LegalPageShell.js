import { Navbar } from './Navbar.js';
import { Footer } from './Footer.js';
import { html } from '../../utils/dom.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { SITE_NAME, COMPANY_LEGAL_NAME, COMPANY_ADDRESS, CUI, REG_COM, CONTACT_EMAIL, DPO_EMAIL, SITE_URL } from '../../utils/constants.js';
import { getLegalPage } from '../../services/legalPageService.js';

// Interpolate {site}, {company}, {address}, {cui}, {regcom}, {email}, {dpo} in body text.
function interp(str) {
  return String(str || '')
    .replaceAll('{site}', SITE_NAME)
    .replaceAll('{company}', COMPANY_LEGAL_NAME)
    .replaceAll('{address}', COMPANY_ADDRESS)
    .replaceAll('{cui}', CUI)
    .replaceAll('{regcom}', REG_COM)
    .replaceAll('{email}', CONTACT_EMAIL)
    .replaceAll('{dpo}', DPO_EMAIL);
}

// Minimal escape so admin-pasted text can't inject script tags. We still
// preserve paragraph breaks (\n\n → </p><p>) and single newlines (→ <br>).
function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function paraify(s) {
  const paras = String(s || '').split(/\n\s*\n/);
  return paras.map((p) => `<p>${interp(escape(p)).replace(/\n/g, '<br>')}</p>`).join('');
}

function renderInto(container, slug, content) {
  const sectionsHtml = (content.sections || []).map((s) => `
    <section class="mb-8">
      <h2 class="font-heading font-bold text-2xl text-blueberry-deep mb-3">${escape(s.heading)}</h2>
      <div class="text-charcoal leading-relaxed space-y-3">${paraify(s.body)}</div>
    </section>
  `).join('');

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-28 pb-16 bg-frost min-h-screen">
      <div class="max-w-3xl mx-auto px-6">
        <a href="${localePath('/')}" class="text-dim hover:text-blueberry text-[14px] inline-block mb-6">${t('legal.backHome')}</a>

        <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${escape(content.title)}</h1>
        <p class="text-dim text-[13px] mb-10">${t('legal.lastUpdated')}: ${escape(content.lastUpdatedISO || '')}</p>

        <div class="text-charcoal leading-relaxed text-[16px] mb-10 space-y-3">${paraify(content.intro)}</div>

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

  // Replace any prior render of this page (fast first paint of i18n
  // defaults, then async swap with Firestore overrides).
  container.innerHTML = '';
  container.appendChild(page);
}

/**
 * Shared layout for all legal pages (Terms, Privacy, GDPR, Delivery, Cancellation).
 *
 * Renders the i18n defaults immediately for fast first paint and SEO
 * prerender, then asynchronously checks Firestore for an admin-edited
 * override and re-renders if one is found. This keeps the prerendered
 * HTML in sync with the in-repo defaults while letting ops change copy
 * without a deploy.
 *
 * Caller passes its `slug` (matches the Firestore doc ID) plus the
 * default `title` / `intro` / `sections` from i18n. Admin edits at
 * `/admin/legal` write back to `legalPages/{slug}`.
 */
export function renderLegalPage(container, { slug, title, intro, sections, lastUpdatedISO = '2026-05-15' }) {
  const defaults = { title, intro, sections, lastUpdatedISO };

  // First paint from i18n defaults — keeps the prerender pipeline working
  // and gives the user something to read before Firestore responds.
  renderInto(container, slug, defaults);

  // Then attempt the override. If the admin hasn't edited the page yet,
  // or Firestore errors, the defaults stay visible.
  if (slug) {
    getLegalPage(slug, getLocale())
      .then((override) => {
        if (!override) return;
        renderInto(container, slug, {
          title: override.title || defaults.title,
          intro: override.intro || defaults.intro,
          sections: Array.isArray(override.sections) && override.sections.length
            ? override.sections
            : defaults.sections,
          lastUpdatedISO: override.lastUpdatedISO || defaults.lastUpdatedISO,
        });
      })
      .catch(() => { /* silently keep defaults */ });
  }
}

export { interp, SITE_URL };
