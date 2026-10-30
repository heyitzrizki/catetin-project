import { formatSeconds, type DialogSegment } from '../../lib/transcript';
import type { RecordingStore } from './recording-store';
import type { TranscriptionSegmentRecord } from './recording-types';

export interface TokenInfo {
  raw: string;
  normalized: string;
}

export function tokenize(text: string): TokenInfo[] {
  if (!text.trim()) return [];
  // Split on whitespace while preserving raw words
  const words = text.trim().split(/\s+/);
  return words.map(w => ({
    raw: w,
    normalized: w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').trim(),
  })).filter(t => t.normalized.length > 0);
}

/**
 * Deduplicates boundary speech across finalized segments using longest token suffix-prefix matching.
 * Strictly bounded to the boundary region: natural repetitions outside the boundary are preserved.
 */
export function deduplicateCrossSegmentBoundary(
  textA: string,
  textB: string,
  maxOverlapTokens = 12
): { dedupedTextB: string; matchedTokens: string[] } {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.length === 0 || tokensB.length === 0) {
    return { dedupedTextB: textB, matchedTokens: [] };
  }

  // Look at suffix of A (up to maxOverlapTokens)
  const suffixCandidate = tokensA.slice(-maxOverlapTokens);
  // Look at prefix of B (up to maxOverlapTokens)
  const prefixCandidate = tokensB.slice(0, maxOverlapTokens);

  const maxK = Math.min(suffixCandidate.length, prefixCandidate.length);
  let bestK = 0;

  // Search for the longest matching sequence of tokens
  for (let k = maxK; k >= 1; k--) {
    const aSlice = suffixCandidate.slice(-k).map(t => t.normalized);
    const bSlice = prefixCandidate.slice(0, k).map(t => t.normalized);

    const matches = aSlice.every((token, idx) => token === bSlice[idx]);
    if (matches) {
      bestK = k;
      break;
    }
  }

  if (bestK === 0) {
    return { dedupedTextB: textB, matchedTokens: [] };
  }

  // Matched tokens
  const matchedTokens = prefixCandidate.slice(0, bestK).map(t => t.raw);

  // Remove the first bestK tokens from textB
  const rawWordsB = textB.trim().split(/\s+/);
  const remainingWords = rawWordsB.slice(bestK);
  const dedupedTextB = remainingWords.join(' ');

  return {
    dedupedTextB,
    matchedTokens,
  };
}

export interface OverlapBounds {
  overlapStartSec: number;
  overlapEndSec: number;
}

/**
 * Merges incoming dialog segments from a finalized segment into existing recording segments,
 * applying cross-segment boundary deduplication ONLY when candidates are within the declared overlap bounds.
 */
export function mergeCrossSegmentDialogs(
  existing: DialogSegment[],
  incoming: DialogSegment[],
  timeOffsetSec: number,
  overlapBounds?: OverlapBounds
): DialogSegment[] {
  if (incoming.length === 0) return [...existing];
  if (existing.length === 0) {
    return incoming.map(s => {
      const globalSec = s.seconds + timeOffsetSec;
      return {
        ...s,
        seconds: globalSec,
        time: formatSeconds(globalSec),
      };
    });
  }

  const result = [...existing];
  const lastExisting = result[result.length - 1];

  let adjustedIncoming = incoming.map(s => {
    const globalSec = s.seconds + timeOffsetSec;
    return {
      ...s,
      seconds: globalSec,
      time: formatSeconds(globalSec),
    };
  });

  // Apply boundary deduplication ONLY if both candidates fall strictly inside the actual overlap window
  if (lastExisting && adjustedIncoming.length > 0 && overlapBounds) {
    const firstIncoming = adjustedIncoming[0];

    const isLastInOverlap =
      lastExisting.seconds >= overlapBounds.overlapStartSec &&
      lastExisting.seconds <= overlapBounds.overlapEndSec;

    const isFirstInOverlap =
      firstIncoming.seconds >= overlapBounds.overlapStartSec &&
      firstIncoming.seconds <= overlapBounds.overlapEndSec;

    if (isLastInOverlap && isFirstInOverlap) {
      const { dedupedTextB, matchedTokens } = deduplicateCrossSegmentBoundary(
        lastExisting.text,
        firstIncoming.text
      );

      if (matchedTokens.length > 0) {
        if (!dedupedTextB.trim()) {
          // Entire first incoming segment was duplicate, drop it
          adjustedIncoming = adjustedIncoming.slice(1);
        } else {
          // Replace with deduplicated text
          adjustedIncoming[0] = {
            ...firstIncoming,
            text: dedupedTextB,
          };
        }
      }
    }
  }

  // Append remaining incoming segments with monotonic timestamp enforcement
  for (const inc of adjustedIncoming) {
    const prevSec = result.length > 0 ? result[result.length - 1].seconds : 0;
    const finalSec = Math.max(prevSec, inc.seconds);
    result.push({
      ...inc,
      seconds: finalSec,
      time: formatSeconds(finalSec),
    });
  }

  return result;
}

export interface BoundedSegmentWorkerTask {
  transcribeAudio: (
    samples16k: Float32Array,
    options: { language: string }
  ) => Promise<Array<{ text: string; start: number; end: number }>>;
}

/**
 * Sequential Bounded Transcription Adapter.
 * Processes finalized segments one at a time, enforcing bounded memory,
 * cancellation checks after every await, and durable checkpoint persistence.
 */
export class RecordingTranscriptionAdapter {
  private isCancelled = false;
  private runToken = 0;
  private isProcessing = false;
  private queue: TranscriptionSegmentRecord[] = [];
  private accumulatedDialogs: DialogSegment[] = [];

  private ownedAudioContext: AudioContext | null = null;
  private isInjectedAudioContext = false;

  constructor(
    private store: RecordingStore,
    private workerTask: BoundedSegmentWorkerTask,
    audioContext?: AudioContext
  ) {
    if (audioContext) {
      this.isInjectedAudioContext = true;
      this.ownedAudioContext = audioContext;
    }
  }

  /**
   * Reconstructs accumulated transcript state from durable checkpoints.
   */
  async initializeFromCheckpoints(sessionId: string): Promise<DialogSegment[]> {
    const segments = await this.store.getTranscriptionSegments(sessionId);
    this.accumulatedDialogs = [];
    for (const seg of segments) {
      if (seg.transcribed && seg.transcriptDialogs) {
        this.accumulatedDialogs.push(...seg.transcriptDialogs);
      }
    }
    return [...this.accumulatedDialogs];
  }

  enqueueSegment(segment: TranscriptionSegmentRecord): void {
    if (this.isCancelled) return;
    this.queue.push(segment);
    if (!this.isProcessing) {
      void this.processNextInQueue();
    }
  }

  cancel(): void {
    this.isCancelled = true;
    this.runToken += 1;
    this.queue = [];
    void this.closeOwnedAudioContext();
  }

  async close(): Promise<void> {
    this.cancel();
    await this.closeOwnedAudioContext();
  }

  private async closeOwnedAudioContext(): Promise<void> {
    if (!this.isInjectedAudioContext && this.ownedAudioContext) {
      try {
        await this.ownedAudioContext.close();
      } catch {
        // ignore
      }
      this.ownedAudioContext = null;
    }
  }

  getAccumulatedDialogs(): DialogSegment[] {
    return [...this.accumulatedDialogs];
  }

  private async processNextInQueue(): Promise<void> {
    if (this.isCancelled || this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const segment = this.queue.shift()!;
    const currentRunToken = this.runToken;
    const isAborted = () => this.isCancelled || this.runToken !== currentRunToken;

    // Checkpoint resume: if segment already completed with durable checkpoint, skip decoding
    if (segment.transcribed) {
      if (segment.transcriptDialogs && segment.transcriptDialogs.length > 0) {
        const alreadyPresent = this.accumulatedDialogs.some(
          d => segment.transcriptDialogs!.some(sd => sd.id === d.id)
        );
        if (!alreadyPresent) {
          this.accumulatedDialogs.push(...segment.transcriptDialogs);
        }
      }
      this.isProcessing = false;
      void this.processNextInQueue();
      return;
    }

    let audioBuffer: AudioBuffer | null = null;
    let samples16k: Float32Array | null = null;

    try {
      if (isAborted()) return;

      const arrayBuffer = await segment.blob.arrayBuffer();
      if (isAborted()) return;

      if (!this.ownedAudioContext) {
        this.ownedAudioContext = new AudioContext({ sampleRate: 48000 });
      }

      // 1. Decode ONLY this one segment
      audioBuffer = await this.ownedAudioContext.decodeAudioData(arrayBuffer);
      if (isAborted()) return;

      // 2. Resample to 16 kHz mono Float32Array
      samples16k = resampleAudioBufferTo16kMono(audioBuffer);

      // 3. Immediately drop AudioBuffer reference to allow garbage collection
      audioBuffer = null;
      if (isAborted()) return;

      // 4. Transcribe audio with worker
      const chunkResults = await this.workerTask.transcribeAudio(samples16k, { language: 'id' });
      if (isAborted()) return;

      const localDialogs: DialogSegment[] = chunkResults.map((c, i) => ({
        id: segment.segmentIndex * 1000 + i,
        seconds: Math.round(c.start),
        time: formatSeconds(Math.round(c.start)),
        speaker: 'Pembicara',
        text: c.text,
      }));

      const overlapBounds: OverlapBounds = {
        overlapStartSec: segment.overlapStartSec,
        overlapEndSec: segment.overlapEndSec,
      };

      const prevCount = this.accumulatedDialogs.length;

      // 5. Merge with bounded overlap deduplication without mutating committed accumulatedDialogs
      const candidateAccumulated = mergeCrossSegmentDialogs(
        this.accumulatedDialogs,
        localDialogs,
        segment.plannedStartSec,
        overlapBounds
      );

      const segmentResultDialogs = candidateAccumulated.slice(prevCount);
      if (isAborted()) return;

      // 6. Atomically persist durable checkpoint in store
      await this.store.markSegmentTranscribed(
        segment.sessionId,
        segment.segmentIndex,
        segmentResultDialogs
      );
      if (isAborted()) return;

      // 7. ONLY THEN commit candidate into committed state
      this.accumulatedDialogs = candidateAccumulated;
    } catch (err) {
      console.error(`[Transcription Adapter] Error processing segment ${segment.segmentIndex}:`, err);
      // Halt queue processing immediately on checkpoint or processing failure
      this.queue = [];
      this.isProcessing = false;
      return;
    } finally {
      // 8. Explicitly release buffer reference
      samples16k = null;
      this.isProcessing = false;
      if (!isAborted() && this.queue.length > 0) {
        void this.processNextInQueue();
      }
    }
  }
}

function resampleAudioBufferTo16kMono(audioBuffer: AudioBuffer): Float32Array {
  const sourceRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const sourceLen = audioBuffer.length;

  let mono: Float32Array;
  if (numChannels === 1) {
    mono = audioBuffer.getChannelData(0);
  } else {
    mono = new Float32Array(sourceLen);
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < sourceLen; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
  }

  if (sourceRate === 16000) {
    return new Float32Array(mono);
  }

  const ratio = sourceRate / 16000;
  const targetLen = Math.floor(sourceLen / ratio);
  const target = new Float32Array(targetLen);

  for (let i = 0; i < targetLen; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, sourceLen - 1);
    const frac = srcIndex - i0;
    target[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }

  return target;
}
