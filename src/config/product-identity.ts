/**
 * Centralized Product Identity Configuration (Rename-Ready Foundation)
 *
 * This module is the single typed source of truth for the product identity,
 * brand assets, support contacts, and production domains.
 *
 * When changing the brand name or domain in the future, updating this file
 * automatically propagates throughout UI components, document titles, and runtime metadata.
 */

export interface ProductIdentityLogos {
  /** Standard lockup SVG (navy / dark on light background) */
  readonly standardLockup: string;
  /** Reversed lockup SVG (ivory / white on dark background) */
  readonly reversedLockup: string;
  /** Standalone mark SVG (for narrow screens and favicons) */
  readonly standardMark: string;
  /** Standalone mark SVG reversed */
  readonly reversedMark: string;
  /** SVG Favicon */
  readonly faviconSvg: string;
  /** Raster 32x32 favicon */
  readonly faviconPng32: string;
  /** Raster 48x48 favicon */
  readonly faviconPng48: string;
  /** Apple Touch Icon (180x180) */
  readonly appleTouchIcon: string;
}

export interface ProductIdentitySocialPreview {
  /** Open Graph and Twitter summary card image */
  readonly ogImage: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

export interface ProductIdentity {
  /** The full product brand name (e.g. "Catetin") */
  readonly productName: string;
  /** Short brand name used for badges, mobile labels, and PWA manifest */
  readonly shortName: string;
  /** Dedicated studio or app workspace sub-brand */
  readonly studioName: string;
  /** Localized concise product description */
  readonly productDescription: {
    readonly id: string;
    readonly en: string;
  };
  /** Primary working production domain */
  readonly workingDomain: string;
  /** Production origin URL */
  readonly productionOrigin: string;
  /** Official support and inquiries email */
  readonly supportEmail: string;
  /** Honest legal entity name or operational placeholder */
  readonly legalName: string;
  /** Canonical brand graphic assets */
  readonly logos: ProductIdentityLogos;
  /** Open Graph & social sharing configuration */
  readonly socialPreview: ProductIdentitySocialPreview;
}

/**
 * Current product identity configuration.
 * "Catetin" remains the active working brand.
 */
export const PRODUCT_IDENTITY: ProductIdentity = {
  productName: 'Catetin',
  shortName: 'Catetin',
  studioName: 'Catetin Studio',
  productDescription: {
    id: 'Transkripsikan, sunting, dan kelola rekaman percakapan langsung di perangkat dan cloud.',
    en: 'Transcribe, edit, and organize conversation recordings directly on device and in the cloud.',
  },
  workingDomain: 'catetin.com',
  productionOrigin: 'https://catetin-project.anwars-rizki.workers.dev',
  supportEmail: 'support@catetin.com',
  legalName: 'Catetin Project',
  logos: {
    standardLockup: '/brand/catetin-lockup.svg',
    reversedLockup: '/brand/catetin-lockup-reversed.svg',
    standardMark: '/brand/catetin-mark.svg',
    reversedMark: '/brand/catetin-mark-reversed.svg',
    faviconSvg: '/brand/catetin-mark.svg',
    faviconPng32: '/icons/favicon-32.png',
    faviconPng48: '/icons/favicon-48.png',
    appleTouchIcon: '/icons/apple-touch-icon.png',
  },
  socialPreview: {
    ogImage: '/brand/catetin-og-1200x630.png',
    width: 1200,
    height: 630,
    alt: 'Catetin logo dan transkripsi lokal',
  },
};

/**
 * Helper to format document title consistently across views.
 * Examples:
 *   formatDocumentTitle("Pusat Akun") -> "Pusat Akun · Catetin"
 *   formatDocumentTitle("Dashboard", { isStudio: true }) -> "Dashboard · Catetin Studio"
 *   formatDocumentTitle() -> "Catetin · Transkripsi lokal untuk rekaman Anda"
 */
export function formatDocumentTitle(
  subTitle?: string,
  options?: { isStudio?: boolean; defaultTagline?: string }
): string {
  const brand = options?.isStudio ? PRODUCT_IDENTITY.studioName : PRODUCT_IDENTITY.productName;
  if (!subTitle || !subTitle.trim()) {
    const tagline = options?.defaultTagline || 'Transkripsi lokal untuk rekaman Anda';
    return `${PRODUCT_IDENTITY.productName} · ${tagline}`;
  }
  return `${subTitle.trim()} · ${brand}`;
}
