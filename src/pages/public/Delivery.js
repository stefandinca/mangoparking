import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { renderLegalPage } from '../../components/core/LegalPageShell.js';

export default function Delivery(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('legal.deliveryTitle')} — Mango Parking`,
    description: locale === 'ro'
      ? 'Politica de livrare digitală a creditelor Mango Parking.'
      : 'Mango Parking digital credit delivery policy.',
    lang: locale,
  });

  renderLegalPage(container, {
    slug: 'delivery',
    title: t('legal.deliveryTitle'),
    intro: t('legal.deliveryIntro'),
    sections: [
      { heading: t('legal.deliverySectionInstant'), body: t('legal.deliveryInstantBody') },
      { heading: t('legal.deliverySectionFailure'), body: t('legal.deliveryFailureBody') },
      { heading: t('legal.deliverySectionService'), body: t('legal.deliveryServiceBody') },
    ],
  });
}
