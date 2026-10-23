import type { TranscriptionBackend, TranscriptionModel } from './types';

export interface DeviceSignals {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  mobile?: boolean;
  formFactor?: 'phone' | 'tablet' | 'desktop';
  viewportWidth?: number;
}

export type DeviceClass = 'phone' | 'tablet' | 'desktop' | 'unknown';
export interface DeviceClassification { class: DeviceClass; reason: string }
export interface WebGpuResult { available: boolean; reason: 'missing-api' | 'adapter-unavailable' | 'adapter-ready' | 'adapter-error' }
export interface CapabilityReport { device: DeviceClassification; webGpu: WebGpuResult }

export function classifyDevice(signals: DeviceSignals): DeviceClassification {
  if (signals.formFactor) return { class: signals.formFactor, reason: 'form-factor-hint' };
  const ua = signals.userAgent.toLowerCase();
  const platform = signals.platform.toLowerCase();
  if (platform === 'macintel' && signals.maxTouchPoints > 1) return { class: 'tablet', reason: 'ipados-desktop-mode' };
  if (signals.mobile === true || /iphone|android.+mobile|mobile/.test(ua)) return { class: 'phone', reason: 'mobile-signal' };
  if (/ipad|tablet/.test(ua)) return { class: 'tablet', reason: 'tablet-signal' };
  if (/foldable/.test(ua)) return { class: 'phone', reason: 'ambiguous-handheld' };
  if (/win|mac|linux/.test(platform) && (/win|macintosh|x11|linux/.test(ua))) return { class: 'desktop', reason: 'desktop-platform' };
  if (signals.maxTouchPoints > 1) return { class: 'phone', reason: 'ambiguous-touch-device' };
  return { class: 'unknown', reason: 'unrecognized' };
}

export async function verifyWebGpu(gpu?: { requestAdapter: () => Promise<unknown> }): Promise<WebGpuResult> {
  if (!gpu) return { available: false, reason: 'missing-api' };
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? { available: true, reason: 'adapter-ready' } : { available: false, reason: 'adapter-unavailable' };
  } catch {
    return { available: false, reason: 'adapter-error' };
  }
}

export interface CapabilityPolicy {
  allowedModels: TranscriptionModel[];
  recommendedModel: TranscriptionModel;
  preferredBackend: TranscriptionBackend;
  fallbackBackend: TranscriptionBackend | null;
  reasons: string[];
}

export function createCapabilityPolicy(report: CapabilityReport): CapabilityPolicy {
  const conservative = report.device.class === 'phone' || report.device.class === 'unknown';
  return {
    allowedModels: conservative ? ['tiny'] : ['tiny', 'base', 'small'],
    recommendedModel: conservative ? 'tiny' : 'base',
    preferredBackend: report.webGpu.available ? 'webgpu' : 'wasm',
    fallbackBackend: report.webGpu.available ? 'wasm' : null,
    reasons: [report.device.reason, report.webGpu.reason],
  };
}
