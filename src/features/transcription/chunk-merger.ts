import type { DialogSegment } from '../../lib/transcript';
import { formatSeconds } from '../../lib/transcript';
import type { TranscriptionLanguage } from './types';

export interface ChunkSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptChunkResult {
  jobId: string;
  chunkId: string;
  sourceIndex: number;
  sourceStart: number;
  sourceEnd: number;
  overlapStart: number;
  overlapEnd: number;
  language: TranscriptionLanguage;
  segments: ChunkSegment[];
}

export interface TranscriptSegment extends ChunkSegment {
  language: TranscriptionLanguage;
  chunkId: string;
}

function normalizeBoundaryText(text: string) {
  return text.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function intersects(start: number, end: number, rangeStart: number, rangeEnd: number) {
  return rangeEnd > rangeStart && start < rangeEnd && end > rangeStart;
}

export function mergeChunkResults(chunks: TranscriptChunkResult[]): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  for (const chunk of [...chunks].sort((a, b) => a.sourceIndex - b.sourceIndex)) {
    for (const source of chunk.segments) {
      const text = source.text.trim();
      if (!text) continue;
      const absoluteStart = Math.max(0, chunk.sourceStart + source.start);
      const absoluteEnd = Math.max(absoluteStart, chunk.sourceStart + source.end);
      const inOverlap = intersects(absoluteStart, absoluteEnd, chunk.overlapStart, chunk.overlapEnd);
      const normalized = normalizeBoundaryText(text);
      const duplicate = inOverlap && merged.some(previous =>
        intersects(previous.start, previous.end, chunk.overlapStart, chunk.overlapEnd)
        && normalizeBoundaryText(previous.text) === normalized,
      );
      if (duplicate) continue;
      const previousEnd = merged.at(-1)?.end ?? 0;
      const start = Math.max(previousEnd, absoluteStart);
      merged.push({ text, start, end: Math.max(start, absoluteEnd), language: chunk.language, chunkId: chunk.chunkId });
    }
  }
  return merged;
}

export function toDialogSegments(segments: TranscriptSegment[]): DialogSegment[] {
  return segments.map((segment, index) => ({
    id: index + 1,
    seconds: segment.start,
    time: formatSeconds(segment.start),
    speaker: 'Pembicara 1',
    text: segment.text.trim(),
  }));
}
