import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, getLocale } from '../../i18n/index.js';
import { html, escapeHtml } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getCollection, where } from '../../firebase/db.js';
import { getPromotionsPage, renderPromoBody } from '../../services/promotionsService.js';
import { showToast } from '../../components/core/Toast.js';

// /promotions — public marketing page. Renders an admin-editable hero
// (image + title + intro), an admin-editable markdown body, and a list
// of currently-active public voucher codes the visitor can copy.
//
// Empty content + no active vouchers → friendly fallback rather than
// a blank page.

function isCurrentlyValid(v, todayStr) {
  if (!v.active) return false;
  if (v.startDate && todayStr < v.startDate) return false;
  if (v.endDate && todayStr > v.endDate) return false;
  return true;
}

function valueLabel(v) {
  if (v.type === 'fixed') return `-${v.value} ${t('common.lei')}`;
  if (v.type === 'percent') return `-${v.value}%`;
  if (v.type === 'days') return t('voucher.valueDays', { value: v.value });
  return '—';
}

function voucherCardHtml(v, locale) {
  const fmt = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
        day: '2-digit', month: 'short',
      });
    } catch { return iso; }
  };
  return `
    <div class="card-solid rounded-3xl p-6 border-2 border-mango/40 bg-gradient-to-br from-mango/5 to-frost">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="min-w-0">
          <p class="text-[12px] uppercase tracking-wider text-dim font-mono">${escapeHtml(v.name || '')}</p>
          <p class="font-heading font-bold text-3xl text-blueberry-deep mt-1 font-mono">${escapeHtml(v.code)}</p>
        </div>
        <span class="font-mono font-bold text-2xl text-mango shrink-0">${valueLabel(v)}</span>
      </div>
      <p class="text-[12px] text-dim font-mono mb-4">${fmt(v.startDate)} → ${fmt(v.endDate)}</p>
      <button type="button" data-copy-code="${escapeHtml(v.code)}" class="w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] py-2.5 rounded-xl transition-colors">${t('promotions.copyCode')}</button>
    </div>
  `;
}

// Local day in Europe/Bucharest. The admin's date pickers store dates as
// YYYY-MM-DD without timezone info, so comparing them to a UTC-derived
// "today" mis-buckets late-night and early-morning visitors. Match the
// pricing-validation helper which does the same thing server-side.
function bucharestToday() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export default async function Promotions(container) {
  const locale = getLocale();
  const todayStr = bucharestToday();

  const [page, allPublic] = await Promise.all([
    getPromotionsPage().catch((err) => { console.warn('promotions page fetch failed:', err?.code || err?.message); return null; }),
    getCollection('promoVouchers', where('visibility', '==', 'public')).catch((err) => {
      // Surface permission denials so we can debug without staring at a
      // blank empty state. The catch is still here so a bad rule
      // doesn't crash the whole page — we just render the empty card.
      console.warn('promoVouchers list failed:', err?.code || err?.message);
      return [];
    }),
  ]);

  const activeVouchers = allPublic.filter((v) => isCurrentlyValid(v, todayStr));

  const localized = page?.[locale] || page?.ro || page?.en || null;
  const heroImage = page?.heroImage || '';
  const title = localized?.title || t('promotions.defaultTitle');
  const intro = localized?.intro || t('promotions.defaultIntro');
  const bodyHtml = renderPromoBody(localized?.body || '');

  updateMeta({
    title: `${title} — ManGO Parking`,
    description: intro,
    lang: locale,
  });

  // Hero image is shown in full (object-contain) — never cropped. The image
  // is scaled to the container width and capped in height; the brand-deep
  // backdrop fills any letterboxing for tall/narrow images. Title + intro
  // sit below the image so they never overlap empty letterbox space.
  const heroBlock = heroImage
    ? `<div class="mb-8">
         <div class="w-full rounded-3xl overflow-hidden bg-blueberry-deep flex items-center justify-center">
           <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(title)}" class="w-full h-auto max-h-[70vh] object-contain">
         </div>
         <div class="mt-6 text-center">
           <h1 class="font-heading text-4xl sm:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${escapeHtml(title)}</h1>
           ${intro ? `<p class="text-dim text-[17px] max-w-2xl mx-auto">${escapeHtml(intro)}</p>` : ''}
         </div>
       </div>`
    : `<div class="mb-8 text-center">
         <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('promotions.pretitle')}</p>
         <h1 class="font-heading text-4xl sm:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${escapeHtml(title)}</h1>
         ${intro ? `<p class="text-dim text-[17px] max-w-2xl mx-auto">${escapeHtml(intro)}</p>` : ''}
       </div>`;

  const bodyBlock = bodyHtml
    ? `<div class="richtext max-w-none text-charcoal mb-12">${bodyHtml}</div>`
    : '';

  const vouchersBlock = activeVouchers.length
    ? `<section>
         <h2 class="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-blueberry-deep mb-2">${t('promotions.activeTitle')}</h2>
         <p class="text-dim text-[15px] mb-6">${t('promotions.activeSubtitle')}</p>
         <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
           ${activeVouchers.map((v) => voucherCardHtml(v, locale)).join('')}
         </div>
       </section>`
    : `<section class="card-solid rounded-3xl p-10 text-center">
         <p class="font-heading font-bold text-lg text-blueberry-deep mb-1">${t('promotions.emptyTitle')}</p>
         <p class="text-dim text-[14px]">${t('promotions.emptyHint')}</p>
       </section>`;

  const pageEl = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16 bg-frost min-h-screen">
      <div class="max-w-5xl mx-auto px-4 sm:px-6">
        ${heroBlock}
        ${bodyBlock}
        ${vouchersBlock}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  pageEl.querySelector('[data-navbar]').replaceWith(Navbar());
  pageEl.querySelector('[data-footer]').replaceWith(Footer());

  pageEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    const code = btn.dataset.copyCode;
    try {
      await navigator.clipboard.writeText(code);
      showToast(t('accountVouchers.copied', { code }), 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast(t('accountVouchers.copied', { code }), 'success'); }
      catch { showToast(t('common.error'), 'error'); }
      finally { ta.remove(); }
    }
  });

  container.appendChild(pageEl);
}
