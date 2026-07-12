import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate, setFieldError, clearErrorOnInput } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getTokenPacks } from '../../services/tokenService.js';
import { startNetopiaPayment } from '../../services/netopiaService.js';
import { getOnlineDiscountPercent, onlineFromStandard } from '../../services/discountService.js';
import { billingFieldsHtml, wireBillingToggle, readBilling } from '../../components/widgets/BillingFields.js';
import { getMyVoucher } from '../../services/voucherService.js';
import { previewVoucher, normalizeCode } from '../../services/promoVoucherService.js';
import { giftCodeRedeemCard } from '../../components/widgets/GiftCodeRedeem.js';
import { getCurrentUser, getUserProfile } from '../../firebase/auth.js';
import { getDocument, updateDocument } from '../../firebase/db.js';
import { isValidEmail, isValidPhone, isValidLicensePlate, required } from '../../utils/validators.js';
import { phoneField, phoneValue } from '../../components/core/PhoneField.js';
import { showToast } from '../../components/core/Toast.js';
import { isProfileComplete } from '../../utils/profileComplete.js';
import { openProfileCompletionModal, profileGateCard } from '../../components/account/ProfileCompletionModal.js';

export default async function Booking(container) {
  const locale = getLocale();
  updateMeta({
    title: locale === 'ro' ? 'Cumpără Credite — ManGO Parking' : 'Buy Credits — ManGO Parking',
    description: locale === 'ro'
      ? 'Cumpără credite de parcare la Aeroportul Otopeni. Plată online, microbuz gratuit.'
      : 'Buy parking credits at Otopeni Airport. Pay online, free shuttle included.',
    lang: locale,
  });

  const packs = await getTokenPacks().catch(() => []);
  const discount = await getOnlineDiscountPercent().catch(() => 0);
  const user = getCurrentUser();
  const voucher = user ? await getMyVoucher().catch(() => null) : null;
  const profile = user ? await getDocument('users', user.uid).catch(() => getUserProfile()) : null;
  const profileVehicles = profile?.vehicles || [];

  // Logged-in customers must have a complete profile (name, phone, plate,
  // billing) before buying credits. Guests (no account) are unaffected.
  if (user && (profile?.role || 'customer') === 'customer' && !isProfileComplete(profile)) {
    const gate = html`<div>
      <div data-navbar></div>
      <section class="pt-32 pb-20 min-h-screen"><div class="max-w-5xl mx-auto px-6" data-gate-slot></div></section>
      <div data-footer></div>
    </div>`;
    gate.querySelector('[data-navbar]').replaceWith(Navbar());
    gate.querySelector('[data-footer]').replaceWith(Footer());
    gate.querySelector('[data-gate-slot]').appendChild(
      profileGateCard(() => openProfileCompletionModal({ onComplete: () => window.location.reload() })),
    );
    container.appendChild(gate);
    return;
  }

  let selectedPack = null;
  let customQty = 0;
  let confirmed = false;
  let promoVoucher = null;  // { code, name, type, value, discountAmount } when applied
  let resultBalance = 0;
  let processing = false;
  let paymentMethod = 'online';   // 'online' | 'pay-at-pickup'

  // Find best value (highest qty pack)
  const bestPack = packs.reduce((best, p) => (!best || p.quantity > best.quantity) ? p : best, null);

  function getSelectedQty() {
    return selectedPack ? selectedPack.quantity : (customQty || 0);
  }

  function getSelectedPrice() {
    if (selectedPack) return selectedPack.price;
    if (customQty > 0 && packs.length > 0) {
      // Use cheapest per-credit rate from packs
      const rates = packs.map(p => p.price / p.quantity);
      return Math.round(customQty * Math.min(...rates));
    }
    return 0;
  }

  // Accordion step card — clickable header (badge + title + collapsed summary
  // + Edit) over a body shown only while active. Mirrors BookingLongTerm.
  const stepCard = ({ step, num, title, optional = false, body }) => `
    <div class="card-solid rounded-2xl overflow-hidden" data-step="${step}">
      <button type="button" data-step-head class="w-full flex items-center justify-between gap-3 px-6 py-5 text-left">
        <span class="flex items-center gap-3 min-w-0">
          <span data-step-badge class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-frost-deep text-charcoal/60 text-[13px] font-bold shrink-0 transition-colors">${num}</span>
          <span class="min-w-0">
            <span class="block font-heading font-semibold text-lg text-blueberry-deep leading-tight">${title}${optional ? ` <span class="text-[12px] font-normal text-dim">(${t('wizard.optional')})</span>` : ''}</span>
            <span data-step-summary class="hidden text-[13px] text-dim truncate">—</span>
          </span>
        </span>
        <span data-step-edit class="hidden text-mango text-[13px] font-semibold shrink-0">${t('common.edit')}</span>
      </button>
      <div data-step-body class="px-6 pb-6">${body}</div>
    </div>`;

  const nextBtn = (to) => `
    <div class="flex justify-end mt-5">
      <button type="button" data-next-step="${to}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-2.5 rounded-xl transition-colors">${t('longTerm.nextStep')} →</button>
    </div>`;

  function render() {
    const page = html`<div>
      <div data-navbar></div>
      <section class="pt-32 pb-20">
        <div class="max-w-5xl mx-auto px-6">
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-3">${t('credit.pageTitle')}</h1>
          ${confirmed ? '' : `
            <p class="text-dim text-[17px] mb-5">${t('credit.introLead')}</p>
            <div class="bg-blueberry/5 border border-blueberry/15 rounded-2xl p-4 mb-8 grid sm:grid-cols-3 gap-3">
              <div class="flex items-center gap-2.5">
                <span class="font-heading font-bold text-2xl text-blueberry-deep shrink-0">1=1</span>
                <span class="text-[13px] text-charcoal/80">${t('credit.introPoint1')}</span>
              </div>
              <div class="flex items-center gap-2.5">
                <span class="font-heading font-bold text-2xl text-blueberry-deep shrink-0">∞</span>
                <span class="text-[13px] text-charcoal/80">${t('credit.introPoint2')}</span>
              </div>
              <div class="flex items-center gap-2.5">
                <span class="font-heading font-bold text-2xl text-blueberry-deep shrink-0">L–V</span>
                <span class="text-[13px] text-charcoal/80">${t('credit.introPoint3')}</span>
              </div>
            </div>
          `}
          ${confirmed ? '' : `<div data-gift-redeem-slot class="mb-8"></div>`}
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
    return `
      <div class="card-solid rounded-3xl p-10 text-center">
        <div class="w-16 h-16 rounded-full bg-leaf/10 flex items-center justify-center mx-auto mb-6">
          <svg class="w-8 h-8 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 class="font-heading text-2xl font-bold mb-2">${t('credit.confirmed')}</h2>
        <p class="text-dim text-[15px] mb-6">${t('credit.confirmMessage')}</p>
        <div class="bg-frost rounded-2xl px-8 py-5 inline-block mb-6">
          <p class="text-dim text-[13px] mb-1">${t('credit.balanceAfter')}</p>
          <span class="font-mono font-bold text-3xl tracking-wider">${resultBalance}</span>
          <span class="text-dim text-[15px] ml-1">${t('credit.plural')}</span>
        </div>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="${localePath('/')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('booking.backHome')}</a>
          <button data-new-purchase class="glass font-semibold text-[15px] px-6 py-3 rounded-xl hover:bg-white transition-colors">${t('credit.newPurchase')}</button>
        </div>
      </div>
    `;
  }

  function renderForm() {
    const packCards = packs.map(p => {
      const isBest = p.id === bestPack?.id;
      const isSelected = selectedPack?.id === p.id;
      const name = locale === 'ro' && p.nameRo ? p.nameRo : p.name;
      const perDay = p.quantity > 0 ? Math.round(p.price / p.quantity) : p.price;
      const online = onlineFromStandard(p.price, discount);
      const showAnchor = online != null;
      return `
        <button type="button" data-pack-id="${p.id}" class="group relative overflow-hidden rounded-2xl bg-white border-2 ${isSelected ? 'border-mango ring-2 ring-mango/30' : 'border-frost-deep hover:border-blueberry/40'} shadow-sm text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <div data-stripe class="absolute inset-y-0 left-0 w-1.5 ${isSelected ? 'bg-mango' : 'bg-blueberry'}"></div>
          ${isBest ? `<span data-best class="absolute top-3.5 right-4 text-[10px] font-bold uppercase tracking-wider bg-mango text-charcoal px-2.5 py-1 rounded-full ${isSelected ? 'hidden' : ''}">${t('credit.bestValue')}</span>` : ''}
          <div data-check class="absolute top-3.5 right-4 w-7 h-7 rounded-full bg-mango items-center justify-center ${isSelected ? 'flex' : 'hidden'}"><svg class="w-4 h-4 text-charcoal" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
          <div class="p-5 pl-6">
            ${name ? `<p class="text-[11px] uppercase tracking-wider text-dim font-mono truncate pr-16">${name}</p>` : ''}
            <div class="flex items-baseline gap-1.5 mt-0.5">
              <span class="font-heading font-bold text-4xl text-blueberry-deep leading-none">${p.quantity}</span>
              <span class="text-dim text-[15px] font-medium">${t('credit.plural')}</span>
            </div>
            <p class="text-dim text-[13px] mt-1.5">≈ ${perDay} ${t('longTerm.perDay')}</p>
            <div class="mt-4 pt-4 border-t border-frost-deep">
              ${showAnchor ? `<p class="font-mono text-[13px] text-dim line-through leading-none mb-0.5">${p.price} lei</p>` : ''}
              <div class="flex items-baseline gap-1">
                <span class="font-mono font-bold text-xl text-blueberry-deep">${showAnchor ? online : p.price}</span>
                <span class="text-dim text-[13px]">lei</span>
              </div>
            </div>
            <span data-select-cta class="mt-4 block text-center font-semibold text-[14px] py-2.5 rounded-xl transition-colors ${isSelected ? 'bg-blueberry text-white' : 'bg-blueberry/5 text-blueberry border border-blueberry/30 group-hover:bg-blueberry/10'}">${isSelected ? t('credit.selected') : t('credit.select')}</span>
          </div>
        </button>
      `;
    }).join('');

    const vehicleBody = `
      ${user && profileVehicles.length > 0 ? `
      <div class="space-y-2 mb-4" data-vehicle-options>
        ${profileVehicles.map((v, i) => `
          <label class="flex items-center gap-3 p-3 rounded-xl border-2 border-frost-deep hover:border-mango/30 cursor-pointer transition-colors ${i === 0 ? 'border-mango bg-mango/5' : ''}">
            <input type="radio" name="vehicleChoice" value="${i}" class="accent-mango w-4 h-4" ${i === 0 ? 'checked' : ''}>
            <span class="font-mono font-semibold text-[15px]">${v.plate}</span>
            <span class="text-dim text-[14px]">${v.make} ${v.model}</span>
          </label>
        `).join('')}
        <label class="flex items-center gap-3 p-3 rounded-xl border-2 border-frost-deep hover:border-mango/30 cursor-pointer transition-colors">
          <input type="radio" name="vehicleChoice" value="new" class="accent-mango w-4 h-4">
          <span class="text-[15px] font-medium">${locale === 'ro' ? '+ Vehicul nou' : '+ New vehicle'}</span>
        </label>
      </div>
      <div class="grid sm:grid-cols-2 gap-4 hidden" data-new-vehicle-fields>
      ` : `
      <div class="grid sm:grid-cols-2 gap-4" data-new-vehicle-fields>
      `}
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
          <input type="text" name="licensePlate" placeholder="B 123 ABC" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 uppercase">
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.makeModel')}</label>
          <input type="text" name="makeModel" placeholder="Dacia Logan" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
        </div>
      </div>`;

    const contactBody = user ? `
      <div class="flex items-center justify-between mb-2">
        <span class="text-[13px] font-medium text-charcoal/60 uppercase tracking-wider font-mono">${t('booking.contactInfo')}</span>
        <a href="${localePath('/account')}" class="text-mango text-[13px] font-semibold hover:text-mango-hover transition-colors">${t('common.edit')} →</a>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-dim">
        <span>${profile?.displayName || '—'}</span>
        <span>${profile?.email || '—'}</span>
        ${profile?.phone ? `<span>${profile.phone}</span>` : ''}
      </div>
      <input type="hidden" name="name" value="${profile?.displayName || ''}">
      <input type="hidden" name="email" value="${profile?.email || ''}">
      <input type="hidden" name="phone" value="${profile?.phone || ''}">
    ` : `
      <div class="grid sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.name')} *</label>
          <input type="text" name="name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.phone')} *</label>
          ${phoneField({ name: 'phone', required: true, inputClass: 'flex-1 min-w-0 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40', selectClass: 'shrink-0 w-[7rem] px-2 py-3 rounded-xl border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-mango/40' })}
        </div>
        <div class="sm:col-span-2">
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.email')} *</label>
          <input type="email" name="email" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
        </div>
      </div>`;

    return `
      <form data-purchase-form novalidate class="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <!-- LEFT: accordion steps -->
        <div class="space-y-4 min-w-0">

          ${stepCard({ step: 'pack', num: 1, title: t('wizard.packStep'), body: `
            <div class="grid sm:grid-cols-2 gap-3">${packCards}</div>
            ${nextBtn('details')}
          ` })}

          ${stepCard({ step: 'details', num: 2, title: t('wizard.contactStep'), body: `
            <h3 class="font-heading font-semibold text-[15px] text-blueberry-deep mb-3">${t('credit.vehicleInfo')}</h3>
            ${vehicleBody}
            <div class="mt-6">${contactBody}</div>
            ${nextBtn('billing')}
          ` })}

          ${stepCard({ step: 'billing', num: 3, title: t('billing.title'), body: `
            <label class="flex items-center gap-2.5 text-[14px] text-charcoal/80 cursor-pointer mb-3" data-billing-same-wrap>
              <input type="checkbox" name="billingSameAsContact" class="accent-blueberry w-4 h-4 shrink-0">
              <span>${t('billing.sameAsContact')}</span>
            </label>
            ${billingFieldsHtml(profile?.billing)}
            ${nextBtn('voucher')}
          ` })}

          ${stepCard({ step: 'voucher', num: 4, title: t('voucher.codeTitle'), optional: true, body: `
            <div data-voucher-block>
              <div class="flex flex-col sm:flex-row gap-2" data-voucher-input-wrap>
                <input type="text" name="voucherCode" placeholder="${t('voucher.codePlaceholder')}" class="flex-1 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] font-mono uppercase focus:outline-none focus:border-blueberry">
                <button type="button" data-apply-voucher class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-3 rounded-xl transition-colors">${t('voucher.apply')}</button>
              </div>
              <div class="hidden mt-3 flex items-center justify-between gap-3 bg-leaf/5 border border-leaf/30 rounded-xl px-4 py-3" data-voucher-applied>
                <div class="min-w-0">
                  <p class="text-[14px] font-semibold text-leaf" data-voucher-applied-name>—</p>
                  <p class="text-[12px] text-charcoal/70" data-voucher-applied-detail>—</p>
                </div>
                <button type="button" data-remove-voucher class="text-[13px] text-red-500 hover:underline font-semibold shrink-0">${t('voucher.remove')}</button>
              </div>
              <p class="hidden mt-2 text-[13px] text-red-500" data-voucher-error></p>
            </div>
          ` })}

        </div>

        <!-- RIGHT: sticky summary + consents + pay -->
        <aside class="lg:sticky lg:top-24 space-y-4">
          <div class="card-solid rounded-2xl p-6" data-summary>
            <h3 class="font-heading font-semibold text-lg mb-4">${t('credit.summary')}</h3>
            <div data-price-summary>
              <p class="text-dim/60">${t('credit.selectPack')}</p>
            </div>
          </div>
          <div class="card-solid rounded-2xl p-5 flex flex-col gap-3">
            <label class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
              <input type="checkbox" name="acceptTerms" required class="accent-blueberry w-4 h-4 mt-1 shrink-0">
              <span>${t('legal.acceptTerms')}</span>
            </label>
            <label class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
              <input type="checkbox" name="acceptPrivacy" required class="accent-blueberry w-4 h-4 mt-1 shrink-0">
              <span>${t('legal.acceptPrivacy')}</span>
            </label>
            <button type="submit" data-pay-btn class="mt-1 w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[16px] py-4 rounded-2xl transition-colors shadow-md disabled:opacity-50" ${!selectedPack ? 'disabled' : ''}>
              ${processing
                ? (paymentMethod === 'pay-at-pickup' ? t('credit.processingPickup') : t('credit.processing'))
                : (paymentMethod === 'pay-at-pickup' ? t('credit.payNowPickup') : t('credit.payNow'))}
            </button>
          </div>
        </aside>
      </form>
    `;
  }

  function updateSummary(pageEl) {
    const summary = pageEl.querySelector('[data-price-summary]');
    if (!summary) return;
    const qty = getSelectedQty();
    const onlinePrice = getSelectedPrice();
    if (qty <= 0) {
      summary.innerHTML = `<p class="text-dim/60">${t('credit.selectPack')}</p>`;
    } else {
      const online = onlineFromStandard(onlinePrice, discount);
      const isPickup = paymentMethod === 'pay-at-pickup';
      const displayPrice = (!isPickup && online != null) ? online : onlinePrice;
      const showAnchor = !isPickup && online != null;
      const voucherActive = !isPickup && voucher && voucher.status === 'unused' && onlinePrice > voucher.amount && !promoVoucher;
      // Re-derive the promo discount from the LIVE base on every refresh —
      // the amount captured at apply-time goes stale the moment the customer
      // switches pack or payment method, showing a total the server won't
      // charge (createPayment re-resolves the code against the new base).
      // Display-only; mirrors the server's per-type formula and
      // BookingLongTerm.recompute().
      if (promoVoucher) {
        if (promoVoucher.type === 'percent') {
          promoVoucher.discountAmount = Math.min(
            Math.round((displayPrice * promoVoucher.value) / 100),
            Math.max(0, displayPrice - 1),
          );
        } else if (promoVoucher.type === 'fixed') {
          promoVoucher.discountAmount = Math.min(
            promoVoucher.value,
            Math.max(0, displayPrice - 1),
          );
        }
        // Keep the applied-voucher box's "−N lei" detail in step.
        const detailEl = pageEl.querySelector('[data-voucher-applied-detail]');
        if (detailEl) {
          detailEl.textContent = promoVoucher.type === 'percent'
            ? t('voucher.appliedPercent', { value: promoVoucher.value, amount: promoVoucher.discountAmount })
            : t('voucher.appliedFixed', { amount: promoVoucher.discountAmount });
        }
      }
      const promoActive = promoVoucher?.discountAmount > 0;
      // Headline must equal what the server charges: standard − online − promo.
      const finalPrice = promoActive ? Math.max(1, displayPrice - promoVoucher.discountAmount) : displayPrice;
      const promoLine = promoActive
        ? `<p class="text-[13px] text-leaf mt-2">${t('voucher.summaryLine', { code: promoVoucher.code, amount: promoVoucher.discountAmount })}</p>`
        : '';
      summary.innerHTML = `
        <div class="flex justify-between items-center mb-1"><span>${qty} ${t('credit.plural')}</span>
          <div class="text-right">
            ${(showAnchor || promoActive) ? `<div class="font-mono text-[13px] text-dim line-through leading-none">${showAnchor ? onlinePrice : displayPrice} lei</div>` : ''}
            <div class="font-mono font-semibold">${finalPrice} lei</div>
            ${showAnchor ? `<div class="text-[10px] font-bold uppercase tracking-wider text-leaf mt-0.5">${t('discount.online', { percent: discount })}</div>` : ''}
          </div>
        </div>
        ${voucherActive ? `<p class="text-[13px] text-mango mt-2">${t('voucher.applied', { amount: voucher.amount })}</p>` : ''}
        ${promoLine}`;
    }
    const btn = pageEl.querySelector('[type="submit"]');
    if (btn) btn.disabled = qty <= 0;
  }

  const page = render();
  container.appendChild(page);

  function bindEvents(pageEl) {
    // Pack selection
    delegate(pageEl, 'click', '[data-pack-id]', (e, btn) => {
      const packId = btn.dataset.packId;
      selectedPack = packs.find(p => p.id === packId) || null;
      customQty = 0;
      // Update selected styles
      pageEl.querySelectorAll('[data-pack-id]').forEach(card => {
        const isSel = card.dataset.packId === packId;
        card.classList.toggle('border-mango', isSel);
        card.classList.toggle('ring-2', isSel);
        card.classList.toggle('ring-mango/30', isSel);
        card.classList.toggle('border-frost-deep', !isSel);
        // Accent stripe: mango when selected, blueberry otherwise.
        const stripe = card.querySelector('[data-stripe]');
        if (stripe) { stripe.classList.toggle('bg-mango', isSel); stripe.classList.toggle('bg-blueberry', !isSel); }
        // Checkmark badge (hide the "best value" badge while selected).
        const check = card.querySelector('[data-check]');
        if (check) { check.classList.toggle('flex', isSel); check.classList.toggle('hidden', !isSel); }
        const best = card.querySelector('[data-best]');
        if (best) best.classList.toggle('hidden', isSel);
        // Select CTA.
        const cta = card.querySelector('[data-select-cta]');
        if (cta) {
          cta.textContent = isSel ? t('credit.selected') : t('credit.select');
          cta.classList.toggle('bg-blueberry', isSel);
          cta.classList.toggle('text-white', isSel);
          cta.classList.toggle('bg-blueberry/5', !isSel);
          cta.classList.toggle('text-blueberry', !isSel);
          cta.classList.toggle('border', !isSel);
          cta.classList.toggle('border-blueberry/30', !isSel);
        }
      });
      updateSummary(pageEl);
    });

    // Vehicle radio toggle (show/hide new vehicle fields)
    const vehicleOptions = pageEl.querySelector('[data-vehicle-options]');
    const newVehicleFields = pageEl.querySelector('[data-new-vehicle-fields]');
    if (vehicleOptions && newVehicleFields) {
      vehicleOptions.addEventListener('change', (e) => {
        const radio = e.target;
        if (!radio.matches('input[name="vehicleChoice"]')) return;
        const isNew = radio.value === 'new';
        newVehicleFields.classList.toggle('hidden', !isNew);
        // Style the selected label
        vehicleOptions.querySelectorAll('label').forEach(lbl => {
          const inp = lbl.querySelector('input');
          lbl.classList.toggle('border-mango', inp.checked);
          lbl.classList.toggle('bg-mango/5', inp.checked);
          lbl.classList.toggle('border-frost-deep', !inp.checked);
        });
      });
    }

    // New purchase button
    delegate(pageEl, 'click', '[data-new-purchase]', () => {
      confirmed = false;
      selectedPack = null;
      customQty = 0;
      resultBalance = 0;
      processing = false;
      container.innerHTML = '';
      const newPage = render();
      container.appendChild(newPage);
      bindEvents(newPage);
    });

    // Form submit
    const form = pageEl.querySelector('[data-purchase-form]');
    if (!form) return;

    // Resolve the plate from the selected saved vehicle (logged-in users pick
    // via radio) or the typed input. Used by both the voucher apply and the
    // submit handler so a preselected vehicle counts as a valid plate.
    function resolveCreditPlate() {
      const fd = new FormData(form);
      let plate = fd.get('licensePlate');
      const vehicleChoice = fd.get('vehicleChoice');
      if (user && profileVehicles.length > 0 && vehicleChoice !== 'new' && vehicleChoice != null) {
        const idx = parseInt(vehicleChoice, 10);
        plate = profileVehicles[idx]?.plate || plate;
      }
      return String(plate || '').trim();
    }

    // Gift-code redeem box — adds free credits to the balance independently of
    // the purchase below. Guests need a plate (it keys their balance); logged-in
    // customers fall back to the plate they've selected/typed, else the server
    // derives it from their profile.
    const giftSlot = pageEl.querySelector('[data-gift-redeem-slot]');
    if (giftSlot) {
      giftSlot.appendChild(giftCodeRedeemCard({
        showPlate: !user,
        getPlate: () => resolveCreditPlate(),
      }));
    }

    // Promo voucher apply / remove — see BookingLongTerm.js for the same
    // pattern. Re-bound on every render (this page rebuilds the DOM
    // on confirmation, vehicle toggle, etc.) so the handlers always
    // attach to fresh nodes.
    const voucherBlock = pageEl.querySelector('[data-voucher-block]');
    if (voucherBlock) {
      const voucherInputWrap = voucherBlock.querySelector('[data-voucher-input-wrap]');
      const voucherAppliedEl = voucherBlock.querySelector('[data-voucher-applied]');
      const voucherAppliedName = voucherBlock.querySelector('[data-voucher-applied-name]');
      const voucherAppliedDetail = voucherBlock.querySelector('[data-voucher-applied-detail]');
      const voucherErrorEl = voucherBlock.querySelector('[data-voucher-error]');
      const voucherInput = voucherBlock.querySelector('input[name="voucherCode"]');
      const applyBtn = voucherBlock.querySelector('[data-apply-voucher]');
      const removeBtn = voucherBlock.querySelector('[data-remove-voucher]');

      const setVoucherError = (msg) => {
        if (!voucherErrorEl) return;
        if (msg) { voucherErrorEl.textContent = msg; voucherErrorEl.classList.remove('hidden'); }
        else voucherErrorEl.classList.add('hidden');
      };
      const renderApplied = () => {
        if (!promoVoucher) {
          voucherInputWrap.classList.remove('hidden');
          voucherAppliedEl.classList.add('hidden');
          return;
        }
        voucherInputWrap.classList.add('hidden');
        voucherAppliedEl.classList.remove('hidden');
        voucherAppliedName.textContent = `${promoVoucher.name} (${promoVoucher.code})`;
        voucherAppliedDetail.textContent = promoVoucher.type === 'percent'
          ? t('voucher.appliedPercent', { value: promoVoucher.value, amount: promoVoucher.discountAmount })
          : t('voucher.appliedFixed', { amount: promoVoucher.discountAmount });
      };
      renderApplied();

      applyBtn?.addEventListener('click', async () => {
        setVoucherError('');
        const code = normalizeCode(voucherInput.value);
        if (!code) { setVoucherError(t('voucher.errorEmpty')); return; }
        const plate = resolveCreditPlate();
        if (!plate) { setVoucherError(t('voucher.errorNeedPlate')); return; }
        const base = (function () {
          const price = selectedPack
            ? (customQty ? (customQty * (selectedPack.price / selectedPack.quantity)) : selectedPack.price)
            : 0;
          const standard = Math.round(price);
          // Match the pay-time base: pay-at-pickup uses the standard price;
          // online uses the discounted amount (discount applied before voucher).
          if (paymentMethod === 'pay-at-pickup') return standard;
          const online = onlineFromStandard(standard, discount);
          return online != null ? online : standard;
        })();
        if (!base) { setVoucherError(t('voucher.errorNoBase')); return; }
        applyBtn.disabled = true;
        applyBtn.textContent = t('common.loading');
        try {
          const res = await previewVoucher({ code, plate, baseAmount: base, orderType: 'credits' });
          if (res?.ok) {
            promoVoucher = { code: res.voucherCode, name: res.name, type: res.type, value: res.value, discountAmount: res.discountAmount };
            renderApplied();
            updateSummary(pageEl);
            showToast(t('voucher.appliedToast'), 'success');
          } else {
            setVoucherError(t(`voucher.error.${res?.error || 'unknown'}`));
          }
        } catch (err) {
          console.error('previewVoucher', err);
          setVoucherError(err?.message || t('common.error'));
        } finally {
          applyBtn.disabled = false;
          applyBtn.textContent = t('voucher.apply');
        }
      });

      removeBtn?.addEventListener('click', () => {
        promoVoucher = null;
        if (voucherInput) voucherInput.value = '';
        setVoucherError('');
        renderApplied();
        updateSummary(pageEl);
      });
    }

    // Clear red field-error state as the user edits any input.
    ['licensePlate', 'name', 'phone', 'email', 'makeModel'].forEach(n => {
      const input = form.elements[n];
      if (input) clearErrorOnInput(input);
    });

    // Wire PF/PJ toggle for the billing block (idempotent — safe across re-renders).
    wireBillingToggle(form);

    // "Billing = same as contact" — copy the contact name into the PF billing
    // name fields and lock them; PF only (hidden for PJ / company invoicing).
    (function wireBillingSameAsContact() {
      const chk = form.querySelector('[name="billingSameAsContact"]');
      const wrap = form.querySelector('[data-billing-same-wrap]');
      if (!chk) return;
      const billingName = () => form.querySelector('[name="billingName"]');
      const isPF = () => (form.querySelector('input[name="billingType"]:checked')?.value || 'PF') !== 'PJ';
      function syncFromContact() {
        if (!chk.checked) return;
        const el = billingName();
        if (el) el.value = String(form.querySelector('[name="name"]')?.value || '').trim();
      }
      function applyLock() {
        const on = chk.checked;
        // Keep the field EDITABLE — disabling it traps the customer when the
        // contact name is empty (#3). Tint to show it's synced; typing in it
        // releases the sync (handler below).
        const el = billingName();
        if (el) el.classList.toggle('bg-frost', on);
        if (on) syncFromContact();
      }
      // Typing in the billing-name field while synced releases the sync so the
      // customer can set a different billing name. (Programmatic .value writes
      // in syncFromContact don't dispatch 'input'.)
      billingName()?.addEventListener('input', () => {
        if (chk.checked) { chk.checked = false; applyLock(); }
      });
      chk.addEventListener('change', applyLock);
      form.querySelector('[name="name"]')?.addEventListener('input', syncFromContact);
      form.querySelector('[data-billing-type-toggle]')?.addEventListener('change', () => {
        if (wrap) wrap.classList.toggle('hidden', !isPF());
        if (!isPF()) { chk.checked = false; applyLock(); }
        else applyLock();
      });
      if (wrap) wrap.classList.toggle('hidden', !isPF());
    })();

    // Payment-method toggle — repaints active card, swaps submit copy
    // (no Netopia branding when paying at pickup), and re-renders the summary.
    const paymethodWrap = pageEl.querySelector('[data-paymethod-toggle]');
    if (paymethodWrap) {
      paymethodWrap.addEventListener('change', (e) => {
        if (!e.target.matches('input[name="paymentMethod"]')) return;
        paymentMethod = e.target.value === 'pay-at-pickup' ? 'pay-at-pickup' : 'online';
        paymethodWrap.querySelectorAll('label').forEach((lbl) => {
          const inp = lbl.querySelector('input');
          lbl.classList.toggle('border-mango', inp.checked);
          lbl.classList.toggle('bg-mango/5', inp.checked);
          lbl.classList.toggle('border-frost-deep', !inp.checked);
        });
        const payBtn = pageEl.querySelector('[data-pay-btn]');
        if (payBtn && !processing) {
          payBtn.textContent = paymentMethod === 'pay-at-pickup'
            ? t('credit.payNowPickup')
            : t('credit.payNow');
        }
        updateSummary(pageEl);
      });
    }

    // ── Accordion controller ───────────────────────────────────────────
    // Only one step open at a time; completed steps collapse to a one-line
    // summary with "Edit". Per-step validation gates "Next"; the summary
    // (price) + consents + pay live in the sticky aside.
    const STEP_ORDER = ['pack', 'details', 'billing', 'voucher'];

    function summarizeStep(step) {
      if (step === 'pack') {
        const qty = getSelectedQty();
        if (qty <= 0) return '—';
        const price = getSelectedPrice();
        const online = onlineFromStandard(price, discount);
        const shown = (online != null) ? online : price;
        return `${qty} ${t('credit.plural')} · ${shown} lei`;
      }
      if (step === 'details') {
        const p = resolveCreditPlate();
        const n = user ? (profile?.displayName || '') : String(form.elements.name?.value || '').trim();
        return [p, n].filter(Boolean).join(' · ') || '—';
      }
      if (step === 'billing') {
        const isPJ = (form.querySelector('input[name="billingType"]:checked')?.value || 'PF') === 'PJ';
        if (isPJ) return form.querySelector('[name="billingCompanyName"]')?.value?.trim() || t('billing.typePJ');
        return form.querySelector('[name="billingName"]')?.value?.trim() || t('billing.typePF');
      }
      if (step === 'voucher') return promoVoucher ? promoVoucher.code : '—';
      return '';
    }

    function openStep(name, { scroll = true } = {}) {
      STEP_ORDER.forEach((s) => {
        const el = pageEl.querySelector(`[data-step="${s}"]`);
        if (!el) return;
        const active = s === name;
        const completed = el.dataset.completed === '1';
        el.classList.toggle('ring-2', active);
        el.classList.toggle('ring-mango/20', active);
        const body = el.querySelector('[data-step-body]');
        const summary = el.querySelector('[data-step-summary]');
        const edit = el.querySelector('[data-step-edit]');
        if (body) body.classList.toggle('hidden', !active);
        if (summary) {
          const show = !active && completed;
          summary.classList.toggle('hidden', !show);
          if (show) summary.textContent = summarizeStep(s);
        }
        if (edit) edit.classList.toggle('hidden', !(completed && !active));
      });
      if (scroll) {
        pageEl.querySelector(`[data-step="${name}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function completeStep(name) {
      const el = pageEl.querySelector(`[data-step="${name}"]`);
      if (!el) return;
      el.dataset.completed = '1';
      const badge = el.querySelector('[data-step-badge]');
      if (badge) {
        badge.textContent = '✓';
        badge.classList.remove('bg-frost-deep', 'text-charcoal/60');
        badge.classList.add('bg-leaf', 'text-white');
      }
    }

    function validateCreditStep(step) {
      if (step === 'pack') {
        if (getSelectedQty() <= 0) { showToast(t('credit.selectPack'), 'error'); return false; }
        return true;
      }
      if (step === 'details') {
        const plate = resolveCreditPlate();
        const plateOk = !!plate && isValidLicensePlate(plate);
        if (!plateOk && form.elements.licensePlate) setFieldError(form.elements.licensePlate, true);
        let ok = plateOk;
        if (!user) {
          const nameOk = required(form.elements.name?.value);
          const phoneOk = isValidPhone(phoneValue(form.elements.phone));
          const emailOk = isValidEmail(form.elements.email?.value);
          setFieldError(form.elements.name, !nameOk);
          setFieldError(form.elements.phone, !phoneOk);
          setFieldError(form.elements.email, !emailOk);
          ok = ok && nameOk && phoneOk && emailOk;
        }
        if (!ok) { showToast(t('common.error'), 'error'); return false; }
        return true;
      }
      if (step === 'billing') {
        const billing = readBilling(form);
        if (billing.error) { showToast(billing.error, 'error'); return false; }
        return true;
      }
      return true;
    }

    pageEl.addEventListener('click', (e) => {
      const nextStepBtn = e.target.closest('[data-next-step]');
      if (nextStepBtn) {
        const cur = nextStepBtn.closest('[data-step]')?.dataset.step;
        if (cur && !validateCreditStep(cur)) return;
        if (cur) completeStep(cur);
        openStep(nextStepBtn.dataset.nextStep);
        return;
      }
      const head = e.target.closest('[data-step-head]');
      if (head) {
        const step = head.closest('[data-step]')?.dataset.step;
        if (step) openStep(step);
      }
    });

    openStep('pack', { scroll: false });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (processing) return;

      const fd = new FormData(form);
      const name = fd.get('name');
      const phone = phoneValue(form.elements.phone);
      // Lowercased — the guest-merge links data to accounts by exact email
      // equality, and phone keyboards auto-capitalize. Server normalizes too.
      const email = String(fd.get('email') || '').trim().toLowerCase();

      // Resolve license plate from saved vehicle or new input
      const licensePlate = resolveCreditPlate();

      // Validate everything up-front so we can highlight all bad fields at once.
      const errors = [];
      if (!user) {
        const nameOk = required(name);
        const phoneOk = isValidPhone(phone);
        const emailOk = isValidEmail(email);
        setFieldError(form.elements.name, !nameOk);
        setFieldError(form.elements.phone, !phoneOk);
        setFieldError(form.elements.email, !emailOk);
        if (!nameOk) errors.push(t('booking.errors.name'));
        if (!phoneOk) errors.push(t('booking.errors.phone'));
        if (!emailOk) errors.push(t('booking.errors.email'));
      }
      const plateOk = !!licensePlate && isValidLicensePlate(licensePlate);
      if (!plateOk && form.elements.licensePlate) setFieldError(form.elements.licensePlate, true);
      if (!plateOk) errors.push(t('booking.errors.plate'));
      if (errors.length) {
        openStep('details');
        showToast(errors[0], 'error');
        return;
      }

      // Terms + privacy must each be agreed before any payment intent is created.
      if (!form.elements.acceptTerms?.checked) {
        showToast(t('legal.acceptTermsRequired'), 'error');
        return;
      }
      if (!form.elements.acceptPrivacy?.checked) {
        showToast(t('legal.acceptPrivacyRequired'), 'error');
        return;
      }

      const billing = readBilling(form);
      if (billing.error) {
        openStep('billing');
        showToast(billing.error, 'error');
        return;
      }

      const qty = getSelectedQty();
      const packId = selectedPack?.id || null;
      if (qty <= 0) { openStep('pack'); showToast(t('credit.selectPack'), 'error'); return; }

      processing = true;
      const btn = form.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = t('credit.processing'); }

      // Save the new vehicle to the user's profile BEFORE redirecting.
      // The Netopia handoff navigates away from the SPA, so anything we
      // want persisted must happen here. Even if the user cancels payment,
      // the saved vehicle is harmless (they can remove it from /account/vehicles).
      if (user && licensePlate) {
        const normalizedPlate = licensePlate.toUpperCase().trim();
        const alreadySaved = profileVehicles.some(v => v.plate.toUpperCase().replace(/[\s-]/g, '') === normalizedPlate.replace(/[\s-]/g, ''));
        if (!alreadySaved) {
          const makeModel = fd.get('makeModel') || '';
          const [make, ...rest] = makeModel.split(' ');
          profileVehicles.push({ plate: normalizedPlate, make: make || '', model: rest.join(' ') || '' });
          await updateDocument('users', user.uid, { vehicles: profileVehicles }).catch(() => {});
        }
      }

      // Promo voucher wins over legacy signup voucher.
      const voucherIdToSend = (!promoVoucher && voucher && voucher.status === 'unused' && getSelectedPrice() > voucher.amount)
        ? voucher.userId
        : null;
      const voucherCodeToSend = promoVoucher ? promoVoucher.code : null;

      try {
        await startNetopiaPayment({
          orderType: 'credits',
          paymentMethod,
          packId,
          quantity: qty,
          // Always send the STANDARD pack price; the server applies the online
          // discount (online only) and any voucher on top.
          packPrice: getSelectedPrice(),
          // Legacy signup voucher stays online-only; promo codes apply to both.
          voucherId: paymentMethod === 'online' ? voucherIdToSend : null,
          voucherCode: voucherCodeToSend,
          customerData: {
            customerId: user?.uid || null,
            licensePlate,
            name,
            email,
            phone,
            billing,
          },
        });
        // Browser is navigating to Netopia — nothing else to do.
      } catch (err) {
        console.error(err);
        // Voucher rejected at pay time (expired / used up / race) — strip the
        // code and reset the voucher UI so the customer can pay, rather than a
        // generic error that leaves the dead code applied.
        if (/voucher:/i.test(err?.message || '') && promoVoucher) {
          promoVoucher = null;
          const vb = pageEl.querySelector('[data-voucher-block]');
          vb?.querySelector('[data-voucher-input-wrap]')?.classList.remove('hidden');
          vb?.querySelector('[data-voucher-applied]')?.classList.add('hidden');
          const vi = vb?.querySelector('input[name="voucherCode"]');
          if (vi) vi.value = '';
          updateSummary(pageEl);
          showToast(t('voucher.payFailed'), 'error');
        } else {
          showToast(t('common.error'), 'error');
        }
        processing = false;
        if (btn) { btn.disabled = false; btn.textContent = t('credit.payNow'); }
      }
    });
  }

  bindEvents(page);
}
