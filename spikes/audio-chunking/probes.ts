export type ProbeVerdict = 'bounded' | 'unbounded' | 'unavailable';

export interface AudioPreparationProbeResult {
  browser: { name: string; version: string; os: string };
  deviceClass: 'phone' | 'tablet' | 'desktop' | 'unknown';
  media: {
    codec: string;
    container: string;
    durationSeconds: number;
    fileSizeBytes: number;
  };
  route: string;
  retainsFullFileBytes: boolean;
  retainsFullDecodedPcm: boolean;
  chunkDurationSeconds: number;
  overlapSeconds: number;
  maxSimultaneousNormalizedPcmSeconds: number | null;
  liveNormalizedChunkBuffers: number;
  completed: boolean;
  failureCategory: string | null;
  memory:
    | { status: 'measured'; peakBytes: number }
    | { status: 'unavailable'; reason: string };
}

export function validateProbeResult(result: AudioPreparationProbeResult) {
  const missing: string[] = [];
  if (!result.browser.name.trim()) missing.push('browser.name');
  if (!result.browser.version.trim()) missing.push('browser.version');
  if (!result.browser.os.trim()) missing.push('browser.os');
  if (!result.media.codec.trim()) missing.push('media.codec');
  if (!result.media.container.trim()) missing.push('media.container');
  if (!(result.media.durationSeconds > 0)) missing.push('media.durationSeconds');
  if (!(result.media.fileSizeBytes > 0)) missing.push('media.fileSizeBytes');
  if (!result.route.trim()) missing.push('route');
  if (result.memory.status === 'unavailable' && !(result.memory.reason ?? '').trim()) missing.push('memory.reason');
  if (result.memory.status === 'measured' && !(result.memory.peakBytes > 0)) missing.push('memory.peakBytes');
  return missing;
}

export function evaluateProbeVerdict(result: AudioPreparationProbeResult): ProbeVerdict {
  if (validateProbeResult(result).length || !result.completed || result.memory.status === 'unavailable') return 'unavailable';
  const liveWindow = result.chunkDurationSeconds + result.overlapSeconds;
  if (result.retainsFullFileBytes
    || result.retainsFullDecodedPcm
    || result.liveNormalizedChunkBuffers > 1
    || result.maxSimultaneousNormalizedPcmSeconds === null
    || result.maxSimultaneousNormalizedPcmSeconds > liveWindow) return 'unbounded';
  return 'bounded';
}
