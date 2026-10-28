import React from 'react';

export interface CatetinBrandProps {
  /**
   * If true, always renders the standalone mark only.
   * If false/omitted, renders the primary lockup with responsive fallback to mark on narrow viewports (<400px).
   */
  markOnly?: boolean;
  /**
   * If true, uses reversed (ivory/white) palette for dark backgrounds.
   */
  reversed?: boolean;
  /**
   * If true, indicates that the parent element (e.g. an accessible button) already
   * provides the accessible name, omitting the internal sr-only text to prevent duplicate announcements.
   */
  hasAccessibleParent?: boolean;
  className?: string;
  height?: number;
}

export const CatetinBrand: React.FC<CatetinBrandProps> = ({
  markOnly = false,
  reversed = false,
  hasAccessibleParent = false,
  className = '',
  height,
}) => {
  const lockupSrc = reversed
    ? '/brand/catetin-lockup-reversed.svg'
    : '/brand/catetin-lockup.svg';
  const markSrc = reversed
    ? '/brand/catetin-mark-reversed.svg'
    : '/brand/catetin-mark.svg';

  // Desktop default height: 34px (~32-36px range); ratio: 727/230 ≈ 3.16
  const defaultHeight = 34;
  const lockupHeight = height ?? defaultHeight;
  const lockupWidth = Math.round(lockupHeight * 3.16);
  // Mark minimum visual presence is 28px, unless specifically constrained by a smaller height (like footer 22-24px)
  const markSize = height ? Math.max(20, Math.min(height, 28)) : 28;

  if (markOnly) {
    return (
      <span className={`catetin-brand inline-flex items-center ${className}`}>
        <img
          src={markSrc}
          alt=""
          aria-hidden="true"
          width={markSize}
          height={markSize}
          className="brand-mark-img block select-none"
          style={height ? { height: `${markSize}px`, width: `${markSize}px` } : undefined}
          draggable={false}
        />
        {!hasAccessibleParent && <span className="sr-only">Catetin</span>}
      </span>
    );
  }

  return (
    <span className={`catetin-brand inline-flex items-center ${className}`}>
      {/* Primary lockup for desktop & normal viewports (>=400px) */}
      <img
        src={lockupSrc}
        alt=""
        aria-hidden="true"
        width={lockupWidth}
        height={lockupHeight}
        className="brand-lockup-img hidden min-[400px]:block select-none"
        style={height ? { height: `${lockupHeight}px`, width: 'auto' } : undefined}
        draggable={false}
      />
      {/* Standalone mark for narrow viewports (<400px) */}
      <img
        src={markSrc}
        alt=""
        aria-hidden="true"
        width={markSize}
        height={markSize}
        className="brand-mark-img block min-[400px]:hidden select-none"
        style={height ? { height: `${markSize}px`, width: `${markSize}px` } : undefined}
        draggable={false}
      />
      {!hasAccessibleParent && <span className="sr-only">Catetin</span>}
    </span>
  );
};
