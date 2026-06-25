// Reusable "redeem a gift code → free credits" card.
//
// A credits-type promo voucher (a gift card) is redeemed standalone — no
// purchase — granting its free parking credits straight to the holder's
// balance via the redeemCreditVoucher callable. This widget renders the
// input + button + result line and is shared by the public credits page
// and the account vouchers page.
//
// Usage:
//   container.appendChild(giftCodeRedeemCard({
//     showPlate: !user,                 // guests need a plate (it keys the balance)
//     getPlate: () => resolvePlate(),   // optional fallback plate (e.g. selected vehicle)
//     onRedeemed: ({ credits, balance }) => { ... },
//   }));

import { html, qs } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';
import { showToast } from '../core/Toast.js';
import { redeemCreditVoucher } from '../../services/promoVoucherService.js';

const GIFT_ICON = '<svg class="w-5 h-5 text-leaf" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"/></svg>';

export function giftCodeRedeemCard({ showPlate = false, getPlate = null, onRedeemed = null } = {}) {
  const el = html`<div class="card-solid rounded-2xl p-5">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl bg-leaf/10 flex items-center justify-center shrink-0">${GIFT_ICON}</div>
      <div class="min-w-0 flex-1">
        <p class="font-heading font-bold text-[15px] text-blueberry-deep">${t('giftRedeem.title')}</p>
        <p class="text-[13px] text-dim mb-3">${t('giftRedeem.subtitle')}</p>
        <div class="flex flex-col sm:flex-row gap-2">
          <input data-gift-code type="text" placeholder="${t('giftRedeem.codePlaceholder')}"
            class="flex-1 px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono uppercase focus:outline-none focus:border-leaf">
          ${showPlate ? `<input data-gift-plate type="text" placeholder="${t('giftRedeem.platePlaceholder')}"
            class="sm:w-40 px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono uppercase focus:outline-none focus:border-leaf">` : ''}
          <button type="button" data-gift-redeem
            class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('giftRedeem.button')}</button>
        </div>
        <p data-gift-msg class="hidden mt-2 text-[13px]"></p>
      </div>
    </div>
  </div>`;

  const codeInput = qs('[data-gift-code]', el);
  const plateInput = qs('[data-gift-plate]', el);
  const btn = qs('[data-gift-redeem]', el);
  const msg = qs('[data-gift-msg]', el);

  const setMsg = (text, kind) => {
    if (!text) { msg.classList.add('hidden'); return; }
    msg.textContent = text;
    msg.className = `mt-2 text-[13px] ${kind === 'error' ? 'text-red-500' : 'text-leaf font-semibold'}`;
  };

  btn.addEventListener('click', async () => {
    setMsg('');
    const code = String(codeInput.value || '').trim();
    if (!code) { setMsg(t('giftRedeem.errorEmpty'), 'error'); return; }
    let plate = plateInput ? String(plateInput.value || '').trim() : '';
    if (!plate && typeof getPlate === 'function') plate = String(getPlate() || '').trim();

    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = t('common.loading');
    try {
      const res = await redeemCreditVoucher({ code, plate });
      if (res?.ok) {
        setMsg(t('giftRedeem.success', { credits: res.credits, balance: res.balance }), 'success');
        codeInput.value = '';
        if (plateInput) plateInput.value = '';
        showToast(t('giftRedeem.successToast', { credits: res.credits }), 'success');
        onRedeemed?.({ credits: res.credits, balance: res.balance });
      } else {
        setMsg(t(`giftRedeem.error.${res?.error || 'unknown'}`), 'error');
      }
    } catch (err) {
      console.error('redeemCreditVoucher', err);
      setMsg(err?.message || t('common.error'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  return el;
}
