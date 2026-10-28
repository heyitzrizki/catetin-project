import { useEffect } from 'react';

export function useLandingMotion(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let observer: IntersectionObserver | null = null;

    // Check prefers-reduced-motion
    const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduceMotionQuery.matches) {
      return;
    }

    // Tab visibility handling: pause ambient animations when tab is hidden
    const handleVisibilityChange = () => {
      if (document.hidden) {
        document.body.classList.add('tab-hidden');
      } else {
        document.body.classList.remove('tab-hidden');
      }
    };

    // Call immediately on mount
    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });

    // Progressive enhancement: only enable reveal animations if IntersectionObserver is supported
    if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function') {
      try {
        const revealElements = container.querySelectorAll('.scroll-reveal');
        observer = new window.IntersectionObserver(
          (entries, obs) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add('is-revealed');
                // Trigger once: unobserve as soon as it enters viewport
                obs.unobserve(entry.target);
              }
            });
          },
          {
            rootMargin: '0px 0px -40px 0px',
            threshold: 0.1,
          }
        );

        revealElements.forEach((el) => observer!.observe(el));

        // Add enhancement class ONLY after successful setup of observer and observe calls
        container.classList.add('js-reveal-enabled');
      } catch {
        // Fallback: ensure enhancement class is removed and all sections remain visible
        container.classList.remove('js-reveal-enabled');
        const revealElements = container.querySelectorAll('.scroll-reveal');
        revealElements.forEach((el) => {
          el.classList.add('is-revealed');
        });
        if (observer) {
          try {
            observer.disconnect();
          } catch {
            // Ignore disconnect errors during failure recovery
          }
          observer = null;
        }
      }
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.body.classList.remove('tab-hidden');
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          // Ignore disconnect errors during cleanup
        }
        observer = null;
      }
    };
  }, [containerRef]);
}
