// Netopia Mobilpay v2 client handoff.
//
// 1. POST { orderType, ... } to Cloud Function `createPayment`.
// 2. Function persists `pendingOrders/{orderId}`, encrypts XML, returns
//    { action, env_key, data, cipher, iv, orderId }.
// 3. Build a hidden POST form and submit it to `action` — the browser
//    is redirected to Netopia's hosted card page.
// 4. After payment, Netopia redirects to ${SITE_URL}/booking/return?orderId=...
//
// The function also receives the IPN out-of-band and credits tokens /
// creates the booking server-side; the return page polls
// `pendingOrders/{orderId}.status` for paid|failed|canceled.

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

  const { action, env_key, data, cipher, iv, orderId, error } = await resp.json();
  if (error) throw new Error(error);
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
