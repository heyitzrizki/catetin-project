import React, { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';

interface AudioLevelMeterProps {
  stream: MediaStream | null;
  className?: string;
  isPaused?: boolean;
}

/**
 * Resilient, accessible audio level meter.
 * Uses local AnalyserNode for visual feedback without affecting recording data.
 * Halts requestAnimationFrame and reduced-motion timeout loops when unmounted
 * or when the page is hidden. Honors prefers-reduced-motion.
 */
export const AudioLevelMeter: React.FC<AudioLevelMeterProps> = ({
  stream,
  className = '',
  isPaused = false,
}) => {
  const [level, setLevel] = useState(0);
  const [hasSound, setHasSound] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });
  const rafIdRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHiddenRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener?.('change', handler);
      return () => mediaQuery.removeEventListener?.('change', handler);
    }
  }, []);

  useEffect(() => {
    const cancelScheduledTick = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };

    if (!stream || isPaused) {
      cancelScheduledTick();
      setLevel(0);
      setHasSound(false);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let isCancelled = false;
    let updateMeter: (() => void) | null = null;

    isHiddenRef.current = Boolean(
      typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')
    );

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      audioCtx = new AudioCtxClass();
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      updateMeter = () => {
        rafIdRef.current = null;
        const currentlyHidden = Boolean(
          typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')
        );
        isHiddenRef.current = currentlyHidden;

        if (isCancelled || currentlyHidden) {
          return;
        }

        if (analyser) {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const avg = sum / bufferLength;
          // Normalize to 0 - 1
          const normalized = Math.min(1, Math.max(0, avg / 128));
          setLevel(normalized);
          setHasSound(normalized > 0.05);
        }

        if (isCancelled || isHiddenRef.current || document.visibilityState === 'hidden') {
          return;
        }

        // Reduced motion: throttle to ~100ms instead of 60fps RAF
        if (prefersReducedMotion) {
          timeoutIdRef.current = setTimeout(() => {
            timeoutIdRef.current = null;
            if (
              isCancelled ||
              isHiddenRef.current ||
              document.hidden ||
              document.visibilityState === 'hidden' ||
              !updateMeter
            ) {
              return;
            }
            rafIdRef.current = requestAnimationFrame(updateMeter);
          }, 100);
        } else if (updateMeter) {
          rafIdRef.current = requestAnimationFrame(updateMeter);
        }
      };

      if (!isHiddenRef.current) {
        rafIdRef.current = requestAnimationFrame(updateMeter);
      }
    } catch {
      // AudioContext may fail in restricted environments
    }

    const handleVisibilityChange = () => {
      const hidden = Boolean(document.hidden || document.visibilityState === 'hidden');
      isHiddenRef.current = hidden;
      if (hidden) {
        cancelScheduledTick();
      } else if (
        !isCancelled &&
        rafIdRef.current === null &&
        timeoutIdRef.current === null &&
        updateMeter
      ) {
        rafIdRef.current = requestAnimationFrame(updateMeter);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelScheduledTick();
      try {
        source?.disconnect();
        analyser?.disconnect();
        if (audioCtx && audioCtx.state !== 'closed') {
          void audioCtx.close();
        }
      } catch {
        // ignore cleanup error
      }
    };
  }, [stream, isPaused, prefersReducedMotion]);

  // Number of segment bars to display
  const totalBars = 12;
  const activeBars = Math.round(level * totalBars);

  return (
    <div
      className={`audio-level-meter flex items-center gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] ${className}`}
      role="group"
      aria-label={t('Level audio input')}
    >
      <div className="flex items-center gap-1 flex-1 h-3" aria-hidden="true">
        {Array.from({ length: totalBars }).map((_, i) => {
          const isActive = i < activeBars;
          return (
            <div
              key={i}
              className={`flex-1 h-full rounded-xs transition-colors ${
                isActive
                  ? i > 9
                    ? 'bg-amber-500'
                    : 'bg-emerald-600 dark:bg-emerald-500'
                  : 'bg-[var(--muted)] opacity-40'
              }`}
            />
          );
        })}
      </div>
      <span className="text-[11px] font-medium text-[var(--muted-foreground)] w-28 text-right truncate">
        {hasSound ? t('Suara terdeteksi') : t('Suara tidak terdeteksi')}
      </span>
    </div>
  );
};
