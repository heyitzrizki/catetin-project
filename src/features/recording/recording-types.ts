import type { DialogSegment } from '../../lib/transcript';

/**
 * Core Local Recording Engine Types.
 * Strictly local-first: no cloud credentials, no network metadata.
 */

export function generateRecordingId(prefix = 'rec'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type RecordingStateStatus =
  | 'idle'
  | 'requesting-permission'
  | 'ready'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'finalizing'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'recoverable';

export type RecordingErrorCode =
  | 'unsupported-browser'
  | 'insecure-context'
  | 'permission-denied'
  | 'microphone-not-found'
  | 'microphone-unreadable'
  | 'device-ended'
  | 'storage-quota'
  | 'storage-write-failed'
  | 'archive-finalization-failed'
  | 'workspace-save-failed'
  | 'transcription-failed'
  | 'checkpoint-read-failed';

export interface RecordingError {
  code: RecordingErrorCode;
  message: string;
  retryable?: boolean;
}

export interface RecordingSession {
  sessionId: string;
  targetProjectId: string;
  title: string;
  status: RecordingStateStatus;
  startedAt: number;
  lastUpdatedAt: number;
  activeDurationMs: number;
  mimeType: string;
  archiveChunkCount: number;
  archiveTotalBytes: number;
  segmentCount: number;
  errorCode: RecordingErrorCode | null;
  errorMessage: string | null;
}

export interface ArchiveChunkRecord {
  sessionId: string;
  chunkIndex: number;
  blob: Blob;
  sizeBytes: number;
  timestampMs: number;
  activeDurationMs: number;
  createdAt: number;
}

export interface TranscriptionSegmentRecord {
  sessionId: string;
  segmentIndex: number;
  blob: Blob;
  sizeBytes: number;
  durationSec: number;
  plannedStartSec: number;
  plannedEndSec: number;
  overlapStartSec: number;
  overlapEndSec: number;
  transcribed: boolean;
  transcriptDialogs?: DialogSegment[];
  createdAt: number;
}

export interface BrowserCapabilities {
  supported: boolean;
  isSecureContext: boolean;
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
  selectedMimeType: string | null;
  reason: string | null;
}

export interface RecordingEngineState {
  status: RecordingStateStatus;
  sessionId: string | null;
  activeDurationMs: number;
  archiveTotalBytes: number;
  segmentCount: number;
  pendingWrites: number;
  error: RecordingError | null;
}

export interface RecordingEngineEvents {
  onStateChange?: (state: RecordingEngineState) => void;
  onSegmentReady?: (segment: TranscriptionSegmentRecord) => void;
  onError?: (error: RecordingError) => void;
}
