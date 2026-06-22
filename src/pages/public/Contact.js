import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { submitContactMessage } from '../../services/contactService.js';
import { isValidEmail, required } from '../../utils/validators.js';
import { showToast } from '../../components/core/Toast.js';
import {
  CONTACT_PHONE, CONTACT_EMAIL, CONTACT_ADDRESS, GOOGLE_MAPS_EMBED,
  COMPANY_LEGAL_NAME, CUI, REG_COM, COMPANY_ADDRESS,
} from '../../utils/constants.js';
import { getOpeningHours, DEFAULT_HOURS, OPENING_DAYS } from '../../services/openingHoursService.js';

// Per-day office-hours rows for the contact info card.
function hoursRowsHtml(hours) {
  return OPENING_DAYS.map((k) => {
    const d = hours[k];
    const val = d.closed ? t('openingHours.closed') : `${d.open}–${d.close}`;
    return `<tr class="border-b border-frost-deep/60 last:border-0">
      <td class="py-1.5 pr-4 text-dim">${t('openingHours.' + k)}</td>
      <td class="py-1.5 text-right font-medium ${d.closed ? 'text-dim' : ''}">${val}</td>
    </tr>`;
  }).join('');
}

export default function Contact(container) {
  const locale = getLocale();

  updateMeta({
    title: locale === 'ro' ? 'Contact — ManGO Parking' : 'Contact — ManGO Parking',
    description: locale === 'ro'
      ? 'Contactează ManGO Parking. Telefon, email și indicații către parcarea noastră de lângă Aeroportul Otopeni.'
      : 'Contact ManGO Parking. Phone, email, and directions to our parking near Otopeni Airport.',
    lang: locale,
  });

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-24 md:pt-32 pb-16 md:pb-20">
      <div class="max-w-4xl mx-auto px-6">
        <div class="text-center mb-16">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('contact.pageTitle')}</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-4">${t('contact.heroTitle')}</h1>
          <p class="text-dim text-[17px] max-w-lg mx-auto">${t('contact.heroSubtitle')}</p>
        </div>

        <div class="grid md:grid-cols-2 gap-8">
          <!-- Form -->
          <div class="card-solid rounded-3xl p-5 sm:p-8">
            <form data-contact-form class="space-y-4">
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.name')} *</label>
                <input type="text" name="name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.email')} *</label>
                <input type="email" name="email" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.subject')}</label>
                <input type="text" name="subject" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.message')} *</label>
                <textarea name="message" rows="5" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 resize-none" required></textarea>
              </div>
              <button type="submit" class="w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[16px] py-4 rounded-2xl transition-colors shadow-md">${t('contact.form.send')}</button>
              <div data-success class="hidden text-leaf text-[15px] text-center font-medium mt-2">${t('contact.form.sent')}</div>
            </form>
          </div>

          <!-- Info -->
          <div class="space-y-6">
            <div class="card-solid rounded-3xl p-8">
              <h3 class="font-heading font-bold text-lg mb-6">${t('contact.info')}</h3>
              <div class="space-y-4">
                <div>
                  <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('contact.phone')}</p>
                  <a href="tel:${CONTACT_PHONE.replace(/\s/g, '')}" class="text-[16px] font-medium hover:text-mango transition-colors">${CONTACT_PHONE}</a>
                </div>
                <div>
                  <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('contact.emailLabel')}</p>
                  <a href="mailto:${CONTACT_EMAIL}" class="text-[16px] font-medium hover:text-mango transition-colors">${CONTACT_EMAIL}</a>
                </div>
                <div>
                  <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('contact.address')}</p>
                  <p class="text-[16px] font-medium">${CONTACT_ADDRESS}</p>
                </div>
                <div>
                  <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1.5">${t('contact.hoursLabel')}</p>
                  <p class="text-[15px] mb-3">${t('footer.parking247')}</p>
                  <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('openingHours.office')}</p>
                  <table class="w-full text-[14px]"><tbody data-hours-tbody>${hoursRowsHtml(DEFAULT_HOURS)}</tbody></table>
                </div>
              </div>
            </div>

            <!-- Map -->
            <div class="card-solid rounded-3xl overflow-hidden">
              <iframe src="${GOOGLE_MAPS_EMBED}" width="100%" height="250" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
              <div class="p-4 text-center">
                <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(CONTACT_ADDRESS)}" target="_blank" rel="noopener" class="text-mango hover:text-mango-hover text-[14px] font-semibold transition-colors">${t('contact.getDirections')} →</a>
              </div>
            </div>

            <!-- Operator / Company details (Netopia + ANPC requirement) -->
            <div class="card-solid rounded-3xl p-8">
              <h3 class="font-heading font-bold text-lg mb-6">${t('contact.operator')}</h3>
              <div class="space-y-4">
                <div>
                  <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('footer.legalName')}</p>
                  <p class="text-[16px] font-medium">${COMPANY_LEGAL_NAME}</p>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('footer.cui')}</p>
                    <p class="text-[15px] font-medium font-mono">${CUI}</p>
                  </div>
                  <div>
                    <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('footer.regCom')}</p>
                    <p class="text-[15px] font-medium font-mono">${REG_COM}</p>
                  </div>
                </div>
                <div>
                  <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('contact.registeredAddress')}</p>
                  <p class="text-[15px]">${COMPANY_ADDRESS}</p>
                </div>
                <p class="text-[13px] text-dim pt-2 border-t border-frost-deep">${t('contact.operatorNote')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  // Form submission
  const form = page.querySelector('[data-contact-form]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get('name');
    const email = fd.get('email');
    const message = fd.get('message');

    if (!required(name) || !isValidEmail(email) || !required(message)) {
      showToast(t('common.error'), 'error');
      return;
    }

    try {
      await submitContactMessage({
        name,
        email,
        subject: fd.get('subject') || '',
        message,
      });
      form.reset();
      page.querySelector('[data-success]').classList.remove('hidden');
      showToast(t('contact.form.sent'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });

  container.appendChild(page);

  // Patch in the real opening hours once loaded (cached service).
  getOpeningHours().then((hours) => {
    const tb = page.querySelector('[data-hours-tbody]');
    if (tb) tb.innerHTML = hoursRowsHtml(hours);
  }).catch(() => {});
}
