import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { t, getLocale } from '../../i18n/index.js';
import { delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllReviews, createReview, updateReview, deleteReview } from '../../services/reviewService.js';
import { showToast } from '../../components/core/Toast.js';

export default async function AdminReviews(container) {
  updateMeta({ title: `${t('admin.reviews')} — Admin`, lang: getLocale() });

  let reviews = await getAllReviews().catch(() => []);

  function reviewRow(r) {
    return `
      <div class="card-solid rounded-2xl p-5 grid md:grid-cols-12 gap-3 items-center" data-review-id="${r.id}">
        <input data-field="name" value="${escape(r.name)}" placeholder="Name" class="md:col-span-2 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px]">
        <input data-field="rating" type="number" min="1" max="5" value="${r.rating || 5}" class="md:col-span-1 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono">
        <input data-field="comment" value="${escape(r.comment)}" placeholder="${t('reviewsAdmin.comment')}" class="md:col-span-4 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px]">
        <input data-field="date" type="date" value="${r.date?.slice(0, 10) || ''}" class="md:col-span-2 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono">
        <select data-field="type" class="md:col-span-1 px-2 py-2 rounded-lg border border-frost-deep bg-white text-[13px]">
          <option value="traveler" ${r.type === 'traveler' ? 'selected' : ''}>${t('reviews.traveler')}</option>
          <option value="commuter" ${r.type === 'commuter' ? 'selected' : ''}>${t('reviews.commuter')}</option>
        </select>
        <input data-field="sortOrder" type="number" value="${r.sortOrder ?? 100}" title="Sort" class="md:col-span-1 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono">
        <label class="md:col-span-1 flex items-center gap-1.5 text-[13px] cursor-pointer">
          <input data-field="published" type="checkbox" ${r.published !== false ? 'checked' : ''} class="accent-mango">
          ${t('reviewsAdmin.published')}
        </label>
        <button data-save class="md:col-span-12 hidden bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[13px] px-4 py-2 rounded-lg transition-colors">${t('common.save')}</button>
        <button data-delete class="md:col-span-12 text-danger hover:bg-danger/5 text-[13px] font-semibold py-2 rounded-lg transition-colors">${t('common.delete')}</button>
      </div>
    `;
  }

  function renderList() {
    const list = page.querySelector('[data-review-list]');
    list.innerHTML = reviews.map(reviewRow).join('') || `<p class="text-dim text-center py-6">${t('reviewsAdmin.empty')}</p>`;
  }

  const body = `
    <div class="mb-6">
      <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.reviews')}</h1>
      <p class="text-dim mt-1">${t('reviewsAdmin.subtitle')}</p>
    </div>

    <button data-add-review class="mb-5 bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('reviewsAdmin.add')}</button>

    <div class="space-y-3" data-review-list></div>
  `;

  const page = AdminLayout('/admin/reviews', body);
  container.appendChild(page);
  initAdminNav(page);
  renderList();

  page.querySelector('[data-add-review]').addEventListener('click', async () => {
    try {
      const id = await createReview({
        name: 'Nume',
        rating: 5,
        comment: '',
        type: 'traveler',
        date: new Date().toISOString().slice(0, 10),
        published: true,
        sortOrder: (reviews[reviews.length - 1]?.sortOrder || 100) + 10,
      });
      reviews = await getAllReviews().catch(() => []);
      renderList();
      showToast(t('reviewsAdmin.added'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });

  // Per-row save (changes from any field)
  delegate(page, 'change', '[data-review-id] input, [data-review-id] select', async (_e, input) => {
    const row = input.closest('[data-review-id]');
    const id = row.dataset.reviewId;
    const field = input.dataset.field;
    if (!field) return;
    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (field === 'rating' || field === 'sortOrder') value = Number(value) || 0;
    try {
      await updateReview(id, { [field]: value });
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });

  delegate(page, 'click', '[data-delete]', async (_e, btn) => {
    const row = btn.closest('[data-review-id]');
    const id = row.dataset.reviewId;
    if (!window.confirm(t('reviewsAdmin.deleteConfirm'))) return;
    try {
      await deleteReview(id);
      reviews = reviews.filter(r => r.id !== id);
      renderList();
      showToast(t('reviewsAdmin.deleted'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });
}

function escape(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
