// Brevo Transactional Email API wrapper.
//
// One thin function: sendBrevoEmail({ to, name, templateName, locale, params }).
// Resolves the numeric template ID via emailTemplates.templateId(), then
// POSTs to https://api.brevo.com/v3/smtp/email with the API key secret.
//
// Brevo renders the template (mustache + {% if %}) server-side, applying
// the params we pass. Returns { ok, messageId } on success; on a known
// configuration miss (template ID is still null) it logs and returns
// { skipped: true } instead of throwing — that way Phase E can deploy
// before every Brevo template is paired with an ID, and the cron jobs
// don't fail noisily during rollout.

import { defineSecret } from 'firebase-functions/params';
import { templateId } from './emailTemplates.js';

export const BREVO_API_KEY = defineSecret('BREVO_API_KEY');

const API_URL = 'https://api.brevo.com/v3/smtp/email';

const SENDER = {
  email: 'rezervari@mangoparking.ro',
  name: 'Mango Parking',
};

export async function sendBrevoEmail({
  to,
  name = '',
  templateName,
  locale = 'ro',
  params = {},
  tags = [],
  bcc = [],
}) {
  if (!to || !to.includes?.('@')) {
    console.warn('sendBrevoEmail: invalid recipient', { to, templateName });
    return { skipped: true, reason: 'invalid-recipient' };
  }
  const id = templateId(templateName, locale);
  if (id == null) {
    console.warn(`sendBrevoEmail: template ID missing for ${templateName}-${locale}`);
    return { skipped: true, reason: 'no-template-id' };
  }

  const cleanBcc = (Array.isArray(bcc) ? bcc : [])
    .filter((b) => b && b.email && b.email.includes('@') && b.email !== to);
  const body = {
    to: [{ email: to, name: name || undefined }],
    sender: SENDER,
    replyTo: SENDER,
    templateId: Number(id),
    params,
    tags: [templateName, locale, ...tags].filter(Boolean),
    ...(cleanBcc.length ? { bcc: cleanBcc } : {}),
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY.value(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('sendBrevoEmail: network error', err?.message, { to, templateName });
    return { skipped: true, reason: 'network-error' };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`sendBrevoEmail: Brevo ${res.status}`, { to, templateName, detail });
    return { skipped: true, reason: `brevo-${res.status}` };
  }

  const data = await res.json().catch(() => ({}));
  console.log(`sendBrevoEmail: ok template=${templateName}-${locale} id=${id} to=${to} msg=${data.messageId}`);
  return { ok: true, messageId: data.messageId };
}
