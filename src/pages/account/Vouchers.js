import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, escapeHtml } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getCurrentUser } from '../../firebase/auth.js';
import { getCollection, getDocument, where } from '../../firebase/db.js';
import { accountLayout, initAccountNav } from '../../components/account/AccountLayout.js';
import { showToast } from '../../components/core/Toast.js';
import { giftCodeRedeemCard } from '../../components/widgets/GiftCodeRedeem.js';

// /account/vouchers — customer-facing view of vouchers attached to this
// account. Two sources:
//   1. promoVouchers/{code} where assignedUserIds contains my uid
//      → personal codes the admin has handed out
//   2. vouchers/{uid} → legacy signup bonus (kept until the in-flight
//      balances clear out; new sign-ups don't get one any more)
//
// Each card surfaces the code (copy-to-clipboard), value, validity,
// and current status (active / expired / used). For private promo
// vouchers we cross-reference voucherRedemptions to detect "already
// used" so the user knows the code is spent.

const TODAY = () => new Date().toISOString().slice(0, 10);

function fmtDate(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

// Human-readable headline phrase for the voucher's value.
function valueHeadline(v) {
  if (v.type === 'fixed') return t('voucher.valueFixed', { value: v.value });
  if (v.type === 'percent') return t('voucher.valuePercent', { value: v.value });
  if (v.type === 'days') return t('voucher.valueDays', { value: v.value });
  if (v.type === 'credits') return t('voucher.valueCredits', { value: v.value });
  return '—';
}

const COPY_ICON = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>';

// Returns 'active' | 'upcoming' | 'expired' | 'used' | 'inactive'.
function voucherStatus(v, redemptionsByCode) {
  if (!v.active) return 'inactive';
  if (redemptionsByCode.has(v.code)) return 'used';
  const today = TODAY();
  if (v.startDate && today < v.startDate) return 'upcoming';
  if (v.endDate && today > v.endDate) return 'expired';
  return 'active';
}

function statusBadge(status) {
  const cls = {
    active:   'bg-leaf/10 text-leaf',
    upcoming: 'bg-blueberry/10 text-blueberry',
    used:     'bg-gray-100 text-dim',
    expired:  'bg-red-100 text-red-500',
    inactive: 'bg-gray-100 text-dim',
  }[status] || 'bg-gray-100 text-dim';
  const label = t(`accountVouchers.status.${status}`);
  return `<span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full ${cls}">${label}</span>`;
}

function promoCardHtml(v, redemptionsByCode, locale) {
  const status = voucherStatus(v, redemptionsByCode);
  const isUsable = status === 'active';
  return `
    <div class="relative overflow-hidden rounded-2xl bg-white border border-frost-deep shadow-sm ${isUsable ? '' : 'opacity-60'}" data-voucher-card="${escapeHtml(v.code)}">
      <div class="absolute inset-y-0 left-0 w-1.5 bg-mango"></div>
      <div class="p-5 pl-6">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-wider text-dim font-mono truncate">${escapeHtml(v.name || '—')}</p>
            <p class="font-heading font-bold text-xl text-blueberry-deep mt-0.5 leading-tight">${valueHeadline(v)}</p>
          </div>
          ${statusBadge(status)}
        </div>
        <div class="flex items-center justify-between gap-2 rounded-xl border border-dashed border-blueberry/30 bg-blueberry/[0.04] px-3 py-2.5">
          <span class="font-mono font-bold tracking-[0.12em] text-blueberry-deep text-[15px] truncate">${escapeHtml(v.code)}</span>
          ${isUsable ? `
            <button type="button" data-copy-code="${escapeHtml(v.code)}" title="${t('accountVouchers.copyCode')}" class="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-blueberry hover:text-blueberry-hover transition-colors">
              ${COPY_ICON}<span class="hidden sm:inline">${t('accountVouchers.copyCode')}</span>
            </button>
          ` : ''}
        </div>
        <p class="text-[12px] text-dim font-mono mt-3">${fmtDate(v.startDate, locale)} → ${fmtDate(v.endDate, locale)}</p>
      </div>
    </div>
  `;
}

function legacyCardHtml(legacy, locale) {
  // The legacy signup voucher is a flat-amount, no-expiry credit auto-applied
  // at checkout. Status comes straight from the doc.
  const status = legacy.status === 'unused' ? 'active' : 'used';
  return `
    <div class="relative overflow-hidden rounded-2xl bg-white border border-frost-deep shadow-sm ${status === 'active' ? '' : 'opacity-60'}">
      <div class="absolute inset-y-0 left-0 w-1.5 bg-leaf"></div>
      <div class="p-5 pl-6">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-wider text-dim font-mono">${t('accountVouchers.legacyName')}</p>
            <p class="font-heading font-bold text-xl text-blueberry-deep mt-0.5 leading-tight">${t('voucher.valueFixed', { value: legacy.amount })}</p>
          </div>
          ${statusBadge(status)}
        </div>
        <p class="text-[13px] text-dim">${t('accountVouchers.legacyHint')}</p>
      </div>
    </div>
  `;
}

export default async function AccountVouchers(container) {
  const locale = getLocale();
  const user = getCurrentUser();
  updateMeta({
    title: `${t('account.vouchers')} — ManGO Parking`,
    description: t('accountVouchers.subtitle'),
    lang: locale,
  });

  // Pull everything in parallel. Legacy signup voucher = vouchers/{uid};
  // promo assignments = promoVouchers where assignedUserIds array-contains uid;
  // already-redeemed promo codes = voucherRedemptions where userId == uid.
  // The Firestore rule now permits #2 only for assigned users (or admins).
  const uid = user?.uid;
  const [promos, redemptions, legacy] = await Promise.all([
    uid
      ? getCollection('promoVouchers', where('assignedUserIds', 'array-contains', uid)).catch(() => [])
      : Promise.resolve([]),
    uid
      ? getCollection('voucherRedemptions', where('userId', '==', uid)).catch(() => [])
      : Promise.resolve([]),
    uid ? getDocument('vouchers', uid).catch(() => null) : Promise.resolve(null),
  ]);

  const redemptionsByCode = new Map();
  for (const r of redemptions) {
    if (r.voucherCode) redemptionsByCode.set(r.voucherCode, r);
  }

  // Sort: active first, then upcoming, then expired/used, then inactive.
  const STATUS_ORDER = { active: 0, upcoming: 1, used: 2, expired: 3, inactive: 4 };
  const sortedPromos = promos
    .slice()
    .sort((a, b) => {
      const sa = STATUS_ORDER[voucherStatus(a, redemptionsByCode)] ?? 9;
      const sb = STATUS_ORDER[voucherStatus(b, redemptionsByCode)] ?? 9;
      if (sa !== sb) return sa - sb;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

  const hasAnyVoucher = sortedPromos.length > 0 || !!legacy;

  const promosHtml = sortedPromos.length
    ? `<div class="grid sm:grid-cols-2 gap-4">${sortedPromos.map((v) => promoCardHtml(v, redemptionsByCode, locale)).join('')}</div>`
    : '';

  const legacyHtml = legacy ? `
    <section class="mt-6">
      <h2 class="font-heading font-bold text-lg text-blueberry-deep mb-3">${t('accountVouchers.legacySection')}</h2>
      ${legacyCardHtml(legacy, locale)}
    </section>
  ` : '';

  const emptyHtml = !hasAnyVoucher ? `
    <div class="card-solid rounded-3xl p-10 text-center">
      <div class="w-16 h-16 rounded-2xl bg-mango/10 flex items-center justify-center mx-auto mb-4">
        <svg class="w-8 h-8 text-mango" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z"/></svg>
      </div>
      <p class="font-heading font-bold text-lg text-blueberry-deep mb-1">${t('accountVouchers.emptyTitle')}</p>
      <p class="text-dim text-[14px]">${t('accountVouchers.emptyHint')}</p>
    </div>
  ` : '';

  const content = `
    <div class="mb-6">
      <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('account.vouchers')}</h1>
      <p class="text-dim text-[15px] mt-1">${t('accountVouchers.subtitle')}</p>
    </div>

    <div data-gift-redeem-slot class="mb-6"></div>

    ${promosHtml}
    ${legacyHtml}
    ${emptyHtml}
  `;

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-24 pb-16 min-h-screen bg-frost">
      <div class="max-w-5xl mx-auto px-4 sm:px-6">
        ${accountLayout('/account/vouchers', content)}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  initAccountNav(page);

  // Gift-code redeem box — logged-in, so the server credits the uid balance
  // and derives the plate from the profile (no plate input). Reload after a
  // successful redeem so any assigned gift voucher card flips to "used".
  page.querySelector('[data-gift-redeem-slot]')?.appendChild(
    giftCodeRedeemCard({ showPlate: false, onRedeemed: () => window.location.reload() }),
  );

  // Copy-code handler.
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    const code = btn.dataset.copyCode;
    try {
      await navigator.clipboard.writeText(code);
      showToast(t('accountVouchers.copied', { code }), 'success');
    } catch {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast(t('accountVouchers.copied', { code }), 'success'); }
      catch { showToast(t('common.error'), 'error'); }
      finally { ta.remove(); }
    }
  });

  container.appendChild(page);
}
