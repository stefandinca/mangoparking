// Netopia Mobilpay v2 client handoff — also handles the pay-at-pickup
// short-circuit.
//
// Online flow:
//   1. POST { orderType, ..., paymentMethod: 'online' } to `createPayment`.
//   2. Function persists `pendingOrders/{orderId}`, encrypts XML, returns
//      { action, env_key, data, cipher, iv, orderId }.
//   3. Build a hidden POST form and submit it to `action` — the browser
//      is redirected to Netopia's hosted card page.
//   4. After payment, Netopia redirects to ${SITE_URL}/booking/return?orderId=...
//   5. The IPN callback credits tokens / creates the booking out-of-band;
//      the return page polls `pendingOrders/{orderId}.status`.
//
// Pay-at-pickup flow:
//   1. POST { ..., paymentMethod: 'pay-at-pickup' } to `createPayment`.
//   2. Function persists `pendingOrders/{orderId}` with paymentStatus=
//      'unpaid' and, for longTerm, immediately creates the booking doc
//      so the reservation is confirmed; no Netopia handoff.
//   3. Function returns { orderId, paymentMethod, redirectUrl }.
//   4. We navigate the browser to redirectUrl — the return page shows
//      the "pay at the lot" confirmation copy.

import { CREATE_PAYMENT_URL } from '../utils/constants.js';

export async function startNetopiaPayment(payload) {
  const resp = await fetch(CREATE_PAYMENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`createPayment ${resp.status}: ${detail || resp.statusText}`);
  }

  const responseBody = await resp.json();
  const { action, env_key, data, cipher, iv, orderId, error, paymentMethod, redirectUrl } = responseBody;
  if (error) throw new Error(error);

  // Pay-at-pickup short-circuit: just navigate. No form, no Netopia.
  if (paymentMethod === 'pay-at-pickup') {
    if (!redirectUrl) throw new Error('Missing redirectUrl from pay-at-pickup handoff');
    window.location.href = redirectUrl;
    return orderId;
  }

  if (!action || !env_key || !data) throw new Error('Invalid Netopia handoff payload');

  // Build a hidden form and auto-submit. The browser leaves the SPA at
  // this point — there is no return value to await.
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  form.style.display = 'none';
  for (const [name, value] of [
    ['env_key', env_key],
    ['data', data],
    ['cipher', cipher || 'aes-256-cbc'],
    ['iv', iv || ''],
  ]) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  return orderId;
}
