import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { showToast } from '../../components/core/Toast.js';
import { getPromotionsPage, savePromotionsPage, bodyToHtml } from '../../services/promotionsService.js';

// /admin/promotions — bilingual editor for the /promotions hero + body.
//
// Three top-level fields:
//   • heroImage (URL, shared across RO + EN)
//   • RO: title, intro (one paragraph), body (rich HTML)
//   • EN: same shape
//
// Body editor: a Quill WYSIWYG (headings, bold/italic/underline/strike,
// text + background colour, alignment, lists, blockquote, links). Content
// is stored as HTML and sanitised on render. Legacy markdown bodies are
// upgraded to HTML on load via `bodyToHtml`.

// Toolbar — the set of formatting options admins get. `clean` strips
// formatting from the selection.
const QUILL_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ align: [] }],
  ['blockquote', 'link'],
  ['clean'],
];

export default async function AdminPromotions(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('admin.promotions')} — Admin — ManGO Parking`,
    description: t('admin.promotionsSubtitle'),
    lang: locale,
  });

  const initial = (await getPromotionsPage()) || {};
  const working = {
    heroImage: initial.heroImage || '',
    ro: {
      title: initial.ro?.title || '',
      intro: initial.ro?.intro || '',
      body: initial.ro?.body || '',
    },
    en: {
      title: initial.en?.title || '',
      intro: initial.en?.intro || '',
      body: initial.en?.body || '',
    },
  };
  let activeTab = 'ro';
  let quill = null;

  function localePane(loc) {
    const data = working[loc];
    return `
      <div class="space-y-4" data-locale-pane="${loc}">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('promotionsEditor.fieldTitle')} (${loc.toUpperCase()})</label>
          <input type="text" data-locale="${loc}" data-field="title" value="${escapeHtml(data.title)}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('promotionsEditor.fieldIntro')} (${loc.toUpperCase()})</label>
          <textarea data-locale="${loc}" data-field="intro" rows="2" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry resize-none">${escapeHtml(data.intro)}</textarea>
        </div>
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-[13px] font-medium text-charcoal/70">${t('promotionsEditor.fieldBody')} (${loc.toUpperCase()})</label>
            <span class="text-[11px] text-dim">${t('promotionsEditor.richtextHint')}</span>
          </div>
          <div data-quill-editor class="bg-white"></div>
        </div>
      </div>
    `;
  }

  const content = `
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.promotions')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('admin.promotionsSubtitle')}</p>
      </div>
      <a href="/promotions" target="_blank" rel="noopener" class="text-[13px] text-blueberry hover:underline font-semibold">${t('promotionsEditor.openPublic')} →</a>
    </div>

    <section class="card-solid rounded-3xl p-6 md:p-8 mb-6">
      <h2 class="font-heading font-bold text-xl text-blueberry-deep mb-1">${t('promotionsEditor.heroTitle')}</h2>
      <p class="text-dim text-[14px] mb-4">${t('promotionsEditor.heroHint')}</p>
      <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('promotionsEditor.fieldHeroImage')}</label>
      <input type="url" data-hero-image value="${escapeHtml(working.heroImage)}" placeholder="https://..." class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono focus:outline-none focus:border-blueberry">
      <div class="mt-4" data-hero-preview-wrap>${heroPreviewHtml(working.heroImage)}</div>
    </section>

    <section class="card-solid rounded-3xl p-6 md:p-8 mb-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="font-heading font-bold text-xl text-blueberry-deep">${t('promotionsEditor.contentTitle')}</h2>
        <div class="flex gap-1 bg-frost rounded-xl p-1" data-locale-tabs>
          <button type="button" data-tab="ro" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-mango text-charcoal">RO</button>
          <button type="button" data-tab="en" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-dim hover:bg-frost-deep">EN</button>
        </div>
      </div>
      <div data-locale-content>${localePane('ro')}</div>
    </section>

    <div class="flex justify-end">
      <button type="button" data-save class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-8 py-3 rounded-xl shadow-md transition-colors">${t('common.save')}</button>
    </div>
  `;

  const page = AdminLayout('/admin/promotions', content);
  initAdminNav(page);
  container.appendChild(page);

  const localeContent = page.querySelector('[data-locale-content]');
  const heroInput = page.querySelector('[data-hero-image]');
  const heroPreviewWrap = page.querySelector('[data-hero-preview-wrap]');

  // Mount a fresh Quill on the body host of the given locale's pane and
  // seed it with that locale's content (legacy markdown is converted to
  // HTML first). The text-change handler keeps `working` in sync.
  function mountEditor(loc) {
    const host = localeContent.querySelector('[data-quill-editor]');
    if (!host) return;
    quill = new Quill(host, {
      theme: 'snow',
      modules: { toolbar: QUILL_TOOLBAR },
      placeholder: t('promotionsEditor.richtextPlaceholder'),
    });
    const seed = bodyToHtml(working[loc].body);
    if (seed) quill.clipboard.dangerouslyPasteHTML(seed);
    quill.on('text-change', () => { working[loc].body = readEditor(); });
  }

  // Read the active editor as HTML, normalising Quill's empty-document
  // sentinel (`<p><br></p>`) back to an empty string so we don't persist
  // noise for a blank locale.
  function readEditor() {
    if (!quill) return working[activeTab].body;
    return quill.getText().trim() ? quill.root.innerHTML : '';
  }

  function bindLocaleInputs(loc) {
    const pane = localeContent.querySelector(`[data-locale-pane="${loc}"]`);
    if (!pane) return;
    pane.querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener('input', () => {
        working[loc][el.dataset.field] = el.value;
      });
    });
  }

  bindLocaleInputs('ro');
  mountEditor('ro');

  // Locale tab switcher — flush the current editor into `working`, swap the
  // pane in place, then rebind inputs + mount a fresh editor for the next
  // locale. (Replacing localeContent.innerHTML discards the old Quill DOM.)
  page.querySelectorAll('[data-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const next = tabBtn.dataset.tab;
      if (next === activeTab) return;
      working[activeTab].body = readEditor();
      quill = null;
      activeTab = next;
      page.querySelectorAll('[data-tab]').forEach((b) => {
        const on = b.dataset.tab === next;
        b.classList.toggle('bg-mango', on);
        b.classList.toggle('text-charcoal', on);
        b.classList.toggle('text-dim', !on);
        b.classList.toggle('hover:bg-frost-deep', !on);
      });
      localeContent.innerHTML = localePane(next);
      bindLocaleInputs(next);
      mountEditor(next);
    });
  });

  heroInput.addEventListener('input', () => {
    const url = heroInput.value.trim();
    working.heroImage = url;
    heroPreviewWrap.innerHTML = heroPreviewHtml(url);
  });

  page.querySelector('[data-save]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    // Flush the visible editor before persisting.
    working[activeTab].body = readEditor();
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = t('common.loading');
    try {
      await savePromotionsPage(working);
      showToast(t('promotionsEditor.saved'), 'success');
    } catch (err) {
      console.error(err);
      showToast(err?.message || t('common.error'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

// Hero preview — mirrors the public page: the whole image is shown
// (object-contain, never cropped), scaled to the container with the
// brand-deep backdrop filling any letterbox space.
function heroPreviewHtml(url) {
  if (!url) {
    return `<div class="text-[13px] text-dim italic">${t('promotionsEditor.heroNoImage')}</div>`;
  }
  return `
    <div class="w-full rounded-2xl overflow-hidden bg-blueberry-deep border border-frost-deep flex items-center justify-center">
      <img src="${escapeHtml(url)}" alt="" class="w-full h-auto max-h-80 object-contain">
    </div>
  `;
}
