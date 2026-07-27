import { escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { showToast } from '../../components/core/Toast.js';
import {
  LEGAL_SLUGS, getLegalPageRaw, saveLegalPage,
} from '../../services/legalPageService.js';

// /admin/legal — edit the customer-facing legal pages without a deploy.
//
// Layout:
//   [Locale toggle: RO | EN]
//   [Slug tabs: Terms · Privacy · GDPR · Delivery · Cancellation]
//   [Editor form for the selected slug + locale]
//     - Title
//     - Intro (paragraph block)
//     - Sections: dynamic array of {heading, body} with add/remove/reorder
//     - "Last updated" date
//     - Save
//
// Saved content lives at legalPages/{slug}. The public legal pages fall
// back to the i18n defaults shipped with the build when no doc exists,
// so an empty Firestore + a deployed site still renders correct copy.

function freshSection() {
  return { heading: '', body: '' };
}

export default async function AdminLegal(container) {
  updateMeta({ title: `${t('admin.legal')} — Admin`, lang: getLocale() });
  const shell = AdminLayout('/admin/legal', '<div data-section-root></div>');
  initAdminNav(shell);
  container.appendChild(shell);
  await mountLegal(shell.querySelector('[data-section-root]'));
}

// Mountable legal-pages editor — reused standalone (above) and as a tab in the
// Public website admin page (AdminWebsite.js). `page` is the host container.
export async function mountLegal(page) {
  // Cache of {slug: rawDoc} loaded from Firestore. Edits live in
  // `working[slug][locale]` until saved.
  const docs = {};
  const working = {};
  await Promise.all(LEGAL_SLUGS.map(async (slug) => {
    docs[slug] = await getLegalPageRaw(slug).catch(() => null);
  }));

  let activeSlug = LEGAL_SLUGS[0];
  let editLocale = 'ro';

  function snapshotFor(slug, loc) {
    if (working[slug]?.[loc]) return working[slug][loc];
    const fromDoc = docs[slug]?.[loc];
    if (fromDoc) {
      return {
        title: fromDoc.title || '',
        intro: fromDoc.intro || '',
        sections: Array.isArray(fromDoc.sections) ? fromDoc.sections.map((s) => ({ ...s })) : [],
        lastUpdatedISO: fromDoc.lastUpdatedISO || new Date().toISOString().slice(0, 10),
      };
    }
    return {
      title: '',
      intro: '',
      sections: [freshSection(), freshSection()],
      lastUpdatedISO: new Date().toISOString().slice(0, 10),
    };
  }

  function content() {
    const snap = snapshotFor(activeSlug, editLocale);
    return `
      <div class="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.legal')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.legalSubtitle')}</p>
        </div>
        <div class="flex items-center gap-1 bg-frost rounded-xl p-1" data-locale-toggle>
          <button data-locale="ro" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold ${editLocale === 'ro' ? 'bg-white text-charcoal shadow-sm' : 'text-dim hover:text-charcoal'} transition-colors">Română</button>
          <button data-locale="en" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold ${editLocale === 'en' ? 'bg-white text-charcoal shadow-sm' : 'text-dim hover:text-charcoal'} transition-colors">English</button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 mb-6" data-slug-tabs>
        ${LEGAL_SLUGS.map((slug) => `
          <button data-slug="${slug}" class="px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${slug === activeSlug ? 'bg-blueberry text-white' : 'bg-frost text-dim hover:text-charcoal'}">${t('legal.' + slug + 'Title')}</button>
        `).join('')}
      </div>

      <form class="card-solid rounded-2xl p-6 space-y-5" data-legal-form>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('admin.legalTitle')}</label>
          <input name="title" value="${escapeHtml(snap.title)}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('admin.legalIntro')}</label>
          <textarea name="intro" rows="4" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-body focus:outline-none focus:border-blueberry">${escapeHtml(snap.intro)}</textarea>
          <p class="text-[12px] text-dim mt-1">${t('admin.legalParaHint')}</p>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-[13px] font-medium text-charcoal/70">${t('admin.legalSections')}</label>
            <button type="button" data-add-section class="text-[13px] text-blueberry hover:underline font-semibold">${t('admin.legalAddSection')}</button>
          </div>
          <div class="space-y-3" data-sections>
            ${snap.sections.map((s, i) => `
              <div class="rounded-xl border border-frost-deep p-3 bg-white" data-section-idx="${i}">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[11px] font-mono uppercase tracking-wider text-dim">${t('admin.legalSection')} ${i + 1}</span>
                  <div class="flex items-center gap-2">
                    <button type="button" data-move-up class="text-[12px] text-dim hover:text-charcoal" ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" data-move-down class="text-[12px] text-dim hover:text-charcoal" ${i === snap.sections.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" data-remove-section class="text-[12px] text-danger hover:underline">${t('common.delete')}</button>
                  </div>
                </div>
                <input name="heading" value="${escapeHtml(s.heading)}" placeholder="${t('admin.legalHeading')}" class="w-full px-3 py-2 mb-2 rounded-lg border border-frost-deep bg-white text-[14px] font-semibold focus:outline-none focus:border-blueberry">
                <textarea name="body" rows="6" placeholder="${t('admin.legalBody')}" class="w-full px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-body focus:outline-none focus:border-blueberry">${escapeHtml(s.body)}</textarea>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('admin.legalLastUpdated')}</label>
          <input name="lastUpdatedISO" type="date" value="${escapeHtml(snap.lastUpdatedISO)}" class="px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-blueberry">
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-frost-deep">
          <p class="text-[12px] text-dim">${t('admin.legalSlug')}: <span class="font-mono">${activeSlug}</span> · ${t('admin.legalLocale')}: <span class="font-mono uppercase">${editLocale}</span></p>
          <button type="submit" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('common.save')}</button>
        </div>
      </form>
    `;
  }

  // Wrap content in a sentinel <div data-legal-root> so re-renders can
  // swap innerHTML cleanly without touching the AdminLayout's <main>
  // wrapper (which holds the page padding + scrolling).
  page.innerHTML = `<div data-legal-root>${content()}</div>`;

  function rerender() {
    const root = page.querySelector('[data-legal-root]');
    if (!root) return;
    root.innerHTML = content();
    wireForm();
  }

  function captureForm() {
    const form = page.querySelector('[data-legal-form]');
    if (!form) return null;
    const sections = [...form.querySelectorAll('[data-section-idx]')].map((el) => ({
      heading: el.querySelector('input[name="heading"]').value,
      body: el.querySelector('textarea[name="body"]').value,
    }));
    return {
      title: form.querySelector('input[name="title"]').value,
      intro: form.querySelector('textarea[name="intro"]').value,
      sections,
      lastUpdatedISO: form.querySelector('input[name="lastUpdatedISO"]').value,
    };
  }

  function wireForm() {
    // Slug tabs
    page.querySelector('[data-slug-tabs]')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-slug]');
      if (!btn) return;
      // Save in-progress edits to working state before switching.
      const current = captureForm();
      if (current) {
        working[activeSlug] = working[activeSlug] || { ro: snapshotFor(activeSlug, 'ro'), en: snapshotFor(activeSlug, 'en') };
        working[activeSlug][editLocale] = current;
      }
      activeSlug = btn.dataset.slug;
      rerender();
    });

    // Locale toggle
    page.querySelector('[data-locale-toggle]')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-locale]');
      if (!btn) return;
      const current = captureForm();
      if (current) {
        working[activeSlug] = working[activeSlug] || { ro: snapshotFor(activeSlug, 'ro'), en: snapshotFor(activeSlug, 'en') };
        working[activeSlug][editLocale] = current;
      }
      editLocale = btn.dataset.locale === 'en' ? 'en' : 'ro';
      rerender();
    });

    // Section controls
    page.querySelector('[data-sections]')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const row = btn.closest('[data-section-idx]');
      if (!row && !btn.matches('[data-add-section]')) return;
      const current = captureForm();
      if (!current) return;
      const idx = row ? Number(row.dataset.sectionIdx) : -1;
      if (btn.matches('[data-remove-section]')) {
        current.sections.splice(idx, 1);
      } else if (btn.matches('[data-move-up]') && idx > 0) {
        const [s] = current.sections.splice(idx, 1);
        current.sections.splice(idx - 1, 0, s);
      } else if (btn.matches('[data-move-down]') && idx < current.sections.length - 1) {
        const [s] = current.sections.splice(idx, 1);
        current.sections.splice(idx + 1, 0, s);
      }
      working[activeSlug] = working[activeSlug] || { ro: snapshotFor(activeSlug, 'ro'), en: snapshotFor(activeSlug, 'en') };
      working[activeSlug][editLocale] = current;
      rerender();
    });
    page.querySelector('[data-add-section]')?.addEventListener('click', () => {
      const current = captureForm();
      if (!current) return;
      current.sections.push(freshSection());
      working[activeSlug] = working[activeSlug] || { ro: snapshotFor(activeSlug, 'ro'), en: snapshotFor(activeSlug, 'en') };
      working[activeSlug][editLocale] = current;
      rerender();
    });

    // Save
    page.querySelector('[data-legal-form]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = captureForm();
      if (!payload) return;
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      const original = submitBtn.textContent;
      submitBtn.textContent = t('common.loading');
      try {
        await saveLegalPage(activeSlug, editLocale, payload);
        // Refresh local cache so subsequent slug switches show the new value.
        docs[activeSlug] = await getLegalPageRaw(activeSlug).catch(() => docs[activeSlug]);
        working[activeSlug] = docs[activeSlug] ? {
          ro: snapshotFor(activeSlug, 'ro'),
          en: snapshotFor(activeSlug, 'en'),
        } : working[activeSlug];
        showToast(t('admin.legalSavedToast'), 'success');
      } catch (err) {
        console.error('saveLegalPage', err);
        showToast(err?.message || t('common.error'), 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = original;
      }
    });
  }

  wireForm();
}
