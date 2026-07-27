// Booking actions + the dialogs behind them.
//
// Extracted from AdminCheckIns so a second surface (the reservation detail
// view) can offer the same operations without a second implementation of
// money-moving buttons. The dialogs moved verbatim; `runBookingAction` is the
// former in-page `[data-action]` dispatcher with its four closure dependencies
// (bookings / locale / creditPerDay / rerender) turned into parameters.
//
// Callers: AdminCheckIns (live list — its snapshot refreshes the rows, so it
// passes a no-op onDone) and the reservation detail view (re-fetches on done).

import { html, qs, escapeHtml } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';
import { openModal, confirmModal } from '../core/Modal.js';
import { showToast } from '../core/Toast.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { getDocument } from '../../firebase/db.js';
import { checkInBooking, checkOutBooking, updateBookingDetails } from '../../services/bookingService.js';
import { phoneField, phoneValue } from '../core/PhoneField.js';
import { dateTimeFieldHtml, wireDateTime } from '../core/FormDateTime.js';
import { geoFieldsHtml, wireGeoFields, readGeoFields } from '../widgets/BillingFields.js';
import { isValidEmail, isValidPhone, isValidLicensePlate } from '../../utils/validators.js';
import { bucharestLocalToIso, isoToBucharestLocal, anyToIso } from '../../utils/date.js';
import { bookingDisplayCode } from '../../utils/bookingCode.js';

const adminMarkOrderPaidFn = httpsCallable(functions, 'adminMarkOrderPaid');
const cancelBookingFn = httpsCallable(functions, 'cancelBookingWithRefund');
const adminChargeOverstayFn = httpsCallable(functions, 'adminChargeOverstay');
const resendConfirmationFn = httpsCallable(functions, 'adminResendConfirmationEmail');
const previewBookingRepriceFn = httpsCallable(functions, 'previewBookingReprice');
const adminRepriceBookingFn = httpsCallable(functions, 'adminRepriceBooking');

// Mirrors the check-in board's grace before a booking reads as overdue.
const OVERDUE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export function fmtDateTime(iso, locale) {
  iso = anyToIso(iso);
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Pinned to the lot's timezone (matches BookingDetailModal and the
    // customer emails) so a staff device with a foreign/mis-set timezone
    // still shows the times the customer was promised.
    return d.toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Bucharest',
    });
  } catch { return iso; }
}

function bucharestDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch { return null; }
}

// Europe/Bucharest UTC offset (minutes) at a given instant — anchors the
// commuter 20:00 cutoff to local wall-clock time across DST.
function bucharestOffsetMinutes(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const hour = +p.hour === 24 ? 0 : +p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Absolute ms for `hour`:00 Europe/Bucharest on the local calendar day of `iso`.
function bucharestCutoffMs(iso, hour = 20) {
  const day = bucharestDate(iso);
  if (!day) return null;
  const guessUtc = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(guessUtc)) return null;
  const off = bucharestOffsetMinutes(new Date(guessUtc));
  return guessUtc - off * 60000;
}

// The instant a booking's 2h overstay grace starts. Long-term: the scheduled
// pick-up. Credit/commuter: 20:00 Europe/Bucharest on the check-in day — the
// end of operating hours (matches the commuter 7PM "overnight fee" reminder).
export function pickupDeadlineMs(b) {
  if (b.type === 'credit') {
    return bucharestCutoffMs(b.checkinTimestamp || b.startDate, 20);
  }
  const pickup = b.pickupAt || b.endDate;
  if (!pickup) return null;
  const ms = new Date(pickup).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Cheapest per-credit price across the active packs (matches BookingCredits'
// custom-quantity rate). Used to value a commuter's overstay days.
export function perCreditPrice(packs) {
  const rates = (packs || [])
    .map((p) => Number(p.price) / Number(p.quantity))
    .filter((r) => Number.isFinite(r) && r > 0);
  return rates.length ? Math.round(Math.min(...rates)) : 0;
}

// Extra days owed when a car is checked out after its pick-up time. Uses
// the same 2h end-of-booking grace as the billing engine, and values each
// extra day at the booking's own daily rate (totalPrice / days). Returns
// null when there's nothing extra to collect. Drives the late-check-out
// warning so an agent never silently completes an overstay.
export function overstayInfo(b, perCredit = 0) {
  const dl = pickupDeadlineMs(b);
  if (dl == null) return null;
  const overMs = Date.now() - dl - OVERDUE_THRESHOLD_MS;
  if (overMs <= 0) return null;
  const daysLate = Math.max(1, Math.ceil(overMs / 86_400_000));
  // Long-term: the booking's own daily rate. Commuter: each extra day is
  // another credit, valued at the standard per-credit price.
  let perDay;
  if (b.type === 'credit') {
    perDay = perCredit;
  } else {
    const days = Number(b.days) || 0;
    const total = Number(b.totalPrice) || 0;
    perDay = days > 0 ? Math.round(total / days) : 0;
  }
  return { daysLate, perDay, amount: daysLate * perDay };
}

export function paymentStatusBadge(b) {
  const status = b.paymentStatus || 'paid';
  const paidBy = b.paidBy || '';
  const labelMap = {
    paid: t('checkins.payPaid'),
    unpaid: t('checkins.payUnpaid'),
    'refund-pending': t('checkins.payRefundPending'),
    refunded: t('checkins.payRefunded'),
  };
  const styleMap = {
    paid: 'bg-leaf/10 text-leaf',
    unpaid: 'bg-red-100 text-red-600',
    'refund-pending': 'bg-mango/10 text-mango',
    refunded: 'bg-gray-100 text-dim',
  };
  const cls = styleMap[status] || styleMap.paid;
  const label = labelMap[status] || status;
  const partnerChip = (paidBy === 'broker' || paidBy === 'partner')
    ? `<span class="ml-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-blueberry/10 text-blueberry">${paidBy}</span>`
    : '';
  return `<span class="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${cls}">${label}${partnerChip}</span>`;
}

// Localized label for a booking status / payment-status value. Guards the two
// failure modes of a raw t() lookup: a missing value builds the literal key
// "reservations.status.undefined", and an unknown value echoes the key back —
// both of which used to render verbatim in the reservation archive.
export function reservationStatusLabel(v) {
  if (!v) return '—';
  const key = `reservations.status.${v}`;
  const label = t(key);
  return label === key ? String(v) : label;
}

// Reservation-type chip — lets staff tell long-term, commuter and broker /
// prepaid (ParkVia etc.) bookings apart at a glance. Broker bookings carry
// `source: 'broker'` / `paidBy: 'broker'` and an optional brokerName.
export function typeBadge(b) {
  const isBroker = b.source === 'broker' || b.paidBy === 'broker';
  const base = 'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded';
  const planeIcon = '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z"/></svg>';
  const peopleIcon = '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11a3 3 0 100-6 3 3 0 000 6zm-8 0a3 3 0 100-6 3 3 0 000 6zm0 2c-2.7 0-8 1.3-8 4v2h8v-2c0-1 .4-1.9 1-2.6-.3 0-.7-.4-1-.4zm8 0c-.3 0-.7 0-1 .4.6.7 1 1.6 1 2.6v2h8v-2c0-2.7-5.3-4-8-4z"/></svg>';
  const brokerIcon = '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M20 6h-4V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zm-6 0h-4V4h4v2z"/></svg>';
  if (isBroker) {
    const name = b.brokerName ? `: ${escapeHtml(b.brokerName)}` : '';
    return `<span class="${base} bg-blueberry/10 text-blueberry">${brokerIcon}${t('checkins.typeBroker')}${name}</span>`;
  }
  if (b.type === 'credit') {
    return `<span class="${base} bg-leaf/10 text-leaf">${peopleIcon}${t('checkins.typeCommuter')}</span>`;
  }
  return `<span class="${base} bg-mango/15 text-charcoal">${planeIcon}${t('checkins.typeLongTerm')}</span>`;
}

// ── Edit reservation (contact + logistics) ───────────────────────────────
// Agents/admins edit a booking's contact (name/email/phone) any time. The
// plate stays editable only while `upcoming` (it keys the activeCheckIns row).
// Long-term drop-off / pick-up dates can be edited while upcoming OR active —
// changing them re-prices the stay and settles the difference (see below).
// Prefill value for the date pickers: Bucharest wall-clock, so an untouched
// field round-trips to the same instant on any device. Handles both full ISO
// timestamps and legacy date-only strings (taken as Bucharest midnight).
function isoToFlatpickr(iso) {
  return isoToBucharestLocal(iso);
}

export function openEditBookingDialog({ booking }) {
  return new Promise((resolve) => {
    const c = booking.contact || {};
    const showLogistics = booking.status === 'upcoming';     // before check-in only
    // Long-term bookings can be re-priced by moving their dates — BOTH the
    // drop-off (check-in) and the pick-up (check-out), whether the booking is
    // still `upcoming` or already `active` (an active drop-off edit corrects
    // the billing start; it doesn't touch the plate-keyed activeCheckIns row).
    // The server re-prices and settles the difference — collect the extra /
    // queue a refund for a paid stay, or simply re-quote an unpaid
    // pay-at-pickup one. See the submit handler below.
    const canReprice = booking.type === 'longTerm' && (booking.status === 'upcoming' || booking.status === 'active');
    const isPaid = booking.paymentStatus === 'paid';
    const inputCls = 'w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry';
    const labelCls = 'block text-[13px] font-medium text-charcoal/70 mb-1.5';

    const toIso = (raw) => bucharestLocalToIso(raw);
    // "Current" dates are the round-trip of what the pickers are prefilled
    // with — guaranteeing an untouched form compares equal (changed=false).
    // Deriving them independently used to disagree for legacy date-only
    // bookings (UTC-midnight prefill vs local-midnight baseline), so ANY
    // save — even a phone-number fix — fired a spurious reprice that
    // rewrote the booking's dates.
    const currentDropoffIso = toIso(isoToFlatpickr(booking.dropoffAt || booking.startDate)) || null;
    const currentPickupIso = toIso(isoToFlatpickr(booking.pickupAt || booking.endDate)) || null;

    const form = html`<form class="space-y-4" data-edit-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('checkins.editTitle')}</h3>
      <div class="rounded-xl bg-frost border border-frost-deep px-3 py-2 flex items-center gap-2">
        <span class="font-mono text-[13px] font-bold text-blueberry-deep">${escapeHtml(bookingDisplayCode(booking))}</span>
        ${typeBadge(booking)}
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="${labelCls}">${t('checkins.colCustomer')} *</label>
          <input name="name" value="${escapeHtml(c.name || '')}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">${t('checkins.detailEmail')} *</label>
          <input name="email" type="email" value="${escapeHtml(c.email || '')}" class="${inputCls}">
        </div>
      </div>
      <div>
        <label class="${labelCls}">${t('checkins.detailPhone')} *</label>
        ${phoneField({ name: 'phone', value: c.phone || '', inputClass: 'flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry', selectClass: 'shrink-0 w-[7rem] px-2 py-2.5 rounded-xl border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-blueberry' })}
      </div>
      ${showLogistics ? `
      <div>
        <label class="${labelCls}">${t('checkins.colPlate')} *</label>
        <input name="plate" value="${escapeHtml(booking.licensePlate || '')}" class="${inputCls} uppercase font-mono">
      </div>` : ''}
      ${canReprice ? `
      <div class="rounded-xl bg-frost border border-frost-deep p-3 space-y-3">
        <p class="text-[13px] font-semibold text-charcoal">${t('checkins.repriceTitle')}</p>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="${labelCls}">${t('checkins.detailDropoff')} *</label>
            ${dateTimeFieldHtml({ name: 'dropoffAt', value: isoToFlatpickr(booking.dropoffAt || booking.startDate), classes: inputCls })}
          </div>
          <div>
            <label class="${labelCls}">${t('checkins.detailPickup')} *</label>
            ${dateTimeFieldHtml({ name: 'pickupAt', value: isoToFlatpickr(booking.pickupAt || booking.endDate), classes: inputCls })}
          </div>
        </div>
        <div data-reprice-preview class="text-[13px]"></div>
        <div data-reprice-pay class="hidden">
          <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('checkins.paidBy')}</label>
          <div class="grid grid-cols-3 gap-2" data-reprice-paidby>
            <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-mango bg-mango/5 cursor-pointer">
              <input type="radio" name="repricePaidBy" value="cash" checked class="accent-mango">
              <span class="text-[14px] font-medium">${t('checkins.payCash')}</span>
            </label>
            <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-frost-deep cursor-pointer">
              <input type="radio" name="repricePaidBy" value="card" class="accent-mango">
              <span class="text-[14px] font-medium">${t('checkins.payCard')}</span>
            </label>
            <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-frost-deep cursor-pointer">
              <input type="radio" name="repricePaidBy" value="email" class="accent-mango">
              <span class="text-[14px] font-medium">${t('checkins.payEmail')}</span>
            </label>
          </div>
          <p data-reprice-email-note class="hidden text-[12px] text-dim mt-2">${t('checkins.repriceEmailNote')}</p>
        </div>
      </div>` : (!showLogistics ? `<p class="text-[12px] text-dim">${t('checkins.editActiveNote')}</p>` : '')}
      <div>
        <label class="${labelCls}">${t('checkins.editNotes')}</label>
        <textarea name="notes" rows="3" placeholder="${escapeHtml(t('checkins.editNotesPlaceholder'))}" class="${inputCls}">${escapeHtml(booking.notes || '')}</textarea>
      </div>
      <div data-edit-err class="hidden text-danger text-[13px]"></div>
      <div class="flex gap-3 justify-end pt-1">
        <button type="button" data-cancel class="px-4 py-2.5 rounded-xl bg-frost text-charcoal/70 font-semibold text-[14px] hover:bg-frost-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed">${t('common.cancel')}</button>
        <button type="submit" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('common.save')}</button>
      </div>
    </form>`;

    const modal = openModal(form, { onClose: () => resolve() });
    if (canReprice) wireDateTime(form);
    const errEl = qs('[data-edit-err]', form);
    const showErr = (m) => { errEl.textContent = m; errEl.classList.remove('hidden'); };
    qs('[data-cancel]', form).addEventListener('click', () => modal.close());

    // Reads the (possibly changed) dates from the form. Active bookings only
    // expose the pick-up field — drop-off stays at its current value.
    const readDates = () => {
      const pRaw = qs('[name="pickupAt"]', form)?.value;
      const dRaw = qs('[name="dropoffAt"]', form)?.value;
      const newPickup = pRaw ? toIso(pRaw) : null;
      const newDropoff = dRaw ? toIso(dRaw) : currentDropoffIso;
      const changed = !!newPickup && ((newPickup !== currentPickupIso) || (newDropoff !== currentDropoffIso));
      return { newDropoff, newPickup, changed };
    };

    // Live re-price preview when a date is moved. Informational only — the
    // submit path re-derives the authoritative difference server-side. For an
    // unpaid pay-at-pickup booking it just shows the new total (re-quote).
    if (canReprice) {
      const previewEl = qs('[data-reprice-preview]', form);
      const payEl = qs('[data-reprice-pay]', form);
      const paidbyWrap = qs('[data-reprice-paidby]', form);
      const emailNoteEl = qs('[data-reprice-email-note]', form);
      paidbyWrap?.addEventListener('change', (e) => {
        if (!e.target.matches('input[name="repricePaidBy"]')) return;
        paidbyWrap.querySelectorAll('label').forEach((lbl) => {
          const inp = lbl.querySelector('input');
          lbl.classList.toggle('border-mango', inp.checked);
          lbl.classList.toggle('bg-mango/5', inp.checked);
          lbl.classList.toggle('border-frost-deep', !inp.checked);
        });
        emailNoteEl?.classList.toggle('hidden', e.target.value !== 'email');
      });
      const runPreview = async () => {
        const { newDropoff, newPickup, changed } = readDates();
        if (!newPickup || !changed) { previewEl.textContent = ''; payEl.classList.add('hidden'); return; }
        previewEl.textContent = t('common.loading');
        try {
          const res = await previewBookingRepriceFn({ bookingId: booking.id, newDropoffAt: newDropoff, newPickupAt: newPickup });
          const { days, perDay, newTotal, difference } = res?.data || {};
          const diff = Number(difference) || 0;
          let line; let cls;
          if (!isPaid) {
            // A changed total on an unpaid booking triggers the re-quote email
            // (server-side) — tell staff so the client contact isn't a surprise.
            line = t(diff !== 0 ? 'checkins.repriceRequoteEmail' : 'checkins.repriceRequote', { amount: newTotal });
            cls = 'text-charcoal';
          } else {
            line = diff > 0 ? t('checkins.repriceCollect', { amount: diff })
              : diff < 0 ? t('checkins.repriceRefund', { amount: Math.abs(diff) })
              : t('checkins.repriceNoChange');
            cls = diff > 0 ? 'text-mango' : diff < 0 ? 'text-leaf' : 'text-dim';
          }
          previewEl.innerHTML = `<div class="text-dim">${escapeHtml(t('transactions.priceComputed', { total: newTotal, days, perDay }))}</div><div class="mt-1 font-semibold ${cls}">${escapeHtml(line)}</div>`;
          const showPay = isPaid && diff > 0;
          payEl.classList.toggle('hidden', !showPay);
          const emailSelected = form.querySelector('input[name="repricePaidBy"]:checked')?.value === 'email';
          emailNoteEl?.classList.toggle('hidden', !(showPay && emailSelected));
        } catch (err) {
          previewEl.textContent = err?.message || t('common.error');
          payEl.classList.add('hidden');
        }
      };
      qs('[name="pickupAt"]', form)?.addEventListener('change', runPreview);
      qs('[name="dropoffAt"]', form)?.addEventListener('change', runPreview);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const name = qs('[name="name"]', form).value.trim();
      const email = qs('[name="email"]', form).value.trim();
      const phone = phoneValue(qs('[name="phone"]', form));
      if (!name) return showErr(t('checkins.editErrorName'));
      if (!isValidEmail(email)) return showErr(t('checkins.editErrorEmail'));
      if (!isValidPhone(phone)) return showErr(t('checkins.editErrorPhone'));

      // Contact / plate / notes go through updateBookingDetails; date changes on
      // a long-term booking are re-priced + settled by the callable below (so
      // days / price stay authoritative), never written here.
      const patch = { contact: { name, email, phone }, notes: qs('[name="notes"]', form).value.trim() };
      if (showLogistics) {
        const plate = qs('[name="plate"]', form).value.trim().toUpperCase();
        if (!isValidLicensePlate(plate)) return showErr(t('checkins.errorInvalidPlate'));
        patch.licensePlate = plate;
      }

      let newDropoff = null; let newPickup = null; let doReprice = false;
      if (canReprice) {
        const dEl = qs('[name="dropoffAt"]', form);
        const dates = readDates();
        if (!dates.newPickup || (dEl && !dEl.value)) return showErr(t('checkins.editErrorDates'));
        newDropoff = dates.newDropoff; newPickup = dates.newPickup;
        if (!newDropoff || Date.parse(newPickup) <= Date.parse(newDropoff)) return showErr(t('checkins.editErrorDates'));
        doReprice = dates.changed;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const cancelBtn = qs('[data-cancel]', form);
      submitBtn.disabled = true;
      submitBtn.textContent = t('common.loading');
      // Lock the modal while the save / reprice runs — an aborted-looking
      // cancel mid-flight would still settle money server-side.
      if (cancelBtn) cancelBtn.disabled = true;
      modal.setDismissible(false);
      try {
        await updateBookingDetails(booking.id, patch);
        // If a long-term booking's dates changed, re-price + settle server-side:
        // collect the extra / queue a refund on a paid stay, or re-quote an
        // unpaid one. The server re-derives the difference — preview is advisory.
        let repriceMsg = null;
        if (doReprice) {
          const paidBy = form.querySelector('input[name="repricePaidBy"]:checked')?.value || 'cash';
          if (isPaid) {
            const pv = await previewBookingRepriceFn({ bookingId: booking.id, newDropoffAt: newDropoff, newPickupAt: newPickup });
            const diffNow = Number(pv?.data?.difference) || 0;
            if (diffNow > 0) {
              const confirmMsg = paidBy === 'email'
                ? t('checkins.repriceEmailConfirm', { amount: diffNow })
                : t('checkins.collectConfirm', { amount: diffNow, method: paidBy === 'cash' ? t('checkins.payCash') : t('checkins.payCard') });
              const ok = await confirmModal(confirmMsg, { confirmText: t('checkins.repriceConfirm') });
              if (!ok) { showToast(t('checkins.editSaved'), 'success'); modal.close(); resolve(); return; }
            } else if (diffNow < 0) {
              const ok = await confirmModal(t('checkins.repriceRefundConfirm', { amount: Math.abs(diffNow) }), { confirmText: t('checkins.repriceConfirm') });
              if (!ok) { showToast(t('checkins.editSaved'), 'success'); modal.close(); resolve(); return; }
            }
          }
          const adj = await adminRepriceBookingFn({ bookingId: booking.id, newDropoffAt: newDropoff, newPickupAt: newPickup, paidBy });
          const out = adj?.data || {};
          const diff = Number(out.difference) || 0;
          repriceMsg = out.requote ? t(out.emailed ? 'checkins.repriceRequotedEmailed' : 'checkins.repriceRequoted', { amount: out.newTotal })
            : out.emailed ? t('checkins.repriceEmailed', { amount: out.owed })
            : diff > 0 ? t('checkins.repriceCollected', { amount: diff })
            : diff < 0 ? t('checkins.repriceRefundQueued', { amount: Math.abs(diff) })
            : t('checkins.repriceUpdated');
        }
        showToast(repriceMsg || t('checkins.editSaved'), 'success');
        modal.close();
        resolve();
      } catch (err) {
        console.error('updateBookingDetails', err);
        showErr(err?.message || t('common.error'));
        submitBtn.disabled = false;
        submitBtn.textContent = t('common.save');
        if (cancelBtn) cancelBtn.disabled = false;
        modal.setDismissible(true);
      }
    });
  });
}

// ── Check-in / check-out confirmation ────────────────────────────────────
// A detailed "are you sure?" before either action, showing the reservation so
// staff can sanity-check plate / dates / payment. For check-out it folds in
// the late-checkout (overstay) warning when one applies. Resolves true on
// confirm, false on cancel / dismiss.
export function openCheckActionConfirm({ booking, action, locale, over = null, overstayCharged = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    const isCheckin = action === 'checkin';
    const title = isCheckin ? t('checkins.confirmCheckInTitle') : t('checkins.confirmCheckOutTitle');
    const confirmLabel = isCheckin ? t('checkins.confirmCheckInBtn') : t('checkins.confirmCheckOutBtn');
    const dropoff = booking.dropoffAt || booking.startDate;
    const pickup = booking.pickupAt || booking.endDate;
    const code = bookingDisplayCode(booking);
    const name = booking.contact?.name || booking.contact?.email || '—';

    const row = (label, value) => `
      <div class="flex justify-between gap-3 py-1 border-b border-frost-deep/60 last:border-0">
        <span class="text-[12px] uppercase tracking-wider text-dim font-mono">${label}</span>
        <span class="text-[13px] text-charcoal text-right">${value}</span>
      </div>`;

    const warn = over ? `
      <div class="rounded-xl bg-mango/10 border border-mango/30 px-4 py-3 text-[13px] text-charcoal">
        ${t('checkins.lateCheckoutWarn', { days: over.daysLate, amount: over.amount })}
      </div>` : '';

    // Positive confirmation when the overstay fee was already collected — so
    // the agent knows it wasn't skipped and isn't owed again.
    const settledNote = overstayCharged ? `
      <div class="rounded-xl bg-leaf/10 border border-leaf/30 px-4 py-3 text-[13px] text-charcoal flex items-center gap-2">
        <svg class="w-4 h-4 text-leaf shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
        ${t('checkins.overstayAlreadyCharged')}
      </div>` : '';

    const form = html`<div class="space-y-4">
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${title}</h3>
      <div class="rounded-2xl bg-frost border border-frost-deep p-4">
        <div class="flex items-center gap-2 mb-2">
          <span class="font-mono text-[14px] font-bold text-blueberry-deep">${escapeHtml(code)}</span>
          ${typeBadge(booking)}
        </div>
        ${row(t('checkins.colCustomer'), escapeHtml(name))}
        ${row(t('checkins.colPlate'), `<span class="font-mono">${escapeHtml(booking.licensePlate || '—')}</span>`)}
        ${row(t('checkins.detailDropoff'), escapeHtml(fmtDateTime(dropoff, locale)))}
        ${row(t('checkins.detailPickup'), escapeHtml(fmtDateTime(pickup, locale)))}
        ${row(t('checkins.colPayment'), paymentStatusBadge(booking))}
        ${booking.spotId ? row(t('checkins.detailSpot'), escapeHtml(booking.spotId)) : ''}
        ${booking.notes ? row(t('checkins.editNotes'), escapeHtml(booking.notes)) : ''}
      </div>
      ${warn}${settledNote}
      <div class="flex gap-3 justify-end pt-1">
        <button type="button" data-cancel class="px-4 py-2.5 rounded-xl bg-frost text-charcoal/70 font-semibold text-[14px] hover:bg-frost-deep transition-colors">${t('common.cancel')}</button>
        <button type="button" data-confirm class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${confirmLabel}</button>
      </div>
    </div>`;

    const modal = openModal(form, { onClose: () => finish(false) });
    qs('[data-cancel]', form).addEventListener('click', () => { finish(false); modal.close(); });
    qs('[data-confirm]', form).addEventListener('click', () => { finish(true); modal.close(); });
  });
}

// ── Collect payment dialog ──────────────────────────────────────────────
export function openCollectPaymentDialog({ orderId, booking }) {
  return new Promise((resolve) => {
    const initialBilling = booking?.billing || {};
    // Best available amount immediately; refined from the pending order's
    // authoritative `amount` (which carries any pay-at-pickup gross-up) once
    // it loads below.
    const initialAmount = Number(booking?.totalPrice || 0);
    const form = html`<form class="space-y-3" data-collect-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('checkins.collectTitle')}</h3>
      <div class="rounded-xl bg-mango/10 border border-mango/30 px-4 py-3 text-center">
        <p class="text-[11px] uppercase tracking-wider text-charcoal/60 font-mono">${t('checkins.amountDue')}</p>
        <p class="font-heading font-bold text-3xl text-blueberry-deep mt-0.5"><span data-amount-due>${initialAmount}</span> ${t('common.lei')}</p>
        <p class="text-[12px] text-dim mt-1">${t('checkins.collectPlate', { plate: booking?.licensePlate || '—' })}</p>
      </div>

      <div class="grid sm:grid-cols-2 gap-2">
        <input name="firstName" type="text" placeholder="${escapeHtml(t('billing.firstName'))} *" value="${escapeHtml(initialBilling.firstName || '')}" required class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">
        <input name="lastName" type="text" placeholder="${escapeHtml(t('billing.lastName'))} *" value="${escapeHtml(initialBilling.lastName || '')}" required class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">
      </div>
      ${geoFieldsHtml({ county: 'county', locality: 'locality', abroad: 'abroad' }, { county: initialBilling.county || '', locality: initialBilling.locality || '', abroad: initialBilling.abroad === true, compact: true })}
      <input name="address" type="text" placeholder="${escapeHtml(t('billing.personalAddress'))} *" value="${escapeHtml(initialBilling.address || initialBilling.personalAddress || '')}" required class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('checkins.paidBy')}</label>
        <div class="grid grid-cols-2 gap-2" data-paidby>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-mango bg-mango/5 cursor-pointer">
            <input type="radio" name="paidBy" value="cash" checked class="accent-mango">
            <span class="text-[14px] font-medium">${t('checkins.payCash')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="paidBy" value="card" class="accent-mango">
            <span class="text-[14px] font-medium">${t('checkins.payCard')}</span>
          </label>
        </div>
      </div>

      <button type="submit" class="w-full bg-leaf hover:bg-leaf/90 text-white font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('checkins.confirmPayment')}</button>
    </form>`;
    const modal = openModal(form, { onClose: () => resolve() });

    // Hydrate the county/locality dropdowns (lazy dataset).
    wireGeoFields(form, { county: 'county', locality: 'locality', abroad: 'abroad' });

    // Refine the displayed amount from the pending order — its `amount`
    // includes any pay-at-pickup gross-up, so it's the figure actually owed.
    if (orderId) {
      getDocument('pendingOrders', orderId).then((order) => {
        const due = Number(order?.amount);
        if (Number.isFinite(due) && due > 0) {
          const el = form.querySelector('[data-amount-due]');
          if (el) el.textContent = String(due);
        }
      }).catch(() => { /* keep the booking total fallback */ });
    }

    form.querySelector('[data-paidby]').addEventListener('change', (e) => {
      if (!e.target.matches('input[name="paidBy"]')) return;
      form.querySelectorAll('[data-paidby] label').forEach((lbl) => {
        const inp = lbl.querySelector('input');
        lbl.classList.toggle('border-mango', inp.checked);
        lbl.classList.toggle('bg-mango/5', inp.checked);
        lbl.classList.toggle('border-frost-deep', !inp.checked);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstName = form.firstName.value.trim();
      const lastName = form.lastName.value.trim();
      const geo = readGeoFields(form, { county: 'county', locality: 'locality', abroad: 'abroad' });
      const address = form.address.value.trim();
      const paidBy = form.querySelector('input[name="paidBy"]:checked')?.value || 'cash';
      if (!firstName || !lastName || !address || (!geo.abroad && (!geo.county || !geo.locality))) {
        showToast(t('common.error'), 'error');
        return;
      }
      // #22: confirm the cash/card collection before recording it.
      const amountDue = form.querySelector('[data-amount-due]')?.textContent?.trim() || '';
      const methodLabel = paidBy === 'cash' ? t('checkins.payCash') : t('checkins.payCard');
      const confirmed = await confirmModal(t('checkins.collectConfirm', { amount: amountDue, method: methodLabel }), { confirmText: t('checkins.confirmPayment') });
      if (!confirmed) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = t('common.loading');
      // Lock while the collection records — a backdrop tap mid-flight would
      // dismiss the dialog while the server still marks the order paid.
      modal.setDismissible(false);
      try {
        await adminMarkOrderPaidFn({
          orderId,
          paidBy,
          payerDetails: { firstName, lastName, locality: geo.locality, county: geo.county, abroad: geo.abroad, address },
        });
        showToast(t('checkins.toastMarkedPaid'), 'success');
        modal.close();
        resolve();
      } catch (err) {
        console.error('markPaid', err);
        showToast(err?.message || t('common.error'), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = t('checkins.confirmPayment');
        modal.setDismissible(true);
      }
    });
  });
}

// ── Overstay charge dialog ──────────────────────────────────────────────
// Suggests an amount (extra days × the booking's own daily rate) and lets
// the agent edit it before recording the charge (cash → cashbook).
export function openOverstayDialog({ booking, perCredit = 0 }) {
  return new Promise((resolve) => {
    const info = overstayInfo(booking, perCredit) || { daysLate: 1, perDay: 0, amount: 0 };
    const form = html`<form class="space-y-4" data-overstay-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('checkins.overstayTitle')}</h3>
      <div class="rounded-xl bg-mango/10 border border-mango/30 px-4 py-3">
        <p class="text-[14px] font-semibold text-charcoal">${t('checkins.overstayDaysLate', { days: info.daysLate })}</p>
        <p class="text-[12px] text-dim mt-0.5">${t('checkins.overstayHint', { days: info.daysLate, perDay: info.perDay })}</p>
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('checkins.overstayAmountLabel')}</label>
        <input name="amount" type="number" min="1" step="1" value="${info.amount || ''}" required class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] font-mono focus:outline-none focus:border-blueberry">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('checkins.paidBy')}</label>
        <div class="grid grid-cols-2 gap-2" data-paidby>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-mango bg-mango/5 cursor-pointer">
            <input type="radio" name="paidBy" value="cash" checked class="accent-mango">
            <span class="text-[14px] font-medium">${t('checkins.payCash')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="paidBy" value="card" class="accent-mango">
            <span class="text-[14px] font-medium">${t('checkins.payCard')}</span>
          </label>
        </div>
      </div>
      <button type="submit" class="w-full bg-leaf hover:bg-leaf/90 text-white font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('checkins.overstayConfirm')}</button>
    </form>`;
    // resolve(true) once the overstay is actually charged; resolve(false) if
    // the agent dismisses — callers (check-out gate) rely on this distinction.
    const modal = openModal(form, { onClose: () => resolve(false) });

    form.querySelector('[data-paidby]').addEventListener('change', (e) => {
      if (!e.target.matches('input[name="paidBy"]')) return;
      form.querySelectorAll('[data-paidby] label').forEach((lbl) => {
        const inp = lbl.querySelector('input');
        lbl.classList.toggle('border-mango', inp.checked);
        lbl.classList.toggle('bg-mango/5', inp.checked);
        lbl.classList.toggle('border-frost-deep', !inp.checked);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Math.round(Number(form.amount.value));
      const paidBy = form.querySelector('input[name="paidBy"]:checked')?.value || 'cash';
      if (!Number.isFinite(amount) || amount <= 0) {
        showToast(t('checkins.overstayNoAmount'), 'error');
        return;
      }
      // #22: confirm the cash/card collection before recording it.
      const methodLabel = paidBy === 'cash' ? t('checkins.payCash') : t('checkins.payCard');
      const confirmed = await confirmModal(t('checkins.collectConfirm', { amount, method: methodLabel }), { confirmText: t('checkins.overstayConfirm') });
      if (!confirmed) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = t('common.loading');
      // Lock while the charge records — a backdrop tap mid-flight would
      // dismiss the dialog while the server still charges the overstay.
      modal.setDismissible(false);
      try {
        await adminChargeOverstayFn({ bookingId: booking.id, amount, paidBy });
        showToast(t('checkins.toastOverstayCharged', { amount }), 'success');
        modal.close();
        resolve(true);
      } catch (err) {
        console.error('chargeOverstay', err);
        showToast(err?.message || t('common.error'), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = t('checkins.overstayConfirm');
        modal.setDismissible(true);
      }
    });
  });
}

/**
 * Run one booking action. `dataset` is the clicked button's dataset (order /
 * code overrides); `ctx` carries what used to come from the page closure.
 * Returns true when something changed, so a caller without a live subscription
 * knows to refresh. Errors are toasted here — the caller only re-enables its UI.
 */
export async function runBookingAction({ action, booking, dataset = {} }, { locale, creditPerDay = 0, onDone } = {}) {
  const bookingId = booking?.id;
  if (!bookingId) return false;
  const done = () => { if (typeof onDone === 'function') onDone(); return true; };

  try {
    if (action === 'checkin') {
      if (booking.paymentStatus === 'unpaid') {
        showToast(t('checkins.errorUnpaidCheckin'), 'error');
        return false;
      }
      const ok = await openCheckActionConfirm({ booking, action: 'checkin', locale });
      if (!ok) return false;
      await checkInBooking(bookingId);
      showToast(t('checkins.toastCheckedIn'), 'success');
      return done();
    }
    if (action === 'checkout') {
      // An overstay must be settled before the car leaves (long-term past
      // pick-up; commuters past the 20:00 cutoff, valued per credit). If one
      // is owed, open the charge dialog first; if the agent dismisses it,
      // require an explicit "check out anyway" override. Already charged
      // (`overstayChargedAt`) → the debt is settled, so don't re-prompt.
      const alreadyCharged = !!booking.overstayChargedAt;
      const over = overstayInfo(booking, creditPerDay);
      let proceed;
      if (over && over.amount > 0 && !alreadyCharged) {
        const charged = await openOverstayDialog({ booking, perCredit: creditPerDay });
        proceed = charged || await confirmModal(
          t('checkins.checkoutWithoutOverstay', { amount: over.amount }),
          { danger: true, confirmText: t('checkins.checkoutAnyway') },
        );
      } else {
        proceed = await openCheckActionConfirm({ booking, action: 'checkout', locale, over: null, overstayCharged: alreadyCharged });
      }
      if (!proceed) return false;
      await checkOutBooking(bookingId);
      showToast(t('checkins.toastCheckedOut'), 'success');
      return done();
    }
    if (action === 'collect') {
      const orderId = dataset.order || booking.paymentId;
      if (!orderId) {
        showToast(t('checkins.errorNoOrderId'), 'error');
        return false;
      }
      await openCollectPaymentDialog({ orderId, booking });
      return done();
    }
    if (action === 'cancel') {
      const code = dataset.code || bookingDisplayCode(booking || { id: bookingId });
      const ok = await confirmModal(t('checkins.cancelConfirm', { code }), {
        danger: true, confirmText: t('checkins.actionCancelReservation'),
      });
      if (!ok) return false;
      await cancelBookingFn({ bookingId });
      showToast(t('checkins.toastCancelled'), 'success');
      return done();
    }
    if (action === 'overstay') {
      await openOverstayDialog({ booking, perCredit: creditPerDay });
      return done();
    }
    if (action === 'resend-email') {
      const code = dataset.code || bookingDisplayCode(booking || { id: bookingId });
      const res = await resendConfirmationFn({ bookingId });
      showToast(t('checkins.resendOk', { code, recipient: res?.data?.recipient || '' }), 'success');
      return false;
    }
    if (action === 'edit') {
      await openEditBookingDialog({ booking, locale });
      return done();
    }
  } catch (err) {
    console.error(action, err);
    const msg = String(err?.message || '');
    showToast(msg === 'UNPAID_BOOKING' ? t('checkins.errorUnpaidCheckin') : (msg || t('common.error')), 'error');
  }
  return false;
}
