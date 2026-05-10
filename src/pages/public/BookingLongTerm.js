import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate, setFieldError, clearErrorOnInput } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getLongTermRates, calculateLongTermCost } from '../../services/longTermService.js';
import { startNetopiaPayment } from '../../services/netopiaService.js';
import { getOnlineDiscountPercent, originalFromOnline } from '../../services/discountService.js';
import { billingFieldsHtml, wireBillingToggle, readBilling } from '../../components/widgets/BillingFields.js';
import { dateTimeFieldHtml, wireDateTime } from '../../components/core/FormDateTime.js';
import { getMyVoucher } from '../../services/voucherService.js';
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
  let discount = 0;
  let voucher = null;  // user's unused signup voucher, if any
  let quote = { days: 1, perDay: 0, total: 0, hours: 24 };

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
          <div class="card-solid rounded-3xl p-6 md:col-span-2">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('longTerm.dropoffAt')} / ${t('longTerm.pickupAt')}</h3>
            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('longTerm.dropoffAt')} *</label>
                ${dateTimeFieldHtml({ name: 'dropoffAt', value: toLocalDatetimeValue(tomorrow10), min: toLocalDatetimeValue(minDropoff), required: true })}
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('longTerm.pickupAt')} *</label>
                ${dateTimeFieldHtml({ name: 'pickupAt', value: toLocalDatetimeValue(dayAfter10), min: toLocalDatetimeValue(tomorrow10), required: true })}
              </div>
            </div>
            <p class="text-[12px] text-dim mt-3">${t('longTerm.graceNote')}</p>
            <p class="text-[12px] text-dim mt-1">${t('longTerm.tierNote')}</p>
          </div>

          <!-- Price tiers -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('rates.longTermRates')}</h3>
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
          <div class="card-solid rounded-3xl p-6">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('longTerm.vehicleInfo')}</h3>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
            <input type="text" name="licensePlate" required placeholder="B 123 ABC" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] uppercase focus:outline-none focus:border-blueberry">
          </div>

          <!-- Billing (PF/PJ) -->
          <div class="md:col-span-2">
            ${billingFieldsHtml(profile?.billing)}
          </div>

          <!-- Contact -->
          <div class="card-solid rounded-3xl p-6">
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
          </div>

          <!-- Pay -->
          <div class="md:col-span-2 flex justify-end">
            <button type="submit" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-10 py-4 rounded-2xl shadow-md transition-colors">${t('longTerm.payNow')}</button>
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

  function renderTiers() {
    if (!rates?.tiers?.length) return;
    const label = locale === 'ro' ? 'zile' : 'days';
    tiersEl.innerHTML = rates.tiers.map(tier => {
      const rangeLabel = tier.maxDays
        ? `${tier.minDays}–${tier.maxDays} ${label}`
        : `${tier.minDays}+ ${label}`;
      return `
        <div data-tier-min="${tier.minDays}" class="rounded-2xl border-2 border-frost-deep bg-white px-4 py-3 transition-colors">
          <p class="text-[12px] font-mono uppercase text-dim tracking-wider">${rangeLabel}</p>
          <p class="font-heading font-bold text-2xl text-blueberry-deep mt-1">${tier.perDay} <span class="text-[12px] font-normal text-dim">${t('longTerm.perDay')}</span></p>
        </div>`;
    }).join('');
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
    quote = { ...calculateLongTermCost(days, rates), hours };
    totalEl.textContent = quote.total || '—';
    daysEl.textContent = quote.days || '—';
    perdayEl.textContent = quote.perDay || '—';
    hoursLineEl.textContent = hours > 0 ? t('longTerm.durationHours', { hours }) : '—';
    // Strikethrough anchor + discount badge — only when discount is configured.
    const original = originalFromOnline(quote.total, discount);
    if (original != null && original !== quote.total) {
      originalEl.textContent = `${original} lei`;
      originalEl.classList.remove('hidden');
      discountBadgeEl.textContent = t('discount.online', { percent: discount });
      discountBadgeEl.classList.remove('hidden');
    } else {
      originalEl.classList.add('hidden');
      discountBadgeEl.classList.add('hidden');
    }
    // Voucher line — visible only if user has an unused voucher AND order
    // total is strictly above voucher amount (we never apply if it would
    // zero/negative the Netopia charge).
    if (voucher && voucher.status === 'unused' && quote.total > voucher.amount) {
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
  ]).then(([r, d, v]) => {
    rates = r && r.tiers?.length ? r : FALLBACK_RATES;
    discount = d || 0;
    voucher = v;
    renderTiers();
    recompute();
  });

  ['dropoffAt', 'pickupAt'].forEach(name => {
    form[name].addEventListener('change', recompute);
    form[name].addEventListener('input', recompute);
  });

  // Clear red field-error state as the user edits.
  ['dropoffAt', 'pickupAt', 'licensePlate', 'name', 'email', 'phone']
    .forEach(name => clearErrorOnInput(form[name]));

  // Wire the PF/PJ toggle.
  wireBillingToggle(form);

  // Branded date/time pickers (flatpickr, 24h, click-anywhere opens).
  wireDateTime(form);

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
    const voucherIdToSend = (voucher && voucher.status === 'unused' && quote.total > voucher.amount)
      ? voucher.userId
      : null;

    try {
      await startNetopiaPayment({
        orderType: 'longTerm',
        // Backward compat: keep date-only fields populated so older admin
        // displays + the existing function path still work. New canonical
        // fields are dropoffAt/pickupAt.
        startDate: dropoffIso.slice(0, 10),
        endDate: pickupIso.slice(0, 10),
        dropoffAt: dropoffIso,
        pickupAt: pickupIso,
        days,
        totalPrice: quote.total,
        voucherId: voucherIdToSend,
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
