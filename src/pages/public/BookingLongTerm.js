import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, setFieldError, clearErrorOnInput } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getLongTermRates, calculateLongTermCost } from '../../services/longTermService.js';
import { listSeasonalPeriods, getEffectiveRates } from '../../services/seasonalRatesService.js';
import { startNetopiaPayment } from '../../services/netopiaService.js';
import { getOnlineDiscountPercent, originalFromOnline } from '../../services/discountService.js';
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
    title: `${t('longTerm.pageTitle')} — Mango Parking`,
    description: t('longTerm.pageSubtitle'),
    lang: locale,
  });

  const user = getCurrentUser();
  const profile = getUserProfile();

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

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-28 pb-16 bg-frost min-h-screen">
      <div class="max-w-4xl mx-auto px-6">
        <div class="text-center mb-10">
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('funnel.longTerm.title')}</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${t('longTerm.pageTitle')}</h1>
          <p class="text-dim text-[17px]">${t('longTerm.pageSubtitle')}</p>
        </div>

        <form data-long-form class="grid md:grid-cols-2 gap-6">
          <!-- Drop-off / Pick-up date+time -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2" data-step="dates">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('longTerm.dropoffAt')} / ${t('longTerm.pickupAt')}</h3>
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
            <div class="flex justify-end mt-5">
              <button type="button" data-next-step="vehicle" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('longTerm.nextStep')} →</button>
            </div>
          </div>

          <!-- Price tiers -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2">
            <div class="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h3 class="font-heading font-bold text-lg text-blueberry-deep">${t('rates.longTermRates')}</h3>
              <span class="hidden text-[12px] uppercase tracking-wider font-mono font-semibold text-mango bg-mango/10 px-3 py-1 rounded-full" data-seasonal-badge></span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3" data-tiers>
              <!-- populated after getLongTermRates() resolves -->
            </div>
          </div>

          <!-- Summary (live total) -->
          <div class="rounded-3xl p-6 md:col-span-2 bg-blueberry-deep text-white shadow-lg">
            <p class="text-[12px] text-white/70 uppercase tracking-wider font-mono mb-2">${t('longTerm.totalLabel')}</p>
            <p class="text-white/50 line-through font-mono text-[15px] hidden" data-quote-original></p>
            <div class="flex items-baseline gap-2 mb-2">
              <span class="font-heading font-bold text-5xl" data-quote-total>—</span>
              <span class="text-white/70 text-lg">lei</span>
              <span class="text-[11px] font-bold uppercase tracking-wider text-mango ml-2 hidden" data-quote-discount-badge></span>
            </div>
            <p class="text-[14px] text-white/70"><span data-quote-days>—</span> ${t('longTerm.days')} × <span data-quote-perday>—</span> ${t('longTerm.perDay')}</p>
            <p class="text-[12px] text-white/50 mt-1" data-quote-hours-line>—</p>
            <p class="text-[13px] text-mango mt-2 hidden" data-voucher-line></p>
          </div>

          <!-- Vehicle -->
          <div class="card-solid rounded-3xl p-6" data-step="vehicle">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('longTerm.vehicleInfo')}</h3>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
            <input type="text" name="licensePlate" required placeholder="B 123 ABC" value="${profile?.vehicles?.[0]?.plate || ''}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] uppercase focus:outline-none focus:border-blueberry">
            <div class="flex justify-end mt-5">
              <button type="button" data-next-step="billing" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('longTerm.nextStep')} →</button>
            </div>
          </div>

          <!-- Billing (PF/PJ) -->
          <div class="md:col-span-2" data-step="billing">
            ${billingFieldsHtml(profile?.billing)}
            <div class="flex justify-end mt-5">
              <button type="button" data-next-step="paymethod" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('longTerm.nextStep')} →</button>
            </div>
          </div>

          <!-- Payment method -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2" data-paymethod-block data-step="paymethod">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('payment.method.title')}</h3>
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
            <div class="flex justify-end mt-5">
              <button type="button" data-next-step="contact" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('longTerm.nextStep')} →</button>
            </div>
          </div>

          <!-- Contact -->
          <div class="card-solid rounded-3xl p-6" data-step="contact">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('longTerm.contactInfo')}</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.name')} *</label>
                <input type="text" name="name" required value="${profile?.displayName || user?.displayName || ''}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.email')} *</label>
                <input type="email" name="email" required value="${profile?.email || user?.email || ''}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.phone')}</label>
                <input type="tel" name="phone" value="${profile?.phone || ''}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
              </div>
            </div>
            <div class="flex justify-end mt-5">
              <button type="button" data-next-step="terms" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('longTerm.nextStep')} →</button>
            </div>
          </div>

          <!-- Voucher code -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2" data-voucher-block>
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-3">${t('voucher.codeTitle')}</h3>
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
          </div>

          <!-- Terms agreement + pay -->
          <div class="md:col-span-2 flex flex-col items-end gap-4" data-step="terms">
            <label class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer max-w-full">
              <input type="checkbox" name="acceptTerms" required class="accent-mango w-4 h-4 mt-1 shrink-0">
              <span>${t('legal.acceptTerms')}</span>
            </label>
            <button type="submit" data-pay-btn class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-10 py-4 rounded-2xl shadow-md transition-colors">${t('longTerm.payNow')}</button>
          </div>
        </form>

        <!-- Confirmation (hidden until success) -->
        <div data-confirmation class="hidden card-solid rounded-3xl p-10 text-center mt-6">
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
      return `
        <div data-tier-min="${tier.minDays}" class="rounded-2xl border-2 border-frost-deep bg-white px-4 py-3 transition-colors">
          <p class="text-[12px] font-mono uppercase text-dim tracking-wider">${rangeLabel}</p>
          <p class="font-heading font-bold text-2xl text-blueberry-deep mt-1">${tier.perDay} <span class="text-[12px] font-normal text-dim">${t('longTerm.perDay')}</span></p>
        </div>`;
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
    tiersEl.querySelectorAll('[data-tier-min]').forEach(el => {
      const isActive = Number(el.dataset.tierMin) === quote.tier.minDays;
      el.classList.toggle('border-mango', isActive);
      el.classList.toggle('bg-mango/10', isActive);
      el.classList.toggle('border-frost-deep', !isActive);
      el.classList.toggle('bg-white', !isActive);
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
    const original = originalFromOnline(quote.total, discount);
    const isPickup = paymentMethod === 'pay-at-pickup';
    const displayTotal = isPickup && original ? original : quote.total;
    const displayPerDay = isPickup && original && quote.days
      ? Math.round(original / quote.days)
      : quote.perDay;
    // Promo voucher application — only on online payments. The displayed
    // total subtracts the discount; the voucher amount is also passed
    // into createPayment which re-validates server-side.
    let finalTotal = displayTotal;
    if (!isPickup && promoVoucher?.discountAmount) {
      finalTotal = Math.max(1, displayTotal - promoVoucher.discountAmount);
    }
    totalEl.textContent = finalTotal || '—';
    daysEl.textContent = quote.days || '—';
    perdayEl.textContent = displayPerDay || '—';
    hoursLineEl.textContent = hours > 0 ? t('longTerm.durationHours', { hours }) : '—';
    // Strikethrough anchor + discount badge — only on the online branch.
    // For pay-at-pickup the displayed total IS the original, so there's
    // nothing left to strike through.
    if (!isPickup && original != null && original !== quote.total) {
      originalEl.textContent = `${original} lei`;
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

  // Wire the PF/PJ toggle.
  wireBillingToggle(form);

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
    const detail = promoVoucher.type === 'percent'
      ? t('voucher.appliedPercent', { value: promoVoucher.value, amount: promoVoucher.discountAmount })
      : t('voucher.appliedFixed', { amount: promoVoucher.discountAmount });
    voucherAppliedDetail.textContent = detail;
  }

  function voucherEligibleBase() {
    // The server expects the ONLINE base (before pay-at-pickup gross-up).
    return Number(quote?.total) || 0;
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      setVoucherError('');
      const code = normalizeCode(voucherInput.value);
      if (!code) { setVoucherError(t('voucher.errorEmpty')); return; }
      const plate = form.licensePlate.value.trim();
      if (!plate) { setVoucherError(t('voucher.errorNeedPlate')); return; }
      const base = voucherEligibleBase();
      if (!base) { setVoucherError(t('voucher.errorNoBase')); return; }
      applyBtn.disabled = true;
      applyBtn.textContent = t('common.loading');
      try {
        const res = await previewVoucher({ code, plate, baseAmount: base, orderType: 'longTerm' });
        if (res?.ok) {
          promoVoucher = {
            code: res.voucherCode,
            name: res.name,
            type: res.type,
            value: res.value,
            discountAmount: res.discountAmount,
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
    if (step === 'vehicle') {
      const ok = isValidLicensePlate(form.licensePlate.value.trim());
      setFieldError(form.licensePlate, !ok);
      if (!ok) { showToast(t('common.error'), 'error'); return false; }
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
    if (step === 'contact') {
      const nameOk = required(form.name.value.trim());
      const emailOk = isValidEmail(form.email.value.trim());
      setFieldError(form.name, !nameOk);
      setFieldError(form.email, !emailOk);
      if (!nameOk || !emailOk) { showToast(t('common.error'), 'error'); return false; }
      return true;
    }
    return true;
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

  page.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-next-step]');
    if (!btn) return;
    const currentCard = btn.closest('[data-step]');
    const currentStep = currentCard?.dataset.step;
    if (currentStep && !validateStep(currentStep)) return;
    const nextStep = btn.dataset.nextStep;
    const target = page.querySelector(`[data-step="${nextStep}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    focusFirstField(target);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dropoffLocal = form.dropoffAt.value;
    const pickupLocal = form.pickupAt.value;
    const dropoffIso = localDatetimeToIso(dropoffLocal);
    const pickupIso = localDatetimeToIso(pickupLocal);
    if (!dropoffIso || !pickupIso) {
      setFieldError(form.dropoffAt, !dropoffIso);
      setFieldError(form.pickupAt, !pickupIso);
      showToast(t('longTerm.invalidDates'), 'error');
      return;
    }
    const dropoffMs = new Date(dropoffIso).getTime();
    const pickupMs = new Date(pickupIso).getTime();
    if (pickupMs <= dropoffMs) {
      setFieldError(form.pickupAt, true);
      showToast(t('longTerm.invalidDates'), 'error');
      return;
    }
    if (pickupMs - dropoffMs < 60 * 60 * 1000) {
      setFieldError(form.pickupAt, true);
      showToast(t('longTerm.minDuration'), 'error');
      return;
    }
    const days = billingDays(dropoffMs, pickupMs);
    if (days < 1) { showToast(t('longTerm.invalidDates'), 'error'); return; }

    const licensePlate = form.licensePlate.value.trim();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();

    const checks = [
      [form.licensePlate, isValidLicensePlate(licensePlate)],
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
    if (hasError) {
      showToast(t('common.error'), 'error');
      return;
    }

    const billing = readBilling(form);
    if (billing.error) {
      showToast(billing.error, 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = t('longTerm.processing');

    // Apply voucher only if it would still leave a positive Netopia charge.
    // Promo (new system) wins over signup (legacy) — they can't combine.
    const voucherIdToSend = (!promoVoucher && voucher && voucher.status === 'unused' && quote.total > voucher.amount)
      ? voucher.userId
      : null;
    const voucherCodeToSend = promoVoucher && paymentMethod === 'online' ? promoVoucher.code : null;

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
        // Always send the ONLINE total (server grosses up for pay-at-pickup).
        totalPrice: quote.total,
        // Voucher only applies to the online branch.
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
      showToast(t('common.error'), 'error');
      btn.disabled = false;
      btn.textContent = t('longTerm.payNow');
    }
  });

  container.appendChild(page);
}
