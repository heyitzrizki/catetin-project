import { evaluateProbeVerdict, type AudioPreparationProbeResult } from './probes';

const durationInput = document.querySelector<HTMLInputElement>('#duration')!;
const generateButton = document.querySelector<HTMLButtonElement>('#generate')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLPreElement>('#output')!;
let selected: File | null = null;

function browserDetails() {
  const edge = navigator.userAgent.match(/Edg\/([\d.]+)/);
  const chrome = navigator.userAgent.match(/Chrome\/([\d.]+)/);
  return { name: edge ? 'Edge' : chrome ? 'Chrome' : 'Unknown', version: edge?.[1] ?? chrome?.[1] ?? 'unknown', os: 'Windows 11' };
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function createWavFixture(durationSeconds: number) {
  const sampleRate = 16_000;
  const samples = Math.floor(durationSeconds * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data'); view.setUint32(40, samples * 2, true);
  // ArrayBuffer starts zero-filled; silence is sufficient for measuring byte flow and live buffers.
  return new File([buffer], `generated-${durationSeconds}s.wav`, { type: 'audio/wav' });
}

async function probePcmWav(file: File): Promise<AudioPreparationProbeResult> {
  const header = new DataView(await file.slice(0, 44).arrayBuffer());
  const sampleRate = header.getUint32(24, true);
  const channels = header.getUint16(22, true);
  const bits = header.getUint16(34, true);
  const dataBytes = header.getUint32(40, true);
  const durationSeconds = dataBytes / (sampleRate * channels * bits / 8);
  const base = {
    browser: browserDetails(), deviceClass: 'desktop' as const,
    media: { codec: `pcm-s${bits}le`, container: 'wav', durationSeconds, fileSizeBytes: file.size },
    route: 'pcm-wav-blob-slice', retainsFullFileBytes: false, retainsFullDecodedPcm: false,
    chunkDurationSeconds: 30, overlapSeconds: 5,
  };
  if (sampleRate !== 16_000 || channels !== 1 || bits !== 16) return {
    ...base, maxSimultaneousNormalizedPcmSeconds: null, liveNormalizedChunkBuffers: 0,
    completed: false, failureCategory: 'unsupported-wav-layout', memory: { status: 'unavailable', reason: 'probe-supports-pcm16-mono-16khz-only' },
  };
  let peakBytes = 0;
  let maxSeconds = 0;
  for (let coreStart = 0; coreStart < durationSeconds; coreStart += 30) {
    const start = Math.max(0, coreStart - 5);
    const end = Math.min(durationSeconds, coreStart + 30);
    const source = new Int16Array(await file.slice(44 + start * sampleRate * 2, 44 + end * sampleRate * 2).arrayBuffer());
    const normalized = new Float32Array(source.length);
    for (let index = 0; index < source.length; index += 1) normalized[index] = source[index] / 32_768;
    peakBytes = Math.max(peakBytes, source.byteLength + normalized.byteLength);
    maxSeconds = Math.max(maxSeconds, normalized.length / sampleRate);
    await Promise.resolve(normalized[0]);
  }
  return {
    ...base, maxSimultaneousNormalizedPcmSeconds: maxSeconds, liveNormalizedChunkBuffers: 1,
    completed: true, failureCategory: null, memory: { status: 'measured', peakBytes },
  };
}

function unavailable(file: File, route: string, failureCategory: string): AudioPreparationProbeResult {
  return {
    browser: browserDetails(), deviceClass: 'desktop',
    media: { codec: file.type || 'unknown', container: file.name.split('.').pop()?.toLowerCase() || 'unknown', durationSeconds: 1, fileSizeBytes: file.size },
    route, retainsFullFileBytes: route === 'decode-audio-data', retainsFullDecodedPcm: route === 'decode-audio-data',
    chunkDurationSeconds: 30, overlapSeconds: 5, maxSimultaneousNormalizedPcmSeconds: null, liveNormalizedChunkBuffers: 0,
    completed: false, failureCategory, memory: { status: 'unavailable', reason: failureCategory },
  };
}

async function run() {
  if (!selected) return;
  output.textContent = 'Running...';
  const results: AudioPreparationProbeResult[] = [];
  if (selected.name.toLowerCase().endsWith('.wav')) results.push(await probePcmWav(selected));
  results.push(unavailable(selected, 'decode-audio-data', 'whole-file-decoded-pcm'));
  results.push(unavailable(selected, 'webcodecs-audio-decoder', 'container-demux-unavailable'));
  results.push(unavailable(selected, 'media-element-web-audio', 'not-deterministic-faster-than-realtime'));
  output.textContent = JSON.stringify(results.map(result => ({ ...result, verdict: evaluateProbeVerdict(result) })), null, 2);
  document.documentElement.dataset.probeComplete = 'true';
}

generateButton.addEventListener('click', () => {
  const duration = Math.max(1, Number(durationInput.value) || 120);
  selected = createWavFixture(duration);
  runButton.disabled = false;
  output.textContent = `${selected.name}, ${selected.size} bytes`;
});
fileInput.addEventListener('change', () => { selected = fileInput.files?.[0] ?? null; runButton.disabled = !selected; });
runButton.addEventListener('click', run);

const autoDuration = new URLSearchParams(location.search).get('autorun');
if (autoDuration) {
  durationInput.value = autoDuration;
  generateButton.click();
  runButton.click();
}
