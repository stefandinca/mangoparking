import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { renderLegalPage } from '../../components/core/LegalPageShell.js';

export default function Terms(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('legal.termsTitle')} — Mango Parking`,
    description: locale === 'ro'
      ? 'Termenii și condițiile de utilizare ale serviciilor Mango Parking.'
      : 'Terms and conditions for Mango Parking services.',
    lang: locale,
  });

  renderLegalPage(container, {
    slug: 'terms',
    title: t('legal.termsTitle'),
    intro: t('legal.termsIntro'),
    sections: [
      { heading: t('legal.termsSectionService'),     body: t('legal.termsServiceBody') },
      { heading: t('legal.termsSectionPrice'),       body: t('legal.termsPriceBody') },
      { heading: t('legal.termsSectionAccount'),     body: t('legal.termsAccountBody') },
      { heading: t('legal.termsSectionObligations'), body: t('legal.termsObligationsBody') },
      { heading: t('legal.termsSectionLiability'),   body: t('legal.termsLiabilityBody') },
      { heading: t('legal.termsSectionLaw'),         body: t('legal.termsLawBody') },
    ],
  });
}
