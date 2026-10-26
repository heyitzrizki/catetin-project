import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { Recording } from '@/lib/transcript';

export function ClosingCTA({ recording, onOpenStudio }: { recording: Recording; onOpenStudio: (sampleId: string) => void }) {
  return <section id="mulai" className="lp-closing page-container" aria-labelledby="closing-title">
    <div className="closing-copy">
      <p className="eyebrow">{t('COBA EDITOR CATETIN')}</p>
      <h2 id="closing-title">{t('Lihat cara Catetin')}<br />{t('merapikan transkrip.')}</h2>
      <p>{t('Mulai dari contoh, kenali alurnya, lalu gunakan rekamanmu sendiri saat siap.')}</p>
      <Button data-primary-cta="true" size="lg" onClick={() => onOpenStudio(recording.id)}>
        {t('Buka contoh di Studio')} <ArrowRight size={16} aria-hidden="true" />
      </Button>
    </div>
    <figure className="closing-illustration">
      <img
        src="/illustrations/closing-cta-editorial-transparent.png"
        alt={t('Pratinjau transkrip Catetin yang sedang disunting')}
        width="1734"
        height="907"
        loading="lazy"
        decoding="async"
      />
    </figure>
  </section>;
}
