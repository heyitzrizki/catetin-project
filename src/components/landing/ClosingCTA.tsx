import { useRef, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { Recording } from '@/lib/transcript';

export function ClosingCTA({
  recording,
  onOpenStudio,
}: {
  recording: Recording;
  onOpenStudio: (sampleId: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof window === 'undefined') return;

    // Only enable parallax for fine pointer (desktop mouse), disabled on touch & reduced motion
    const isFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!isFinePointer || isReducedMotion) return;

    const img = section.querySelector('.closing-illustration img') as HTMLElement | null;
    if (!img) return;

    let rafId: number | null = null;
    let targetX = 0;
    let targetY = 0;

    const handlePointerMove = (e: PointerEvent) => {
      // Do not update transform when tab is hidden
      if (typeof document !== 'undefined' && document.hidden) return;

      const rect = section.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) / rect.width - 0.5;
      const relativeY = (e.clientY - rect.top) / rect.height - 0.5;

      // Max subtle depth/parallax 10-12px
      targetX = Math.round(Math.max(-10, Math.min(10, relativeX * 20)));
      targetY = Math.round(Math.max(-8, Math.min(8, relativeY * 16)));

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (typeof document !== 'undefined' && document.hidden) return;
          if (img) {
            img.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
          }
        });
      }
    };

    const handlePointerLeave = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (img) {
        img.style.transform = 'translate3d(0, 0, 0)';
      }
    };

    section.addEventListener('pointermove', handlePointerMove, { passive: true });
    section.addEventListener('pointerleave', handlePointerLeave, { passive: true });

    return () => {
      section.removeEventListener('pointermove', handlePointerMove);
      section.removeEventListener('pointerleave', handlePointerLeave);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="mulai"
      className="lp-closing page-container scroll-reveal"
      aria-labelledby="closing-title"
    >
      <div className="closing-copy scroll-reveal-child-copy">
        <p className="eyebrow">{t('COBA EDITOR CATETIN')}</p>
        <h2 id="closing-title">
          {t('Lihat cara Catetin')}
          <br />
          {t('merapikan transkrip.')}
        </h2>
        <p>
          {t(
            'Mulai dari contoh, kenali alurnya, lalu gunakan rekamanmu sendiri saat siap.'
          )}
        </p>
        <Button
          data-primary-cta="true"
          size="lg"
          onClick={() => onOpenStudio(recording.id)}
        >
          {t('Buka contoh di Studio')}{' '}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
      <figure className="closing-illustration scroll-reveal-child-illustration">
        <img
          src="/illustrations/closing-cta-editorial-transparent.png"
          alt={t('Pratinjau transkrip Catetin yang sedang disunting')}
          width={1734}
          height={907}
          loading="lazy"
          decoding="async"
        />
      </figure>
    </section>
  );
}
