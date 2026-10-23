import type { DialogSegment } from './transcript';
import { formatSeconds } from './transcript';

export type ModelSize = 'tiny' | 'base' | 'small';
export type TranscriptionState = {
  phase: 'idle' | 'decoding' | 'model' | 'transcription' | 'complete' | 'error';
  message: string;
  progress: number | null;
};

export async function decodeAudio(file: Blob) {
  const context = new AudioContext({ sampleRate: 16_000 });
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const length = Math.ceil(decoded.duration * 16_000);
    const offline = new OfflineAudioContext(1, length, 16_000);
    const source = offline.createBufferSource();
    const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const output = mono.getChannelData(0);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const input = decoded.getChannelData(channel);
      for (let index = 0; index < input.length; index += 1) output[index] += input[index] / decoded.numberOfChannels;
    }
    source.buffer = mono;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    await context.close();
  }
}

export function toSegments(output: { text: string; chunks?: Array<{ text: string; timestamp: [number | null, number | null] }> }): DialogSegment[] {
  const chunks = output.chunks?.filter(chunk => chunk.text.trim()) ?? [];
  if (!chunks.length && output.text.trim()) return [{ id: 1, seconds: 0, time: '00:00', speaker: 'Pembicara 1', text: output.text.trim() }];
  return chunks.map((chunk, index) => {
    const seconds = Math.max(0, Math.floor(chunk.timestamp?.[0] ?? 0));
    return { id: index + 1, seconds, time: formatSeconds(seconds), speaker: 'Pembicara 1', text: chunk.text.trim() };
  });
}
