import { html, qs, escapeHtml, setFieldError } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { openModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { isValidEmail, isValidLicensePlate, isValidPhone, isValidCnp, isValidCui } from '../../utils/validators.js';
import { lookupCui } from '../../services/cuiService.js';
import { phoneField, phoneValue } from '../core/PhoneField.js';
import { dateTimeFieldHtml, wireDateTime } from '../../components/core/FormDateTime.js';
import { bucharestLocalToIso, isoToBucharestLocal } from '../../utils/date.js';
import { getBalance, lookupByPlate, getTokenPacks } from '../../services/tokenService.js';
import { getLongTermRates, calculateLongTermCost } from '../../services/longTermService.js';
import { listSeasonalPeriods, getEffectiveRates } from '../../services/seasonalRatesService.js';
import { createTransfer, updateTransfer } from '../../services/transferService.js';

// Billing rule mirror of BookingLongTerm: 1 day = 24h from drop-off with a
// single 2h grace at the end. Kept in sync so a walk-in priced here matches
// what the customer would have paid online for the same dates.
const WALKIN_GRACE_MS = 2 * 60 * 60 * 1000;
function walkInBillingDays(dropoffMs, pickupMs) {
  const duration = pickupMs - dropoffMs;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(1, Math.ceil((duration - WALKIN_GRACE_MS) / 86_400_000));
}

// Walk-in credit pricing mirrors the public BookingCredits page: an exact
// pack-quantity match uses that pack's listed price; any other quantity is
// priced at the cheapest per-credit rate across packs. tokenPacks prices are
// the final (online) prices — the same basis the long-term walk-in auto-fill
// uses — so cash-counter sales and online purchases stay consistent.
function computeCreditAmount(quantity, packs) {
  if (!Array.isArray(packs) || !packs.length) return null;
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) return null;
  const exact = packs.find((p) => Number(p.quantity) === qty);
  if (exact && Number.isFinite(Number(exact.price))) return Math.round(Number(exact.price));
  const rates = packs
    .map((p) => Number(p.price) / Number(p.quantity))
    .filter((r) => Number.isFinite(r) && r > 0);
  if (!rates.length) return null;
  return Math.round(qty * Math.min(...rates));
}

// Reusable "Create transaction" modal.
//
// Originally lived inside AdminTransactions.js (v1.6 + earlier). Lifted
// into a shared component during the v1.7 check-in/check-out redesign
// because the same modal is now the primary entry point for walk-in
// bookings on AdminCheckIns. The Transactions page no longer hosts it.
//
// Two booking types (long-term vs credit pack), two user modes
// (existing user lookup or new-user invite). Optional `autoCheckIn`
// checkbox routes to the v1.7 walk-in path on the server, immediately
// checking the customer in upon creation.
//
// Usage:
//   import { openCreateTransactionModal } from '.../CreateTransactionModal.js';
//   openCreateTransactionModal(users, async () => { /* on success */ });

const adminCreateLongtermBookingFn = httpsCallable(functions, 'adminCreateLongtermBooking');
const grantCreditsForCashFn       = httpsCallable(functions, 'grantCreditsForCash');
const checkInWithCreditsFn        = httpsCallable(functions, 'checkInWithCredits');
const adminSendInviteFn           = httpsCallable(functions, 'adminSendInvite');

// Map server error codes from checkInWithCredits to friendly i18n strings.
function creditCheckInError(err) {
  const msg = String(err?.message || '');
  if (msg.includes('NO_BALANCE')) return t('transactions.errorNoBalance');
  if (msg.includes('INSUFFICIENT_CREDITS')) return t('transactions.errorInsufficientCredits');
  if (msg.includes('ALREADY_CHECKED_IN')) return t('transactions.errorAlreadyCheckedIn');
  return err?.message || t('common.error');
}

export function openCreateTransactionModal(users, onDone, { allowWalkIn = true, editTransfer = null } = {}) {
  const locale = getLocale();
  // Sensible defaults so a walk-in agent doesn't have to fill dates from
  // scratch. Drop-off = now (the customer is at the gate); pick-up = +1
  // day. Agent can change either, but the common case is one click away.
  // Rendered as Bucharest wall-clock (the timezone all bookings live in) and
  // rounded to the picker's 15-minute grid so the time-slider pill matches
  // the committed value exactly.
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(Math.round(now.getMinutes() / 15) * 15);
  const defaultDropoff = isoToBucharestLocal(now.toISOString());
  const defaultPickup = isoToBucharestLocal(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());

  // Door-to-airport transfer is a third reservation type. When `editTransfer`
  // is passed, the modal opens straight into transfer-edit mode (the type
  // toggle is hidden and the form is prefilled). `ed` holds the values to
  // prefill; an ISO timestamp is converted back to flatpickr's `Y-m-d H:i`
  // (Bucharest wall-clock, so an untouched field round-trips unchanged).
  const ed = editTransfer || {};
  const isoToFlatpickr = (iso) => isoToBucharestLocal(iso);
  const edRoundtrip = ed.transferType === 'roundtrip';
  const body = html`
    <div class="space-y-4">
      <h2 class="font-heading font-bold text-xl text-blueberry-deep">${editTransfer ? t('transfers.formTitleEdit') : t('transactions.createTitle')}</h2>

      <!-- Type selector (hidden in transfer-edit mode — you can't switch a
           recorded airport transfer into a parking booking) -->
      <div data-type-wrap class="${editTransfer ? 'hidden' : ''}">
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('transactions.createTypeLabel')}</label>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2" data-type-toggle>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 ${editTransfer ? 'border-frost-deep' : 'border-mango bg-mango/5'} cursor-pointer">
            <input type="radio" name="tType" value="longterm" ${editTransfer ? '' : 'checked'} class="accent-mango w-4 h-4">
            <span class="text-[13px] font-medium">${t('transactions.createTypeLongterm')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="tType" value="credit" class="accent-mango w-4 h-4">
            <span class="text-[13px] font-medium">${t('transactions.createTypeCredit')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 ${editTransfer ? 'border-mango bg-mango/5' : 'border-frost-deep'} cursor-pointer">
            <input type="radio" name="tType" value="transfer" ${editTransfer ? 'checked' : ''} class="accent-mango w-4 h-4">
            <span class="text-[13px] font-medium">${t('transactions.createTypeTransfer')}</span>
          </label>
        </div>
      </div>

      <!-- User picker -->
      <div data-user-picker>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('transactions.createUserLabel')}</label>
        <div class="grid grid-cols-2 gap-2 mb-2" data-mode-toggle>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-blueberry bg-blueberry/5 cursor-pointer">
            <input type="radio" name="userMode" value="existing" checked class="accent-blueberry w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createUserExisting')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="userMode" value="new" class="accent-blueberry w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createUserNew')}</span>
          </label>
        </div>

        <div data-existing-block>
          <input list="users-options-ct" data-user-search type="text"
            placeholder="${t('transactions.createUserSearch')}"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <datalist id="users-options-ct">
            ${users
              .filter(u => u.email)
              .map(u => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.displayName || '')}</option>`)
              .join('')}
          </datalist>
          <!-- Saved plates of the matched customer (click to fill the plate
               field). Rendered/hidden by refreshUserPlates() once a user is
               picked from the datalist. -->
          <div data-user-plates class="mt-2 hidden"></div>
        </div>

        <div data-new-block class="hidden grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input type="text" name="newName" placeholder="${t('transactions.createNewName')}"
            class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <input type="email" name="newEmail" placeholder="${t('transactions.createNewEmail')}"
            class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <div class="sm:col-span-2">
            ${phoneField({ name: 'newPhone', placeholder: t('transactions.createNewPhone'), inputClass: 'flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40', selectClass: 'shrink-0 w-[7rem] px-2 py-2.5 rounded-xl border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-mango/40' })}
          </div>
        </div>
      </div>

      <!-- Plate -->
      <div data-plate-wrap>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createPlate')} *</label>
        <input type="text" name="plate" placeholder="B 123 ABC" required
          class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] uppercase font-mono focus:outline-none focus:border-mango/40">
      </div>

      <!-- Longterm-specific fields -->
      <div data-lt-fields class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createDropoff')} *</label>
            ${dateTimeFieldHtml({ name: 'dropoffAt', value: defaultDropoff, required: true, stepToNext: 'pickupAt' })}
            <label class="block text-[12px] font-medium text-charcoal/60 mt-2 mb-1">${t('transactions.createFlight')} <span class="text-dim font-normal">(${t('wizard.optional')})</span></label>
            <input type="text" name="flightNumberDropoff" placeholder="RO 201" maxlength="10" autocomplete="off" title="${escapeHtml(t('transactions.createFlightTooltip'))}"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] uppercase font-mono focus:outline-none focus:border-mango/40">
          </div>
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createPickup')} *</label>
            ${dateTimeFieldHtml({ name: 'pickupAt', value: defaultPickup, required: true })}
            <label class="block text-[12px] font-medium text-charcoal/60 mt-2 mb-1">${t('transactions.createFlight')} <span class="text-dim font-normal">(${t('wizard.optional')})</span></label>
            <input type="text" name="flightNumberPickup" placeholder="RO 201" maxlength="10" autocomplete="off" title="${escapeHtml(t('transactions.createFlightTooltip'))}"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] uppercase font-mono focus:outline-none focus:border-mango/40">
          </div>
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createPassengers')}</label>
          <select name="passengers" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
            ${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createTotal')} *</label>
          <input type="number" name="totalPrice" min="1" step="1" required placeholder="120"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          <p data-price-hint class="text-[12px] text-dim mt-1.5 hidden"></p>
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createNotes')}</label>
          <textarea name="notes" rows="2" placeholder="${escapeHtml(t('transactions.createNotesPlaceholder'))}"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40"></textarea>
        </div>
      </div>

      <!-- Credit-specific fields (hidden by default) -->
      <div data-cr-fields class="hidden space-y-3">
        ${allowWalkIn ? `
        <!-- Sell new vs. use existing credits -->
        <div class="grid grid-cols-2 gap-2" data-credit-mode-toggle>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-leaf bg-leaf/5 cursor-pointer text-center">
            <input type="radio" name="creditMode" value="sell" checked class="accent-leaf w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createCreditModeSell')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-frost-deep cursor-pointer text-center">
            <input type="radio" name="creditMode" value="use" class="accent-leaf w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createCreditModeUse')}</span>
          </label>
        </div>
        ` : ''}

        <!-- Sell new credits -->
        <div data-cr-sell class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createQuantity')} *</label>
            <input type="number" name="quantity" min="1" step="1" placeholder="5"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </div>
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createAmount')} *</label>
            <input type="number" name="amount" min="1" step="1" placeholder="100"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </div>
          <p data-credit-price-hint class="col-span-2 text-[12px] text-dim mt-0.5 hidden"></p>
        </div>

        <!-- Use existing credits (check-in) -->
        <div data-cr-use class="hidden space-y-3">
          <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-frost border border-frost-deep">
            <span class="text-[12px] uppercase tracking-wider text-dim font-mono">${t('transactions.createBalanceLabel')}</span>
            <span data-balance-display class="text-[13px] font-semibold text-charcoal/70">${t('transactions.createBalancePrompt')}</span>
          </div>
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createCreditsToUse')} *</label>
            <input type="number" name="creditsToUse" min="1" step="1" value="1"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </div>
        </div>
      </div>

      <!-- Door-to-airport transfer fields (shown only when type = transfer).
           Self-contained: none of the parking machinery above applies, and
           the submit handler branches early for this type. -->
      <div data-transfer-fields class="hidden space-y-3">
        <!-- Contact -->
        <p class="text-[12px] uppercase tracking-wider text-dim font-mono">${t('transfers.sectionContact')}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input type="text" name="transferName" value="${escapeHtml(ed.contactName || '')}" placeholder="${escapeHtml(t('transfers.contactName'))} *"
            class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          ${phoneField({ name: 'transferPhone', value: ed.phone || '', placeholder: `${t('transfers.phone')} *`, inputClass: 'flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40', selectClass: 'shrink-0 w-[7rem] px-2 py-2.5 rounded-xl border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-mango/40' })}
        </div>
        <input type="email" name="transferEmail" value="${escapeHtml(ed.email || '')}" placeholder="${escapeHtml(t('transfers.email'))}"
          class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">

        <!-- Trip -->
        <p class="text-[12px] uppercase tracking-wider text-dim font-mono pt-1">${t('transfers.sectionTrip')}</p>
        <input type="text" name="transferPickupAddress" value="${escapeHtml(ed.pickupAddress || '')}" placeholder="${escapeHtml(t('transfers.pickupAddress'))} *"
          class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.pickupAt')} *</label>
            ${dateTimeFieldHtml({ name: 'transferPickupAt', value: isoToFlatpickr(ed.pickupAt), classes: 'w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40' })}
          </div>
          <div>
            <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.flightNumber')}</label>
            <input type="text" name="transferFlight" value="${escapeHtml(ed.flightNumber || '')}" placeholder="RO 234"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] uppercase font-mono focus:outline-none focus:border-mango/40">
          </div>
        </div>

        <!-- One-way vs round-trip -->
        <div>
          <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.transferTypeLabel')}</label>
          <div class="grid grid-cols-2 gap-2" data-transfer-type-toggle>
            <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 ${edRoundtrip ? 'border-frost-deep' : 'border-blueberry bg-blueberry/5'} cursor-pointer">
              <input type="radio" name="transferType" value="oneway" ${edRoundtrip ? '' : 'checked'} class="accent-blueberry w-4 h-4">
              <span class="text-[12px] font-medium">${t('transfers.typeOneway')}</span>
            </label>
            <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 ${edRoundtrip ? 'border-blueberry bg-blueberry/5' : 'border-frost-deep'} cursor-pointer">
              <input type="radio" name="transferType" value="roundtrip" ${edRoundtrip ? 'checked' : ''} class="accent-blueberry w-4 h-4">
              <span class="text-[12px] font-medium">${t('transfers.typeRoundtrip')}</span>
            </label>
          </div>
        </div>

        <!-- Group & luggage -->
        <p class="text-[12px] uppercase tracking-wider text-dim font-mono pt-1">${t('transfers.sectionGroup')}</p>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <label class="block">
            <span class="block text-[11px] text-charcoal/60 mb-1">${t('transfers.adults')}</span>
            <input type="number" name="transferAdults" min="1" step="1" value="${ed.adults || 1}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </label>
          <label class="block">
            <span class="block text-[11px] text-charcoal/60 mb-1">${t('transfers.children')}</span>
            <input type="number" name="transferChildren" min="0" step="1" value="${ed.children || 0}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </label>
          <label class="block">
            <span class="block text-[11px] text-charcoal/60 mb-1">${t('transfers.infantsInArms')}</span>
            <input type="number" name="transferInfants" min="0" step="1" value="${ed.infantsInArms || 0}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </label>
          <label class="block">
            <span class="block text-[11px] text-charcoal/60 mb-1">${t('transfers.holdLuggage')}</span>
            <input type="number" name="transferHold" min="0" step="1" value="${ed.holdLuggage || 0}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </label>
          <label class="block">
            <span class="block text-[11px] text-charcoal/60 mb-1">${t('transfers.cabinLuggage')}</span>
            <input type="number" name="transferCabin" min="0" step="1" value="${ed.cabinLuggage || 0}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </label>
        </div>

        <!-- Return leg (round-trip only) -->
        <div data-transfer-return class="${edRoundtrip ? '' : 'hidden'} space-y-2 rounded-xl bg-frost border border-frost-deep p-3">
          <p class="text-[12px] uppercase tracking-wider text-dim font-mono">${t('transfers.sectionReturn')}</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.returnAt')}</label>
              ${dateTimeFieldHtml({ name: 'transferReturnAt', value: isoToFlatpickr(ed.returnAt), classes: 'w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40' })}
            </div>
            <div>
              <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.returnFlightNumber')}</label>
              <input type="text" name="transferReturnFlight" value="${escapeHtml(ed.returnFlightNumber || '')}" placeholder="RO 235"
                class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] uppercase font-mono focus:outline-none focus:border-mango/40">
            </div>
          </div>
          <div>
            <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.returnTo')}</label>
            <input type="text" name="transferReturnTo" value="${escapeHtml(ed.returnTo || '')}" placeholder="${escapeHtml(t('transfers.returnToHint'))}"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          </div>
        </div>

        <!-- Price (free-text note) -->
        <div>
          <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.price')}</label>
          <input type="text" name="transferPrice" value="${escapeHtml(ed.price || '')}" placeholder="${escapeHtml(t('transfers.pricePlaceholder'))}"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
        </div>
        <!-- Group notes -->
        <div>
          <label class="block text-[12px] font-medium text-charcoal/70 mb-1.5">${t('transfers.groupNotes')}</label>
          <textarea name="transferNotes" rows="2" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">${escapeHtml(ed.groupNotes || '')}</textarea>
        </div>
      </div>

      <!-- Billing (invoice) details — mandatory for admin-created long-term
           reservations and credit-pack sales so the customer can be invoiced.
           Shown for those two paths only (hidden for transfers + credit
           check-in). Pre-filled from a matched customer's saved billing. -->
      <div data-billing-wrap class="space-y-2.5 rounded-xl bg-frost border border-frost-deep p-3">
        <p class="text-[12px] uppercase tracking-wider text-dim font-mono">${t('transactions.billingSection')}</p>
        <div class="grid grid-cols-2 gap-2" data-billing-type-toggle>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-mango bg-mango/5 cursor-pointer">
            <input type="radio" name="ctBillingType" value="PF" checked class="accent-mango w-4 h-4">
            <span class="text-[12px] font-medium">${t('billing.typePF')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="ctBillingType" value="PJ" class="accent-mango w-4 h-4">
            <span class="text-[12px] font-medium">${t('billing.typePJ')}</span>
          </label>
        </div>

        <!-- PF: person -->
        <div data-billing-pf class="space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <input type="text" name="ctBillNume" placeholder="${escapeHtml(t('transactions.billNume'))} *"
              class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
            <input type="text" name="ctBillPrenume" placeholder="${escapeHtml(t('transactions.billPrenume'))} *"
              class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          </div>
          <input type="text" name="ctBillAddress" placeholder="${escapeHtml(t('transactions.billAddress'))} *"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <input type="text" name="ctBillCnp" placeholder="${escapeHtml(t('transactions.billCnpOptional'))}"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
        </div>

        <!-- PJ: company -->
        <div data-billing-pj class="hidden space-y-2">
          <input type="text" name="ctBillCompany" placeholder="${escapeHtml(t('transactions.billCompany'))} *"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <div class="relative">
            <input type="text" name="ctBillCui" placeholder="${escapeHtml(t('transactions.billCuiOptional'))}"
              class="w-full px-4 py-2.5 pr-10 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40" data-ct-cui>
            <span class="hidden absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-blueberry/30 border-t-blueberry animate-spin" data-ct-cui-spinner></span>
          </div>
          <input type="text" name="ctBillCompanyAddress" placeholder="${escapeHtml(t('transactions.billCompanyAddress'))} *"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
        </div>
      </div>

      <!-- Paid by (hidden when using existing credits — no money moves) -->
      <div data-paidby-wrap>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createPaidBy')}</label>
        <select name="paidBy" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <option value="cash">${t('checkins.payCash')}</option>
          <option value="card">${t('checkins.payCard')}</option>
          <option value="broker" data-broker-opt>${t('transactions.paidByBroker')}</option>
          <option value="later" data-later-opt>${t('transactions.paidByLater')}</option>
        </select>
      </div>

      <!-- Broker / prepaid reservation name (long-term only, shown when paidBy=broker) -->
      <div data-broker-wrap class="hidden">
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.brokerNameLabel')}</label>
        <input type="text" name="brokerName" placeholder="${escapeHtml(t('transactions.brokerNamePlaceholder'))}"
          class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
      </div>

      ${allowWalkIn ? `
      <!-- Walk-in auto-checkin (v1.7) -->
      <label data-autocheckin-wrap class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer pt-1">
        <input type="checkbox" name="autoCheckIn" class="accent-mango w-4 h-4 mt-0.5">
        <span>${t('checkins.walkInAutoCheckIn')}</span>
      </label>
      ` : ''}

      <div data-err class="text-danger text-[13px] hidden"></div>

      <div class="flex gap-3 justify-end pt-2">
        <button type="button" data-cancel class="px-4 py-2.5 rounded-xl bg-frost text-charcoal/70 font-semibold text-[14px] hover:bg-frost-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed">${t('common.cancel')}</button>
        <button type="button" data-submit class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('transactions.createSubmit')}</button>
      </div>
    </div>
  `;

  const { close, contentEl, setDismissible } = openModal(body);

  // While a create request is in flight the modal must not be cancellable:
  // an HTTPS callable can't be aborted, so a backdrop tap / Cancel during
  // the await would dismiss the form while the server still creates the
  // booking — staff would believe they cancelled a reservation that in
  // fact got saved (with whatever dates the form held at submit time).
  const cancelBtn = qs('[data-cancel]', contentEl);
  const lockModal = (locked) => {
    if (cancelBtn) cancelBtn.disabled = locked;
    setDismissible(!locked);
  };

  // Attach the branded flatpickr to the two datetime inputs. Picker
  // overlays render against document.body via flatpickr's defaults, so
  // they render above the modal without z-index drama.
  wireDateTime(contentEl);

  // ── Walk-in price auto-compute (long-term) ──
  // Pre-fill the total from the booked dates using the same tier + seasonal
  // engine the public booking page uses, so the agent gets the correct
  // price by default but can still override it (e.g. add an extra service).
  // The field stays the source of truth — we only auto-fill until the agent
  // edits it manually, then we never clobber their value.
  const totalInput = qs('[name="totalPrice"]', contentEl);
  const priceHintEl = qs('[data-price-hint]', contentEl);
  let ltRates = null;
  let ltSeasonal = [];
  let priceTouched = false;

  totalInput?.addEventListener('input', () => { priceTouched = true; });

  // ── Walk-in price auto-compute (credits) ──
  // Selling new credits pre-fills the amount from the entered quantity using
  // the same pack tiers shown on the public Pricing page, so the agent gets
  // the right cash amount by default but can still override it. Like the
  // long-term field, once the agent edits the amount we stop clobbering it.
  const quantityInput = qs('[name="quantity"]', contentEl);
  const amountInput = qs('[name="amount"]', contentEl);
  const creditPriceHintEl = qs('[data-credit-price-hint]', contentEl);
  let creditPacks = [];
  let amountTouched = false;

  amountInput?.addEventListener('input', () => { amountTouched = true; });

  function computeWalkInPrice() {
    if (!ltRates) return null;
    const dropoffRaw = qs('[name="dropoffAt"]', contentEl)?.value;
    const pickupRaw = qs('[name="pickupAt"]', contentEl)?.value;
    if (!dropoffRaw || !pickupRaw) return null;
    const dropMs = Date.parse(bucharestLocalToIso(dropoffRaw) || '');
    const pickMs = Date.parse(bucharestLocalToIso(pickupRaw) || '');
    const days = walkInBillingDays(dropMs, pickMs);
    if (!days) return null;
    // Pick-up day drives the seasonal override (matches BookingLongTerm).
    const pickupDay = String(pickupRaw).slice(0, 10);
    const eff = getEffectiveRates(ltSeasonal, pickupDay, ltRates);
    const ratesForQuote = eff.tiers?.length ? { tiers: eff.tiers } : ltRates;
    const quote = calculateLongTermCost(days, ratesForQuote);
    return { ...quote, period: eff.period || null };
  }

  function refreshWalkInPrice() {
    if (!priceHintEl || !totalInput) return;
    if (getType() !== 'longterm') { priceHintEl.classList.add('hidden'); return; }
    const q = computeWalkInPrice();
    if (!q || !q.total) { priceHintEl.classList.add('hidden'); return; }
    const seasonalNote = q.period ? ` · ${t('seasonal.appliedBadge', { name: q.period.name })}` : '';
    priceHintEl.textContent = t('transactions.priceComputed', {
      total: q.total, days: q.days, perDay: q.perDay,
    }) + seasonalNote;
    priceHintEl.classList.remove('hidden');
    if (!priceTouched) totalInput.value = String(q.total);
  }

  function refreshCreditPrice() {
    if (!amountInput || !creditPriceHintEl) return;
    // Only when selling NEW credits — not long-term, not use-existing.
    if (getType() !== 'credit' || isCreditUse()) {
      creditPriceHintEl.classList.add('hidden');
      return;
    }
    const qty = Number(quantityInput?.value);
    const amount = computeCreditAmount(qty, creditPacks);
    if (amount == null) { creditPriceHintEl.classList.add('hidden'); return; }
    creditPriceHintEl.textContent = t('transactions.creditAmountComputed', { amount, qty });
    creditPriceHintEl.classList.remove('hidden');
    if (!amountTouched) amountInput.value = String(amount);
  }

  // flatpickr dispatches a native 'change' on the underlying input when a
  // date is chosen; recompute on either field changing.
  qs('[name="dropoffAt"]', contentEl)?.addEventListener('change', refreshWalkInPrice);
  qs('[name="pickupAt"]', contentEl)?.addEventListener('change', refreshWalkInPrice);
  quantityInput?.addEventListener('input', refreshCreditPrice);

  Promise.all([
    getLongTermRates().catch(() => null),
    listSeasonalPeriods().catch(() => []),
    getTokenPacks().catch(() => []),
  ]).then(([rates, seasonal, packs]) => {
    ltRates = rates;
    ltSeasonal = Array.isArray(seasonal) ? seasonal : [];
    creditPacks = Array.isArray(packs) ? packs : [];
    refreshWalkInPrice();
    refreshCreditPrice();
  });

  const typeToggle = qs('[data-type-toggle]', contentEl);
  const ltFields = qs('[data-lt-fields]', contentEl);
  const crFields = qs('[data-cr-fields]', contentEl);
  const crSell = qs('[data-cr-sell]', contentEl);
  const crUse = qs('[data-cr-use]', contentEl);
  const creditModeToggle = qs('[data-credit-mode-toggle]', contentEl);
  const paidbyWrap = qs('[data-paidby-wrap]', contentEl);
  const paidBySelect = qs('[name="paidBy"]', contentEl);
  const brokerOpt = qs('[data-broker-opt]', contentEl);
  const laterOpt = qs('[data-later-opt]', contentEl);
  const brokerWrap = qs('[data-broker-wrap]', contentEl);
  const autoCheckInWrap = qs('[data-autocheckin-wrap]', contentEl);
  const autoCheckInInput = qs('input[name="autoCheckIn"]', contentEl);
  const submitBtn = qs('[data-submit]', contentEl);
  const balanceDisplay = qs('[data-balance-display]', contentEl);
  const transferFields = qs('[data-transfer-fields]', contentEl);
  const transferReturn = qs('[data-transfer-return]', contentEl);
  const transferTypeToggle = qs('[data-transfer-type-toggle]', contentEl);
  const userPickerWrap = qs('[data-user-picker]', contentEl);
  const plateWrap = qs('[data-plate-wrap]', contentEl);
  const userPlatesEl = qs('[data-user-plates]', contentEl);
  const billingWrap = qs('[data-billing-wrap]', contentEl);
  const billingPf = qs('[data-billing-pf]', contentEl);
  const billingPj = qs('[data-billing-pj]', contentEl);
  const billingTypeToggle = qs('[data-billing-type-toggle]', contentEl);
  const ctCuiInput = qs('[data-ct-cui]', contentEl);
  const ctCuiSpinner = qs('[data-ct-cui-spinner]', contentEl);
  // Reg. Com. isn't shown as a field — it's captured only when the CUI lookup
  // (ANAF) returns one, so it still lands on the stored billing record.
  let cuiRegCom = '';
  let lastBillingUserId = null; // guards prefill from re-clobbering on each keystroke

  // State readers — the DOM is the single source of truth.
  const getType = () => qs('input[name="tType"]:checked', contentEl).value;
  const getMode = () => qs('input[name="userMode"]:checked', contentEl).value;
  const getCreditMode = () => {
    const el = qs('input[name="creditMode"]:checked', contentEl);
    return el ? el.value : 'sell';
  };
  // True when checking a customer in against credits they already hold —
  // no money moves, so paid-by + auto-check-in + sell fields are hidden.
  const isCreditUse = () => getType() === 'credit' && getCreditMode() === 'use';

  function applyVisibility() {
    const type = getType();
    const isLT = type === 'longterm';
    const isCredit = type === 'credit';
    const isTransfer = type === 'transfer';

    ltFields.classList.toggle('hidden', !isLT);
    crFields.classList.toggle('hidden', !isCredit);
    transferFields?.classList.toggle('hidden', !isTransfer);

    // A transfer has no payer/plate — hide the parking-only blocks entirely.
    userPickerWrap?.classList.toggle('hidden', isTransfer);
    plateWrap?.classList.toggle('hidden', isTransfer);

    const useExisting = isCreditUse();
    if (crSell) crSell.classList.toggle('hidden', useExisting || !isCredit);
    if (crUse) crUse.classList.toggle('hidden', !useExisting);
    // Money + walk-in affordances are irrelevant when spending existing
    // credits or when recording a transfer (no money moves here).
    paidbyWrap?.classList.toggle('hidden', useExisting || isTransfer);
    // Billing is required only for invoiceable admin sales: a long-term
    // reservation or selling new credits. Not for credit check-in or transfers.
    const billingNeeded = isLT || (isCredit && !useExisting);
    billingWrap?.classList.toggle('hidden', !billingNeeded);
    // Broker/prepaid and pay-later are long-term-only payment routes. Hide
    // both options on the credit funnel (grantCreditsForCash only takes
    // cash/card) and snap the selector back to cash if it was left on either.
    if (brokerOpt) brokerOpt.hidden = !isLT;
    if (laterOpt) laterOpt.hidden = !isLT;
    if (!isLT && (paidBySelect?.value === 'broker' || paidBySelect?.value === 'later')) paidBySelect.value = 'cash';
    if (brokerWrap) brokerWrap.classList.toggle('hidden', !(isLT && paidBySelect?.value === 'broker'));
    // Pay-later is an unpaid reservation — you can't auto-check-in an unpaid
    // car (payment-first), so hide the walk-in checkbox and clear it.
    const isPayLater = isLT && paidBySelect?.value === 'later';
    autoCheckInWrap?.classList.toggle('hidden', useExisting || isPayLater || isTransfer);
    if (isPayLater && autoCheckInInput) autoCheckInInput.checked = false;
    submitBtn.textContent = isTransfer
      ? (editTransfer ? t('transfers.submitEdit') : t('transfers.submitCreate'))
      : useExisting
        ? t('transactions.createCheckInSubmit')
        : t('transactions.createSubmit');
  }

  // Re-apply visibility as the payment method changes — handles the broker
  // name field and the pay-later (unpaid) affordances.
  paidBySelect?.addEventListener('change', applyVisibility);

  typeToggle.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="tType"]')) return;
    typeToggle.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-mango', inp.checked);
      lbl.classList.toggle('bg-mango/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
    applyVisibility();
    if (isCreditUse()) refreshBalance();
    refreshWalkInPrice();
    refreshCreditPrice();
  });

  creditModeToggle?.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="creditMode"]')) return;
    creditModeToggle.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-leaf', inp.checked);
      lbl.classList.toggle('bg-leaf/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
    applyVisibility();
    if (isCreditUse()) refreshBalance();
    refreshCreditPrice();
  });

  // ── Transfer one-way / round-trip toggle ──
  // Reveals the return-leg block and keeps the segmented-control styling in
  // sync, mirroring the other toggles in this modal.
  transferTypeToggle?.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="transferType"]')) return;
    transferTypeToggle.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-blueberry', inp.checked);
      lbl.classList.toggle('bg-blueberry/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
    const roundtrip = qs('input[name="transferType"]:checked', contentEl)?.value === 'roundtrip';
    transferReturn?.classList.toggle('hidden', !roundtrip);
  });

  // ── Billing (PF/PJ) block ──
  function setBillingType(type) {
    const isPJ = type === 'PJ';
    billingPf?.classList.toggle('hidden', isPJ);
    billingPj?.classList.toggle('hidden', !isPJ);
    billingTypeToggle?.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-mango', inp.checked);
      lbl.classList.toggle('bg-mango/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
  }
  billingTypeToggle?.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="ctBillingType"]')) return;
    setBillingType(e.target.value);
  });

  // CUI (ANAF) autofill — the field is optional, but when a valid CUI is typed
  // we prefill company name + address (and capture Reg. Com. behind the scenes).
  // Mirrors the public BillingFields widget; only fills empty fields.
  if (ctCuiInput) {
    let cuiTimer = null;
    ctCuiInput.addEventListener('input', () => {
      clearTimeout(cuiTimer);
      cuiTimer = setTimeout(async () => {
        const value = ctCuiInput.value.trim();
        if (!isValidCui(value)) return;
        ctCuiSpinner?.classList.remove('hidden');
        const result = await lookupCui(value).catch(() => ({ error: true }));
        ctCuiSpinner?.classList.add('hidden');
        if (!result || result.error) return;
        const fill = (name, v) => {
          const el = qs(`[name="${name}"]`, contentEl);
          if (el && v && !el.value.trim()) el.value = v;
        };
        fill('ctBillCompany', result.companyName);
        fill('ctBillCompanyAddress', result.address);
        if (result.regCom) cuiRegCom = result.regCom;
      }, 600);
    });
  }

  // Pre-fill billing from a matched customer's saved record. Only re-applies
  // when the resolved account changes, so switching customer refreshes it but
  // ordinary typing doesn't clobber the agent's edits.
  function applyBillingToForm(b) {
    if (!b || typeof b !== 'object') return;
    const type = b.type === 'PJ' ? 'PJ' : 'PF';
    const radio = qs(`input[name="ctBillingType"][value="${type}"]`, contentEl);
    if (radio) radio.checked = true;
    setBillingType(type);
    const set = (name, v) => { const el = qs(`[name="${name}"]`, contentEl); if (el) el.value = v || ''; };
    if (type === 'PJ') {
      set('ctBillCompany', b.companyName);
      set('ctBillCui', b.cui);
      set('ctBillCompanyAddress', b.companyAddress);
      cuiRegCom = b.regCom || '';
    } else {
      let nume = b.lastName || '';
      let prenume = b.firstName || '';
      if (!nume && !prenume && b.name) {
        const parts = String(b.name).split(/\s+/).filter(Boolean);
        nume = parts[0] || b.name;
        prenume = parts.slice(1).join(' ');
      }
      set('ctBillNume', nume);
      set('ctBillPrenume', prenume);
      set('ctBillAddress', b.address || b.personalAddress || '');
      set('ctBillCnp', b.cnp);
    }
  }
  function maybePrefillBilling() {
    if (getMode() !== 'existing') { lastBillingUserId = null; return; }
    const u = resolveMatchedUser();
    const uid = u?.id || null;
    if (uid === lastBillingUserId) return;
    lastBillingUserId = uid;
    if (u && u.billing && Object.keys(u.billing).length) applyBillingToForm(u.billing);
  }

  // Read + validate the billing block. Returns { billing } or { error }.
  // PF requires Nume/Prenume/Adresă (CNP optional, checksum-validated if given);
  // PJ requires company name + address (CUI optional, validated if given).
  function readCtBilling() {
    const type = qs('input[name="ctBillingType"]:checked', contentEl)?.value === 'PJ' ? 'PJ' : 'PF';
    const val = (name) => String(qs(`[name="${name}"]`, contentEl)?.value || '').trim();
    const fail = (name, msgKey) => {
      const el = qs(`[name="${name}"]`, contentEl);
      if (el) setFieldError(el, true);
      return { error: t(msgKey) };
    };
    if (type === 'PJ') {
      const companyName = val('ctBillCompany');
      const cui = val('ctBillCui');
      const companyAddress = val('ctBillCompanyAddress');
      if (!companyName) return fail('ctBillCompany', 'billing.errors.companyName');
      if (cui && !isValidCui(cui)) return fail('ctBillCui', 'billing.errors.cui');
      if (!companyAddress) return fail('ctBillCompanyAddress', 'billing.errors.companyAddress');
      return { billing: { type: 'PJ', companyName, cui, regCom: cuiRegCom, companyAddress } };
    }
    const nume = val('ctBillNume');
    const prenume = val('ctBillPrenume');
    const address = val('ctBillAddress');
    const cnp = val('ctBillCnp');
    if (!nume) return fail('ctBillNume', 'transactions.billErrorNume');
    if (!prenume) return fail('ctBillPrenume', 'transactions.billErrorPrenume');
    if (!address) return fail('ctBillAddress', 'transactions.billErrorAddress');
    if (cnp && !isValidCnp(cnp)) return fail('ctBillCnp', 'billing.errors.cnp');
    const billing = { type: 'PF', name: `${nume} ${prenume}`.trim(), firstName: prenume, lastName: nume, address };
    if (cnp) billing.cnp = cnp;
    return { billing };
  }

  // ── Matched-customer resolution (existing-user mode) ──
  // The datalist input is free text; we treat a customer as "selected" only
  // when the value exactly equals one of their email/name. Returns the full
  // user record (with vehicles) so callers can read its plates / id.
  function resolveMatchedUser() {
    const search = String(qs('[data-user-search]', contentEl).value || '').trim().toLowerCase();
    if (!search) return null;
    return users.find(u =>
      (u.email || '').toLowerCase() === search
      || (u.displayName || '').toLowerCase() === search
    ) || null;
  }
  // ── Live balance lookup (use-existing mode) ──
  // Resolve by matched customer first, then by plate. Shown so the agent
  // sees "(if they have any)" before attempting the check-in.
  function resolveMatchedCustomerId() {
    const matched = resolveMatchedUser();
    return matched ? matched.id : null;
  }

  // ── Saved-plate chips (existing-user mode) ──
  // When a customer is matched, list their saved vehicles (users/{uid}.vehicles)
  // as clickable chips so the agent fills the plate in one tap instead of
  // re-typing it. Hidden for new-user mode or when the customer has no vehicles.
  function refreshUserPlates() {
    if (!userPlatesEl) return;
    const matched = getMode() === 'existing' ? resolveMatchedUser() : null;
    const seen = new Set();
    const plates = [];
    for (const v of (matched?.vehicles || [])) {
      const plate = String(v?.plate || '').toUpperCase().trim();
      if (!plate || seen.has(plate)) continue;
      seen.add(plate);
      const label = [v?.make, v?.model].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
      plates.push({ plate, label });
    }
    if (!plates.length) {
      userPlatesEl.classList.add('hidden');
      userPlatesEl.innerHTML = '';
      return;
    }
    const current = String(qs('[name="plate"]', contentEl)?.value || '').toUpperCase().trim();
    userPlatesEl.innerHTML = `
      <p class="text-[12px] text-dim mb-1.5">${escapeHtml(t('transactions.createUserPlatesLabel'))}</p>
      <div class="flex flex-wrap gap-1.5">
        ${plates.map((p) => {
          const on = p.plate === current;
          return `<button type="button" data-plate-chip="${escapeHtml(p.plate)}" class="inline-flex items-center px-3 py-1.5 rounded-lg border ${on ? 'border-mango bg-mango/5' : 'border-frost-deep bg-white'} hover:border-mango/60 hover:bg-mango/5 transition-colors">
            <span class="text-[13px] font-mono uppercase">${escapeHtml(p.plate)}</span>
            ${p.label ? `<span class="text-dim text-[11px] ml-1.5">${escapeHtml(p.label)}</span>` : ''}
          </button>`;
        }).join('')}
      </div>`;
    userPlatesEl.classList.remove('hidden');
  }

  // Clicking a chip fills the plate field and re-runs the downstream side
  // effects (balance lookup listens on the plate input), then re-highlights.
  userPlatesEl?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-plate-chip]');
    if (!chip || !userPlatesEl.contains(chip)) return;
    const plateInput = qs('[name="plate"]', contentEl);
    if (!plateInput) return;
    plateInput.value = chip.dataset.plateChip;
    plateInput.dispatchEvent(new Event('input', { bubbles: true }));
    refreshUserPlates();
  });

  let balanceToken = 0;
  async function refreshBalance() {
    if (!isCreditUse() || !balanceDisplay) return;
    const plate = String(qs('[name="plate"]', contentEl).value || '').toUpperCase().trim();
    const customerId = getMode() === 'existing' ? resolveMatchedCustomerId() : null;
    if (!plate && !customerId) {
      balanceDisplay.textContent = t('transactions.createBalancePrompt');
      balanceDisplay.className = 'text-[13px] font-semibold text-charcoal/70';
      return;
    }
    const myToken = ++balanceToken;
    balanceDisplay.textContent = t('transactions.createBalanceChecking');
    balanceDisplay.className = 'text-[13px] font-semibold text-dim';
    try {
      let bal = null;
      if (customerId) bal = await getBalance(customerId);
      if (!bal && plate) bal = await lookupByPlate(plate);
      if (myToken !== balanceToken) return; // a newer lookup superseded this one
      const credits = bal ? Number(bal.balance || 0) : 0;
      if (credits > 0) {
        balanceDisplay.textContent = t('transactions.createBalanceCredits', { n: credits });
        balanceDisplay.className = 'text-[13px] font-semibold text-leaf';
      } else {
        balanceDisplay.textContent = t('transactions.createBalanceNone');
        balanceDisplay.className = 'text-[13px] font-semibold text-red-600';
      }
    } catch (err) {
      if (myToken !== balanceToken) return;
      balanceDisplay.textContent = t('transactions.createBalanceNone');
      balanceDisplay.className = 'text-[13px] font-semibold text-red-600';
    }
  }

  let balanceTimer = null;
  const scheduleBalance = () => {
    clearTimeout(balanceTimer);
    balanceTimer = setTimeout(refreshBalance, 350);
  };
  qs('[name="plate"]', contentEl).addEventListener('input', scheduleBalance);
  qs('[data-user-search]', contentEl).addEventListener('input', scheduleBalance);
  qs('[data-user-search]', contentEl).addEventListener('input', refreshUserPlates);
  qs('[data-user-search]', contentEl).addEventListener('input', maybePrefillBilling);

  applyVisibility();
  refreshUserPlates();

  const modeToggle = qs('[data-mode-toggle]', contentEl);
  const existingBlock = qs('[data-existing-block]', contentEl);
  const newBlock = qs('[data-new-block]', contentEl);
  modeToggle.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="userMode"]')) return;
    const isExisting = e.target.value === 'existing';
    existingBlock.classList.toggle('hidden', !isExisting);
    newBlock.classList.toggle('hidden', isExisting);
    if (!isExisting) newBlock.classList.add('grid');
    modeToggle.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-blueberry', inp.checked);
      lbl.classList.toggle('bg-blueberry/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
    refreshUserPlates();
    maybePrefillBilling();
  });

  qs('[data-cancel]', contentEl).addEventListener('click', close);

  qs('[data-submit]', contentEl).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const errEl = qs('[data-err]', contentEl);
    errEl.classList.add('hidden');

    const type = qs('input[name="tType"]:checked', contentEl).value;

    // ── Door-to-airport transfer ──
    // A passenger transfer reservation — no plate, no parking, no money. Branch
    // out before any of the booking machinery and write straight to `transfers`.
    if (type === 'transfer') {
      const showErr = (m) => { errEl.textContent = m; errEl.classList.remove('hidden'); };
      const val = (name) => String(qs(`[name="${name}"]`, contentEl)?.value || '').trim();
      const contactName = val('transferName');
      const phone = phoneValue(qs('[name="transferPhone"]', contentEl));
      const pickupAddress = val('transferPickupAddress');
      const pickupRaw = qs('[name="transferPickupAt"]', contentEl)?.value || '';
      const transferType = qs('input[name="transferType"]:checked', contentEl)?.value === 'roundtrip' ? 'roundtrip' : 'oneway';
      const returnRaw = qs('[name="transferReturnAt"]', contentEl)?.value || '';

      if (!contactName) return showErr(t('transfers.errorMissingContact'));
      if (!phone) return showErr(t('transfers.errorMissingPhone'));
      if (!pickupAddress) return showErr(t('transfers.errorMissingPickupAddress'));
      if (!pickupRaw) return showErr(t('transfers.errorMissingPickupAt'));
      if (transferType === 'roundtrip' && !returnRaw) return showErr(t('transfers.errorMissingReturn'));

      // flatpickr stores `YYYY-MM-DD HH:MM` — Bucharest wall-clock, converted
      // to an ISO instant by the shared helper (same convention everywhere).
      const toIso = (raw) => (raw ? (bucharestLocalToIso(raw) || '') : '');
      const payload = {
        contactName, phone,
        email: val('transferEmail'),
        pickupAddress,
        pickupAt: toIso(pickupRaw),
        transferType,
        flightNumber: val('transferFlight'),
        adults: val('transferAdults'),
        children: val('transferChildren'),
        infantsInArms: val('transferInfants'),
        holdLuggage: val('transferHold'),
        cabinLuggage: val('transferCabin'),
        returnAt: toIso(returnRaw),
        returnFlightNumber: val('transferReturnFlight'),
        returnTo: val('transferReturnTo'),
        price: val('transferPrice'),
        groupNotes: val('transferNotes'),
      };
      btn.disabled = true;
      btn.textContent = '…';
      lockModal(true);
      try {
        if (editTransfer) {
          await updateTransfer(editTransfer.id, payload);
          showToast(t('transfers.updatedToast'), 'success');
        } else {
          await createTransfer(payload);
          showToast(t('transfers.createdToast'), 'success');
        }
        close();
        onDone?.({ transfer: true });
      } catch (err) {
        console.error('saveTransfer', err);
        showErr(err?.message || t('common.error'));
        btn.disabled = false;
        btn.textContent = editTransfer ? t('transfers.submitEdit') : t('transfers.submitCreate');
        lockModal(false);
      }
      return;
    }

    const mode = qs('input[name="userMode"]:checked', contentEl).value;
    const plate = String(qs('[name="plate"]', contentEl).value || '').toUpperCase().trim();
    const paidBy = qs('[name="paidBy"]', contentEl).value;
    const autoCheckInEl = qs('input[name="autoCheckIn"]', contentEl);
    const autoCheckIn = !!autoCheckInEl?.checked;

    if (!isValidLicensePlate(plate)) {
      errEl.textContent = t('checkins.errorInvalidPlate') || t('common.error');
      errEl.classList.remove('hidden');
      return;
    }

    // ── Credit check-in against an existing balance ──
    // No payer / new-user requirement and no money movement — we just
    // spend credits the customer already holds and put the car on the lot.
    if (type === 'credit' && getCreditMode() === 'use') {
      const creditsRaw = qs('[name="creditsToUse"]', contentEl).value;
      const credits = Number(creditsRaw);
      if (!creditsRaw || !Number.isInteger(credits) || credits <= 0) {
        errEl.textContent = t('transactions.errorMissingCredits');
        errEl.classList.remove('hidden');
        return;
      }
      const matchedCustomerId = mode === 'existing' ? resolveMatchedCustomerId() : null;
      btn.disabled = true;
      btn.textContent = '…';
      lockModal(true);
      try {
        const result = await checkInWithCreditsFn({ plate, customerId: matchedCustomerId, credits });
        showToast(t('transactions.createCheckInSuccess', { n: credits }), 'success');
        close();
        onDone?.(result?.data || { checkedIn: true });
      } catch (err) {
        console.error('checkInWithCredits', err);
        errEl.textContent = creditCheckInError(err);
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = t('transactions.createCheckInSubmit');
        lockModal(false);
      }
      return;
    }

    let payerEmail = '';
    let payerName = '';
    let payerPhone = '';
    let customerId = null;

    if (mode === 'existing') {
      const search = String(qs('[data-user-search]', contentEl).value || '').trim().toLowerCase();
      if (!search) {
        errEl.textContent = t('transactions.createPickUser');
        errEl.classList.remove('hidden');
        return;
      }
      const matched = users.find(u =>
        (u.email || '').toLowerCase() === search
        || (u.displayName || '').toLowerCase() === search
      );
      if (matched) {
        payerEmail = matched.email || '';
        payerName = matched.displayName || '';
        payerPhone = matched.phone || '';
        customerId = matched.id;
      } else if (isValidEmail(search)) {
        payerEmail = search;
      } else {
        errEl.textContent = t('transactions.createPickUser');
        errEl.classList.remove('hidden');
        return;
      }
    } else {
      const newName = String(qs('[name="newName"]', contentEl).value || '').trim();
      const newEmail = String(qs('[name="newEmail"]', contentEl).value || '').trim();
      const newPhone = phoneValue(qs('[name="newPhone"]', contentEl));
      if (!isValidEmail(newEmail)) {
        errEl.textContent = t('admin.usersError');
        errEl.classList.remove('hidden');
        return;
      }
      // Phone is mandatory so staff can reach the customer.
      if (!isValidPhone(newPhone)) {
        errEl.textContent = t('transactions.errorMissingPhone');
        errEl.classList.remove('hidden');
        return;
      }
      payerEmail = newEmail;
      payerName = newName;
      payerPhone = newPhone;
    }

    // Billing is mandatory for admin-created sales (long-term + credit packs).
    // Credit check-in against existing credits already returned above, so at
    // this point the sale is always invoiceable.
    const billingRes = readCtBilling();
    if (billingRes.error) {
      errEl.textContent = billingRes.error;
      errEl.classList.remove('hidden');
      return;
    }
    const billing = billingRes.billing;

    btn.disabled = true;
    btn.textContent = '…';
    lockModal(true);

    try {
      let result;
      if (type === 'longterm') {
        const dropoffRaw = qs('[name="dropoffAt"]', contentEl).value;
        const pickupRaw = qs('[name="pickupAt"]', contentEl).value;
        const totalRaw = qs('[name="totalPrice"]', contentEl).value;
        const totalPrice = Number(totalRaw);
        if (!dropoffRaw) throw new Error(t('transactions.errorMissingDropoff'));
        if (!pickupRaw) throw new Error(t('transactions.errorMissingPickup'));
        if (!totalRaw || !Number.isFinite(totalPrice) || totalPrice <= 0) {
          throw new Error(t('transactions.errorMissingTotal'));
        }
        // flatpickr stores `YYYY-MM-DD HH:MM` — always Bucharest wall-clock,
        // whatever timezone the staff device happens to be set to.
        const dropoffAt = bucharestLocalToIso(dropoffRaw);
        const pickupAt = bucharestLocalToIso(pickupRaw);
        if (Date.parse(pickupAt) <= Date.parse(dropoffAt)) {
          throw new Error(t('transactions.errorPickupBeforeDropoff'));
        }
        // Same 2h-grace billing-days rule as the auto-filled price hint and
        // the public booking flow — otherwise a 25h stay is priced as 1 day
        // but stored as days=2, skewing the per-day rate that overstay and
        // reprice math later derive from totalPrice / days.
        const days = Math.max(1, walkInBillingDays(Date.parse(dropoffAt), Date.parse(pickupAt)));
        const brokerName = paidBy === 'broker'
          ? String(qs('[name="brokerName"]', contentEl)?.value || '').trim()
          : '';
        const notes = String(qs('[name="notes"]', contentEl)?.value || '').trim();
        const passengers = Math.min(10, Math.max(1, parseInt(qs('[name="passengers"]', contentEl)?.value, 10) || 1));
        const cleanFlight = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 12);
        const flightNumberDropoff = cleanFlight(qs('[name="flightNumberDropoff"]', contentEl)?.value);
        const flightNumberPickup = cleanFlight(qs('[name="flightNumberPickup"]', contentEl)?.value);
        result = await adminCreateLongtermBookingFn({
          plate, dropoffAt, pickupAt, days, totalPrice,
          payerEmail, payerName, payerPhone, customerId,
          paidBy, brokerName, autoCheckIn, notes, billing, passengers,
          flightNumberDropoff, flightNumberPickup,
        });
      } else {
        const qtyRaw = qs('[name="quantity"]', contentEl).value;
        const amtRaw = qs('[name="amount"]', contentEl).value;
        const quantity = Number(qtyRaw);
        const amount = Number(amtRaw);
        if (!qtyRaw || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(t('transactions.errorMissingQuantity'));
        }
        if (!amtRaw || !Number.isFinite(amount) || amount <= 0) {
          throw new Error(t('transactions.errorMissingAmount'));
        }
        result = await grantCreditsForCashFn({
          plate, quantity, amount,
          payerEmail, payerName, payerPhone, customerId,
          paidBy, autoCheckIn, billing,
        });
      }

      if (mode === 'new') {
        try {
          await adminSendInviteFn({ email: payerEmail, displayName: payerName, role: 'customer', locale });
          showToast(t('transactions.createInviteSent'), 'info');
        } catch (err) {
          console.warn('invite send failed (transaction still created):', err?.message);
        }
      }

      const checkedIn = !!result?.data?.checkedIn;
      showToast(
        checkedIn ? t('checkins.walkInDoneCheckedIn') : t('transactions.createSuccess'),
        'success',
      );
      close();
      onDone?.(result?.data || {});
    } catch (err) {
      console.error('createTransaction', err);
      errEl.textContent = err?.message || t('common.error');
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = t('transactions.createSubmit');
      lockModal(false);
    }
  });
}
