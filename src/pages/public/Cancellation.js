import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { renderLegalPage } from '../../components/core/LegalPageShell.js';

export default function Cancellation(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('legal.cancellationTitle')} — Mango Parking`,
    description: locale === 'ro'
      ? 'Politica de anulare și retur, incluzând dreptul de retragere de 14 zile.'
      : 'Cancellation and refund policy, including the 14-day right of withdrawal.',
    lang: locale,
  });

  renderLegalPage(container, {
    slug: 'cancellation',
    title: t('legal.cancellationTitle'),
    intro: t('legal.cancellationIntro'),
    sections: [
      { heading: t('legal.cancellationSectionHow'),        body: t('legal.cancellationHowBody') },
      { heading: t('legal.cancellationSectionRefund'),     body: t('legal.cancellationRefundBody') },
      { heading: t('legal.cancellationSectionExceptions'), body: t('legal.cancellationExceptionsBody') },
      { heading: t('legal.cancellationSectionDispute'),    body: t('legal.cancellationDisputeBody') },
    ],
  });
}
