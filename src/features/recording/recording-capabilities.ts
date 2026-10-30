import type { BrowserCapabilities } from './recording-types';

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
];

export function checkRecordingCapabilities(env: {
  isSecureContext?: boolean;
  hasMediaDevices?: boolean;
  hasMediaRecorder?: boolean;
  isTypeSupported?: (mime: string) => boolean;
} = {}): BrowserCapabilities {
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

  if (!hasMediaDevices) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: false,
      hasMediaRecorder,
      selectedMimeType: null,
      reason: 'Perangkat penangkap audio (navigator.mediaDevices.getUserMedia) tidak didukung oleh browser ini.',
    };
  }

  if (!hasMediaRecorder) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: true,
      hasMediaRecorder: false,
      selectedMimeType: null,
      reason: 'MediaRecorder API tidak tersedia pada browser ini.',
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
      reason: 'Browser ini tidak mendukung format container WebM Opus lokal yang diperlukan untuk perekaman rapat.',
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
