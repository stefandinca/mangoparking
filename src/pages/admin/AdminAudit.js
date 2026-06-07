import { html, delegate } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAuditLog } from '../../services/auditService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';

const ACTION_STYLES = {
  booking_checkin: 'bg-leaf/10 text-leaf',
  booking_checkout: 'bg-blue-100 text-blue-600',
  booking_created: 'bg-mango/10 text-mango',
  spot_updated: 'bg-purple-100 text-purple-600',
  shuttle_updated: 'bg-indigo-100 text-indigo-600',
  booking_cancelled: 'bg-red-100 text-red-500',
  pricing_updated: 'bg-yellow-100 text-yellow-700',
  addon_updated: 'bg-yellow-100 text-yellow-700',
  subscription_created: 'bg-mango/10 text-mango',
  subscription_cancelled: 'bg-red-100 text-red-500',
  check_in: 'bg-leaf/10 text-leaf',
  check_out: 'bg-blue-100 text-blue-600',
  create: 'bg-mango/10 text-mango',
  update: 'bg-purple-100 text-purple-600',
  cancel: 'bg-red-100 text-red-500',
  dispatch: 'bg-indigo-100 text-indigo-600',
  pricing: 'bg-yellow-100 text-yellow-700',
  login: 'bg-gray-100 text-gray-600',
  shuttle_delay: 'bg-orange-100 text-orange-600',
};

export default async function AdminAudit(container) {
  updateMeta({ title: 'Audit Log — Admin — ManGO Parking', description: 'System audit log and activity trail.' });

  const auditLog = await getAuditLog(100).catch(() => []);
  const actionTypes = [...new Set(auditLog.map(l => l.action))];
  const users = [...new Set(auditLog.map(l => l.user))];

  const page = AdminLayout('/admin/audit', `
        <div class="mb-8">
          <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.auditLog')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.auditSubtitle')}</p>
        </div>

        <!-- Filters -->
        <div class="flex flex-col sm:flex-row gap-4 mb-6">
          <div class="flex-1 relative">
            <svg class="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-dim" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
            <input type="text" placeholder="${t('admin.searchLogs')}" class="w-full pl-11 pr-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-audit-search>
          </div>
          <select class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] text-dim focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-audit-action-filter>
            <option value="all">${t('admin.allActions')}</option>
            ${actionTypes.map(a => `<option value="${a}">${a.replace(/_/g, ' ')}</option>`).join('')}
          </select>
          <select class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] text-dim focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all" data-audit-user-filter>
            <option value="all">${t('admin.allUsers')}</option>
            ${users.map(u => `<option value="${u}">${u}</option>`).join('')}
          </select>
        </div>

        <!-- Log Table -->
        <div class="card-solid rounded-2xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-frost-deep">
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.timestamp')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.action')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.entity')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.user')}</th>
                  <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.details')}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-frost-deep/60" data-audit-body>
                ${auditLog.map(log => `
                  <tr class="hover:bg-frost transition-colors" data-log-action="${log.action}" data-log-user="${log.user}">
                    <td class="px-6 py-4 font-mono text-[13px] text-dim whitespace-nowrap">${log.timestamp || '—'}</td>
                    <td class="px-6 py-4">
                      <span class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap ${ACTION_STYLES[log.action] || 'bg-gray-100 text-gray-600'}">${(log.action || '').replace(/_/g, ' ')}</span>
                    </td>
                    <td class="px-6 py-4 text-[14px] font-medium text-charcoal whitespace-nowrap">${log.entity || '—'}</td>
                    <td class="px-6 py-4 font-mono text-[13px] text-dim">${log.user || '—'}</td>
                    <td class="px-6 py-4 text-[14px] text-charcoal/60 max-w-xs truncate">${log.details || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Pagination placeholder -->
        <div class="flex items-center justify-between mt-6">
          <p class="text-[14px] text-dim">${t('admin.showing')} ${auditLog.length} ${t('admin.of')} ${auditLog.length} ${t('admin.entries')}</p>
        </div>
  `);

  // Search & filter
  const searchInput = page.querySelector('[data-audit-search]');
  const actionFilter = page.querySelector('[data-audit-action-filter]');
  const userFilter = page.querySelector('[data-audit-user-filter]');

  function applyFilters() {
    const query = searchInput.value.toLowerCase();
    const actionVal = actionFilter.value;
    const userVal = userFilter.value;

    page.querySelectorAll('[data-log-action]').forEach(row => {
      const matchesSearch = !query || row.textContent.toLowerCase().includes(query);
      const matchesAction = actionVal === 'all' || row.dataset.logAction === actionVal;
      const matchesUser = userVal === 'all' || row.dataset.logUser === userVal;
      row.style.display = (matchesSearch && matchesAction && matchesUser) ? '' : 'none';
    });
  }

  searchInput.addEventListener('input', applyFilters);
  actionFilter.addEventListener('change', applyFilters);
  userFilter.addEventListener('change', applyFilters);

  // Wire mobile admin nav
  initAdminNav(page);

  container.appendChild(page);
}
