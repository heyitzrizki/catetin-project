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

  if (markOnly) {
    return (
      <span className={`catetin-brand inline-flex items-center ${className}`}>
        <img
          src={markSrc}
          alt=""
          aria-hidden="true"
          width={height || 28}
          height={height || 28}
          className="brand-mark-img block select-none"
          style={height ? { height: `${height}px`, width: `${height}px` } : undefined}
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
        width={height ? Math.round(height * 3.16) : 95}
        height={height || 30}
        className="brand-lockup-img hidden min-[400px]:block select-none"
        style={height ? { height: `${height}px`, width: 'auto' } : undefined}
        draggable={false}
      />
      {/* Standalone mark for narrow viewports (<400px) */}
      <img
        src={markSrc}
        alt=""
        aria-hidden="true"
        width={height || 28}
        height={height || 28}
        className="brand-mark-img block min-[400px]:hidden select-none"
        style={height ? { height: `${height}px`, width: `${height}px` } : undefined}
        draggable={false}
      />
      {!hasAccessibleParent && <span className="sr-only">Catetin</span>}
    </span>
  );
};
