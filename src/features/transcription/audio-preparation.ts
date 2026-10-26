export type PreparationRoute = 'pcm-wav-slice' | 'whole-file-decode';

export type AudioValidationErrorCode =
  | 'empty-file'
  | 'unsupported-format'
  | 'corrupt-wav'
  | 'unsupported-wav-codec'
  | 'unverified-duration'
  | 'exceeds-safe-limit';

export interface WavHeaderInfo {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataByteLength: number;
  durationSeconds: number;
}

export interface AudioInspectionResult {
  valid: boolean;
  route: PreparationRoute | null;
  errorCode: AudioValidationErrorCode | null;
  durationSeconds: number | null;
  maxAllowedBytes: number;
  maxAllowedDurationSeconds: number;
  wavHeader: WavHeaderInfo | null;
}

export interface PreparedAudioChunk {
  chunkId: string;
  sourceIndex: number;
  totalChunks: number;
  sourceStart: number;
  sourceEnd: number;
  overlapStart: number;
  overlapEnd: number;
  samples: Float32Array;
}

export const CHUNK_CORE_SECONDS = 30;
export const CHUNK_OVERLAP_SECONDS = 5;
export const TARGET_SAMPLE_RATE = 16_000;

export const MAX_WAV_SLICE_BYTES = 40 * 1024 * 1024; // 40 MB private-alpha guardrail
export const MAX_WAV_SLICE_DURATION_SECONDS = 1200; // 20 minutes private-alpha guardrail

export const MAX_WHOLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB private-alpha guardrail
export const MAX_WHOLE_FILE_DURATION_SECONDS = 300; // 5 minutes private-alpha guardrail

const SUPPORTED_EXTENSIONS = /\.(wav|mp3|m4a|webm)$/i;
const SUPPORTED_MIME = /^(audio\/(wav|x-wav|wave|mpeg|mp3|mp4|x-m4a|webm)|video\/webm)$/i;

function readAscii(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let i = 0; i < length && offset + i < view.byteLength; i += 1) {
    result += String.fromCharCode(view.getUint8(offset + i));
  }
  return result;
}

export function parseWavHeader(buffer: ArrayBuffer, totalFileByteLength?: number): WavHeaderInfo | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null;

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let fmtFound = false;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;

    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || dataStart + 16 > view.byteLength) return null;
      audioFormat = view.getUint16(dataStart, true);
      channels = view.getUint16(dataStart + 2, true);
      sampleRate = view.getUint32(dataStart + 4, true);
      blockAlign = view.getUint16(dataStart + 12, true);
      bitsPerSample = view.getUint16(dataStart + 14, true);
      fmtFound = true;
    } else if (chunkId === 'data') {
      if (!fmtFound || channels < 1 || sampleRate < 8000 || sampleRate > 192_000) return null;
      const effectiveBlockAlign = blockAlign > 0 ? blockAlign : channels * (bitsPerSample / 8);
      if (effectiveBlockAlign <= 0) return null;
      const availableBytes = totalFileByteLength != null ? Math.max(0, totalFileByteLength - dataStart) : chunkSize;
      const dataByteLength = Math.min(chunkSize, availableBytes);
      const durationSeconds = Math.floor(dataByteLength / effectiveBlockAlign) / sampleRate;
      return { audioFormat, channels, sampleRate, bitsPerSample, blockAlign: effectiveBlockAlign, dataOffset: dataStart, dataByteLength, durationSeconds };
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  return null;
}

export function isSupportedPcm16Wav(header: WavHeaderInfo): boolean {
  return header.audioFormat === 1 && header.bitsPerSample === 16 && (header.channels === 1 || header.channels === 2) && header.dataByteLength > 0;
}

export function isSupportedMediaFormat(name: string, mimeType: string): boolean {
  return SUPPORTED_EXTENSIONS.test(name.trim()) || SUPPORTED_MIME.test(mimeType.trim());
}

export async function probeCompressedDurationSeconds(file: Blob): Promise<number | null> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  const objectUrl = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';

  return new Promise<number | null>(resolve => {
    let settled = false;
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch { /* ignore */ }
      try {
        URL.revokeObjectURL(objectUrl);
      } catch { /* ignore */ }
    };
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 4000);
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      finish(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    audio.onerror = () => finish(null);
    audio.src = objectUrl;
  });
}

export async function inspectAudioFile(
  file: Blob & { name?: string; type?: string },
  options: {
    knownDurationSeconds?: number;
    probeDuration?: (file: Blob) => Promise<number | null>;
  } = {},
): Promise<AudioInspectionResult> {
  const name = file.name ?? 'recording';
  const mimeType = file.type ?? '';

  if (!file || file.size <= 0) {
    return { valid: false, route: null, errorCode: 'empty-file', durationSeconds: null, maxAllowedBytes: MAX_WHOLE_FILE_BYTES, maxAllowedDurationSeconds: MAX_WHOLE_FILE_DURATION_SECONDS, wavHeader: null };
  }
  if (!isSupportedMediaFormat(name, mimeType)) {
    return { valid: false, route: null, errorCode: 'unsupported-format', durationSeconds: null, maxAllowedBytes: MAX_WHOLE_FILE_BYTES, maxAllowedDurationSeconds: MAX_WHOLE_FILE_DURATION_SECONDS, wavHeader: null };
  }

  if (/\.wav$/i.test(name) || /wav/i.test(mimeType)) {
    if (file.size > MAX_WAV_SLICE_BYTES) {
      return { valid: false, route: 'pcm-wav-slice', errorCode: 'exceeds-safe-limit', durationSeconds: null, maxAllowedBytes: MAX_WAV_SLICE_BYTES, maxAllowedDurationSeconds: MAX_WAV_SLICE_DURATION_SECONDS, wavHeader: null };
    }
    const header = parseWavHeader(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer(), file.size);
    if (!header) {
      return { valid: false, route: null, errorCode: 'corrupt-wav', durationSeconds: null, maxAllowedBytes: MAX_WAV_SLICE_BYTES, maxAllowedDurationSeconds: MAX_WAV_SLICE_DURATION_SECONDS, wavHeader: null };
    }
    if (!isSupportedPcm16Wav(header)) {
      return { valid: false, route: null, errorCode: 'unsupported-wav-codec', durationSeconds: header.durationSeconds, maxAllowedBytes: MAX_WAV_SLICE_BYTES, maxAllowedDurationSeconds: MAX_WAV_SLICE_DURATION_SECONDS, wavHeader: header };
    }
    if (header.durationSeconds > MAX_WAV_SLICE_DURATION_SECONDS) {
      return { valid: false, route: 'pcm-wav-slice', errorCode: 'exceeds-safe-limit', durationSeconds: header.durationSeconds, maxAllowedBytes: MAX_WAV_SLICE_BYTES, maxAllowedDurationSeconds: MAX_WAV_SLICE_DURATION_SECONDS, wavHeader: header };
    }
    return { valid: true, route: 'pcm-wav-slice', errorCode: null, durationSeconds: header.durationSeconds, maxAllowedBytes: MAX_WAV_SLICE_BYTES, maxAllowedDurationSeconds: MAX_WAV_SLICE_DURATION_SECONDS, wavHeader: header };
  }

  // Compressed formats (MP3, M4A, WebM): check size BEFORE probing or reading bytes
  if (file.size > MAX_WHOLE_FILE_BYTES) {
    return { valid: false, route: 'whole-file-decode', errorCode: 'exceeds-safe-limit', durationSeconds: null, maxAllowedBytes: MAX_WHOLE_FILE_BYTES, maxAllowedDurationSeconds: MAX_WHOLE_FILE_DURATION_SECONDS, wavHeader: null };
  }

  let duration = Number.isFinite(options.knownDurationSeconds) && (options.knownDurationSeconds ?? 0) > 0
    ? options.knownDurationSeconds!
    : null;

  if (duration === null) {
    const prober = options.probeDuration ?? probeCompressedDurationSeconds;
    duration = await prober(file);
  }

  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    return { valid: false, route: 'whole-file-decode', errorCode: 'unverified-duration', durationSeconds: null, maxAllowedBytes: MAX_WHOLE_FILE_BYTES, maxAllowedDurationSeconds: MAX_WHOLE_FILE_DURATION_SECONDS, wavHeader: null };
  }

  if (duration > MAX_WHOLE_FILE_DURATION_SECONDS) {
    return { valid: false, route: 'whole-file-decode', errorCode: 'exceeds-safe-limit', durationSeconds: duration, maxAllowedBytes: MAX_WHOLE_FILE_BYTES, maxAllowedDurationSeconds: MAX_WHOLE_FILE_DURATION_SECONDS, wavHeader: null };
  }

  return { valid: true, route: 'whole-file-decode', errorCode: null, durationSeconds: duration, maxAllowedBytes: MAX_WHOLE_FILE_BYTES, maxAllowedDurationSeconds: MAX_WHOLE_FILE_DURATION_SECONDS, wavHeader: null };
}

export function decodeAndNormalizeWavSlice(buffer: ArrayBuffer, header: WavHeaderInfo): Float32Array {
  const frameCount = Math.floor(buffer.byteLength / header.blockAlign);
  if (frameCount <= 0) return new Float32Array(0);

  const view = new DataView(buffer);
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * header.blockAlign;
    const left = view.getInt16(offset, true) / 32_768;
    mono[frame] = header.channels === 2 ? (left + view.getInt16(offset + 2, true) / 32_768) * 0.5 : left;
  }

  if (header.sampleRate === TARGET_SAMPLE_RATE) return mono;

  const targetLength = Math.max(1, Math.round((frameCount * TARGET_SAMPLE_RATE) / header.sampleRate));
  const resampled = new Float32Array(targetLength);
  const ratio = header.sampleRate / TARGET_SAMPLE_RATE;
  for (let i = 0; i < targetLength; i += 1) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = mono[Math.min(idx, frameCount - 1)];
    const s1 = mono[Math.min(idx + 1, frameCount - 1)];
    resampled[i] = s0 + (s1 - s0) * frac;
  }
  return resampled;
}

export function buildChunkWindows(durationSeconds: number, coreSeconds = CHUNK_CORE_SECONDS, overlapSeconds = CHUNK_OVERLAP_SECONDS) {
  if (!(durationSeconds > 0)) return [];
  const totalChunks = Math.max(1, Math.ceil(durationSeconds / coreSeconds));
  return Array.from({ length: totalChunks }, (_, index) => {
    const coreStart = index * coreSeconds;
    const sourceStart = index === 0 ? 0 : Math.max(0, coreStart - overlapSeconds);
    return {
      chunkId: `chunk-${index}`,
      sourceIndex: index,
      totalChunks,
      sourceStart,
      sourceEnd: Math.min(durationSeconds, coreStart + coreSeconds),
      overlapStart: index === 0 ? 0 : sourceStart,
      overlapEnd: index === 0 ? 0 : coreStart,
    };
  });
}

export async function* generateWavSliceChunks(file: Blob, header: WavHeaderInfo, startFromChunkIndex = 0): AsyncGenerator<PreparedAudioChunk, void, unknown> {
  const windows = buildChunkWindows(header.durationSeconds);
  const maxFrames = Math.floor(header.dataByteLength / header.blockAlign);
  for (let i = startFromChunkIndex; i < windows.length; i += 1) {
    const win = windows[i];
    const startByte = header.dataOffset + Math.floor(win.sourceStart * header.sampleRate) * header.blockAlign;
    const endByte = header.dataOffset + Math.min(maxFrames, Math.ceil(win.sourceEnd * header.sampleRate)) * header.blockAlign;
    const samples = decodeAndNormalizeWavSlice(await file.slice(startByte, endByte).arrayBuffer(), header);
    yield { ...win, samples };
  }
}

export async function computeInputFingerprint(file: Blob & { name?: string }): Promise<string> {
  const sampleSize = Math.min(file.size, 4096);
  const head = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
  let hash = 2166136261;
  for (const byte of head) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `${file.name ?? 'blob'}:${file.size}:${hash.toString(16)}`;
}
