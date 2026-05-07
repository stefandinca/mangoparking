import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { subscribeDoc } from '../../firebase/db.js';

// /booking/return?orderId=ord_xxx
//
// Subscribes to pendingOrders/{orderId} and renders one of three states:
//   pending  — the IPN hasn't arrived yet (or arrived in <1s, before
//              the snapshot listener attached). Shows a spinner.
//   paid     — order is fulfilled (tokens credited or booking created).
//   failed/canceled — payment did not go through; offer retry CTA.
//
// The IPN callback (server-side) is the source of truth for status.

export default function BookingReturn(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('return.title')} — Mango Parking`,
    description: t('return.subtitleProcessing'),
    lang: locale,
  });

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-32 pb-20 min-h-screen bg-frost">
      <div class="max-w-2xl mx-auto px-6">
        <div data-status class="card-solid rounded-3xl p-10 text-center">
          ${renderProcessing()}
        </div>
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  const statusEl = page.querySelector('[data-status]');

  if (!orderId) {
    statusEl.innerHTML = renderError(t('return.missingOrderId'));
    container.appendChild(page);
    return;
  }

  // Watchdog: if no terminal status arrives in 90s, fall back to a
  // softer "still processing" message — IPN can occasionally lag, but
  // staying on a spinner forever feels broken.
  let terminal = false;
  const watchdog = setTimeout(() => {
    if (!terminal) statusEl.innerHTML = renderSlow(orderId);
  }, 90_000);

  const unsubscribe = subscribeDoc('pendingOrders', orderId, (order) => {
    if (!order) {
      // Doc doesn't exist (yet, or wrong id) — keep waiting briefly,
      // then show error if still missing.
      return;
    }
    const status = String(order.status || 'pending').toLowerCase();
    if (status === 'paid') {
      terminal = true;
      clearTimeout(watchdog);
      statusEl.innerHTML = renderSuccess(order);
      unsubscribe?.();
      return;
    }
    if (['failed', 'canceled', 'cancelled', 'credit'].includes(status)) {
      terminal = true;
      clearTimeout(watchdog);
      statusEl.innerHTML = renderFailure(order);
      unsubscribe?.();
      return;
    }
    // status === 'pending' — keep showing the spinner.
  });

  container.appendChild(page);

  return () => {
    clearTimeout(watchdog);
    unsubscribe?.();
  };
}

function renderProcessing() {
  return `
    <div class="w-16 h-16 rounded-full bg-mango/10 flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-mango animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"/>
      </svg>
    </div>
    <h1 class="font-heading text-2xl md:text-3xl font-bold text-blueberry-deep mb-2">${t('return.titleProcessing')}</h1>
    <p class="text-dim text-[15px]">${t('return.subtitleProcessing')}</p>
  `;
}

function renderSuccess(order) {
  const isLongTerm = order.orderType === 'longTerm';
  const detail = isLongTerm
    ? `${order.days} ${t('longTerm.days')} · ${order.totalPrice} ${t('common.lei')}`
    : `${order.quantity} ${t('credit.plural')} · ${order.amount} ${t('common.lei')}`;

  return `
    <div class="w-16 h-16 rounded-full bg-leaf/10 flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
      </svg>
    </div>
    <h1 class="font-heading text-2xl md:text-3xl font-bold text-blueberry-deep mb-2">${t('return.titleSuccess')}</h1>
    <p class="text-dim text-[15px] mb-6">${t('return.subtitleSuccess')}</p>
    <div class="bg-frost rounded-2xl px-6 py-4 inline-block mb-6">
      <p class="font-mono font-semibold text-[15px]">${detail}</p>
    </div>
    <div class="flex flex-col sm:flex-row gap-3 justify-center">
      <a href="${localePath('/')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('booking.backHome')}</a>
      ${isLongTerm
        ? `<a href="${localePath('/account/bookings')}" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.viewBookings')}</a>`
        : `<a href="${localePath('/account')}" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.viewBalance')}</a>`}
    </div>
  `;
}

function renderFailure(order) {
  const retryHref = order.orderType === 'longTerm'
    ? localePath('/booking/long-term')
    : localePath('/booking/credits');
  return `
    <div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </div>
    <h1 class="font-heading text-2xl md:text-3xl font-bold text-blueberry-deep mb-2">${t('return.titleFailure')}</h1>
    <p class="text-dim text-[15px] mb-6">${t('return.subtitleFailure')}</p>
    <div class="flex flex-col sm:flex-row gap-3 justify-center">
      <a href="${retryHref}" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.tryAgain')}</a>
      <a href="${localePath('/contact')}" class="font-semibold text-[15px] px-6 py-3 rounded-xl border-2 border-frost-deep hover:bg-white transition-colors">${t('return.contactUs')}</a>
    </div>
  `;
}

function renderSlow(orderId) {
  return `
    <div class="w-16 h-16 rounded-full bg-mango/10 flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-mango" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    </div>
    <h1 class="font-heading text-2xl md:text-3xl font-bold text-blueberry-deep mb-2">${t('return.titleSlow')}</h1>
    <p class="text-dim text-[15px] mb-2">${t('return.subtitleSlow')}</p>
    <p class="text-dim text-[12px] font-mono mb-6">${orderId}</p>
    <a href="${localePath('/contact')}" class="inline-block bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.contactUs')}</a>
  `;
}

function renderError(message) {
  return `
    <div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    </div>
    <p class="text-dim text-[15px] mb-6">${message}</p>
    <a href="${localePath('/booking')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.backToBooking')}</a>
  `;
}
