import type { BrowserCapabilities } from './recording-types';

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
];

export interface NavigatorUABrandVersion {
  brand: string;
  version?: string;
}

export interface NavigatorUADataLike {
  brands?: NavigatorUABrandVersion[];
  mobile?: boolean;
  platform?: string;
}

export interface RecordingCapabilityEnv {
  isSecureContext?: boolean;
  hasMediaDevices?: boolean;
  hasMediaRecorder?: boolean;
  isTypeSupported?: (mime: string) => boolean;
  userAgentData?: NavigatorUADataLike | null;
  userAgent?: string;
  vendor?: string;
}

const CHROMIUM_BRAND_PATTERN = /Chrom(ium|e)|Google Chrome|Microsoft Edge|Brave|Opera|Vivaldi/i;
const CHROMIUM_UA_PATTERN = /(?:Chrome|Chromium|Edg|OPR|Brave)\/\d+/i;
const FIREFOX_OR_GECKO_PATTERN = /(?:Firefox|FxiOS)\/\d+/i;
const MOBILE_UA_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function isChromiumDesktopBrowser(env: RecordingCapabilityEnv = {}): boolean {
  const hasNav = typeof navigator !== 'undefined';
  const uaData: NavigatorUADataLike | null | undefined =
    env.userAgentData !== undefined
      ? env.userAgentData
      : hasNav
        ? ((navigator as any).userAgentData as NavigatorUADataLike | undefined)
        : undefined;

  const ua =
    env.userAgent !== undefined
      ? env.userAgent
      : hasNav && typeof navigator.userAgent === 'string'
        ? navigator.userAgent
        : '';

  // Reject mobile or Firefox immediately from UA if present
  if (ua && (MOBILE_UA_PATTERN.test(ua) || FIREFOX_OR_GECKO_PATTERN.test(ua))) {
    return false;
  }

  // 1. Primary check via structured User-Agent Client Hints (navigator.userAgentData)
  if (uaData) {
    if (uaData.mobile === true) {
      return false;
    }
    if (Array.isArray(uaData.brands) && uaData.brands.length > 0) {
      const hasChromiumBrand = uaData.brands.some(b => CHROMIUM_BRAND_PATTERN.test(b.brand));
      if (!hasChromiumBrand) {
        return false;
      }
      return true;
    }
  }

  // 2. Fallback check via userAgent & vendor evidence when userAgentData is unavailable
  if (!ua) {
    return false;
  }

  // Safari-only user agents have Version/... Safari/... without Chrome/Chromium/Edg
  if (!CHROMIUM_UA_PATTERN.test(ua)) {
    return false;
  }

  const vendor =
    env.vendor !== undefined
      ? env.vendor
      : hasNav && typeof navigator.vendor === 'string'
        ? navigator.vendor
        : '';

  if (vendor && /Apple Computer/i.test(vendor)) {
    return false;
  }

  return true;
}

export function checkRecordingCapabilities(env: RecordingCapabilityEnv = {}): BrowserCapabilities {
  const isSecure = env.isSecureContext ?? (typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false);
  const hasNav = typeof navigator !== 'undefined';
  const hasMediaDevices = env.hasMediaDevices ?? (hasNav && Boolean(navigator.mediaDevices?.getUserMedia));
  const hasMediaRecorder = env.hasMediaRecorder ?? (typeof MediaRecorder !== 'undefined');

  if (!isSecure) {
    return {
      supported: false,
      isSecureContext: false,
      hasMediaDevices,
      hasMediaRecorder,
      selectedMimeType: null,
      reason: 'Perekaman mikrofon memerlukan konteks aman (HTTPS atau localhost).',
    };
  }

  if (!isChromiumDesktopBrowser(env)) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices,
      hasMediaRecorder,
      selectedMimeType: null,
      reason: 'Perekaman lokal belum didukung di peramban ini pada tahap awal. Gunakan Chrome, Edge, atau peramban berbasis Chromium desktop.',
    };
  }

  if (!hasMediaDevices) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: false,
      hasMediaRecorder,
      selectedMimeType: null,
      reason: 'Perangkat penangkap audio (navigator.mediaDevices.getUserMedia) tidak tersedia di peramban ini.',
    };
  }

  if (!hasMediaRecorder) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: true,
      hasMediaRecorder: false,
      selectedMimeType: null,
      reason: 'MediaRecorder API tidak tersedia di peramban ini.',
    };
  }

  // Probe MIME support
  const isTypeSupportedFn = env.isTypeSupported ?? (
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? (m: string) => MediaRecorder.isTypeSupported(m)
      : () => false
  );

  let selectedMimeType: string | null = null;
  for (const mime of PREFERRED_MIME_TYPES) {
    try {
      if (isTypeSupportedFn(mime)) {
        selectedMimeType = mime;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (!selectedMimeType) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: true,
      hasMediaRecorder: true,
      selectedMimeType: null,
      reason: 'Format perekaman WebM Opus lokal belum tersedia pada peramban ini.',
    };
  }

  return {
    supported: true,
    isSecureContext: true,
    hasMediaDevices: true,
    hasMediaRecorder: true,
    selectedMimeType,
    reason: null,
  };
}
