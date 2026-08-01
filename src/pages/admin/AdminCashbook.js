import { html, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { openModal, confirmModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';
import { getCurrentUser, getUserProfile } from '../../firebase/auth.js';
import {
  listOpenEntriesForAgent,
  listAllOpenEntries,
  listReports,
  groupByDay,
  groupByAgent,
  sumAmount,
  listHandovers,
  ownerOfHandover,
  recordHandover,
  cancelHandover,
  closeCashbook,
} from '../../services/cashbookService.js';

// /admin/cashbook — per-agent cash ledger.
//
// Each cash payment collected at the lot (mark-paid, direct longterm
// booking, direct credit grant) writes a row to `cashEntries`. This page
// shows the CURRENT user's open entries grouped by day, with a daily
// running total. The agent closes their cashbook with one button — that
// snapshots the open entries into `cashbookReports/{id}`, marks them as
// closed, and the printable report is shown immediately.
//
// Card payments don't enter the cashbook (ops decision — drivers/agents
// only reconcile physical cash).

function formatTime(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function formatDay(day, locale) {
  if (!day) return '—';
  try {
    return new Date(day + 'T00:00:00').toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch { return day; }
}

function formatDateTime(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function sourceLabel(source) {
  switch (source) {
    case 'longterm-direct':    return t('cashbook.srcLongtermDirect');
    case 'longterm-markpaid':  return t('cashbook.srcLongtermMarkpaid');
    case 'credits-direct':     return t('cashbook.srcCreditsDirect');
    case 'credits-markpaid':   return t('cashbook.srcCreditsMarkpaid');
    case 'longterm-extension': return t('cashbook.srcLongtermExtension');
    case 'overstay':           return t('cashbook.srcOverstay');
    case 'refund':             return t('cashbook.srcRefund');
    default:                   return source || '—';
  }
}

// Cash refunds are recorded as NEGATIVE entries (money leaving the drawer),
// so they must not read as another collection. Colour them like the outflow
// they are; everything else keeps the default weight.
function amountClass(amount) {
  return Number(amount) < 0 ? 'text-red-600' : '';
}

// Build the day-card HTML block for a given set of open entries +
// matching handovers. Used by both the single-agent and per-agent-admin
// views — reused so layout stays identical across roles. The agentUid
// gets stamped on the handover button so admins logging a handover for
// another agent stamp it to the correct cashbook.
function renderDayCards(openEntries, handovers, locale, agentUid) {
  const byDay = groupByDay(openEntries);
  const handoversByDay = new Map();
  for (const h of handovers) {
    if (!h.day) continue;
    if (!handoversByDay.has(h.day)) handoversByDay.set(h.day, []);
    handoversByDay.get(h.day).push(h);
  }
  if (byDay.length === 0) {
    return `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('cashbook.emptyOpen')}</div>`;
  }
  return byDay.map(([day, dayEntries]) => {
    const daySum = sumAmount(dayEntries);
    const dayHandovers = handoversByDay.get(day) || [];
    const handedSum = dayHandovers.reduce((acc, h) => acc + (Number(h.amount) || 0), 0);
    const outstanding = Math.max(0, daySum - handedSum);

    const rows = dayEntries
      .sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')))
      .map((e) => `
        <tr class="border-t border-frost-deep">
          <td class="px-4 py-3 text-[14px] font-mono whitespace-nowrap">${formatTime(e.paidAt, locale)}</td>
          <td class="px-4 py-3 text-[14px] font-mono">${escapeHtml(e.plate || '—')}</td>
          <td class="px-4 py-3 text-[14px]">${escapeHtml(e.payerName || '—')}</td>
          <td class="px-4 py-3 text-[14px] text-dim">${sourceLabel(e.source)}</td>
          <td class="px-4 py-3 text-[14px] font-mono font-semibold text-right ${amountClass(e.amount)}">${Number(e.amount || 0)} ${t('common.lei')}</td>
        </tr>`).join('');

    const handoverRows = dayHandovers.length
      ? dayHandovers.map((h) => `
          <li class="flex items-baseline justify-between gap-3 text-[13px] text-charcoal/80">
            <span class="min-w-0 truncate">${escapeHtml(h.handedTo)} · ${formatTime(h.handedAt, locale)}${h.notes ? ` · ${escapeHtml(h.notes)}` : ''}</span>
            <span class="flex items-baseline gap-3 shrink-0">
              <span class="font-mono font-semibold">${Number(h.amount || 0)} ${t('common.lei')}</span>
              <button type="button" data-cancel-handover="${escapeHtml(h.id)}" class="text-[12px] text-red-600 hover:text-red-700 hover:underline font-semibold">${t('cashbook.cancelHandover')}</button>
            </span>
          </li>
        `).join('')
      : `<li class="text-[13px] text-dim italic">${t('cashbook.noHandovers')}</li>`;

    const hasHandover = dayHandovers.length > 0;
    const handoverButton = hasHandover
      ? `<span class="text-[12px] text-leaf font-semibold font-mono uppercase tracking-wider px-3 py-2">${t('cashbook.alreadyHandedOver')}</span>`
      : `<button data-handover-day="${day}" data-handover-agent="${escapeHtml(agentUid || '')}" data-suggest="${outstanding}" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[13px] px-4 py-2 rounded-lg transition-colors">${t('cashbook.recordHandover')}</button>`;

    return `
      <div class="card-solid rounded-2xl overflow-hidden mb-6">
        <div class="px-5 py-4 bg-frost flex flex-wrap items-center justify-between gap-3 border-b border-frost-deep">
          <div>
            <h3 class="font-heading font-bold text-[16px] text-blueberry-deep">${formatDay(day, locale)}</h3>
            <p class="text-[12px] text-dim font-mono">${day}</p>
          </div>
          <div class="flex items-center gap-4 flex-wrap">
            <div class="text-right">
              <p class="text-[11px] uppercase tracking-wider text-dim font-mono">${t('cashbook.daySum')}</p>
              <p class="font-mono font-bold text-[15px] text-leaf">${daySum} ${t('common.lei')}</p>
            </div>
            <div class="text-right">
              <p class="text-[11px] uppercase tracking-wider text-dim font-mono">${t('cashbook.outstandingCash')}</p>
              <p class="font-mono font-bold text-[15px] ${outstanding > 0 ? 'text-mango' : 'text-charcoal/40'}">${outstanding} ${t('common.lei')}</p>
            </div>
            ${handoverButton}
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-white">
              <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
                <th class="px-4 py-3 font-medium">${t('cashbook.time')}</th>
                <th class="px-4 py-3 font-medium">${t('cashbook.plate')}</th>
                <th class="px-4 py-3 font-medium">${t('cashbook.payer')}</th>
                <th class="px-4 py-3 font-medium">${t('cashbook.source')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('cashbook.amount')}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="px-5 py-4 bg-frost/50 border-t border-frost-deep">
          <p class="text-[12px] font-mono uppercase tracking-wider text-dim mb-2">${t('cashbook.handovers')}</p>
          <ul class="space-y-1">${handoverRows}</ul>
        </div>
      </div>
    `;
  }).join('');
}

// Initials avatar used on the agent header bar.
function initialsOf(name) {
  return String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '').join('');
}

// Per-agent card with name, totals, and close button. Admin view renders
// one of these per agent who has open entries. Strong visual treatment
// (colored header bar + avatar + total) so the page reads as cleanly
// segmented even when only one agent has entries — without this, a
// single-agent view looks like a flat table.
function renderAgentSection({ agentUid, agentName, openEntries, dayCardsHtml, isSelf }) {
  const totalOpen = sumAmount(openEntries);
  const initials = initialsOf(agentName);
  return `
    <section class="mb-10 rounded-3xl border-2 border-blueberry-deep/15 overflow-hidden bg-white" data-agent-section="${escapeHtml(agentUid)}">
      <header class="bg-blueberry-deep text-white px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-11 h-11 rounded-full bg-mango text-charcoal flex items-center justify-center font-heading font-bold text-[15px] shrink-0">${escapeHtml(initials || '?')}</div>
          <div class="min-w-0">
            <h2 class="font-heading text-[18px] font-bold tracking-tight truncate">${escapeHtml(agentName)}${isSelf ? ` <span class="text-[12px] text-white/70 font-normal">(${t('admin.usersYou')})</span>` : ''}</h2>
            <p class="text-[11px] text-white/60 font-mono truncate">${escapeHtml(agentUid)}</p>
          </div>
        </div>
        <div class="flex items-center gap-5 flex-wrap">
          <div class="text-right">
            <p class="text-[11px] uppercase tracking-wider text-white/60 font-mono">${t('cashbook.entriesCount')}</p>
            <p class="font-mono font-bold text-[18px]">${openEntries.length}</p>
          </div>
          <div class="text-right">
            <p class="text-[11px] uppercase tracking-wider text-white/60 font-mono">${t('cashbook.openTotal')}</p>
            <p class="font-mono font-bold text-[20px] text-mango">${totalOpen} ${t('common.lei')}</p>
          </div>
          <button data-close-agent="${escapeHtml(agentUid)}" ${openEntries.length === 0 ? 'disabled' : ''} class="bg-mango hover:bg-mango-hover disabled:bg-white/20 disabled:cursor-not-allowed text-charcoal disabled:text-white/40 font-semibold text-[13px] px-4 py-2 rounded-xl transition-colors">${t('cashbook.closeAgentBtn')}</button>
        </div>
      </header>
      <div class="p-5 bg-frost/40">
        ${dayCardsHtml}
      </div>
    </section>
  `;
}

function renderReportsTable(reports, locale, { withAgentColumn = false } = {}) {
  if (reports.length === 0) return '';
  return `
    <section class="mt-12">
      <h2 class="font-heading text-2xl font-bold tracking-tight text-blueberry-deep mb-4">${t('cashbook.pastReports')}</h2>
      <div class="card-solid rounded-2xl overflow-hidden">
        <table class="w-full">
          <thead class="bg-frost">
            <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
              <th class="px-4 py-3 font-medium">${t('cashbook.reportClosed')}</th>
              ${withAgentColumn ? `<th class="px-4 py-3 font-medium">${t('cashbook.agent')}</th>` : ''}
              <th class="px-4 py-3 font-medium">${t('cashbook.reportRange')}</th>
              <th class="px-4 py-3 font-medium text-right">${t('cashbook.reportEntries')}</th>
              <th class="px-4 py-3 font-medium text-right">${t('cashbook.reportTotal')}</th>
              <th class="px-4 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            ${reports.map((r) => `
              <tr class="border-t border-frost-deep">
                <td class="px-4 py-3 text-[14px]">${formatDateTime(r.generatedAt, locale)}</td>
                ${withAgentColumn ? `<td class="px-4 py-3 text-[14px]">${escapeHtml(r.agentName || r.agentUid || '—')}</td>` : ''}
                <td class="px-4 py-3 text-[13px] text-dim">${formatDateTime(r.rangeFromIso, locale)} → ${formatDateTime(r.rangeToIso, locale)}</td>
                <td class="px-4 py-3 text-[14px] font-mono text-right">${r.entryCount}</td>
                <td class="px-4 py-3 text-[14px] font-mono font-semibold text-right">${Number(r.totalAmount || 0)} ${t('common.lei')}</td>
                <td class="px-4 py-3 text-right">
                  <button data-view-report="${escapeHtml(r.id)}" class="text-[13px] text-blueberry hover:underline font-semibold">${t('cashbook.viewReport')}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export default async function AdminCashbook(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('cashbook.pageTitle')} — Admin — ManGO Parking`,
    description: t('cashbook.subtitle'),
    lang: locale,
  });

  const profile = getUserProfile();
  const myUid = getCurrentUser()?.uid;
  const myName = profile?.displayName || profile?.email || myUid;
  const isAdmin = profile?.role === 'admin';

  // Admin sees everyone's open entries + every report. Agents see only
  // their own. The Firestore rules already enforce this at the row level;
  // we just match the UI to the data.
  const [openEntries, reports, handovers] = await Promise.all([
    isAdmin ? listAllOpenEntries() : listOpenEntriesForAgent(myUid),
    listReports({ agentUid: isAdmin ? undefined : myUid, days: 90 }),
    listHandovers({ days: 30 }),
  ]);

  // Build the per-agent map either way. For non-admin this map has at
  // most one entry (the current user).
  const perAgent = groupByAgent(openEntries);
  const totalOpenAcrossAll = sumAmount(openEntries);

  // Sort agents: caller first (so admin always sees their own up top),
  // then the rest by descending open total.
  const agentEntries = [...perAgent.entries()].sort((a, b) => {
    if (a[0] === myUid) return -1;
    if (b[0] === myUid) return 1;
    return sumAmount(b[1].entries) - sumAmount(a[1].entries);
  });

  // Filter handovers per agent so each section shows its own. Uses
  // ownerOfHandover() — prefers `forAgentUid` and falls back to
  // `handedBy` for rows written before that field existed.
  function handoversFor(agentUid) {
    return handovers.filter((h) => ownerOfHandover(h) === agentUid);
  }

  const sectionsHtml = agentEntries.length === 0
    ? `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('cashbook.emptyOpen')}</div>`
    : agentEntries.map(([agentUid, { agentName, entries }]) => {
        const dayCardsHtml = renderDayCards(entries, handoversFor(agentUid), locale, agentUid);
        return renderAgentSection({
          agentUid,
          agentName,
          openEntries: entries,
          dayCardsHtml,
          isSelf: agentUid === myUid,
        });
      }).join('');

  const headerLine = isAdmin
    ? t('cashbook.subtitleAdmin', { count: agentEntries.length })
    : t('cashbook.subtitleAgent', { name: escapeHtml(myName || '') });

  const content = `
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('cashbook.pageTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${headerLine}</p>
      </div>
      ${isAdmin ? `
        <div class="text-right">
          <p class="text-[11px] uppercase tracking-wider text-dim font-mono">${t('cashbook.openTotalAll')}</p>
          <p class="font-mono font-bold text-2xl text-leaf">${totalOpenAcrossAll} ${t('common.lei')}</p>
        </div>
      ` : ''}
    </div>

    ${sectionsHtml}

    ${renderReportsTable(reports, locale, { withAgentColumn: isAdmin })}
  `;

  const page = AdminLayout('/admin/cashbook', `<div data-cashbook-root>${content}</div>`);
  initAdminNav(page);
  container.appendChild(page);

  // Close-cashbook handler (admin: per-agent button; agent: would be
  // their own section button, same data-close-agent attribute).
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-close-agent]');
    if (!btn || btn.disabled) return;
    const targetUid = btn.dataset.closeAgent;
    const agentBlock = perAgent.get(targetUid);
    if (!agentBlock) return;
    const targetEntries = agentBlock.entries;
    const targetTotal = sumAmount(targetEntries);

    const prompt = targetUid === myUid
      ? t('cashbook.closeConfirm', { count: targetEntries.length, total: targetTotal })
      : t('cashbook.closeAgentConfirm', { name: agentBlock.agentName, count: targetEntries.length, total: targetTotal });
    const ok = await confirmModal(prompt, {
      confirmText: t('cashbook.closeButton'),
      danger: targetUid !== myUid,
    });
    if (!ok) return;

    btn.disabled = true;
    try {
      const res = await closeCashbook(targetUid === myUid ? undefined : targetUid);
      showToast(t('cashbook.closedToast', { count: res.entryCount, total: res.totalAmount }), 'success');
      // Open the report so it can be printed / forwarded immediately.
      const fresh = await listReports({ agentUid: isAdmin ? undefined : myUid, days: 90 });
      const newReport = fresh.find((r) => r.id === res.reportId);
      if (newReport) openReportModal(newReport, locale);
      setTimeout(() => window.location.reload(), 200);
    } catch (err) {
      console.error('closeCashbook', err);
      showToast(err?.message || t('common.error'), 'error');
      btn.disabled = false;
    }
  });

  // View report
  page.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view-report]');
    if (!btn) return;
    const r = reports.find((x) => x.id === btn.dataset.viewReport);
    if (r) openReportModal(r, locale);
  });

  // Handover. `data-handover-agent` carries the section's agent uid so
  // admins recording a handover on behalf of another agent stamp it to
  // that agent's cashbook (not their own).
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-handover-day]');
    if (!btn) return;
    const day = btn.dataset.handoverDay;
    const suggest = btn.dataset.suggest || '';
    const forAgentUid = btn.dataset.handoverAgent || myUid;
    await openHandoverDialog(day, suggest, forAgentUid);
  });

  // Cancel a handover (rollback in case of mistake). Hard-deletes the
  // doc on the server; reload to refresh the day-card.
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cancel-handover]');
    if (!btn || btn.disabled) return;
    const handoverId = btn.dataset.cancelHandover;
    if (!handoverId) return;
    const ok = await confirmModal(t('cashbook.cancelHandoverConfirm'), {
      confirmText: t('cashbook.cancelHandover'),
      danger: true,
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      await cancelHandover(handoverId);
      showToast(t('cashbook.handoverCancelled'), 'success');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      console.error('cancelHandover', err);
      showToast(err?.message || t('common.error'), 'error');
      btn.disabled = false;
    }
  });
}

function openHandoverDialog(day, suggestAmount, forAgentUid) {
  return new Promise((resolve) => {
    const form = html`<form class="space-y-4" data-handover-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('cashbook.recordHandover')}</h3>
      <p class="text-[13px] text-charcoal/70">${t('cashbook.handoverHint')} <span class="font-mono">${day}</span></p>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('cashbook.amount')} *</label>
        <input name="amount" type="number" min="1" step="1" value="${escapeHtml(String(suggestAmount || ''))}" required class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono focus:outline-none focus:border-blueberry">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('cashbook.handedTo')} *</label>
        <input name="handedTo" type="text" required placeholder="${escapeHtml(t('cashbook.handedToPlaceholder'))}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('cashbook.notesOptional')}</label>
        <input name="notes" type="text" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
      </div>
      <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('cashbook.confirmHandover')}</button>
    </form>`;
    const modal = openModal(form, { onClose: () => resolve() });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(form.amount.value);
      const handedTo = form.handedTo.value.trim();
      const notes = form.notes.value.trim();
      if (!amount || !handedTo) {
        showToast(t('common.error'), 'error');
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = t('common.loading');
      try {
        await recordHandover({ day, amount, handedTo, notes, forAgentUid });
        showToast(t('cashbook.handoverRecorded'), 'success');
        modal.close();
        setTimeout(() => window.location.reload(), 800);
      } catch (err) {
        console.error(err);
        showToast(err?.message || t('common.error'), 'error');
        btn.disabled = false;
        btn.textContent = t('cashbook.confirmHandover');
      }
    });
  });
}

// Printable report modal — opens a styled summary the agent can print
// (browser print dialog) or screenshot for hand-off to the manager.
function openReportModal(report, locale) {
  const entriesByDay = groupByDay(report.entries || []);
  const handoversList = (report.handovers || [])
    .sort((a, b) => String(a.handedAt || '').localeCompare(String(b.handedAt || '')));

  const entriesHtml = entriesByDay.map(([day, entries]) => {
    const daySum = sumAmount(entries);
    const rows = entries
      .sort((a, b) => String(a.paidAt || '').localeCompare(String(b.paidAt || '')))
      .map((e) => `
        <tr class="border-t border-frost-deep">
          <td class="px-3 py-2 text-[13px] font-mono">${formatTime(e.paidAt, locale)}</td>
          <td class="px-3 py-2 text-[13px] font-mono">${escapeHtml(e.plate || '—')}</td>
          <td class="px-3 py-2 text-[13px]">${escapeHtml(e.payerName || '—')}</td>
          <td class="px-3 py-2 text-[13px] text-dim">${sourceLabel(e.source)}</td>
          <td class="px-3 py-2 text-[13px] font-mono text-right ${amountClass(e.amount)}">${Number(e.amount || 0)} ${t('common.lei')}</td>
        </tr>`).join('');
    return `
      <div class="mb-4">
        <div class="flex justify-between items-baseline mb-1.5">
          <h4 class="font-semibold text-[14px] text-charcoal">${formatDay(day, locale)}</h4>
          <span class="font-mono font-semibold text-[14px]">${daySum} ${t('common.lei')}</span>
        </div>
        <table class="w-full bg-white rounded-lg border border-frost-deep overflow-hidden">
          <thead class="bg-frost text-[11px] font-mono uppercase tracking-wider text-dim">
            <tr>
              <th class="px-3 py-2 text-left">${t('cashbook.time')}</th>
              <th class="px-3 py-2 text-left">${t('cashbook.plate')}</th>
              <th class="px-3 py-2 text-left">${t('cashbook.payer')}</th>
              <th class="px-3 py-2 text-left">${t('cashbook.source')}</th>
              <th class="px-3 py-2 text-right">${t('cashbook.amount')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const handoversHtml = handoversList.length
    ? `<ul class="space-y-1 mb-4">${handoversList.map((h) => `
        <li class="flex justify-between text-[13px] text-charcoal/80">
          <span>${escapeHtml(h.handedTo)} · ${formatDateTime(h.handedAt, locale)}${h.notes ? ` · ${escapeHtml(h.notes)}` : ''}</span>
          <span class="font-mono font-semibold">${Number(h.amount || 0)} ${t('common.lei')}</span>
        </li>`).join('')}</ul>`
    : `<p class="text-[13px] text-dim italic mb-4">${t('cashbook.noHandovers')}</p>`;

  const body = html`<div data-cashbook-report class="space-y-4">
    <div class="flex items-start justify-between gap-4 print:mb-4">
      <div>
        <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('cashbook.reportTitle')}</h3>
        <p class="text-[13px] text-dim mt-1">${escapeHtml(report.agentName || '—')} · ${formatDateTime(report.generatedAt, locale)}</p>
        <p class="text-[12px] text-dim font-mono mt-0.5">${formatDateTime(report.rangeFromIso, locale)} → ${formatDateTime(report.rangeToIso, locale)}</p>
      </div>
      <button data-print class="print:hidden bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[13px] px-3 py-1.5 rounded-lg transition-colors">${t('cashbook.printBtn')}</button>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="card-solid rounded-xl p-3">
        <p class="text-[11px] font-mono uppercase tracking-wider text-dim">${t('cashbook.reportEntries')}</p>
        <p class="font-mono font-bold text-xl">${report.entryCount}</p>
      </div>
      <div class="card-solid rounded-xl p-3">
        <p class="text-[11px] font-mono uppercase tracking-wider text-dim">${t('cashbook.reportTotal')}</p>
        <p class="font-mono font-bold text-xl text-leaf">${Number(report.totalAmount || 0)} ${t('common.lei')}</p>
      </div>
    </div>

    ${entriesHtml || `<p class="text-[13px] text-dim italic">${t('cashbook.emptyOpen')}</p>`}

    <div>
      <h4 class="font-semibold text-[14px] text-charcoal mb-2">${t('cashbook.handovers')}</h4>
      ${handoversHtml}
    </div>

    <p class="text-[11px] text-dim text-center pt-3 border-t border-frost-deep">${t('cashbook.reportFooter')}</p>
  </div>`;

  openModal(body);
  body.querySelector('[data-print]')?.addEventListener('click', () => {
    printReport(report, locale);
  });
}

// Build a self-contained, print-optimized HTML document for a closed report.
// It is printed inside an isolated iframe (see printReport) so the browser
// renders ONLY this — not the live admin page + scrollable modal, which is
// what window.print() captured before and produced the broken/clipped output.
// No Tailwind classes reach the iframe, so all styling is inline here.
function buildPrintDoc(report, locale) {
  const esc = escapeHtml;
  const lei = t('common.lei');
  const entriesByDay = groupByDay(report.entries || []);
  const handoversList = (report.handovers || [])
    .sort((a, b) => String(a.handedAt || '').localeCompare(String(b.handedAt || '')));

  const days = entriesByDay.map(([day, entries]) => {
    const daySum = sumAmount(entries);
    const rows = entries
      .sort((a, b) => String(a.paidAt || '').localeCompare(String(b.paidAt || '')))
      .map((e) => `
        <tr>
          <td class="mono">${esc(formatTime(e.paidAt, locale))}</td>
          <td class="mono">${esc(e.plate || '—')}</td>
          <td>${esc(e.payerName || '—')}</td>
          <td class="dim">${esc(sourceLabel(e.source))}</td>
          <td class="mono right${Number(e.amount) < 0 ? ' neg' : ''}">${Number(e.amount || 0)} ${esc(lei)}</td>
        </tr>`).join('');
    return `
      <section class="day">
        <div class="day-head">
          <span class="day-title">${esc(formatDay(day, locale))}</span>
          <span class="mono bold">${daySum} ${esc(lei)}</span>
        </div>
        <table>
          <thead><tr>
            <th>${esc(t('cashbook.time'))}</th>
            <th>${esc(t('cashbook.plate'))}</th>
            <th>${esc(t('cashbook.payer'))}</th>
            <th>${esc(t('cashbook.source'))}</th>
            <th class="right">${esc(t('cashbook.amount'))}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  const handovers = handoversList.length
    ? `<ul class="handovers">${handoversList.map((h) => `
        <li>
          <span>${esc(h.handedTo || '—')} · ${esc(formatDateTime(h.handedAt, locale))}${h.notes ? ' · ' + esc(h.notes) : ''}</span>
          <span class="mono bold">${Number(h.amount || 0)} ${esc(lei)}</span>
        </li>`).join('')}</ul>`
    : `<p class="dim italic">${esc(t('cashbook.noHandovers'))}</p>`;

  const styles = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1A1A; font-size: 13px; line-height: 1.4; padding: 24px; }
    .brand { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #C8912A; font-weight: 700; }
    h1 { font-size: 20px; margin: 2px 0 4px; color: #0F2D66; }
    .sub { color: #666; font-size: 12px; margin: 1px 0; }
    .sub.mono { font-size: 11px; }
    .summary { display: flex; gap: 16px; margin: 16px 0; }
    .card { border: 1px solid #EDE3CC; border-radius: 8px; padding: 8px 14px; min-width: 140px; }
    .card .label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #999; }
    .card .value { font-size: 22px; font-weight: 700; }
    .value.leaf { color: #3E9B37; }
    .day { margin-bottom: 14px; page-break-inside: avoid; }
    .day-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
    .day-title { font-weight: 600; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #EDE3CC; }
    th { background: #FFF8E8; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #999; padding: 6px 10px; font-weight: 600; }
    th.right { text-align: right; }
    td { padding: 5px 10px; border-top: 1px solid #F0EADB; font-size: 12px; }
    .mono { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace; }
    .right { text-align: right; }
    .dim { color: #888; }
    /* Cash refunds are negative entries — money that left the drawer. */
    .neg { color: #b00020; }
    .bold { font-weight: 700; }
    .italic { font-style: italic; }
    .section-title { font-weight: 600; font-size: 14px; margin: 18px 0 6px; }
    .handovers { list-style: none; padding: 0; margin: 0; }
    .handovers li { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 12px; border-bottom: 1px solid #F0EADB; }
    .footer { text-align: center; color: #999; font-size: 11px; margin-top: 22px; padding-top: 10px; border-top: 1px solid #EDE3CC; }
    @page { margin: 14mm; }
  `;

  const title = esc(t('cashbook.reportTitle'));
  return `<!DOCTYPE html><html lang="${esc(locale)}"><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style></head><body>
    <div class="brand">ManGO Parking</div>
    <h1>${title}</h1>
    <p class="sub">${esc(report.agentName || '—')} · ${esc(formatDateTime(report.generatedAt, locale))}</p>
    <p class="sub mono">${esc(formatDateTime(report.rangeFromIso, locale))} → ${esc(formatDateTime(report.rangeToIso, locale))}</p>
    <div class="summary">
      <div class="card"><div class="label">${esc(t('cashbook.reportEntries'))}</div><div class="value">${Number(report.entryCount || 0)}</div></div>
      <div class="card"><div class="label">${esc(t('cashbook.reportTotal'))}</div><div class="value leaf">${Number(report.totalAmount || 0)} ${esc(lei)}</div></div>
    </div>
    ${days || `<p class="dim italic">${esc(t('cashbook.emptyOpen'))}</p>`}
    <div class="section-title">${esc(t('cashbook.handovers'))}</div>
    ${handovers}
    <div class="footer">${esc(t('cashbook.reportFooter'))}</div>
  </body></html>`;
}

// Print a closed report in isolation: write the self-contained doc into a
// hidden iframe and print that window, so nothing from the SPA (sidebar,
// navbar, modal overflow) bleeds into the output. Cleaned up on afterprint,
// with a long safety-net timeout for browsers that don't fire it.
function printReport(report, locale) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.srcdoc = buildPrintDoc(report, locale);
  iframe.onload = () => {
    const win = iframe.contentWindow;
    const cleanup = () => { if (iframe.parentNode) iframe.remove(); };
    try {
      win.focus();
      win.onafterprint = cleanup;
      win.print();
    } catch (err) {
      console.error('cashbook print failed', err);
      cleanup();
      return;
    }
    setTimeout(cleanup, 60000);
  };
  document.body.appendChild(iframe);
}
