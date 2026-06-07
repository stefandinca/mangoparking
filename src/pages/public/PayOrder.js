// /pay?orderId=ord_xxx — self-service repay for a pay-at-pickup order.
//
// Flow:
//   1. Page reads ?orderId from the URL (link delivered via the booking
//      confirmation email when paymentMethod === 'pay-at-pickup').
//   2. Fetches pendingOrders/{orderId} client-side to render the order
//      summary + savings preview.
//   3. On "Pay now": POSTs { orderId } to `repayOrder`, gets a Netopia
//      handoff envelope, builds a hidden form and submits to Netopia.
//   4. Netopia redirects to /booking/return?orderId=... where the IPN
//      eventually flips paymentStatus to 'paid'. The repaid booking is
//      patched in-place (see netopiaCallback in functions/src/index.js).

import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getDocument, getCollection, where } from '../../firebase/db.js';
import { getOnlineDiscountPercent } from '../../services/discountService.js';
import { REPAY_ORDER_URL } from '../../utils/constants.js';
import { submitNetopiaHandoff } from '../../services/netopiaService.js';

export default function PayOrder(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('pay.title')} — ManGO Parking`,
    description: t('pay.subtitle'),
    lang: locale,
  });

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-32 pb-20 min-h-screen bg-frost">
      <div class="max-w-2xl mx-auto px-6">
        <div data-shell class="card-solid rounded-3xl p-10">
          ${renderLoading()}
        </div>
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  container.appendChild(page);

  const shell = page.querySelector('[data-shell]');

  if (!orderId) {
    shell.innerHTML = renderError(t('pay.missingOrderId'));
    return;
  }

  load(shell, orderId);
}

async function load(shell, orderId) {
  let order;
  try {
    order = await getDocument('pendingOrders', orderId);
  } catch (err) {
    console.error('PayOrder: getDocument failed', err);
    shell.innerHTML = renderError(t('pay.errorGeneric'));
    return;
  }

  // Backward-compat: pre-fix emails put the bookingId in the URL because
  // booking.paymentId was nulled out for pay-at-pickup. Resolve through
  // the booking → its paymentId, or via a where-query on pendingOrders.
  if (!order) {
    const booking = await getDocument('bookings', orderId).catch(() => null);
    if (booking) {
      if (booking.paymentId) {
        order = await getDocument('pendingOrders', booking.paymentId).catch(() => null);
        if (order) orderId = booking.paymentId;
      }
      if (!order) {
        const rows = await getCollection('pendingOrders', where('bookingId', '==', booking.id || orderId)).catch(() => []);
        if (rows.length > 0) {
          order = rows[0];
          orderId = rows[0].id;
        }
      }
    }
  }

  if (!order) {
    shell.innerHTML = renderError(t('pay.notFound'));
    return;
  }
  if (order.paymentStatus === 'paid' || order.status === 'paid') {
    shell.innerHTML = renderError(t('pay.alreadyPaid'));
    return;
  }
  if (order.paymentMethod !== 'pay-at-pickup') {
    shell.innerHTML = renderError(t('pay.notRepayable'));
    return;
  }

  const discountPct = await getOnlineDiscountPercent().catch(() => 10);
  const lotAmount = Number(order.amount) || 0;
  const onlineAmount = Math.round(lotAmount * (1 - discountPct / 100));
  const savings = lotAmount - onlineAmount;

  shell.innerHTML = renderReady({ orderId, order, onlineAmount, savings });

  shell.querySelector('[data-pay]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('pay.loading');
    try {
      await submitRepay(orderId);
    } catch (err) {
      console.error('PayOrder: repay failed', err);
      btn.disabled = false;
      btn.textContent = t('pay.payButton', { amount: onlineAmount });
      const errEl = shell.querySelector('[data-err]');
      if (errEl) errEl.textContent = t('pay.errorGeneric');
    }
  });
}

async function submitRepay(orderId) {
  const resp = await fetch(REPAY_ORDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`repayOrder ${resp.status}: ${detail}`);
  }
  const body = await resp.json();
  const { error } = body;
  if (error) throw new Error(error);
  submitNetopiaHandoff(body);
}

function renderLoading() {
  return `
    <div class="text-center py-8">
      <div class="w-12 h-12 rounded-full bg-mango/10 flex items-center justify-center mx-auto mb-4">
        <svg class="w-6 h-6 text-mango animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"/>
        </svg>
      </div>
      <p class="text-dim text-[15px]">${t('pay.loading')}</p>
    </div>
  `;
}

function renderReady({ orderId, order, onlineAmount, savings }) {
  const isLongTerm = order.orderType === 'longTerm';
  const detail = isLongTerm
    ? `${order.days} ${t('longTerm.days')}`
    : `${order.quantity} ${t('credit.plural')}`;
  return `
    <h1 class="font-heading text-2xl md:text-3xl font-bold text-blueberry-deep mb-2">${t('pay.title')}</h1>
    <p class="text-dim text-[15px] mb-6">${t('pay.subtitle')}</p>

    <div class="bg-frost rounded-2xl px-6 py-5 mb-6">
      <p class="text-[12px] font-mono uppercase tracking-wider text-dim mb-1">${t('pay.orderRef')}</p>
      <p class="font-mono font-semibold text-[15px] mb-3">${orderId}</p>
      <p class="text-[14px] text-charcoal">${detail}</p>
    </div>

    <div class="bg-mango/10 border-2 border-mango/30 rounded-2xl px-6 py-5 mb-6 text-center">
      <p class="text-[13px] uppercase tracking-wider text-charcoal/70 mb-1">${t('pay.youSave', { amount: savings })}</p>
      <p class="font-heading text-3xl font-bold text-blueberry-deep">${onlineAmount} ${t('common.lei')}</p>
    </div>

    <button data-pay class="w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-4 rounded-xl transition-colors">
      ${t('pay.payButton', { amount: onlineAmount })}
    </button>
    <p data-err class="text-danger text-[13px] mt-3 text-center min-h-[1.2em]"></p>

    <p class="text-center mt-6">
      <a href="${localePath('/')}" class="text-dim hover:text-charcoal text-[14px] underline">${t('pay.backHome')}</a>
    </p>
  `;
}

function renderError(message) {
  return `
    <div class="text-center">
      <div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
        <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      </div>
      <p class="text-dim text-[15px] mb-6">${message}</p>
      <a href="${localePath('/')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('pay.backHome')}</a>
    </div>
  `;
}
