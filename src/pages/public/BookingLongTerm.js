import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getLongTermRates, calculateLongTermCost, createLongTermBooking } from '../../services/longTermService.js';
import { getCurrentUser, getUserProfile } from '../../firebase/auth.js';
import { isValidEmail, isValidLicensePlate, required } from '../../utils/validators.js';
import { showToast } from '../../components/core/Toast.js';

function daysBetween(startIso, endIso) {
  const s = new Date(startIso).setHours(0, 0, 0, 0);
  const e = new Date(endIso).setHours(0, 0, 0, 0);
  const diff = Math.round((e - s) / 86_400_000);
  return diff > 0 ? diff : 0;
}

function formatIsoDate(d) {
  return d.toISOString().slice(0, 10);
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
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const dayAfter = new Date(today.getTime() + 3 * 86_400_000);

  let rates = null;
  let quote = { days: 2, perDay: 0, total: 0 };

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-28 pb-16 bg-frost min-h-screen">
      <div class="max-w-4xl mx-auto px-6">
        <div class="text-center mb-10">
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">Long-term</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${t('longTerm.pageTitle')}</h1>
          <p class="text-dim text-[17px]">${t('longTerm.pageSubtitle')}</p>
        </div>

        <form data-long-form class="grid md:grid-cols-2 gap-6">
          <!-- Dates -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('longTerm.startDate')} / ${t('longTerm.endDate')}</h3>
            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('longTerm.startDate')} *</label>
                <input type="date" name="startDate" required min="${formatIsoDate(today)}" value="${formatIsoDate(tomorrow)}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('longTerm.endDate')} *</label>
                <input type="date" name="endDate" required min="${formatIsoDate(tomorrow)}" value="${formatIsoDate(dayAfter)}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
              </div>
            </div>
            <p class="text-[12px] text-dim mt-3">${t('longTerm.tierNote')}</p>
          </div>

          <!-- Price tiers -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('rates.longTermRates')}</h3>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3" data-tiers>
              <!-- populated after getLongTermRates() resolves -->
            </div>
          </div>

          <!-- Vehicle -->
          <div class="card-solid rounded-3xl p-6">
            <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('longTerm.vehicleInfo')}</h3>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
            <input type="text" name="licensePlate" required placeholder="B 123 ABC" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] uppercase focus:outline-none focus:border-blueberry">
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

          <!-- Summary + pay -->
          <div class="card-solid rounded-3xl p-6 md:col-span-2 bg-blueberry-deep text-white">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <p class="text-[13px] text-white/70 uppercase tracking-wider font-mono mb-1">${t('longTerm.totalLabel')}</p>
                <div class="flex items-baseline gap-2">
                  <span class="font-heading font-bold text-4xl" data-quote-total>0</span>
                  <span class="text-white/70 text-[14px]">lei</span>
                </div>
                <p class="text-[13px] text-white/60 mt-1"><span data-quote-days>0</span> ${t('longTerm.days')} × <span data-quote-perday>0</span> ${t('longTerm.perDay')}</p>
              </div>
              <button type="submit" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-10 py-4 rounded-2xl shadow-md transition-colors">${t('longTerm.payNow')}</button>
            </div>
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
    const startDate = form.startDate.value;
    const endDate = form.endDate.value;
    const days = daysBetween(startDate, endDate);
    quote = calculateLongTermCost(days, rates);
    totalEl.textContent = quote.total;
    daysEl.textContent = quote.days;
    perdayEl.textContent = quote.perDay;
    highlightActiveTier();
  }

  // Load rates, then render tiers + compute initial quote
  getLongTermRates().then(r => {
    rates = r;
    renderTiers();
    recompute();
  });

  ['startDate', 'endDate'].forEach(name => {
    form[name].addEventListener('change', recompute);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const startDate = form.startDate.value;
    const endDate = form.endDate.value;
    const days = daysBetween(startDate, endDate);
    if (days < 1) { showToast(t('longTerm.invalidDates'), 'error'); return; }

    const licensePlate = form.licensePlate.value.trim();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();

    if (!isValidLicensePlate(licensePlate) || !required(name) || !isValidEmail(email)) {
      showToast(t('common.error'), 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = t('longTerm.processing');

    try {
      // Netopia payment stub — simulate 1.5s, then create booking
      await new Promise(r => setTimeout(r, 1500));
      await createLongTermBooking({
        customerId: user?.uid || null,
        licensePlate,
        startDate,
        endDate,
        days,
        totalPrice: quote.total,
        contact: { name, email, phone },
        paymentId: `stub_${Date.now()}`,
      });
      form.style.display = 'none';
      page.querySelector('[data-confirmation]').classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
      btn.disabled = false;
      btn.textContent = t('longTerm.payNow');
    }
  });

  container.appendChild(page);
}
