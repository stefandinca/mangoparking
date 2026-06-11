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
import { getCurrentUser, getUserProfile } from '../../firebase/auth.js';
import { getDocument, updateDocument } from '../../firebase/db.js';
import { isValidEmail, isValidPhone, isValidLicensePlate, required } from '../../utils/validators.js';
import { showToast } from '../../components/core/Toast.js';

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

  function render() {
    const page = html`<div>
      <div data-navbar></div>
      <section class="pt-32 pb-20">
        <div class="max-w-3xl mx-auto px-6">
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
        <button data-pack-id="${p.id}" class="group relative overflow-hidden rounded-2xl bg-white border-2 ${isSelected ? 'border-mango ring-2 ring-mango/30' : 'border-frost-deep hover:border-blueberry/40'} shadow-sm text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
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

    return `
      <!-- Pack selection -->
      <div class="mb-8">
        <h3 class="font-heading font-semibold text-lg mb-4">${t('credit.selectPack')}</h3>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          ${packCards}
        </div>
      </div>

      <form data-purchase-form class="space-y-6">
        <!-- Vehicle -->
        <div class="card-solid rounded-2xl p-6">
          <h3 class="font-heading font-semibold text-lg mb-4">${t('credit.vehicleInfo')}</h3>
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
          <div class="grid md:grid-cols-2 gap-4 hidden" data-new-vehicle-fields>
          ` : `
          <div class="grid md:grid-cols-2 gap-4" data-new-vehicle-fields>
          `}
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
              <input type="text" name="licensePlate" placeholder="B 123 ABC" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 uppercase">
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.makeModel')}</label>
              <input type="text" name="makeModel" placeholder="Dacia Logan" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
            </div>
          </div>
        </div>

        <!-- Contact Info -->
        ${user ? `
        <div class="card-solid rounded-2xl p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-heading font-semibold text-lg">${t('booking.contactInfo')}</h3>
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
        </div>
        ` : `
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
        `}

        <!-- Billing (PF/PJ) -->
        <label class="flex items-center gap-2.5 text-[14px] text-charcoal/80 cursor-pointer px-1 mb-2" data-billing-same-wrap>
          <input type="checkbox" name="billingSameAsContact" class="accent-blueberry w-4 h-4 shrink-0">
          <span>${t('billing.sameAsContact')}</span>
        </label>
        ${billingFieldsHtml(profile?.billing)}

        <!-- Payment method -->
        <div class="card-solid rounded-2xl p-6" data-paymethod-block>
          <h3 class="font-heading font-semibold text-lg mb-4">${t('payment.method.title')}</h3>
          <div class="grid sm:grid-cols-2 gap-3" data-paymethod-toggle>
            <label class="flex items-start gap-3 p-4 rounded-2xl border-2 border-mango bg-mango/5 cursor-pointer transition-colors">
              <input type="radio" name="paymentMethod" value="online" class="accent-mango w-4 h-4 mt-0.5" checked>
              <div class="min-w-0">
                <p class="font-semibold text-[15px] text-charcoal">${t('payment.method.online')}</p>
                <p class="text-[13px] text-leaf font-medium mt-0.5">${t('payment.method.onlineHint')}</p>
              </div>
            </label>
            <label class="flex items-start gap-3 p-4 rounded-2xl border-2 border-frost-deep cursor-pointer transition-colors">
              <input type="radio" name="paymentMethod" value="pay-at-pickup" class="accent-mango w-4 h-4 mt-0.5">
              <div class="min-w-0">
                <p class="font-semibold text-[15px] text-charcoal">${t('payment.method.pickup')}</p>
                <p class="text-[13px] text-dim mt-0.5">${t('payment.method.pickupHint')}</p>
              </div>
            </label>
          </div>
        </div>

        <!-- Voucher code -->
        <div class="card-solid rounded-2xl p-6" data-voucher-block>
          <h3 class="font-heading font-semibold text-lg mb-3">${t('voucher.codeTitle')}</h3>
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

        <!-- Summary -->
        <div class="card-solid rounded-2xl p-6" data-summary>
          <h3 class="font-heading font-semibold text-lg mb-4">${t('credit.summary')}</h3>
          <div data-price-summary>
            <p class="text-dim/60">${t('credit.selectPack')}</p>
          </div>
        </div>

        <label class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
          <input type="checkbox" name="acceptTerms" required class="accent-blueberry w-4 h-4 mt-1 shrink-0">
          <span>${t('legal.acceptTerms')}</span>
        </label>

        <label class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
          <input type="checkbox" name="acceptPrivacy" required class="accent-blueberry w-4 h-4 mt-1 shrink-0">
          <span>${t('legal.acceptPrivacy')}</span>
        </label>

        <button type="submit" data-pay-btn class="w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[16px] py-4 rounded-2xl transition-colors shadow-md disabled:opacity-50" ${!selectedPack ? 'disabled' : ''}>
          ${processing
            ? t('credit.processing')
            : (paymentMethod === 'pay-at-pickup' ? t('credit.payNowPickup') : t('credit.payNow'))}
        </button>
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
      const promoActive = promoVoucher?.discountAmount > 0;
      const promoLine = promoActive
        ? `<p class="text-[13px] text-leaf mt-2">${t('voucher.summaryLine', { code: promoVoucher.code, amount: promoVoucher.discountAmount })}</p>`
        : '';
      summary.innerHTML = `
        <div class="flex justify-between items-center mb-1"><span>${qty} ${t('credit.plural')}</span>
          <div class="text-right">
            ${showAnchor ? `<div class="font-mono text-[13px] text-dim line-through leading-none">${onlinePrice} lei</div>` : ''}
            <div class="font-mono font-semibold">${displayPrice} lei</div>
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
      const billingFirst = () => form.querySelector('[name="billingFirstName"]');
      const billingLast = () => form.querySelector('[name="billingLastName"]');
      const isPF = () => (form.querySelector('input[name="billingType"]:checked')?.value || 'PF') !== 'PJ';
      function syncFromContact() {
        if (!chk.checked) return;
        const parts = String(form.querySelector('[name="name"]')?.value || '').trim().split(/\s+/).filter(Boolean);
        const fn = billingFirst();
        const ln = billingLast();
        if (fn) fn.value = parts[0] || '';
        if (ln) ln.value = parts.length > 1 ? parts.slice(1).join(' ') : '';
      }
      function applyLock() {
        const on = chk.checked;
        [billingFirst(), billingLast()].forEach((el) => {
          if (!el) return;
          el.disabled = on;
          el.classList.toggle('bg-frost', on);
          el.classList.toggle('text-dim', on);
        });
        if (on) syncFromContact();
      }
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (processing) return;

      const fd = new FormData(form);
      const name = fd.get('name');
      const phone = fd.get('phone');
      const email = fd.get('email');

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
        showToast(billing.error, 'error');
        return;
      }

      const qty = getSelectedQty();
      const packId = selectedPack?.id || null;
      if (qty <= 0) { showToast(t('credit.selectPack'), 'error'); return; }

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
        showToast(t('common.error'), 'error');
        processing = false;
        if (btn) { btn.disabled = false; btn.textContent = t('credit.payNow'); }
      }
    });
  }

  bindEvents(page);
}
