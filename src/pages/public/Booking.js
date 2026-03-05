import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, qs, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { calculatePrice, getCommuterRate, getPricingTiers, getAddOns } from '../../services/pricingService.js';
import { createBooking } from '../../services/bookingService.js';
import { createSubscription } from '../../services/subscriptionService.js';
import { daysBetween } from '../../utils/date.js';
import { isValidEmail, isValidPhone, isValidLicensePlate, required } from '../../utils/validators.js';
import { showToast } from '../../components/core/Toast.js';
import { TOTAL_CAPACITY } from '../../utils/constants.js';

export default async function Booking(container) {
  const locale = getLocale();
  updateMeta({
    title: locale === 'ro' ? 'Rezervă Locul Tău — Mango Parking' : 'Book Your Spot — Mango Parking',
    description: locale === 'ro'
      ? 'Rezervă parcare la Aeroportul Otopeni. Plata la sosire, shuttle gratuită inclusă.'
      : 'Book parking at Otopeni Airport. Pay on arrival, free shuttle included.',
    lang: locale,
  });

  const tiers = await getPricingTiers();
  const addons = await getAddOns();
  const commuterRate = getCommuterRate();
  const mockAvailable = 87;

  let currentTab = 'traveler';
  let priceResult = null;
  let confirmed = false;
  let confirmCode = '';

  function render() {
    const page = html`<div>
      <div data-navbar></div>

      <section class="pt-32 pb-20">
        <div class="max-w-3xl mx-auto px-6">
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] mb-4">${t('booking.pageTitle')}</h1>

          <!-- Capacity badge -->
          <div class="inline-flex items-center gap-2 bg-white/60 backdrop-blur-sm border border-white/80 rounded-full px-4 py-1.5 mb-10 shadow-sm">
            <span class="w-2 h-2 rounded-full bg-leaf animate-[pulse_2s_ease-in-out_infinite]"></span>
            <span class="text-charcoal/60 text-[14px] font-medium">${t('booking.spotsLeft', { count: mockAvailable })}</span>
          </div>

          ${confirmed ? renderConfirmation() : renderForm()}
        </div>
      </section>

      <div data-footer></div>
    </div>`;

    page.querySelector('[data-navbar]').replaceWith(Navbar());
    page.querySelector('[data-footer]').replaceWith(Footer());
    return page;
  }

  function renderConfirmation() {
    const isCommuter = currentTab === 'commuter';
    return `
      <div class="card-solid rounded-3xl p-10 text-center">
        <div class="w-16 h-16 rounded-full bg-leaf/10 flex items-center justify-center mx-auto mb-6">
          <svg class="w-8 h-8 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 class="font-heading text-2xl font-bold mb-2">${isCommuter ? t('booking.subscriptionConfirmed') : t('booking.confirmed')}</h2>
        <p class="text-dim text-[15px] mb-6">${isCommuter ? t('booking.subscriptionCode') : t('booking.bookingCode')}</p>
        <div class="bg-frost rounded-2xl px-8 py-5 inline-block mb-6">
          <span class="font-mono font-bold text-3xl tracking-wider">${confirmCode}</span>
        </div>
        <p class="text-dim text-[14px] mb-8">${t('booking.bookingCodeNote')}</p>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="${localePath('/')}" class="bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('booking.backHome')}</a>
          <button data-new-booking class="glass font-semibold text-[15px] px-6 py-3 rounded-xl hover:bg-white/70 transition-colors">${t('booking.newBooking')}</button>
        </div>
      </div>
    `;
  }

  function renderForm() {
    return `
      <!-- Tabs -->
      <div class="flex gap-2 mb-8">
        <button data-tab="traveler" class="px-6 py-3 rounded-xl text-[15px] font-semibold transition-colors ${currentTab === 'traveler' ? 'bg-charcoal text-white' : 'bg-white text-charcoal/50 hover:text-charcoal'}">${t('booking.travelerTab')}</button>
        <button data-tab="commuter" class="px-6 py-3 rounded-xl text-[15px] font-semibold transition-colors ${currentTab === 'commuter' ? 'bg-charcoal text-white' : 'bg-white text-charcoal/50 hover:text-charcoal'}">${t('booking.commuterTab')}</button>
      </div>

      <form data-booking-form class="space-y-6">
        ${currentTab === 'traveler' ? renderTravelerForm() : renderCommuterForm()}

        <!-- Contact Info -->
        <div class="card-solid rounded-2xl p-6">
          <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.contactInfo')}</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.name')} *</label>
              <input type="text" name="name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.phone')} *</label>
              <input type="tel" name="phone" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
            </div>
          </div>
          <div class="mt-4">
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.email')} *</label>
            <input type="email" name="email" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
          </div>
        </div>

        <!-- Summary -->
        <div class="card-solid rounded-2xl p-6" data-summary>
          <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.summary')}</h3>
          <div data-price-summary class="text-[15px] text-dim">
            ${currentTab === 'traveler'
              ? '<p class="text-dim/60">Select dates to see pricing</p>'
              : `<div class="flex justify-between mb-2"><span>${t('booking.monthlyRate')}</span><span class="font-mono font-semibold text-charcoal">${commuterRate} lei</span></div>`
            }
          </div>
          <p class="text-[13px] text-dim/40 mt-4">${t('booking.payOnArrival')}</p>
        </div>

        <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-white font-semibold text-[16px] py-4 rounded-2xl transition-colors shadow-md">
          ${currentTab === 'traveler' ? t('booking.confirm') : t('booking.subscribe')}
        </button>
      </form>
    `;
  }

  function renderTravelerForm() {
    return `
      <!-- Dates -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.dropOff')} / ${t('booking.pickUp')}</h3>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.dropOff')}</label>
            <input type="datetime-local" name="dropOff" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
          </div>
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.pickUp')}</label>
            <input type="datetime-local" name="pickUp" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
          </div>
        </div>
      </div>

      <!-- Vehicle -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.vehicle')}</h3>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
            <input type="text" name="licensePlate" placeholder="B 123 ABC" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 uppercase" required>
          </div>
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.makeModel')}</label>
            <input type="text" name="makeModel" placeholder="Dacia Logan" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
          </div>
        </div>
      </div>

      <!-- Add-ons -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.addOns')}</h3>
        <div class="space-y-3">
          ${addons.map(a => `
            <label class="flex items-center justify-between p-3 rounded-xl border border-frost-deep hover:border-mango/30 transition-colors cursor-pointer">
              <div class="flex items-center gap-3">
                <input type="checkbox" name="addon" value="${a.id}" class="w-4 h-4 rounded accent-mango">
                <span class="text-[15px] font-medium">${locale === 'ro' && a.nameRo ? a.nameRo : a.name}</span>
              </div>
              <span class="text-[14px] font-mono text-dim">${a.price} lei${a.type === 'per_day' ? ('/' + (locale === 'ro' ? 'zi' : 'day')) : ''}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderCommuterForm() {
    return `
      <!-- Start month -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.startMonth')}</h3>
        <input type="month" name="startMonth" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
        <p class="text-[13px] text-dim mt-2">${t('booking.commuterTerms')}</p>
      </div>

      <!-- Vehicle -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.vehicle')}</h3>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
            <input type="text" name="licensePlate" placeholder="B 123 ABC" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 uppercase" required>
          </div>
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.makeModel')}</label>
            <input type="text" name="makeModel" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
          </div>
        </div>
      </div>
    `;
  }

  async function updatePrice(form) {
    const dropOff = form.querySelector('[name="dropOff"]')?.value;
    const pickUp = form.querySelector('[name="pickUp"]')?.value;
    const summaryEl = form.querySelector('[data-price-summary]');
    if (!dropOff || !pickUp || !summaryEl) return;

    const days = daysBetween(dropOff, pickUp);
    const selectedAddons = [...form.querySelectorAll('[name="addon"]:checked')].map(el => el.value);
    priceResult = await calculatePrice(days, selectedAddons);

    summaryEl.innerHTML = `
      <div class="space-y-2">
        <div class="flex justify-between gap-2"><span class="flex-shrink-0">${t('booking.duration')}</span><span class="font-mono font-semibold text-right text-[13px]">${days} ${t('booking.days')}</span></div>
        <div class="flex justify-between gap-2"><span class="flex-shrink-0">${t('booking.basePrice')}</span><span class="font-mono text-right text-[13px]">${priceResult.pricePerDay} lei/zi × ${days} = ${priceResult.basePrice} lei</span></div>
        ${priceResult.addOnTotal > 0 ? `<div class="flex justify-between gap-2"><span class="flex-shrink-0">${t('booking.addOns')}</span><span class="font-mono text-right text-[13px]">+${priceResult.addOnTotal} lei</span></div>` : ''}
        <div class="flex justify-between gap-2 pt-2 border-t border-frost-deep text-charcoal font-semibold"><span class="flex-shrink-0">${t('booking.total')}</span><span class="font-mono text-lg text-right">${priceResult.total} lei</span></div>
      </div>
    `;
  }

  const page = render();
  container.appendChild(page);

  // Tab switching
  delegate(page, 'click', '[data-tab]', (e, btn) => {
    currentTab = btn.dataset.tab;
    container.innerHTML = '';
    const newPage = render();
    container.appendChild(newPage);
    bindEvents(newPage);
  });

  // New booking button
  delegate(page, 'click', '[data-new-booking]', () => {
    confirmed = false;
    confirmCode = '';
    container.innerHTML = '';
    const newPage = render();
    container.appendChild(newPage);
    bindEvents(newPage);
  });

  function bindEvents(pageEl) {
    const form = pageEl.querySelector('[data-booking-form]');
    if (!form) return;

    // Price update on date/addon change
    form.querySelectorAll('[name="dropOff"], [name="pickUp"]').forEach(input => {
      input.addEventListener('change', () => updatePrice(form));
    });
    form.querySelectorAll('[name="addon"]').forEach(input => {
      input.addEventListener('change', () => updatePrice(form));
    });

    // Submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const name = fd.get('name');
      const phone = fd.get('phone');
      const email = fd.get('email');
      const licensePlate = fd.get('licensePlate');

      if (!required(name)) { showToast(t('booking.errors.name'), 'error'); return; }
      if (!isValidPhone(phone)) { showToast(t('booking.errors.phone'), 'error'); return; }
      if (!isValidEmail(email)) { showToast(t('booking.errors.email'), 'error'); return; }

      try {
        if (currentTab === 'traveler') {
          const dropOff = fd.get('dropOff');
          const pickUp = fd.get('pickUp');
          if (!dropOff || !pickUp) { showToast(t('booking.errors.dates'), 'error'); return; }

          const selectedAddons = [...form.querySelectorAll('[name="addon"]:checked')].map(el => el.value);
          const days = daysBetween(dropOff, pickUp);
          const price = await calculatePrice(days, selectedAddons);

          const result = await createBooking({
            name, phone, email, licensePlate,
            makeModel: fd.get('makeModel') || '',
            dropOff, pickUp,
            addOns: selectedAddons,
            estimatedPrice: price.total,
          });
          confirmCode = result.code;
        } else {
          const result = await createSubscription({
            name, phone, email, licensePlate,
            makeModel: fd.get('makeModel') || '',
            startMonth: fd.get('startMonth'),
            monthlyRate: commuterRate,
          });
          confirmCode = result.code;
        }

        confirmed = true;
        container.innerHTML = '';
        const newPage = render();
        container.appendChild(newPage);
      } catch (err) {
        console.error(err);
        showToast(t('common.error'), 'error');
      }
    });
  }

  bindEvents(page);
}
