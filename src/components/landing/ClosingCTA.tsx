import { Download, FileText, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { Recording } from '@/lib/transcript';

function MiniWaveform() {
  return <div className="closing-wave" aria-hidden="true">{Array.from({ length: 34 }, (_, index) => <i key={index} style={{ height: `${8 + ((index * 13 + index * index) % 26)}px` }} />)}</div>;
}

export function ClosingCTA({ recording, onOpenStudio }: { recording: Recording; onOpenStudio: (sampleId: string) => void }) {
  const segment = recording.segments[0];
  return <section className="lp-closing page-container" aria-labelledby="closing-title">
    <div className="closing-copy">
      <p className="eyebrow">{t('MULAI DARI CONTOH')}</p>
      <h2 id="closing-title">{t('Setiap percakapan')}<br/>{t('layak dicatat.')}</h2>
      <p>{t('Kenali editornya, lalu buka rekamanmu sendiri.')}</p>
      <Button data-primary-cta="true" size="lg" onClick={() => onOpenStudio(recording.id)}>{t('Coba contoh di Studio')}</Button>
    </div>
    <div className="closing-product" aria-label={t('Pratinjau editor Catetin')}>
      <div className="closing-product-bar"><span>catetin</span><span>{t('Contoh naskah')}</span></div>
      <div className="closing-transcript">
        <div className="closing-speaker"><span>{segment.speaker.slice(0, 1)}</span><div><b>{segment.speaker}</b><time>{segment.time}</time></div></div>
        <p>{segment.text.slice(0, Math.max(72, Math.floor(segment.text.length * .65)))} <mark>{segment.text.slice(Math.max(72, Math.floor(segment.text.length * .65)))}</mark></p>
      </div>
      <div className="closing-player"><span className="closing-play" aria-hidden="true"><Play size={15} fill="currentColor"/></span><MiniWaveform/><time>{segment.time}</time></div>
      <div className="closing-export" aria-hidden="true"><Download size={15}/>{['TXT','SRT','DOC'].map(format => <span key={format}><FileText size={13}/>{format}</span>)}</div>
    </div>
  </section>;
}
