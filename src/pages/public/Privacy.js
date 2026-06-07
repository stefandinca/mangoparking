import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { renderLegalPage } from '../../components/core/LegalPageShell.js';

export default function Privacy(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('legal.privacyTitle')} — ManGO Parking`,
    description: locale === 'ro'
      ? 'Cum prelucrează ManGO Parking datele cu caracter personal (GDPR).'
      : 'How ManGO Parking processes personal data (GDPR).',
    lang: locale,
  });

  renderLegalPage(container, {
    slug: 'privacy',
    title: t('legal.privacyTitle'),
    intro: t('legal.privacyIntro'),
    sections: [
      { heading: t('legal.privacySectionData'),      body: t('legal.privacyDataBody') },
      { heading: t('legal.privacySectionWhy'),       body: t('legal.privacyWhyBody') },
      { heading: t('legal.privacySectionShare'),     body: t('legal.privacyShareBody') },
      { heading: t('legal.privacySectionRetention'), body: t('legal.privacyRetentionBody') },
      { heading: t('legal.privacySectionRights'),    body: t('legal.privacyRightsBody') },
    ],
  });
}
