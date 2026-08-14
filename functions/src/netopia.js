// Netopia Mobilpay v2 crypto helpers — direct port of the official sample at
// https://github.com/mobilpay/Node.js (proof-of-concept repo, not a published
// npm package). Hybrid encryption: AES-256-CBC for the XML body, RSA-PKCS1
// for the AES key envelope.

import crypto from 'node:crypto';
import forge from 'node-forge';
import { Builder, parseStringPromise } from 'xml2js';

const builder = new Builder({ cdata: true });

export const NETOPIA_ENDPOINTS = {
  sandbox: 'https://sandboxsecure.mobilpay.ro',
  live: 'https://secure.mobilpay.ro',
};

// Encrypt an outgoing request payload. Returns the three fields the browser
// POSTs to Netopia's hosted payment page: env_key + data + cipher (+ iv).
export function encryptRequest(publicKeyPem, xml) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  let encrypted = cipher.update(xml, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const envKey = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    aesKey
  );

  return {
    env_key: envKey.toString('base64'),
    data: encrypted,
    iv: iv.toString('base64'),
    cipher: 'aes-256-cbc',
  };
}

// Decrypt an IPN envelope sent by Netopia. The POST body (application/x-www-form-urlencoded)
// carries env_key, data, cipher (and we need iv from… actually the sample passes iv in
// the original data structure; Netopia's IPN includes it within the encrypted XML).
// We reuse node-forge for RSA decrypt — node's crypto.privateDecrypt has worked for me
// too, but forge is the path the official sample takes so stay parity.
export async function decryptIpn(privateKeyPem, { env_key, data, cipher, iv }) {
  const encryptedKey = Buffer.from(env_key, 'base64');
  const privKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const aesKeyBinary = privKey.decrypt(encryptedKey, 'RSAES-PKCS1-V1_5');
  const aesKey = Buffer.from(aesKeyBinary, 'binary');

  const decipher = crypto.createDecipheriv(
    cipher || 'aes-256-cbc',
    aesKey,
    Buffer.from(iv, 'base64')
  );
  let decrypted = decipher.update(data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return parseStringPromise(decrypted, { explicitArray: false });
}

// Build the Netopia XML payload for a card payment request.
export function buildRequestXml({
  orderId,
  amount,
  currency = 'RON',
  signature,
  returnUrl,
  confirmUrl,
  details,
  billing,
  shipping,
}) {
  const payload = {
    order: {
      $: { id: orderId, timestamp: Date.now(), type: 'card' },
      signature,
      url: { return: returnUrl, confirm: confirmUrl },
      invoice: {
        $: { currency, amount: String(amount) },
        details: details || 'Mango Parking — parking service',
        contact_info: {
          billing: { $: { type: 'person' }, ...billing },
          shipping: { $: { type: 'person' }, ...(shipping || billing) },
        },
      },
      ipn_cipher: 'aes-256-cbc',
    },
  };
  return builder.buildObject(payload);
}

// Netopia IPN expects a <crc> XML reply. Success = <crc>success</crc>; any other
// value is treated as a failure to process by Netopia and the IPN will be retried.
export function crcSuccess() {
  return '<?xml version="1.0" encoding="utf-8"?><crc>success</crc>';
}
export function crcError(code, msg) {
  return `<?xml version="1.0" encoding="utf-8"?><crc error_type="1" error_code="${code}">${msg}</crc>`;
}

// ── IPN state decisions ──────────────────────────────────────────────────
// Netopia's `action` vocabulary overlaps our own order `status` vocabulary:
// a DECLINED card still reports the attempted action, which is literally
// 'paid' (the error code carries the refusal). Recording that raw action as
// the order status makes a failed order indistinguishable from a fulfilled
// one — see the incident note above `netopiaCallback` in index.js.

// An order is fulfilled only if the success branch actually ran. `status`
// alone is not proof (a failed IPN used to be able to write 'paid' into it);
// the success branch is the only writer of bookingId / balanceDocId / paidBy,
// so require one of those as evidence. Orders paid at the desk carry paidBy,
// and the nine May-2026 orders that predate paymentStatus still carry a
// bookingId or balanceDocId — so every genuinely fulfilled order matches.
export function isFulfilledOrder(order) {
  if (!order || order.status !== 'paid') return false;
  return Boolean(order.bookingId || order.balanceDocId || order.paidBy);
}

// Status to record for a non-success IPN. Keeps the informative actions
// ('canceled', 'credit', …) but never lets one impersonate the fulfilled
// sentinel, which would make later IPNs for the same order look like replays.
export function failureStatusFor(action) {
  const a = String(action || '').toLowerCase();
  if (!a || a === 'paid' || a === 'confirmed') return 'failed';
  return a;
}
