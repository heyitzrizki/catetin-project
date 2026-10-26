import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_WAV_SLICE_BYTES,
  MAX_WAV_SLICE_DURATION_SECONDS,
  MAX_WHOLE_FILE_BYTES,
  MAX_WHOLE_FILE_DURATION_SECONDS,
  buildChunkWindows,
  decodeAndNormalizeWavSlice,
  generateWavSliceChunks,
  inspectAudioFile,
  parseWavHeader,
  probeCompressedDurationSeconds,
} from '../../src/features/transcription/audio-preparation';

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function createPcmWavBlob(options: {
  durationSeconds: number;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  audioFormat?: number;
  name?: string;
}): Blob & { name: string; type: string } {
  const sampleRate = options.sampleRate ?? 16_000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const audioFormat = options.audioFormat ?? 1;
  const blockAlign = channels * (bitsPerSample / 8);
  const totalFrames = Math.floor(options.durationSeconds * sampleRate);
  const dataByteLength = totalFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  const blob = new Blob([buffer], { type: 'audio/wav' }) as Blob & { name: string; type: string };
  Object.defineProperty(blob, 'name', { value: options.name ?? 'sample.wav' });
  return blob;
}

test('parses valid 16-bit PCM WAV header and enforces 40MB / 20min guardrail', async () => {
  const wav = createPcmWavBlob({ durationSeconds: 65 });
  const result = await inspectAudioFile(wav);
  assert.equal(result.valid, true);
  assert.equal(result.route, 'pcm-wav-slice');
  assert.equal(result.durationSeconds, 65);
  assert.equal(result.maxAllowedBytes, MAX_WAV_SLICE_BYTES);
  assert.equal(result.maxAllowedDurationSeconds, MAX_WAV_SLICE_DURATION_SECONDS);

  const overDurationWav = createPcmWavBlob({ durationSeconds: 1201 });
  assert.equal((await inspectAudioFile(overDurationWav)).errorCode, 'exceeds-safe-limit');
});

test('rejects non-16-bit WAV layouts and OGG/FLAC formats', async () => {
  const wav24 = createPcmWavBlob({ durationSeconds: 5, bitsPerSample: 24 });
  assert.equal((await inspectAudioFile(wav24)).errorCode, 'unsupported-wav-codec');

  const flac = new Blob([new Uint8Array(128)], { type: 'audio/flac' }) as Blob & { name: string };
  Object.defineProperty(flac, 'name', { value: 'sample.flac' });
  assert.equal((await inspectAudioFile(flac)).errorCode, 'unsupported-format');
});

test('generates bounded 30s core + 5s overlap chunks from PCM WAV via Blob.slice', async () => {
  const wav = createPcmWavBlob({ durationSeconds: 65 });
  const header = parseWavHeader(await wav.slice(0, 128).arrayBuffer(), wav.size)!;
  const chunks = [];
  for await (const chunk of generateWavSliceChunks(wav, header)) {
    chunks.push({ id: chunk.chunkId, start: chunk.sourceStart, end: chunk.sourceEnd, len: chunk.samples.length });
  }
  assert.deepEqual(chunks, [
    { id: 'chunk-0', start: 0, end: 30, len: 30 * 16_000 },
    { id: 'chunk-1', start: 25, end: 60, len: 35 * 16_000 },
    { id: 'chunk-2', start: 55, end: 65, len: 10 * 16_000 },
  ]);
});

test('downmixes stereo 48kHz 16-bit WAV slice to 16kHz mono Float32Array', async () => {
  const wav = createPcmWavBlob({ durationSeconds: 1, sampleRate: 48_000, channels: 2 });
  const full = await wav.arrayBuffer();
  const header = parseWavHeader(full, wav.size)!;
  const normalized = decodeAndNormalizeWavSlice(full.slice(header.dataOffset), header);
  assert.equal(normalized.length, 16_000);
});

test('validates compressed MP3, M4A, and WebM size and duration before decode and fails safely if duration is unverified', async () => {
  for (const [name, type] of [['short.mp3', 'audio/mpeg'], ['short.m4a', 'audio/mp4'], ['short.webm', 'audio/webm']] as const) {
    let arrayBufferCalled = false;
    const file = new Blob([new Uint8Array(1024)], { type }) as Blob & { name: string };
    Object.defineProperty(file, 'name', { value: name });
    file.arrayBuffer = async () => {
      arrayBufferCalled = true;
      return new ArrayBuffer(0);
    };

    // Valid when duration is verified <= 300s (5 min)
    const ok = await inspectAudioFile(file, { probeDuration: async () => 120 });
    assert.equal(ok.valid, true);
    assert.equal(ok.route, 'whole-file-decode');
    assert.equal(ok.maxAllowedBytes, MAX_WHOLE_FILE_BYTES);
    assert.equal(ok.maxAllowedDurationSeconds, MAX_WHOLE_FILE_DURATION_SECONDS);
    assert.equal(arrayBufferCalled, false);

    // Rejects when duration > 300s (5 min) without calling arrayBuffer
    const overDur = await inspectAudioFile(file, { probeDuration: async () => 301 });
    assert.equal(overDur.valid, false);
    assert.equal(overDur.errorCode, 'exceeds-safe-limit');
    assert.equal(arrayBufferCalled, false);

    // Rejects safely when duration cannot be determined before decode
    const unverified = await inspectAudioFile(file, { probeDuration: async () => null });
    assert.equal(unverified.valid, false);
    assert.equal(unverified.errorCode, 'unverified-duration');
    assert.equal(arrayBufferCalled, false);
  }

  // Rejects compressed file over 10 MB before even probing duration
  let probeCalled = false;
  const hugeMp3 = {
    name: 'huge.mp3',
    type: 'audio/mpeg',
    size: MAX_WHOLE_FILE_BYTES + 1,
    arrayBuffer: async () => { throw new Error('must not read bytes'); },
  } as unknown as Blob & { name: string; type: string };
  const overSize = await inspectAudioFile(hugeMp3, {
    probeDuration: async () => { probeCalled = true; return 60; },
  });
  assert.equal(overSize.valid, false);
  assert.equal(overSize.errorCode, 'exceeds-safe-limit');
  assert.equal(probeCalled, false);

  assert.deepEqual(buildChunkWindows(0), []);
});

test('probeCompressedDurationSeconds revokes object URL and cleans up audio element after metadata probe', async () => {
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  let removedSrc = false;
  let loadCalled = false;

  const origDoc = globalThis.document;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;

  URL.createObjectURL = () => {
    const url = `blob:mock-${createdUrls.length + 1}`;
    createdUrls.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revokedUrls.push(url);
  };
  (globalThis as any).document = {
    createElement: (tag: string) => {
      assert.equal(tag, 'audio');
      const el: any = {
        preload: '',
        duration: 180,
        onloadedmetadata: null,
        onerror: null,
        removeAttribute: (attr: string) => { if (attr === 'src') removedSrc = true; },
        load: () => { loadCalled = true; },
      };
      Object.defineProperty(el, 'src', {
        set() {
          queueMicrotask(() => el.onloadedmetadata?.());
        },
      });
      return el;
    },
  };

  try {
    const file = new Blob([new Uint8Array(64)], { type: 'audio/mpeg' });
    const duration = await probeCompressedDurationSeconds(file);
    assert.equal(duration, 180);
    assert.equal(createdUrls.length, 1);
    assert.deepEqual(revokedUrls, createdUrls);
    assert.equal(removedSrc, true);
    assert.equal(loadCalled, true);
  } finally {
    (globalThis as any).document = origDoc;
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  }
});
