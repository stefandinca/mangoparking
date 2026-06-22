// /admin/website — "Public website": one admin home for front-end content.
//
// Tabs:
//   • Gallery      — the homepage "Our facility" photos (upload/caption/order/delete)
//   • Opening hours — per-day office hours (shown on Contact + Footer)
//   • Promotions   — the existing /promotions editor (mounted as a tab)
//   • Reviews      — the existing reviews editor (mounted as a tab)
//   • Legal        — the existing legal-pages editor (mounted as a tab)
//
// Gallery + Hours are built inline here. Promotions/Reviews/Legal reuse the
// extracted mount<X>() functions from their own page modules (their standalone
// routes still work). Tab panels are mounted lazily on first open and cached
// (so the Quill editor and any unsaved edits survive a tab switch).

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { t, getLocale } from '../../i18n/index.js';
import { escapeHtml, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { showToast } from '../../components/core/Toast.js';
import { confirmModal } from '../../components/core/Modal.js';
import { uploadGalleryImage } from '../../firebase/storage.js';
import {
  getGalleryImages, addGalleryImage, updateGalleryImage, deleteGalleryImage,
} from '../../services/galleryService.js';
import { getOpeningHours, saveOpeningHours, OPENING_DAYS } from '../../services/openingHoursService.js';

const TABS = [
  { key: 'gallery',    labelKey: 'website.tabGallery' },
  { key: 'hours',      labelKey: 'website.tabHours' },
  { key: 'promotions', labelKey: 'website.tabPromotions' },
  { key: 'reviews',    labelKey: 'website.tabReviews' },
  { key: 'legal',      labelKey: 'website.tabLegal' },
];

export default async function AdminWebsite(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('admin.website')} — Admin — ManGO Parking`, description: t('admin.websiteSubtitle'), lang: locale });

  const params = new URLSearchParams(window.location.search);
  let activeTab = TABS.some((x) => x.key === params.get('tab')) ? params.get('tab') : 'gallery';

  function tabBtn(tab) {
    const active = tab.key === activeTab;
    const cls = active ? 'bg-blueberry text-white' : 'bg-frost text-charcoal/70 hover:bg-frost-deep';
    return `<button type="button" data-website-tab="${tab.key}" class="px-4 py-2 rounded-xl text-[14px] font-semibold transition-colors ${cls}">${t(tab.labelKey)}</button>`;
  }

  const content = `
    <div class="mb-6">
      <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.website')}</h1>
      <p class="text-dim text-[15px] mt-1">${t('admin.websiteSubtitle')}</p>
    </div>
    <div class="flex flex-wrap gap-2 mb-6" data-website-tabs>${TABS.map(tabBtn).join('')}</div>
    <div data-website-panel></div>
  `;

  const page = AdminLayout('/admin/website', content);
  initAdminNav(page);
  container.appendChild(page);

  const panel = page.querySelector('[data-website-panel]');
  const mounted = {}; // key -> host element (cached once mounted)

  async function showTab(key) {
    activeTab = key;
    page.querySelectorAll('[data-website-tab]').forEach((b) => {
      const on = b.dataset.websiteTab === key;
      b.classList.toggle('bg-blueberry', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('bg-frost', !on);
      b.classList.toggle('text-charcoal/70', !on);
      b.classList.toggle('hover:bg-frost-deep', !on);
    });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    window.history.replaceState({}, '', url.toString());

    panel.innerHTML = '';
    if (mounted[key]) {
      panel.appendChild(mounted[key]);
      return;
    }
    const host = document.createElement('div');
    mounted[key] = host;
    panel.appendChild(host);
    host.innerHTML = `<p class="text-dim text-center py-8">${t('common.loading')}</p>`;
    try {
      await mountTab(key, host);
    } catch (err) {
      console.error('mount tab', key, err);
      host.innerHTML = `<p class="text-danger text-center py-8">${t('common.error')}</p>`;
    }
  }

  async function mountTab(key, host) {
    if (key === 'gallery') return mountGallery(host);
    if (key === 'hours') return mountHours(host);
    if (key === 'promotions') return (await import('./AdminPromotions.js')).mountPromotions(host);
    if (key === 'reviews') return (await import('./AdminReviews.js')).mountReviews(host);
    if (key === 'legal') return (await import('./AdminLegal.js')).mountLegal(host);
  }

  delegate(page, 'click', '[data-website-tab]', (_e, btn) => { showTab(btn.dataset.websiteTab); });

  showTab(activeTab);
}

// ── Gallery editor ────────────────────────────────────────────────────────
async function mountGallery(host) {
  let images = await getGalleryImages();

  const card = (img) => `
    <div class="card-solid rounded-2xl p-4 flex gap-4 items-start" data-gallery-row data-id="${escapeHtml(img.id)}" data-path="${escapeHtml(img.path || '')}">
      <img src="${escapeHtml(img.url)}" alt="" class="w-28 h-20 object-cover rounded-lg shrink-0 bg-frost-deep">
      <div class="flex-1 min-w-0 space-y-2">
        <input data-field="caption" value="${escapeHtml(img.caption || '')}" placeholder="${escapeHtml(t('website.galleryCaption'))}" class="w-full px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px]">
        <div class="flex items-center gap-3">
          <label class="text-[12px] text-dim">${t('website.gallerySort')}
            <input data-field="sortOrder" type="number" value="${img.sortOrder ?? 100}" class="ml-1 w-20 px-2 py-1 rounded-lg border border-frost-deep bg-white text-[13px] font-mono">
          </label>
          <button type="button" data-gallery-delete class="text-danger hover:bg-danger/5 text-[13px] font-semibold px-3 py-1 rounded-lg ml-auto">${t('common.delete')}</button>
        </div>
      </div>
    </div>`;

  function render() {
    host.innerHTML = `
      <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p class="text-dim text-[14px]">${t('website.gallerySubtitle')}</p>
        <label class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors cursor-pointer">
          ${t('website.galleryAdd')}
          <input type="file" accept="image/*" multiple data-gallery-upload class="hidden">
        </label>
      </div>
      <div class="space-y-3" data-gallery-list>
        ${images.length ? images.map(card).join('') : `<p class="text-dim text-center py-8">${t('website.galleryEmpty')}</p>`}
      </div>`;
  }
  render();

  host.addEventListener('change', async (e) => {
    // New uploads
    if (e.target.matches('[data-gallery-upload]')) {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      showToast(t('website.galleryUploading'), 'info');
      try {
        let nextSort = images[images.length - 1]?.sortOrder || 100;
        for (const file of files) {
          const { url, path } = await uploadGalleryImage(file);
          nextSort += 10;
          await addGalleryImage({ url, path, caption: '', sortOrder: nextSort });
        }
        images = await getGalleryImages();
        render();
        showToast(t('website.gallerySaved'), 'success');
      } catch (err) {
        console.error('gallery upload', err);
        showToast(err?.message || t('common.error'), 'error');
      }
      return;
    }
    // Caption / sort edits
    const row = e.target.closest('[data-gallery-row]');
    if (row && e.target.dataset.field) {
      const field = e.target.dataset.field;
      const value = field === 'sortOrder' ? (Number(e.target.value) || 0) : e.target.value;
      try { await updateGalleryImage(row.dataset.id, { [field]: value }); }
      catch (err) { console.error(err); showToast(t('common.error'), 'error'); }
    }
  });

  delegate(host, 'click', '[data-gallery-delete]', async (_e, btn) => {
    const row = btn.closest('[data-gallery-row]');
    const ok = await confirmModal(t('website.galleryDeleteConfirm'), { danger: true, confirmText: t('common.delete') });
    if (!ok) return;
    try {
      await deleteGalleryImage(row.dataset.id, row.dataset.path);
      images = images.filter((x) => x.id !== row.dataset.id);
      render();
      showToast(t('website.galleryDeleted'), 'success');
    } catch (err) { console.error(err); showToast(t('common.error'), 'error'); }
  });
}

// ── Opening hours editor ──────────────────────────────────────────────────
async function mountHours(host) {
  const hours = await getOpeningHours();

  host.innerHTML = `
    <p class="text-dim text-[14px] mb-5">${t('website.hoursSubtitle')}</p>
    <form class="card-solid rounded-2xl p-6 space-y-3 max-w-2xl" data-hours-form>
      ${OPENING_DAYS.map((k) => {
        const d = hours[k];
        return `
        <div class="grid grid-cols-[90px_1fr_1fr_auto] items-center gap-2 sm:gap-3" data-day="${k}">
          <span class="text-[14px] font-medium">${t('openingHours.' + k)}</span>
          <input data-h="open" type="time" value="${escapeHtml(d.open)}" ${d.closed ? 'disabled' : ''} class="px-2 sm:px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono ${d.closed ? 'opacity-40' : ''}">
          <input data-h="close" type="time" value="${escapeHtml(d.close)}" ${d.closed ? 'disabled' : ''} class="px-2 sm:px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono ${d.closed ? 'opacity-40' : ''}">
          <label class="flex items-center gap-1.5 text-[13px] cursor-pointer whitespace-nowrap">
            <input data-h="closed" type="checkbox" ${d.closed ? 'checked' : ''} class="accent-mango"> ${t('openingHours.closed')}
          </label>
        </div>`;
      }).join('')}
      <div class="flex justify-end pt-3 border-t border-frost-deep">
        <button type="submit" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('common.save')}</button>
      </div>
    </form>`;

  // Toggle the time inputs when a day is marked closed.
  host.addEventListener('change', (e) => {
    if (e.target.dataset.h !== 'closed') return;
    const row = e.target.closest('[data-day]');
    const closed = e.target.checked;
    row.querySelectorAll('[data-h="open"],[data-h="close"]').forEach((inp) => {
      inp.disabled = closed;
      inp.classList.toggle('opacity-40', closed);
    });
  });

  host.querySelector('[data-hours-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {};
    host.querySelectorAll('[data-day]').forEach((row) => {
      payload[row.dataset.day] = {
        open: row.querySelector('[data-h="open"]').value || '08:00',
        close: row.querySelector('[data-h="close"]').value || '20:00',
        closed: row.querySelector('[data-h="closed"]').checked,
      };
    });
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = t('common.loading');
    try {
      await saveOpeningHours(payload);
      showToast(t('website.hoursSaved'), 'success');
    } catch (err) {
      console.error('saveOpeningHours', err);
      showToast(err?.message || t('common.error'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}
