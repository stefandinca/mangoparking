import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, setFieldError, clearErrorOnInput, escapeHtml } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getLongTermRates, calculateLongTermCost } from '../../services/longTermService.js';
import { listSeasonalPeriods, getEffectiveRates } from '../../services/seasonalRatesService.js';
import { startNetopiaPayment } from '../../services/netopiaService.js';
import { getOnlineDiscountPercent, onlineFromStandard } from '../../services/discountService.js';
import { billingFieldsHtml, wireBillingToggle, readBilling } from '../../components/widgets/BillingFields.js';
import { dateTimeFieldHtml, wireDateTime } from '../../components/core/FormDateTime.js';
import { getMyVoucher } from '../../services/voucherService.js';
import { previewVoucher, normalizeCode } from '../../services/promoVoucherService.js';
import { getCurrentUser, getUserProfile } from '../../firebase/auth.js';
import { isValidEmail, isValidLicensePlate, required } from '../../utils/validators.js';
import { showToast } from '../../components/core/Toast.js';

// Billing rule: 1 day = 24h from drop-off, with a single 2h grace at the end
// of the entire booking. Booked 24h+ ≤ 26h → 1 day; >26h ≤ 50h → 2 days; etc.
const GRACE_MS = 2 * 60 * 60 * 1000;

function billingDays(dropoffMs, pickupMs) {
  const duration = pickupMs - dropoffMs;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(1, Math.ceil((duration - GRACE_MS) / 86_400_000));
}

function durationHours(dropoffMs, pickupMs) {
  const ms = pickupMs - dropoffMs;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 3_600_000);
}

// Render a Date as "YYYY-MM-DD HH:MM" in local time. Matches the format
// flatpickr writes into the hidden input via FormDateTime (dateFormat
// 'Y-m-d H:i'), so values flow through `form.dropoffAt.value` unchanged.
function toLocalDatetimeValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert flatpickr's "YYYY-MM-DD HH:MM" (local) → full ISO with offset.
// Also tolerates the legacy "YYYY-MM-DDTHH:MM" shape for safety.
function localDatetimeToIso(localValue) {
  if (!localValue) return null;
  const normalized = String(localValue).replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default function BookingLongTerm(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('longTerm.pageTitle')} — ManGO Parking`,
    description: t('longTerm.pageSubtitle'),
    lang: locale,
  });

  const user = getCurrentUser();
  const profile = getUserProfile();
  const profileVehicles = profile?.vehicles || [];

  // Default suggestion: drop-off tomorrow 10:00, pick-up the day after at 10:00.
  // Stored as local-time-formatted strings for the datetime-local input.
  const tomorrow10 = new Date();
  tomorrow10.setDate(tomorrow10.getDate() + 1);
  tomorrow10.setHours(10, 0, 0, 0);
  const dayAfter10 = new Date(tomorrow10.getTime() + 86_400_000);
  const minDropoff = new Date(); // can't drop off in the past

  let rates = null;
  let seasonalPeriods = [];
  let activePeriod = null;        // matched period for the current drop-off date, if any
  let discount = 0;
  let voucher = null;  // legacy signup voucher (existing balances only — new sign-ups don't get one)
  let promoVoucher = null;  // { code, name, type, value, discountAmount } when a promo code is active
  let quote = { days: 1, perDay: 0, total: 0, hours: 24 };
  let paymentMethod = 'online';   // 'online' | 'pay-at-pickup'

  // Accordion step card scaffold — a clickable header (number badge + title +
  // collapsed summary + Edit affordance) over a body that only shows while the
  // step is active. Keeps the page short: one step open at a time.
  const stepCard = ({ step, num, title, optional = false, body }) => `
    <div class="card-solid rounded-3xl overflow-hidden" data-step="${step}">
      <button type="button" data-step-head class="w-full flex items-center justify-between gap-3 px-6 py-5 text-left">
        <span class="flex items-center gap-3 min-w-0">
          <span data-step-badge class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-frost-deep text-charcoal/60 text-[13px] font-bold shrink-0 transition-colors">${num}</span>
          <span class="min-w-0">
            <span class="block font-heading font-bold text-lg text-blueberry-deep leading-tight">${title}${optional ? ` <span class="text-[12px] font-sans font-normal text-dim">(${t('wizard.optional')})</span>` : ''}</span>
            <span data-step-summary class="hidden text-[13px] text-dim truncate">—</span>
          </span>
        </span>
        <span data-step-edit class="hidden text-blueberry text-[13px] font-semibold shrink-0">${t('common.edit')}</span>
      </button>
      <div data-step-body class="px-6 pb-6">${body}</div>
    </div>`;

  const nextBtn = (to) => `
    <div class="flex justify-end mt-5">
      <button type="button" data-next-step="${to}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('longTerm.nextStep')} →</button>
    </div>`;

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-28 pb-16 bg-frost min-h-screen">
      <div class="max-w-5xl mx-auto px-6">
        <div class="text-center mb-8">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('funnel.longTerm.title')}</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${t('longTerm.pageTitle')}</h1>
          <p class="text-dim text-[17px]">${t('longTerm.pageSubtitle')}</p>
        </div>

        <form data-long-form novalidate class="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
          <!-- LEFT: accordion steps -->
          <div class="space-y-4 min-w-0">

            ${stepCard({ step: 'dates', num: 1, title: t('wizard.datesStep'), body: `
              <div class="grid sm:grid-cols-2 gap-4">
                <div>
                  <label class="flex items-center gap-2 text-[14px] font-medium text-charcoal/70 mb-1.5">
                    <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-mango text-charcoal text-[11px] font-bold">1</span>
                    ${t('longTerm.dropoffAt')} *
                  </label>
                  ${dateTimeFieldHtml({ name: 'dropoffAt', value: toLocalDatetimeValue(tomorrow10), min: toLocalDatetimeValue(minDropoff), required: true, stepToNext: 'pickupAt' })}
                </div>
                <div>
                  <label class="flex items-center gap-2 text-[14px] font-medium text-charcoal/70 mb-1.5">
                    <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-mango text-charcoal text-[11px] font-bold">2</span>
                    ${t('longTerm.pickupAt')} *
                  </label>
                  ${dateTimeFieldHtml({ name: 'pickupAt', value: toLocalDatetimeValue(dayAfter10), min: toLocalDatetimeValue(tomorrow10), required: true })}
                </div>
              </div>
              <p class="text-[12px] text-dim mt-3">${t('longTerm.graceNote')}</p>
              <p class="text-[12px] text-dim mt-1">${t('longTerm.tierNote')}</p>
              <div class="mt-4 pt-4 border-t border-frost-deep">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-1.5">
                  <span class="text-[12px] font-mono uppercase tracking-wider text-dim">${t('rates.longTermRates')}</span>
                  <span class="hidden text-[11px] uppercase tracking-wider font-mono font-semibold text-mango-deep" data-seasonal-badge></span>
                </div>
                <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]" data-tiers></div>
              </div>
              ${nextBtn('details')}
            ` })}

            ${stepCard({ step: 'details', num: 2, title: t('wizard.contactStep'), body: `
              <h3 class="font-heading font-bold text-[15px] text-blueberry-deep mb-3">${t('longTerm.vehicleInfo')}</h3>
              ${user && profileVehicles.length > 0 ? `
                <div class="space-y-2 mb-3" data-vehicle-options>
                  ${profileVehicles.map((v, i) => `
                    <label class="flex items-center gap-3 p-3 rounded-xl border-2 ${i === 0 ? 'border-blueberry bg-blueberry/5' : 'border-frost-deep'} hover:border-blueberry/40 cursor-pointer transition-colors">
                      <input type="radio" name="vehicleChoice" value="${i}" class="accent-blueberry w-4 h-4" ${i === 0 ? 'checked' : ''}>
                      <span class="font-mono font-semibold text-[15px]">${escapeHtml(v.plate || '')}</span>
                      ${(v.make || v.model) ? `<span class="text-dim text-[14px]">${escapeHtml(((v.make || '') + ' ' + (v.model || '')).trim())}</span>` : ''}
                    </label>
                  `).join('')}
                  <label class="flex items-center gap-3 p-3 rounded-xl border-2 border-frost-deep hover:border-blueberry/40 cursor-pointer transition-colors">
                    <input type="radio" name="vehicleChoice" value="new" class="accent-blueberry w-4 h-4">
                    <span class="text-[15px] font-medium">${locale === 'ro' ? '+ Vehicul nou' : '+ New vehicle'}</span>
                  </label>
                </div>
                <div class="hidden" data-new-vehicle-fields>
              ` : `
                <div data-new-vehicle-fields>
              `}
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
                <input type="text" name="licensePlate" placeholder="B 123 ABC" value="${(user && profileVehicles.length > 0) ? '' : escapeHtml(profile?.vehicles?.[0]?.plate || '')}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] uppercase focus:outline-none focus:border-blueberry">
              </div>

              <h3 class="font-heading font-bold text-[15px] text-blueberry-deep mt-6 mb-3">${t('longTerm.contactInfo')}</h3>
              <div class="space-y-3">
                <div>
                  <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.name')} *</label>
                  <input type="text" name="name" required value="${escapeHtml(profile?.displayName || user?.displayName || '')}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
                </div>
                <div class="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.email')} *</label>
                    <input type="email" name="email" required value="${escapeHtml(profile?.email || user?.email || '')}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
                  </div>
                  <div>
                    <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.phone')}</label>
                    <input type="tel" name="phone" value="${escapeHtml(profile?.phone || '')}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
                  </div>
                </div>
              </div>
              ${nextBtn('billing')}
            ` })}

            ${stepCard({ step: 'billing', num: 3, title: t('billing.title'), body: `
              <label class="flex items-center gap-2.5 text-[14px] text-charcoal/80 cursor-pointer mb-3" data-billing-same-wrap>
                <input type="checkbox" name="billingSameAsContact" class="accent-blueberry w-4 h-4 shrink-0">
                <span>${t('billing.sameAsContact')}</span>
              </label>
              ${billingFieldsHtml(profile?.billing)}
              ${nextBtn('paymethod')}
            ` })}

            <div data-paymethod-block>${stepCard({ step: 'paymethod', num: 4, title: t('payment.method.title'), body: `
              <div class="grid sm:grid-cols-2 gap-3" data-paymethod-toggle>
                <label class="flex items-start gap-3 p-4 rounded-2xl border-2 border-mango bg-mango/5 cursor-pointer transition-colors">
                  <input type="radio" name="paymentMethod" value="online" class="accent-mango w-4 h-4 mt-0.5" checked>
                  <div class="min-w-0">
                    <p class="font-semibold text-[15px] text-charcoal">${t('payment.method.online')}</p>
                    <p class="text-[13px] text-leaf font-medium mt-0.5" data-paymethod-online-hint>${t('payment.method.onlineHint')}</p>
                  </div>
                </label>
                <label class="flex items-start gap-3 p-4 rounded-2xl border-2 border-frost-deep cursor-pointer transition-colors">
                  <input type="radio" name="paymentMethod" value="pay-at-pickup" class="accent-mango w-4 h-4 mt-0.5">
                  <div class="min-w-0">
                    <p class="font-semibold text-[15px] text-charcoal">${t('payment.method.pickup')}</p>
                    <p class="text-[13px] text-dim mt-0.5">${t('payment.method.pickupHint')}</p>
                  </div>
                </label>
              </div>
              ${nextBtn('voucher')}
            ` })}</div>

            <div data-voucher-block>${stepCard({ step: 'voucher', num: 5, title: t('voucher.codeTitle'), optional: true, body: `
              <div class="flex flex-col sm:flex-row gap-2" data-voucher-input-wrap>
                <input type="text" name="voucherCode" placeholder="${t('voucher.codePlaceholder')}" class="flex-1 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] font-mono uppercase focus:outline-none focus:border-blueberry">
                <button type="button" data-apply-voucher class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-3 rounded-xl transition-colors">${t('voucher.apply')}</button>
              </div>
              <div class="hidden mt-3 flex items-center justify-between gap-3 bg-leaf/5 border border-leaf/30 rounded-xl px-4 py-3" data-voucher-applied>
                <div class="min-w-0">
                  <p class="text-[14px] font-semibold text-leaf" data-voucher-applied-name>—</p>
                  <p class="text-[12px] text-charcoal/70" data-voucher-applied-detail>—</p>
                </div>
                <button type="button" data-remove-voucher class="text-[13px] text-red-500 hover:underline font-semibold shrink-0">${t('voucher.remove')}</button>
              </div>
              <p class="hidden mt-2 text-[13px] text-red-500" data-voucher-error></p>
            ` })}</div>

          </div>

          <!-- RIGHT: sticky summary + consents + pay -->
          <aside class="lg:sticky lg:top-24 space-y-4">
            <div class="rounded-3xl p-6 bg-blueberry-deep text-white shadow-lg">
              <p class="text-[12px] text-white/70 uppercase tracking-wider font-mono mb-2">${t('longTerm.totalLabel')}</p>
              <p class="text-white/50 line-through font-mono text-[15px] hidden" data-quote-original></p>
              <div class="flex items-baseline gap-2 mb-2">
                <span class="font-heading font-bold text-5xl" data-quote-total>—</span>
                <span class="text-white/70 text-lg">lei</span>
                <span class="text-[11px] font-bold uppercase tracking-wider text-mango ml-1 hidden" data-quote-discount-badge></span>
              </div>
              <p class="text-[14px] text-white/70"><span data-quote-days>—</span> ${t('longTerm.days')} × <span data-quote-perday>—</span> ${t('longTerm.perDay')}</p>
              <p class="text-[12px] text-white/50 mt-1" data-quote-hours-line>—</p>
              <p class="text-[13px] text-mango mt-2 hidden" data-voucher-line></p>
              <div class="hidden text-[13px] space-y-1 mt-4 pt-4 border-t border-white/15" data-pay-breakdown>
                <div class="flex justify-between text-white/70"><span>${t('longTerm.subtotal')}</span><span data-bd-subtotal>—</span></div>
                <div class="flex justify-between text-leaf" style="display:none" data-bd-online-row><span data-bd-online-label>—</span><span data-bd-online>—</span></div>
                <div class="flex justify-between text-mango" style="display:none" data-bd-voucher-row><span data-bd-voucher-label>—</span><span data-bd-voucher>—</span></div>
              </div>
            </div>
            <div class="card-solid rounded-3xl p-5 flex flex-col gap-3">
              <label class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
                <input type="checkbox" name="acceptTerms" required class="accent-blueberry w-4 h-4 mt-1 shrink-0">
                <span>${t('legal.acceptTerms')}</span>
              </label>
              <label class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
                <input type="checkbox" name="acceptPrivacy" required class="accent-blueberry w-4 h-4 mt-1 shrink-0">
                <span>${t('legal.acceptPrivacy')}</span>
              </label>
              <button type="submit" data-pay-btn class="mt-1 w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[16px] px-6 py-4 rounded-2xl shadow-md transition-colors">${t('longTerm.payNow')}</button>
            </div>
          </aside>
        </form>

        <!-- Confirmation (hidden until success) -->
        <div data-confirmation class="hidden card-solid rounded-3xl p-10 text-center mt-6 max-w-2xl mx-auto">
          <div class="w-16 h-16 rounded-2xl bg-leaf/10 flex items-center justify-center mx-auto mb-5">
            <svg class="w-8 h-8 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <h2 class="font-heading text-2xl font-bold text-blueberry-deep mb-2">${t('longTerm.confirmed')}</h2>
          <p class="text-dim mb-6">${t('longTerm.confirmMessage')}</p>
          <a href="${localePath('/')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-8 py-3 rounded-xl transition-colors">${t('booking.backHome')}</a>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  const form = page.querySelector('[data-long-form]');
  const totalEl = page.querySelector('[data-quote-total]');
  const payBreakdownEl = page.querySelector('[data-pay-breakdown]');
  const bdSubtotalEl = page.querySelector('[data-bd-subtotal]');
  const bdOnlineRow = page.querySelector('[data-bd-online-row]');
  const bdOnlineLabel = page.querySelector('[data-bd-online-label]');
  const bdOnlineEl = page.querySelector('[data-bd-online]');
  const bdVoucherRow = page.querySelector('[data-bd-voucher-row]');
  const bdVoucherLabel = page.querySelector('[data-bd-voucher-label]');
  const bdVoucherEl = page.querySelector('[data-bd-voucher]');
  const daysEl = page.querySelector('[data-quote-days]');
  const perdayEl = page.querySelector('[data-quote-perday]');
  const hoursLineEl = page.querySelector('[data-quote-hours-line]');
  const originalEl = page.querySelector('[data-quote-original]');
  const discountBadgeEl = page.querySelector('[data-quote-discount-badge]');
  const voucherLineEl = page.querySelector('[data-voucher-line]');
  const tiersEl = page.querySelector('[data-tiers]');
  const seasonalBadgeEl = page.querySelector('[data-seasonal-badge]');

  // Returns the tier set currently in effect — seasonal override if the
  // PICK-UP date falls inside an active period, otherwise the default
  // rates. Pick-up wins so bookings that straddle a boundary always
  // price at the higher-demand period the customer is leaving on.
  function effectiveRates() {
    if (!rates) return { tiers: [], period: null };
    const pickupLocal = form?.pickupAt?.value;
    const pickupDay = pickupLocal ? String(pickupLocal).slice(0, 10) : null;
    const eff = getEffectiveRates(seasonalPeriods, pickupDay, rates);
    activePeriod = eff.period;
    return eff;
  }

  function renderTiers() {
    const eff = effectiveRates();
    if (!eff.tiers.length) return;
    const label = locale === 'ro' ? 'zile' : 'days';
    tiersEl.innerHTML = eff.tiers.map(tier => {
      const rangeLabel = tier.maxDays
        ? `${tier.minDays}–${tier.maxDays} ${label}`
        : `${tier.minDays}+ ${label}`;
      // Plain inline text — no box, no border, no fill, no cursor change, so
      // it reads as a reference list rather than a set of selectable cards.
      return `
        <span data-tier-min="${tier.minDays}" class="whitespace-nowrap text-dim">
          <span class="text-charcoal/50">${rangeLabel}:</span>
          <span class="font-mono font-semibold" data-tier-rate>${tier.perDay} ${t('longTerm.perDay')}</span><span data-tier-tag class="hidden text-blueberry font-medium"> · ${t('longTerm.yourRate')}</span>
        </span>`;
    }).join('');

    // Seasonal banner — only when a period is in effect for the drop-off.
    if (seasonalBadgeEl) {
      if (activePeriod) {
        seasonalBadgeEl.textContent = t('seasonal.appliedBadge', { name: activePeriod.name });
        seasonalBadgeEl.classList.remove('hidden');
      } else {
        seasonalBadgeEl.classList.add('hidden');
      }
    }
  }

  function highlightActiveTier() {
    if (!quote.tier) return;
    // Informational only — the applicable tier is just bolded blue with a
    // quiet "your rate" note. No box/ring/fill that could read as a
    // selected, clickable option.
    tiersEl.querySelectorAll('[data-tier-min]').forEach(el => {
      const isActive = Number(el.dataset.tierMin) === quote.tier.minDays;
      const rate = el.querySelector('[data-tier-rate]');
      if (rate) {
        rate.classList.toggle('text-blueberry-deep', isActive);
        rate.classList.toggle('text-charcoal/70', !isActive);
      }
      const tag = el.querySelector('[data-tier-tag]');
      if (tag) tag.classList.toggle('hidden', !isActive);
    });
  }

  function recompute() {
    if (!rates) return;
    const dropoffMs = new Date(form.dropoffAt.value).getTime();
    const pickupMs = new Date(form.pickupAt.value).getTime();
    const days = billingDays(dropoffMs, pickupMs);
    const hours = durationHours(dropoffMs, pickupMs);
    // Re-derive the effective tier set on every recompute — drop-off
    // moving across a seasonal-period boundary should swap pricing live.
    // renderTiers() also calls effectiveRates(); calling here too keeps
    // the quote in sync with what's displayed.
    const eff = effectiveRates();
    const ratesForQuote = eff.tiers.length ? { tiers: eff.tiers } : rates;
    quote = { ...calculateLongTermCost(days, ratesForQuote), hours };
    // Re-render tier cards so the active badge + numbers stay in sync.
    renderTiers();
    // Stored tier prices are the STANDARD (on-site) price. Online pays a real
    // discount on top, so online shows the discounted total with the standard
    // price struck through; pay-at-pickup pays the standard price as-is.
    const onlineTotal = onlineFromStandard(quote.total, discount);
    const isPickup = paymentMethod === 'pay-at-pickup';
    const displayTotal = (!isPickup && onlineTotal != null) ? onlineTotal : quote.total;
    const displayPerDay = quote.perDay;
    // Promo voucher application — applies to BOTH online and pay-at-pickup.
    // The displayed total subtracts the discount from the method-appropriate
    // base (online = discounted, pickup = standard); createPayment re-validates
    // and the agent collects the reduced amount for pickup.
    let finalTotal = displayTotal;
    if (promoVoucher) {
      // Re-derive the discount from the LIVE quote on every recompute so the
      // displayed total stays correct when the customer changes dates after
      // applying a code. The server re-validates at pay time; this is
      // display-only, but it must mirror the server's formula per type.
      if (promoVoucher.type === 'days' && quote.days) {
        // min(remaining balance, booked days) × the booking's daily rate.
        // `daysAvailable` is the identity's remaining balance — days
        // vouchers are splittable across multiple bookings.
        const available = promoVoucher.daysAvailable ?? promoVoucher.value;
        promoVoucher.daysGranted = Math.min(available, quote.days);
        promoVoucher.discountAmount = Math.min(
          promoVoucher.daysGranted * quote.perDay,
          displayTotal
        );
      } else if (promoVoucher.type === 'percent') {
        promoVoucher.discountAmount = Math.min(
          Math.round((displayTotal * promoVoucher.value) / 100),
          Math.max(0, displayTotal - 1)
        );
      } else if (promoVoucher.type === 'fixed') {
        promoVoucher.discountAmount = Math.min(
          promoVoucher.value,
          Math.max(0, displayTotal - 1)
        );
      }
      if (promoVoucher.discountAmount) {
        // Days vouchers may cover the WHOLE total (free order — the server
        // skips Netopia); fixed/percent keep the 1-leu Netopia floor.
        const floor = promoVoucher.type === 'days' ? 0 : 1;
        finalTotal = Math.max(floor, displayTotal - promoVoucher.discountAmount);
      }
      renderAppliedVoucher();
    }
    totalEl.textContent = quote.days ? String(finalTotal) : '—';
    // Itemize the reductions next to the final total: the online discount
    // (standard − online) and any applied voucher. Hidden when neither applies.
    const onlineDiscountAmt = (!isPickup && onlineTotal != null) ? (quote.total - onlineTotal) : 0;
    const voucherAmt = promoVoucher?.discountAmount ? promoVoucher.discountAmount : 0;
    if (payBreakdownEl) {
      const hasReductions = !!quote.days && (onlineDiscountAmt > 0 || voucherAmt > 0);
      payBreakdownEl.classList.toggle('hidden', !hasReductions);
      if (bdSubtotalEl) bdSubtotalEl.textContent = `${quote.total} lei`;
      if (bdOnlineRow) bdOnlineRow.style.display = onlineDiscountAmt > 0 ? 'flex' : 'none';
      if (bdOnlineLabel) bdOnlineLabel.textContent = t('discount.online', { percent: discount });
      if (bdOnlineEl) bdOnlineEl.textContent = `−${onlineDiscountAmt} lei`;
      if (bdVoucherRow) bdVoucherRow.style.display = voucherAmt > 0 ? 'flex' : 'none';
      if (bdVoucherLabel && promoVoucher) bdVoucherLabel.textContent = promoVoucher.code;
      if (bdVoucherEl) bdVoucherEl.textContent = `−${voucherAmt} lei`;
    }
    // Submit-button copy: a fully-covered booking (days voucher) charges
    // nothing on either method, so show the "free" label; otherwise reflect
    // the chosen method (Netopia vs confirm-at-lot).
    const payBtnEl = page.querySelector('[data-pay-btn]');
    if (payBtnEl) {
      payBtnEl.textContent = finalTotal === 0
        ? t('longTerm.payNowFree')
        : (isPickup ? t('longTerm.payNowPickup') : t('longTerm.payNow'));
    }
    daysEl.textContent = quote.days || '—';
    perdayEl.textContent = displayPerDay || '—';
    hoursLineEl.textContent = hours > 0 ? t('longTerm.durationHours', { hours }) : '—';
    // Strikethrough anchor + discount badge — only on the online branch.
    // For pay-at-pickup the displayed total IS the original, so there's
    // nothing left to strike through.
    if (!isPickup && onlineTotal != null) {
      // Anchor = the standard (pre-discount) total, struck through.
      originalEl.textContent = `${quote.total} lei`;
      originalEl.classList.remove('hidden');
      discountBadgeEl.textContent = t('discount.online', { percent: discount });
      discountBadgeEl.classList.remove('hidden');
    } else {
      originalEl.classList.add('hidden');
      discountBadgeEl.classList.add('hidden');
    }
    // Voucher line — visible only if user has an unused voucher AND order
    // total is strictly above voucher amount AND online payment. Voucher
    // application via the IPN callback only fires on online orders.
    if (!isPickup && voucher && voucher.status === 'unused' && quote.total > voucher.amount) {
      voucherLineEl.textContent = t('voucher.applied', { amount: voucher.amount });
      voucherLineEl.classList.remove('hidden');
    } else {
      voucherLineEl.classList.add('hidden');
    }
    // Keep pickup's min in sync with the chosen dropoff so the native
    // date picker stops the user before they submit something invalid.
    if (form.dropoffAt.value) form.pickupAt.min = form.dropoffAt.value;
    highlightActiveTier();
  }

  // Load rates, then render tiers + compute initial quote. Fall back to
  // sane defaults if the fetch rejects (offline / rules), so the page never
  // stays stuck at "—".
  const FALLBACK_RATES = {
    tiers: [
      { minDays: 1, maxDays: 6, perDay: 49 },
      { minDays: 7, maxDays: 13, perDay: 39 },
      { minDays: 14, maxDays: null, perDay: 29 },
    ],
  };
  Promise.all([
    getLongTermRates().catch(() => FALLBACK_RATES),
    getOnlineDiscountPercent().catch(() => 0),
    getMyVoucher().catch(() => null),
    listSeasonalPeriods().catch(() => []),
  ]).then(([r, d, v, periods]) => {
    rates = r && r.tiers?.length ? r : FALLBACK_RATES;
    discount = d || 0;
    voucher = v;
    seasonalPeriods = periods || [];
    renderTiers();
    recompute();
  });

  ['dropoffAt', 'pickupAt'].forEach(name => {
    form[name].addEventListener('change', recompute);
    form[name].addEventListener('input', recompute);
  });

  // Keep pickup ≥ dropoff: when dropoff changes, bump the pickup picker's
  // minDate so users can't accidentally pick an end date before the start.
  // The picker also auto-opens after dropoff closes (step-through wizard).
  form.dropoffAt.addEventListener('change', () => {
    const pickupFp = form.pickupAt.__fpInstance;
    if (!pickupFp || !form.dropoffAt.value) return;
    pickupFp.set('minDate', form.dropoffAt.value);
    // If the existing pickup is now before the new dropoff, clear it so
    // the user re-picks rather than submitting an invalid range.
    if (form.pickupAt.value && form.pickupAt.value < form.dropoffAt.value) {
      pickupFp.clear();
    }
  });

  // Clear red field-error state as the user edits.
  ['dropoffAt', 'pickupAt', 'licensePlate', 'name', 'email', 'phone']
    .forEach(name => clearErrorOnInput(form[name]));

  // Saved-vehicle picker (logged-in users): selecting a plate hides the
  // new-plate field; "+ New vehicle" reveals it. Mirrors /booking/credits.
  const vehicleOptions = form.querySelector('[data-vehicle-options]');
  const newVehicleFields = form.querySelector('[data-new-vehicle-fields]');
  if (vehicleOptions && newVehicleFields) {
    vehicleOptions.addEventListener('change', (e) => {
      if (!e.target.matches('input[name="vehicleChoice"]')) return;
      newVehicleFields.classList.toggle('hidden', e.target.value !== 'new');
      vehicleOptions.querySelectorAll('label').forEach((lbl) => {
        const inp = lbl.querySelector('input');
        lbl.classList.toggle('border-blueberry', inp.checked);
        lbl.classList.toggle('bg-blueberry/5', inp.checked);
        lbl.classList.toggle('border-frost-deep', !inp.checked);
      });
    });
  }

  // Wire the PF/PJ toggle.
  wireBillingToggle(form);

  // "Billing = same as contact" — copies the contact name into the PF
  // billing name fields (first token → first name, the rest → last name)
  // and locks them, so the customer doesn't re-type their name. Only
  // relevant for PF (a company has its own name), so it's hidden for PJ.
  (function wireBillingSameAsContact() {
    const chk = form.querySelector('[name="billingSameAsContact"]');
    const wrap = form.querySelector('[data-billing-same-wrap]');
    if (!chk) return;
    const billingFirst = () => form.querySelector('[name="billingFirstName"]');
    const billingLast = () => form.querySelector('[name="billingLastName"]');
    const isPF = () => (form.querySelector('input[name="billingType"]:checked')?.value || 'PF') !== 'PJ';

    function syncFromContact() {
      if (!chk.checked) return;
      const parts = String(form.name?.value || '').trim().split(/\s+/).filter(Boolean);
      const fn = billingFirst();
      const ln = billingLast();
      if (fn) fn.value = parts[0] || '';
      if (ln) ln.value = parts.length > 1 ? parts.slice(1).join(' ') : '';
    }
    function applyLock() {
      const on = chk.checked;
      // Keep the fields EDITABLE — disabling them traps the customer when the
      // contact name is empty (#3). Tint to show they're synced; typing in
      // them releases the sync (handler below).
      [billingFirst(), billingLast()].forEach((el) => {
        if (!el) return;
        el.classList.toggle('bg-frost', on);
      });
      if (on) syncFromContact();
    }
    // Typing in a billing-name field while synced means the customer wants a
    // different billing name — release the sync so they can edit freely.
    // (Programmatic .value writes in syncFromContact don't dispatch 'input'.)
    [billingFirst(), billingLast()].forEach((el) => {
      el?.addEventListener('input', () => {
        if (chk.checked) { chk.checked = false; applyLock(); }
      });
    });
    chk.addEventListener('change', applyLock);
    form.name?.addEventListener('input', syncFromContact);
    // Re-apply after a PF/PJ switch (the PF fields are re-shown) and hide the
    // option entirely for PJ.
    form.querySelector('[data-billing-type-toggle]')?.addEventListener('change', () => {
      if (wrap) wrap.classList.toggle('hidden', !isPF());
      if (!isPF()) { chk.checked = false; applyLock(); }
      else applyLock();
    });
    // Initial visibility — hidden when the profile defaults to PJ.
    if (wrap) wrap.classList.toggle('hidden', !isPF());
  })();

  // Branded date/time pickers (flatpickr, 24h, click-anywhere opens).
  wireDateTime(form);

  // Payment-method toggle — repaints active card, swaps the submit-button
  // copy ("Plătește cu Netopia" vs "Confirmă rezervarea") so users don't
  // see Netopia branding on a pay-at-pickup order, and recomputes price.
  const paymethodWrap = page.querySelector('[data-paymethod-toggle]');
  const payBtn = page.querySelector('[data-pay-btn]');
  if (paymethodWrap) {
    paymethodWrap.addEventListener('change', (e) => {
      if (!e.target.matches('input[name="paymentMethod"]')) return;
      paymentMethod = e.target.value === 'pay-at-pickup' ? 'pay-at-pickup' : 'online';
      paymethodWrap.querySelectorAll('label').forEach((lbl) => {
        const inp = lbl.querySelector('input');
        lbl.classList.toggle('border-mango', inp.checked);
        lbl.classList.toggle('bg-mango/5', inp.checked);
        lbl.classList.toggle('border-frost-deep', !inp.checked);
      });
      if (payBtn) {
        payBtn.textContent = paymentMethod === 'pay-at-pickup'
          ? t('longTerm.payNowPickup')
          : t('longTerm.payNow');
      }
      recompute();
    });
  }

  // Promo voucher: apply / remove. Preview via the validateVoucherCode
  // callable so the customer sees the discount before paying; the same
  // validation runs again server-side at pay time.
  const voucherBlock = page.querySelector('[data-voucher-block]');
  const voucherInputWrap = page.querySelector('[data-voucher-input-wrap]');
  const voucherAppliedEl = page.querySelector('[data-voucher-applied]');
  const voucherAppliedName = page.querySelector('[data-voucher-applied-name]');
  const voucherAppliedDetail = page.querySelector('[data-voucher-applied-detail]');
  const voucherErrorEl = page.querySelector('[data-voucher-error]');
  const voucherInput = page.querySelector('input[name="voucherCode"]');
  const applyBtn = page.querySelector('[data-apply-voucher]');
  const removeBtn = page.querySelector('[data-remove-voucher]');

  function setVoucherError(msg) {
    if (!voucherErrorEl) return;
    if (msg) {
      voucherErrorEl.textContent = msg;
      voucherErrorEl.classList.remove('hidden');
    } else {
      voucherErrorEl.classList.add('hidden');
    }
  }

  function renderAppliedVoucher() {
    if (!promoVoucher) {
      voucherInputWrap.classList.remove('hidden');
      voucherAppliedEl.classList.add('hidden');
      return;
    }
    voucherInputWrap.classList.add('hidden');
    voucherAppliedEl.classList.remove('hidden');
    voucherAppliedName.textContent = `${promoVoucher.name} (${promoVoucher.code})`;
    let detail;
    if (promoVoucher.type === 'percent') {
      detail = t('voucher.appliedPercent', { value: promoVoucher.value, amount: promoVoucher.discountAmount });
    } else if (promoVoucher.type === 'days') {
      const granted = promoVoucher.daysGranted ?? promoVoucher.value;
      const left = Math.max(0, (promoVoucher.daysAvailable ?? promoVoucher.value) - granted);
      detail = t('voucher.appliedDays', { value: granted, amount: promoVoucher.discountAmount });
      // Splittable balance — tell the customer what stays on the voucher.
      if (left > 0) detail += ` · ${t('voucher.appliedDaysLeft', { left })}`;
    } else {
      detail = t('voucher.appliedFixed', { amount: promoVoucher.discountAmount });
    }
    voucherAppliedDetail.textContent = detail;
  }

  function voucherEligibleBase() {
    // Preview against the method-appropriate base so it matches the pay-time
    // charge: pay-at-pickup uses the standard total; online uses the
    // already-discounted amount (the server applies the online discount first).
    if (paymentMethod === 'pay-at-pickup') return Number(quote?.total) || 0;
    const onlineTotal = onlineFromStandard(quote?.total, discount);
    return Number(onlineTotal != null ? onlineTotal : quote?.total) || 0;
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      setVoucherError('');
      const code = normalizeCode(voucherInput.value);
      if (!code) { setVoucherError(t('voucher.errorEmpty')); return; }
      const plate = resolvePlate();
      if (!plate) { setVoucherError(t('voucher.errorNeedPlate')); return; }
      const base = voucherEligibleBase();
      if (!base) { setVoucherError(t('voucher.errorNoBase')); return; }
      applyBtn.disabled = true;
      applyBtn.textContent = t('common.loading');
      try {
        // days/perDay context lets days-type vouchers compute their
        // discount (N free days × this booking's daily rate).
        const res = await previewVoucher({ code, plate, baseAmount: base, orderType: 'longTerm', days: quote.days, perDay: quote.perDay });
        if (res?.ok) {
          promoVoucher = {
            code: res.voucherCode,
            name: res.name,
            type: res.type,
            value: res.value,
            discountAmount: res.discountAmount,
            // Days vouchers: remaining balance + days this booking uses.
            daysAvailable: res.daysAvailable ?? null,
            daysGranted: res.daysUsed ?? null,
          };
          renderAppliedVoucher();
          recompute();
          showToast(t('voucher.appliedToast'), 'success');
        } else {
          setVoucherError(t(`voucher.error.${res?.error || 'unknown'}`));
        }
      } catch (err) {
        console.error('previewVoucher', err);
        setVoucherError(err?.message || t('common.error'));
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = t('voucher.apply');
      }
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      promoVoucher = null;
      voucherInput.value = '';
      setVoucherError('');
      renderAppliedVoucher();
      recompute();
    });
  }

  // "Next step" buttons — validate the current card, scroll to the next
  // one, focus its first input. Mirrors submit-time validation so users
  // catch errors as they go rather than only at pay-time. Datetime pickers
  // count as "valid" once flatpickr has a parseable value in the hidden
  // input; full cross-field rules (pickup > dropoff, min duration) still
  // run at submit.
  function validateStep(step) {
    if (step === 'dates') {
      const dropoffIso = localDatetimeToIso(form.dropoffAt.value);
      const pickupIso = localDatetimeToIso(form.pickupAt.value);
      setFieldError(form.dropoffAt, !dropoffIso);
      setFieldError(form.pickupAt, !pickupIso);
      if (!dropoffIso || !pickupIso) { showToast(t('longTerm.invalidDates'), 'error'); return false; }
      const dropMs = new Date(dropoffIso).getTime();
      const pickMs = new Date(pickupIso).getTime();
      if (pickMs <= dropMs) { setFieldError(form.pickupAt, true); showToast(t('longTerm.invalidDates'), 'error'); return false; }
      if (pickMs - dropMs < 60 * 60 * 1000) { setFieldError(form.pickupAt, true); showToast(t('longTerm.minDuration'), 'error'); return false; }
      return true;
    }
    if (step === 'details') {
      const plate = resolvePlate();
      const plateOk = isValidLicensePlate(plate);
      const plateInput = form.querySelector('input[name="licensePlate"]');
      if (plateInput && isPlateInputActive()) setFieldError(plateInput, !plateOk);
      const nameOk = required(form.name.value.trim());
      const emailOk = isValidEmail(form.email.value.trim());
      setFieldError(form.name, !nameOk);
      setFieldError(form.email, !emailOk);
      if (!plateOk || !nameOk || !emailOk) { showToast(t('common.error'), 'error'); return false; }
      return true;
    }
    if (step === 'billing') {
      const billing = readBilling(form);
      if (billing.error) { showToast(billing.error, 'error'); return false; }
      return true;
    }
    if (step === 'paymethod') {
      // Radio has a default; nothing to block on.
      return true;
    }
    return true;
  }

  // Plate resolution — from the selected saved vehicle, or the typed input
  // when the customer is a guest or chose "new vehicle".
  function isPlateInputActive() {
    const choice = form.querySelector('input[name="vehicleChoice"]:checked');
    return !choice || choice.value === 'new';
  }
  function resolvePlate() {
    const choice = form.querySelector('input[name="vehicleChoice"]:checked');
    if (choice && choice.value !== 'new') {
      const idx = parseInt(choice.value, 10);
      return String(profileVehicles[idx]?.plate || '').trim();
    }
    return String(form.querySelector('input[name="licensePlate"]')?.value || '').trim();
  }

  function focusFirstField(stepEl) {
    if (!stepEl) return;
    const field = stepEl.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea');
    if (field && typeof field.focus === 'function') {
      // Slight delay so the smooth scroll has started before the focus
      // tries to jump back to the field on mobile keyboards.
      setTimeout(() => field.focus({ preventScroll: true }), 350);
    }
  }

  // ── Accordion controller ──────────────────────────────────────────────
  // Only one step is expanded at a time; completed steps collapse to a
  // one-line summary with an "Edit" link. Keeps the funnel short while the
  // existing per-step validation (validateStep) still gates "Next".
  const STEP_ORDER = ['dates', 'details', 'billing', 'paymethod', 'voucher'];

  function summarizeStep(step) {
    if (step === 'dates') return quote.days ? `${quote.days} ${t('longTerm.days')}` : '—';
    if (step === 'details') {
      const p = resolvePlate();
      const n = String(form.name?.value || '').trim();
      return [p, n].filter(Boolean).join(' · ') || '—';
    }
    if (step === 'billing') {
      const isPJ = (form.querySelector('input[name="billingType"]:checked')?.value || 'PF') === 'PJ';
      if (isPJ) return form.querySelector('[name="billingCompanyName"]')?.value?.trim() || t('billing.typePJ');
      const fn = form.querySelector('[name="billingFirstName"]')?.value?.trim() || '';
      const ln = form.querySelector('[name="billingLastName"]')?.value?.trim() || '';
      return [fn, ln].filter(Boolean).join(' ') || t('billing.typePF');
    }
    if (step === 'paymethod') return paymentMethod === 'pay-at-pickup' ? t('payment.method.pickup') : t('payment.method.online');
    if (step === 'voucher') return promoVoucher ? promoVoucher.code : '—';
    return '';
  }

  function openStep(name, { scroll = true } = {}) {
    STEP_ORDER.forEach((s) => {
      const el = page.querySelector(`[data-step="${s}"]`);
      if (!el) return;
      const active = s === name;
      const completed = el.dataset.completed === '1';
      el.classList.toggle('ring-2', active);
      el.classList.toggle('ring-blueberry/20', active);
      const body = el.querySelector('[data-step-body]');
      const summary = el.querySelector('[data-step-summary]');
      const edit = el.querySelector('[data-step-edit]');
      if (body) body.classList.toggle('hidden', !active);
      if (summary) {
        const show = !active && completed;
        summary.classList.toggle('hidden', !show);
        if (show) summary.textContent = summarizeStep(s);
      }
      if (edit) edit.classList.toggle('hidden', !(completed && !active));
    });
    if (scroll) {
      const el = page.querySelector(`[data-step="${name}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      focusFirstField(el?.querySelector('[data-step-body]'));
    }
  }

  function completeStep(name) {
    const el = page.querySelector(`[data-step="${name}"]`);
    if (!el) return;
    el.dataset.completed = '1';
    const badge = el.querySelector('[data-step-badge]');
    if (badge) {
      badge.textContent = '✓';
      badge.classList.remove('bg-frost-deep', 'text-charcoal/60');
      badge.classList.add('bg-leaf', 'text-white');
    }
  }

  page.addEventListener('click', (e) => {
    const nextStepBtn = e.target.closest('[data-next-step]');
    if (nextStepBtn) {
      const card = nextStepBtn.closest('[data-step]');
      const currentStep = card?.dataset.step;
      if (currentStep && !validateStep(currentStep)) return;
      if (currentStep) completeStep(currentStep);
      openStep(nextStepBtn.dataset.nextStep);
      return;
    }
    // Header click — re-open a step to edit it (collapses whatever's open).
    const head = e.target.closest('[data-step-head]');
    if (head) {
      const step = head.closest('[data-step]')?.dataset.step;
      if (step) openStep(step);
    }
  });

  // Start with only the first step expanded.
  openStep('dates', { scroll: false });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dropoffLocal = form.dropoffAt.value;
    const pickupLocal = form.pickupAt.value;
    const dropoffIso = localDatetimeToIso(dropoffLocal);
    const pickupIso = localDatetimeToIso(pickupLocal);
    if (!dropoffIso || !pickupIso) {
      setFieldError(form.dropoffAt, !dropoffIso);
      setFieldError(form.pickupAt, !pickupIso);
      openStep('dates');
      showToast(t('longTerm.invalidDates'), 'error');
      return;
    }
    const dropoffMs = new Date(dropoffIso).getTime();
    const pickupMs = new Date(pickupIso).getTime();
    if (pickupMs <= dropoffMs) {
      setFieldError(form.pickupAt, true);
      openStep('dates');
      showToast(t('longTerm.invalidDates'), 'error');
      return;
    }
    if (pickupMs - dropoffMs < 60 * 60 * 1000) {
      setFieldError(form.pickupAt, true);
      openStep('dates');
      showToast(t('longTerm.minDuration'), 'error');
      return;
    }
    const days = billingDays(dropoffMs, pickupMs);
    if (days < 1) { openStep('dates'); showToast(t('longTerm.invalidDates'), 'error'); return; }

    const licensePlate = resolvePlate();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();

    const plateInput = form.querySelector('input[name="licensePlate"]');
    const checks = [
      [isPlateInputActive() ? plateInput : null, isValidLicensePlate(licensePlate)],
      [form.name, required(name)],
      [form.email, isValidEmail(email)],
    ];
    let hasError = false;
    for (const [input, ok] of checks) {
      setFieldError(input, !ok);
      if (!ok) hasError = true;
    }
    // Terms agreement is the legal gate — browsers also enforce `required`
    // on the checkbox, but we double-check here so users get a specific
    // toast instead of the browser's tooltip if they tab past it.
    if (!form.acceptTerms?.checked) {
      showToast(t('legal.acceptTermsRequired'), 'error');
      return;
    }
    if (!form.acceptPrivacy?.checked) {
      showToast(t('legal.acceptPrivacyRequired'), 'error');
      return;
    }
    if (hasError) {
      openStep('details');
      showToast(t('common.error'), 'error');
      return;
    }

    const billing = readBilling(form);
    if (billing.error) {
      openStep('billing');
      showToast(billing.error, 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    // Pay-at-pickup records a reservation (no card charge), so don't say
    // "processing payment" — say "processing reservation".
    btn.textContent = paymentMethod === 'pay-at-pickup'
      ? t('longTerm.processingPickup')
      : t('longTerm.processing');

    // Promo (new system) wins over signup (legacy) — they can't combine.
    // Both apply to online and pay-at-pickup; the server re-validates and
    // (for pickup) the agent collects the reduced amount.
    const voucherIdToSend = (!promoVoucher && voucher && voucher.status === 'unused' && quote.total > voucher.amount)
      ? voucher.userId
      : null;
    const voucherCodeToSend = promoVoucher ? promoVoucher.code : null;

    try {
      await startNetopiaPayment({
        orderType: 'longTerm',
        paymentMethod,
        // Backward compat: keep date-only fields populated so older admin
        // displays + the existing function path still work. New canonical
        // fields are dropoffAt/pickupAt.
        startDate: dropoffIso.slice(0, 10),
        endDate: pickupIso.slice(0, 10),
        dropoffAt: dropoffIso,
        pickupAt: pickupIso,
        days,
        // Always send the STANDARD total (server applies the online discount
        // for online orders; pay-at-pickup pays this as-is).
        totalPrice: quote.total,
        // Legacy signup voucher stays online-only; promo codes apply to both.
        voucherId: paymentMethod === 'online' ? voucherIdToSend : null,
        voucherCode: voucherCodeToSend,
        customerData: {
          customerId: user?.uid || null,
          licensePlate,
          name,
          email,
          phone,
          billing,
        },
      });
      // The browser is now navigating to Netopia's hosted page —
      // nothing else to do here.
    } catch (err) {
      console.error(err);
      // The server rejects a voucher that expired / sold out / lost the race
      // between preview and pay with an error like "voucher: expired". Strip
      // the now-invalid code and say so, instead of a generic error that
      // leaves the customer unable to pay.
      if (/voucher:/i.test(err?.message || '') && promoVoucher) {
        promoVoucher = null;
        if (voucherInput) voucherInput.value = '';
        renderAppliedVoucher();
        showToast(t('voucher.payFailed'), 'error');
      } else {
        showToast(t('common.error'), 'error');
      }
      btn.disabled = false;
      recompute(); // restores the correct button label + price for the method
    }
  });

  // #20: if the customer goes to Netopia and hits Back, the browser may
  // restore this page from the bfcache with the submit button still disabled
  // (its mid-submit state). Re-enable it on bfcache restore so they can
  // switch to pay-at-pickup and confirm. recompute() also fixes the label.
  function onPageShow(e) {
    if (!e.persisted) return;
    const btn = page.querySelector('[data-pay-btn]');
    if (btn) btn.disabled = false;
    recompute();
  }
  window.addEventListener('pageshow', onPageShow);

  container.appendChild(page);

  return () => window.removeEventListener('pageshow', onPageShow);
}
