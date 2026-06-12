// Admin Guide — a plain-language help page for the people running the lot
// (admins, agents, drivers). Standalone, read-only: explains what every
// admin page does and the key day-to-day concepts. Bilingual content is
// kept inline (RO/EN via getLocale) so the ~1.3k-line locale files don't
// balloon with long-form copy; only the menu label lives in i18n.
//
// Access: gated by PERM.HELP, which admin / agent / driver all have and
// customer does not (see utils/permissions.js + the route guard).

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { hasPermission, PERM, ROLE_ADMIN, ROLE_AGENT, ROLE_DRIVER } from '../../utils/permissions.js';

export default function AdminHelp(container) {
  const locale = getLocale();
  const ro = locale === 'ro';
  const tx = (r, e) => (ro ? r : e);

  updateMeta({ title: `${t('admin.help')} — Admin`, lang: locale });

  const roleLabel = (role) =>
    role === ROLE_ADMIN ? tx('Administrator', 'Admin')
      : role === ROLE_AGENT ? 'Agent'
        : role === ROLE_DRIVER ? tx('Șofer', 'Driver')
          : role;

  // Role pills for a section — derived from the real permission map so the
  // guide can never drift out of sync with who actually sees each page.
  const badgesFor = (perm) =>
    [ROLE_ADMIN, ROLE_AGENT, ROLE_DRIVER]
      .filter((r) => hasPermission(r, perm))
      .map((r) => `<span class="inline-block text-[11px] font-semibold uppercase tracking-wider text-blueberry-deep bg-blueberry/10 rounded-full px-2 py-0.5">${roleLabel(r)}</span>`)
      .join(' ');

  // Each section mirrors a real admin page (title pulled from the same i18n
  // key the sidebar uses, so they always read identically).
  const sections = [
    {
      perm: PERM.DASHBOARD, title: t('admin.dashboard'),
      summary: tx('Imaginea de ansamblu a zilei.', 'The day at a glance.'),
      what: tx('Prima pagină când intri. Arată câte locuri sunt ocupate și libere, câte credite s-au folosit și s-au vândut azi și câte rezervări așteaptă o rambursare.', 'The first page you land on. Shows how many spots are taken and free, how many credits were used and sold today, and how many bookings are waiting for a refund.'),
      how: tx('Doar pentru informare. Apeși pe cardurile cu cifre ca să sari direct la pagina respectivă (de exemplu Rambursări).', 'Just for an overview. Click the number cards to jump straight to that page (for example Refunds).'),
    },
    {
      perm: PERM.CHECKINS, title: t('admin.checkins'),
      summary: tx('Inima muncii zilnice: predai și preiei mașinile.', 'The core of daily work: cars in and out.'),
      what: tx('Aici vezi toate rezervările și gestionezi sosirile și plecările. Are file: „Check-in” (cine vine azi), „Check-out” (cine pleacă), „Întârziate” (au depășit ora de plecare) și „Neprezentări” (nu au mai venit).', 'Here you see every reservation and handle arrivals and departures. It has tabs: "Check-in" (arriving today), "Check-out" (leaving), "Overdue" (past their pick-up time) and "No-show" (never came).'),
      how: tx('Cauți după numărul de înmatriculare, apeși „Check-in” când sosește mașina și „Check-out” la plecare. Pentru un client fără rezervare folosești „Walk-in”. Dacă a stat mai mult decât a plătit, sistemul îți cere să încasezi diferența înainte de check-out.', 'Search by plate, press "Check-in" when the car arrives and "Check-out" when it leaves. For a customer without a booking use "Walk-in". If they stayed longer than they paid for, the system asks you to collect the difference before check-out.'),
    },
    {
      perm: PERM.TRANSACTIONS, title: t('admin.transactions'),
      summary: tx('Istoricul complet al banilor și creditelor.', 'The full money and credits history.'),
      what: tx('Un registru cu tot ce s-a întâmplat: pachete de credite cumpărate, credite folosite, rezervări pe termen lung și taxe de întârziere.', 'A ledger of everything that happened: credit packs bought, credits used, long-term bookings and late fees.'),
      how: tx('Îl folosești ca să cauți o plată sau să verifici ce a făcut un client. De aici poți porni și o vânzare „walk-in”.', 'Use it to look up a payment or check what a customer did. You can also start a walk-in sale from here.'),
    },
    {
      perm: PERM.CASHBOOK, title: t('admin.cashbook'),
      summary: tx('Banii cash pe care i-ai încasat tu.', 'The cash you personally collected.'),
      what: tx('Ține evidența numerarului luat de la clienți în tura ta. La final predai banii managerului („handover”) și „închizi” casa, generând un raport.', 'Tracks the cash you took from customers during your shift. At the end you hand the money to the manager ("handover") and "close" the cashbook, which generates a report.'),
      how: tx('Plățile cash apar automat aici când le încasezi. Apeși „Predă numerar” când dai banii și „Închide casa” pentru raportul zilei.', 'Cash payments appear here automatically when you collect them. Press "Hand over cash" when you give the money and "Close cashbook" for the day\'s report.'),
    },
    {
      perm: PERM.REFUNDS, title: t('admin.refunds'),
      summary: tx('Clienți cărora trebuie să le dai banii înapoi.', 'Customers owed money back.'),
      what: tx('O listă cu rezervările anulate care fuseseră plătite și așteaptă o rambursare.', 'A list of cancelled bookings that had been paid and are waiting for a refund.'),
      how: tx('După ce returnezi banii (prin Netopia sau cash), apeși „Marchează rambursat” ca să iasă din listă. Suma afișată este exact cât a plătit clientul.', 'After you return the money (via Netopia or cash), press "Mark refunded" so it leaves the list. The amount shown is exactly what the customer paid.'),
    },
    {
      perm: PERM.VOUCHERS, title: t('admin.vouchers'),
      summary: tx('Coduri de reducere.', 'Discount codes.'),
      what: tx('Creezi și editezi coduri promoționale. Trei tipuri: sumă fixă (de exemplu −20 lei), procent (de exemplu −10%) sau zile gratuite (de exemplu 1 zi gratis la parcarea pe termen lung).', 'Create and edit promo codes. Three types: fixed amount (e.g. −20 lei), percent (e.g. −10%) or free days (e.g. 1 free day on long-term parking).'),
      how: tx('Apeși „Adaugă”, alegi tipul, valoarea și perioada de valabilitate. Clientul introduce codul la plată.', 'Press "Add", choose the type, value and validity dates. The customer enters the code at checkout.'),
    },
    {
      perm: PERM.PROMOTIONS, title: t('admin.promotions'),
      summary: tx('Ofertele de campanie afișate pe site.', 'Campaign offers shown on the site.'),
      what: tx('Gestionezi ofertele pe care le văd clienții pe pagina de promoții.', 'Manage the offers customers see on the promotions page.'),
      how: tx('Adaugi un titlu, o descriere și o perioadă; promoția apare pe site cât timp este activă.', 'Add a title, description and dates; the promo shows on the site while it is active.'),
    },
    {
      perm: PERM.CAPACITY, title: t('admin.capacity'),
      summary: tx('Câte locuri sunt și cât e ocupat.', 'How many spots there are and how full.'),
      what: tx('Arată numărul total de locuri, câte sunt libere și câte ocupate, plus harta locurilor.', 'Shows the total number of spots, how many are free and taken, plus the spot map.'),
      how: tx('Îl verifici ca să știi dacă mai poți primi mașini. Administratorul poate ajusta numărul total de locuri.', 'Check it to know whether you can still take cars in. An admin can adjust the total number of spots.'),
    },
    {
      perm: PERM.PRICING, title: t('admin.pricing'),
      summary: tx('Tarifele și reducerile.', 'Rates and discounts.'),
      what: tx('Setezi prețul pe zi pentru parcarea pe termen lung (pe tranșe de zile), reducerea pentru plata online și perioadele sezoniere cu tarife speciale.', 'Set the per-day long-term price (in day tiers), the online-payment discount and seasonal periods with special rates.'),
      how: tx('Prețurile din sistem sunt prețul „standard” (la fața locului). Plata online scade automat procentul de reducere.', 'The prices in the system are the "standard" (on-site) price. Paying online automatically subtracts the discount percent.'),
    },
    {
      perm: PERM.SHUTTLE, title: t('admin.shuttle'),
      summary: tx('Programul microbuzului ManGO buzz.', 'The ManGO buzz shuttle schedule.'),
      what: tx('Programul curselor gratuite spre aeroport și gară, afișat clienților.', 'The free shuttle schedule to the airport and train station, shown to customers.'),
      how: tx('Adaugi sau modifici orele de plecare. Șoferii și agenții îl pot vedea.', 'Add or edit departure times. Drivers and agents can view it.'),
    },
    {
      perm: PERM.REVIEWS, title: t('admin.reviews'),
      summary: tx('Părerile clienților afișate pe site.', 'Customer testimonials shown on the site.'),
      what: tx('Recenziile afișate pe pagina principală.', 'The reviews shown on the homepage.'),
      how: tx('Adaugi, editezi sau ascunzi recenzii și le dai o ordine de afișare.', 'Add, edit or hide reviews and set their display order.'),
    },
    {
      perm: PERM.USERS, title: t('admin.users'),
      summary: tx('Conturile echipei și rolurile lor.', 'Staff accounts and their roles.'),
      what: tx('Gestionezi cine are acces la panou și cu ce rol (administrator, agent sau șofer).', 'Manage who has access to the panel and with what role (admin, agent or driver).'),
      how: tx('Trimiți invitații prin email, schimbi rolul cuiva sau elimini un cont.', 'Send email invites, change someone\'s role or remove an account.'),
    },
    {
      perm: PERM.LEGAL, title: t('admin.legal'),
      summary: tx('Textele paginilor legale.', 'The legal page texts.'),
      what: tx('Editezi conținutul paginilor Termeni, Confidențialitate, GDPR și celelalte pagini legale.', 'Edit the content of the Terms, Privacy, GDPR and other legal pages.'),
      how: tx('Modifici textul și salvezi; se actualizează pe site.', 'Change the text and save; it updates on the site.'),
    },
  ];

  // Cross-cutting concepts that show up across several pages.
  const glossary = [
    {
      title: tx('Credite vs. termen lung', 'Credits vs. long-term'),
      body: tx('Creditele sunt jetoane de o zi (1 credit = 1 zi de parcare), bune pentru navetiști care vin des — scazi un credit pe zi după numărul de înmatriculare. Termen lung este o rezervare pe un interval de date (sosire → plecare), plătită în avans.', 'Credits are one-day tokens (1 credit = 1 day of parking), good for frequent commuters — you deduct one credit per day by plate. Long-term is a reservation for a date range (drop-off → pick-up), paid up front.'),
    },
    {
      title: 'Walk-in',
      body: tx('Un client care vine fără rezervare. Îl înregistrezi pe loc din pagina Check-in sau Tranzacții: întâi plata, apoi check-in. Nu poți face check-in unui client neplătit.', 'A customer who arrives without a booking. You register them on the spot from the Check-in or Transactions page: payment first, then check-in. You can\'t check in a customer who hasn\'t paid.'),
    },
    {
      title: tx('Plata online vs. la sosire', 'Pay online vs. on arrival'),
      body: tx('Clientul poate plăti online (card, cu reducere) sau la sosire (cash sau card, la prețul standard). Reducerea online se aplică automat doar la plata online; la sosire se plătește prețul afișat standard.', 'The customer can pay online (card, with a discount) or on arrival (cash or card, at the standard price). The online discount applies automatically only when paying online; on arrival they pay the standard listed price.'),
    },
    {
      title: tx('Neprezentare (no-show)', 'No-show'),
      body: tx('O rezervare la care clientul nu s-a prezentat. Sistemul o marchează automat „neprezentare” la 12 ore după ora de sosire, dacă mașina nu a fost predată, și eliberează locul. Banii nu se returnează.', 'A booking where the customer never showed up. The system auto-marks it "no-show" 12 hours after the drop-off time if the car was never handed in, and frees the spot. The money is not refunded.'),
    },
    {
      title: tx('Depășire / taxă de întârziere', 'Overstay / late fee'),
      body: tx('Când clientul stă mai mult decât a plătit. La check-out, sistemul calculează zilele în plus și îți cere să încasezi diferența (cash sau card) înainte de a finaliza.', 'When a customer stays longer than they paid for. At check-out the system works out the extra days and asks you to collect the difference (cash or card) before finishing.'),
    },
    {
      title: tx('Predare și închidere casă', 'Handover and closing the cashbook'),
      body: tx('„Predare” înseamnă că dai numerarul din tura ta managerului. „Închidere” generează raportul zilei și golește casa ta, ca să pornești curat tura următoare.', '"Handover" means you give your shift\'s cash to the manager. "Close" generates the day\'s report and clears your cashbook so you start the next shift clean.'),
    },
  ];

  const chevron = '<svg class="w-5 h-5 text-dim shrink-0 mt-0.5 transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>';

  const sectionCard = (s) => `
    <details class="card-solid rounded-2xl overflow-hidden group" data-help-item>
      <summary class="flex items-start gap-3 px-5 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-heading font-semibold text-[16px] text-blueberry-deep">${s.title}</span>
            ${badgesFor(s.perm)}
          </div>
          <p class="text-[13px] text-dim mt-0.5">${s.summary}</p>
        </div>
        ${chevron}
      </summary>
      <div class="px-5 pb-5 pt-1 border-t border-frost-deep space-y-2.5 text-[14px] text-charcoal/80 leading-relaxed">
        <p><span class="font-semibold text-charcoal">${tx('Ce face:', 'What it does:')}</span> ${s.what}</p>
        <p><span class="font-semibold text-charcoal">${tx('Cum folosești:', 'How you use it:')}</span> ${s.how}</p>
      </div>
    </details>`;

  const glossaryCard = (g) => `
    <details class="card-solid rounded-2xl overflow-hidden group" data-help-item>
      <summary class="flex items-start gap-3 px-5 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span class="flex-1 font-heading font-semibold text-[16px] text-blueberry-deep">${g.title}</span>
        ${chevron}
      </summary>
      <div class="px-5 pb-5 pt-1 border-t border-frost-deep text-[14px] text-charcoal/80 leading-relaxed">${g.body}</div>
    </details>`;

  const body = `
    <div class="mb-6">
      <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.help')}</h1>
      <p class="text-dim mt-1">${tx('Pe scurt, ce face fiecare pagină din panou și cum o folosești zi de zi.', 'In plain words: what each page of the panel does and how you use it day to day.')}</p>
    </div>

    <!-- Roles -->
    <div class="grid sm:grid-cols-3 gap-4 mb-8">
      <div class="card-solid rounded-2xl p-5 border-t-4 border-mango">
        <h3 class="font-heading font-bold text-blueberry-deep">${tx('Administrator', 'Admin')}</h3>
        <p class="text-[13px] text-charcoal/75 mt-1.5 leading-relaxed">${tx('Acces complet. Vede și modifică tot, inclusiv setările: prețuri, utilizatori, vouchere, promoții și paginile legale.', 'Full access. Sees and edits everything, including the settings: pricing, users, vouchers, promotions and the legal pages.')}</p>
      </div>
      <div class="card-solid rounded-2xl p-5 border-t-4 border-blueberry">
        <h3 class="font-heading font-bold text-blueberry-deep">Agent</h3>
        <p class="text-[13px] text-charcoal/75 mt-1.5 leading-relaxed">${tx('Operațiuni zilnice: check-in/out, plăți, casă, rambursări, capacitate, microbuz și recenzii. Nu vede setările de configurare.', 'Day-to-day operations: check-in/out, payments, cashbook, refunds, capacity, shuttle and reviews. Does not see the configuration settings.')}</p>
      </div>
      <div class="card-solid rounded-2xl p-5 border-t-4 border-leaf">
        <h3 class="font-heading font-bold text-blueberry-deep">${tx('Șofer', 'Driver')}</h3>
        <p class="text-[13px] text-charcoal/75 mt-1.5 leading-relaxed">${tx('Șofer de microbuz: tabloul de bord, check-in/out, capacitate și programul microbuzului.', 'Shuttle driver: the dashboard, check-in/out, capacity and the shuttle schedule.')}</p>
      </div>
    </div>

    <p class="text-[13px] text-dim mb-5">${tx('Eticheta de pe fiecare secțiune arată cine o poate deschide. Dacă o secțiune nu apare în meniul tău, rolul tău nu are acces la ea.', 'The label on each section shows who can open it. If a section doesn\'t appear in your menu, your role doesn\'t have access to it.')}</p>

    <!-- Search -->
    <div class="relative mb-5">
      <input type="search" data-help-search placeholder="${tx('Caută în ghid…', 'Search the guide…')}" class="w-full pl-10 pr-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
      <svg class="w-5 h-5 text-dim absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
    </div>

    <!-- Pages -->
    <h2 class="font-heading text-xl font-bold text-blueberry-deep mb-3">${tx('Paginile panoului', 'The panel pages')}</h2>
    <div class="space-y-2.5 mb-10" data-help-group>
      ${sections.map(sectionCard).join('')}
    </div>

    <!-- Glossary -->
    <h2 class="font-heading text-xl font-bold text-blueberry-deep mb-3">${tx('Noțiuni utile', 'Useful concepts')}</h2>
    <div class="space-y-2.5" data-help-group>
      ${glossary.map(glossaryCard).join('')}
    </div>

    <p class="text-[13px] text-dim mt-10 text-center" data-help-empty hidden>${tx('Niciun rezultat pentru căutarea ta.', 'No results for your search.')}</p>
  `;

  const page = AdminLayout('/admin/help', body);
  container.appendChild(page);
  initAdminNav(page);

  // Live filter — hide non-matching cards and auto-expand the matches.
  const search = page.querySelector('[data-help-search]');
  const items = [...page.querySelectorAll('[data-help-item]')];
  const emptyMsg = page.querySelector('[data-help-empty]');
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let visible = 0;
    items.forEach((el) => {
      const match = !q || el.textContent.toLowerCase().includes(q);
      el.classList.toggle('hidden', !match);
      el.open = !!q && match;
      if (match) visible++;
    });
    if (emptyMsg) emptyMsg.hidden = visible !== 0;
    // Hide a group's heading row only matters visually; groups stay.
  });
}
