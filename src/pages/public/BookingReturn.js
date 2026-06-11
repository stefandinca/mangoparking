import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { subscribeDoc } from '../../firebase/db.js';
import { getCurrentUser } from '../../firebase/auth.js';
import { SIGNUP_VOUCHER_AMOUNT } from '../../services/voucherService.js';

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
    title: `${t('return.title')} — ManGO Parking`,
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
    // Pay-at-pickup: status stays 'pending' until staff marks paid at the
    // lot. Show the "register confirmed, pay on arrival" view immediately
    // instead of spinning. We keep the subscription open so the same tab
    // flips to success when staff acts (e.g., the customer keeps the page
    // open while paying at the kiosk).
    if (order.paymentMethod === 'pay-at-pickup') {
      terminal = true;
      clearTimeout(watchdog);
      statusEl.innerHTML = renderPickup(order, orderId);
      // Don't unsubscribe — let the success state replace this when paid.
      return;
    }
    // status === 'pending' (online, waiting for IPN) — keep the spinner.
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
  const isGuest = !getCurrentUser();
  // `amount` is what was actually charged (post-voucher; 0 for a booking
  // fully covered by a days voucher). Fall back to the gross totalPrice
  // for older orders that predate the amount field on long-term docs.
  const paidAmount = Number.isFinite(Number(order.amount)) ? Number(order.amount) : order.totalPrice;
  const detail = isLongTerm
    ? `${order.days} ${t('longTerm.days')} · ${paidAmount} ${t('common.lei')}`
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
        ? `<a href="${localePath('/account/bookings')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.viewBookings')}</a>`
        : `<a href="${localePath('/account')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.viewBalance')}</a>`}
    </div>
    ${isGuest ? renderSignupCTA(order) : ''}
  `;
}

// Shown only to guest buyers — invites them to sign up for a 20 RON
// voucher applied to their next purchase. Pre-fills email from the order.
function renderSignupCTA(order) {
  const email = encodeURIComponent(order?.customerData?.email || '');
  const registerHref = email ? `${localePath('/register')}?email=${email}` : localePath('/register');
  const loginHref = email ? `${localePath('/login')}?email=${email}` : localePath('/login');
  return `
    <div class="mt-8 p-6 rounded-2xl bg-mango/10 border-2 border-mango/30 text-left">
      <p class="font-heading font-bold text-blueberry-deep text-lg mb-1">${t('voucher.signupCtaTitle', { amount: SIGNUP_VOUCHER_AMOUNT })}</p>
      <p class="text-charcoal/70 text-[14px] mb-4">${t('voucher.signupCtaHint')}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <a href="${loginHref}" class="flex items-center justify-center gap-2 bg-white hover:bg-frost text-charcoal font-semibold text-[14px] px-5 py-3 rounded-xl border border-frost-deep transition-colors">
          <svg class="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>${t('voucher.signupGoogle')}</span>
        </a>
        <a href="${registerHref}" class="flex items-center justify-center gap-2 bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-3 rounded-xl transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
          </svg>
          <span>${t('voucher.signupEmail')}</span>
        </a>
      </div>
    </div>
  `;
}

// Pay-at-pickup confirmation. The reservation is recorded (longTerm
// booking is already in the DB; credit pack is held in pendingOrders);
// the customer simply pays cash or card at the lot. We nudge them to
// pay online for the discount if they change their mind.
function renderPickup(order, orderId) {
  const isLongTerm = order.orderType === 'longTerm';
  const detail = isLongTerm
    ? `${order.days} ${t('longTerm.days')} · ${order.amount} ${t('common.lei')}`
    : `${order.quantity} ${t('credit.plural')} · ${order.amount} ${t('common.lei')}`;
  return `
    <div class="w-16 h-16 rounded-full bg-blueberry/10 flex items-center justify-center mx-auto mb-6">
      <svg class="w-8 h-8 text-blueberry" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    </div>
    <h1 class="font-heading text-2xl md:text-3xl font-bold text-blueberry-deep mb-2">${t('return.titlePickup')}</h1>
    <p class="text-dim text-[15px] mb-6">${t('return.subtitlePickup')}</p>
    <div class="bg-frost rounded-2xl px-6 py-4 inline-block mb-6">
      <p class="text-[12px] font-mono uppercase tracking-wider text-dim mb-1">${t('return.orderRef')}</p>
      <p class="font-mono font-semibold text-[15px] mb-2">${orderId}</p>
      <p class="font-mono font-semibold text-[15px]">${detail}</p>
    </div>
    <div class="mt-2 p-5 rounded-2xl bg-mango/10 border-2 border-mango/30 text-left mb-6">
      <p class="font-heading font-semibold text-blueberry-deep mb-1">${t('return.payOnlineNudgeTitle')}</p>
      <p class="text-charcoal/70 text-[14px]">${t('return.payOnlineNudge')}</p>
    </div>
    <div class="flex flex-col sm:flex-row gap-3 justify-center">
      <a href="${localePath('/pay')}?orderId=${encodeURIComponent(orderId)}" class="bg-mango hover:bg-mango/90 text-charcoal font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.payOnlineCta')}</a>
      <a href="${localePath('/')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('booking.backHome')}</a>
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
      <a href="${retryHref}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.tryAgain')}</a>
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
    <a href="${localePath('/contact')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('return.contactUs')}</a>
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
