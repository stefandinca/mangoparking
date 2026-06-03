import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { renderLegalPage } from '../../components/core/LegalPageShell.js';

export default function GDPR(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('legal.gdprTitle')} — Mango Parking`,
    description: locale === 'ro'
      ? 'Politica GDPR Mango Parking — temei legal, drepturi, măsuri de securitate.'
      : 'Mango Parking GDPR policy — legal basis, rights, security measures.',
    lang: locale,
  });

  renderLegalPage(container, {
    slug: 'gdpr',
    title: t('legal.gdprTitle'),
    intro: t('legal.gdprIntro'),
    sections: [
      { heading: t('legal.gdprSectionController'), body: t('legal.gdprControllerBody') },
      { heading: t('legal.gdprSectionBasis'),      body: t('legal.gdprBasisBody') },
      { heading: t('legal.gdprSectionRights'),     body: t('legal.gdprRightsBody') },
      { heading: t('legal.gdprSectionSecurity'),   body: t('legal.gdprSecurityBody') },
      { heading: t('legal.gdprSectionComplaint'),  body: t('legal.gdprComplaintBody') },
    ],
  });
}
