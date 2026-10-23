import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeChunkResults, toDialogSegments, type TranscriptChunkResult } from '../../src/features/transcription/chunk-merger';

function chunk(overrides: Partial<TranscriptChunkResult>): TranscriptChunkResult {
  return {
    jobId: 'job-1', chunkId: 'chunk-0', sourceIndex: 0,
    sourceStart: 0, sourceEnd: 30, overlapStart: 0, overlapEnd: 0,
    language: 'id', segments: [], ...overrides,
  };
}

test('offsets local timestamps and orders chunks by source index', () => {
  const result = mergeChunkResults([
    chunk({ chunkId: 'chunk-1', sourceIndex: 1, sourceStart: 25, sourceEnd: 55, overlapStart: 25, overlapEnd: 30, segments: [{ text: 'Bagian kedua', start: 5, end: 9 }] }),
    chunk({ segments: [{ text: 'Bagian pertama', start: 2.25, end: 4.5 }] }),
  ]);
  assert.deepEqual(result.map(({ text, start, end }) => ({ text, start, end })), [
    { text: 'Bagian pertama', start: 2.25, end: 4.5 },
    { text: 'Bagian kedua', start: 30, end: 34 },
  ]);
});

test('removes normalized duplicate phrases only inside declared overlap', () => {
  const result = mergeChunkResults([
    chunk({ sourceEnd: 30, segments: [{ text: 'Kami mulai dari sini.', start: 24, end: 29 }] }),
    chunk({ chunkId: 'chunk-1', sourceIndex: 1, sourceStart: 25, sourceEnd: 55, overlapStart: 25, overlapEnd: 30, segments: [
      { text: '  kami mulai dari sini ', start: 0, end: 4 },
      { text: 'Lalu pembahasan berlanjut.', start: 5, end: 8 },
      { text: 'Kami mulai dari sini.', start: 12, end: 15 },
    ] }),
  ]);
  assert.deepEqual(result.map(item => item.text), [
    'Kami mulai dari sini.',
    'Lalu pembahasan berlanjut.',
    'Kami mulai dari sini.',
  ]);
});

test('drops blank segments and keeps timestamps non-negative and monotonic', () => {
  const result = mergeChunkResults([chunk({ segments: [
    { text: ' ', start: 0, end: 1 },
    { text: 'Pertama', start: -0.000001, end: 2 },
    { text: 'Kedua', start: 1.999999, end: 1.5 },
  ] })]);
  assert.deepEqual(result, [
    { text: 'Pertama', start: 0, end: 2, language: 'id', chunkId: 'chunk-0' },
    { text: 'Kedua', start: 2, end: 2, language: 'id', chunkId: 'chunk-0' },
  ]);
});

test('converts merged segments to the existing editor contract', () => {
  const result = toDialogSegments([
    { text: ' Halo ', start: 12.8, end: 15.1, language: 'id', chunkId: 'chunk-0' },
    { text: 'Dunia', start: 61.2, end: 62, language: 'id', chunkId: 'chunk-1' },
  ]);
  assert.deepEqual(result, [
    { id: 1, seconds: 12.8, time: '00:12', speaker: 'Pembicara 1', text: 'Halo' },
    { id: 2, seconds: 61.2, time: '01:01', speaker: 'Pembicara 1', text: 'Dunia' },
  ]);
});
