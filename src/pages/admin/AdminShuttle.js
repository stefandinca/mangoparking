import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getShuttleSchedule, updateShuttleStatus, getRouteKey } from '../../services/shuttleService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';

const STATUS_KEYS = {
  departed: 'admin.departed',
  delayed: 'admin.delayed',
  boarding: 'admin.boarding',
  scheduled: 'admin.scheduled',
  cancelled: 'admin.cancelled',
};

const STATUS_STYLES = {
  departed: 'bg-gray-100 text-gray-600',
  delayed: 'bg-yellow-100 text-yellow-700',
  boarding: 'bg-mango/10 text-mango',
  scheduled: 'bg-blue-100 text-blue-600',
  cancelled: 'bg-red-100 text-red-500',
};

const ROUTE_DISPLAY = {
  parking_to_airport: 'admin.parkingToAirport',
  airport_to_parking: 'admin.airportToParking',
  parking_to_train: 'admin.parkingToTrain',
  train_to_parking: 'admin.trainToParking',
};

export default async function AdminShuttle(container) {
  updateMeta({ title: 'Shuttle — Admin — Mango Parking', description: 'Manage shuttle schedule.' });

  const schedule = await getShuttleSchedule();

  const page = AdminLayout('/admin/shuttle', `
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('admin.shuttleSchedule')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('admin.todayDepartures')}</p>
          </div>
          <button class="bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors" data-add-departure>+ ${t('admin.addDeparture')}</button>
        </div>

        <!-- Status Summary -->
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8" data-summary-cards>
          ${[
            { label: t('admin.departed'), count: schedule.filter(s => s.status === 'departed').length, color: 'text-gray-600' },
            { label: t('admin.boarding'), count: schedule.filter(s => s.status === 'boarding').length, color: 'text-mango' },
            { label: t('admin.scheduled'), count: schedule.filter(s => s.status === 'scheduled').length, color: 'text-blue-600' },
            { label: t('admin.delayed'), count: schedule.filter(s => s.status === 'delayed').length, color: 'text-yellow-700' },
            { label: t('admin.cancelled'), count: schedule.filter(s => s.status === 'cancelled').length, color: 'text-red-500' },
          ].map(s => `
            <div class="card-solid rounded-2xl p-5 text-center">
              <p class="font-heading font-bold text-2xl font-mono ${s.color}">${s.count}</p>
              <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mt-1">${s.label}</p>
            </div>
          `).join('')}
        </div>

        <!-- Schedule Table -->
        <div class="card-solid rounded-2xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-frost-deep">
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.time')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.route')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.driver')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.passengers')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.status')}</th>
                  <th class="text-right text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.actionsCol')}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-frost-deep/60">
                ${schedule.map(s => {
                  const routeKey = ROUTE_DISPLAY[s.route] || 'admin.parkingToAirport';
                  const status = s.status || 'scheduled';
                  return `
                  <tr class="hover:bg-frost/50 transition-colors" data-shuttle-id="${s.id}">
                    <td class="px-6 py-4 font-mono text-[15px] font-semibold">${s.departureTime || s.time || '—'}</td>
                    <td class="px-6 py-4 text-[15px]">${t(routeKey)}</td>
                    <td class="px-6 py-4 text-[15px] text-dim">${s.driver || '—'}</td>
                    <td class="px-6 py-4 font-mono text-[14px]">${s.capacity || '—'}</td>
                    <td class="px-6 py-4">
                      <span class="text-[12px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${STATUS_STYLES[status] || STATUS_STYLES.scheduled}" data-shuttle-status="${s.id}">${t(STATUS_KEYS[status] || STATUS_KEYS.scheduled)}</span>
                    </td>
                    <td class="px-6 py-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        ${status === 'scheduled' || status === 'boarding' ? `
                          <button class="text-[13px] font-semibold text-yellow-600 hover:text-yellow-700 transition-colors" data-action="delay" data-id="${s.id}">${t('admin.delay')}</button>
                          <button class="text-[13px] font-semibold text-red-500 hover:text-red-600 transition-colors" data-action="cancel" data-id="${s.id}">${t('admin.cancel')}</button>
                        ` : ''}
                        ${status === 'scheduled' ? `
                          <button class="text-[13px] font-semibold text-leaf hover:text-leaf/80 transition-colors" data-action="depart" data-id="${s.id}">${t('admin.depart')}</button>
                        ` : ''}
                        <button class="text-[13px] font-semibold text-dim hover:text-charcoal transition-colors" data-action="edit" data-id="${s.id}">${t('admin.edit')}</button>
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
  `);

  // Status toggle actions — persist to Firestore
  delegate(page, 'click', '[data-action]', async (e, btn) => {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const statusEl = page.querySelector(`[data-shuttle-status="${id}"]`);
    if (!statusEl) return;

    let newStatus = '';
    if (action === 'delay') newStatus = 'delayed';
    else if (action === 'cancel') newStatus = 'cancelled';
    else if (action === 'depart') newStatus = 'departed';
    else return;

    // Update UI
    Object.values(STATUS_STYLES).forEach(cls => {
      cls.split(' ').forEach(c => statusEl.classList.remove(c));
    });
    STATUS_STYLES[newStatus].split(' ').forEach(c => statusEl.classList.add(c));
    statusEl.textContent = t(STATUS_KEYS[newStatus]);

    // Persist to Firestore
    await updateShuttleStatus(id, newStatus).catch(console.error);
  });

  // Wire mobile admin nav
  initAdminNav(page);

  container.appendChild(page);
}
