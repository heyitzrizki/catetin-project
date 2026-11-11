/**
 * Isolated Protocol & Types for Phase R3B-A:
 * Cloudflare R2 Multipart Interoperability Spike.
 *
 * This module is strictly isolated from production worker and client code.
 */

export const SPIKE_PART_SIZE_BYTES = 8 * 1024 * 1024; // 8,388,608 bytes (8 MiB)
export const SPIKE_FINAL_PART_SIZE_BYTES = 2 * 1024 * 1024; // 2,097,152 bytes (2 MiB)
export const SPIKE_TOTAL_SIZE_BYTES =
  SPIKE_PART_SIZE_BYTES * 2 + SPIKE_FINAL_PART_SIZE_BYTES; // 18,874,368 bytes (18 MiB)
export const SPIKE_MAX_PARALLEL_PARTS = 3;
export const SPIKE_DEFAULT_PRESIGN_TTL_SECONDS = 900; // 15 minutes

export type SpikePhase =
  | 'init'
  | 'slice_payload'
  | 'create_multipart'
  | 'presign_parts'
  | 'upload_part'
  | 'complete_multipart'
  | 'verify_head'
  | 'cleanup_delete_object'
  | 'cleanup_abort_multipart';

export type SanitizedErrorCategory =
  | 'UNAUTHORIZED'
  | 'INVALID_CONFIG'
  | 'INVALID_PART_SIZE'
  | 'PRESIGN_FAILED'
  | 'CREATE_MULTIPART_FAILED'
  | 'PART_UPLOAD_HTTP_ERROR'
  | 'CORS_ETAG_NOT_EXPOSED'
  | 'MISSING_ETAG'
  | 'COMPLETE_MULTIPART_FAILED'
  | 'HEAD_VERIFICATION_FAILED'
  | 'SIZE_MISMATCH'
  | 'CLEANUP_FAILED'
  | 'UNEXPECTED_ERROR';

export interface SanitizedSpikeLogEntry {
  timestamp: string;
  runId: string;
  phase: SpikePhase;
  partNumber?: number;
  byteCount?: number;
  httpStatus?: number;
  errorCategory?: SanitizedErrorCategory;
  cleanupAction?: 'delete_object' | 'abort_multipart';
  cleanupSucceeded?: boolean;
  objectKeySha256Prefix?: string;
}

export interface PartSliceDescriptor {
  partNumber: number;
  offsetBytes: number;
  byteLength: number;
  payload: Uint8Array;
}

export interface PresignedPartTarget {
  partNumber: number;
  expectedByteLength: number;
  uploadUrl: string;
  expiresAtMs: number;
}

export interface UploadedPartReceipt {
  partNumber: number;
  etag: string;
  byteLength: number;
  httpStatus: number;
}

export interface SpikeInitiateResponse {
  runId: string;
  objectKey: string;
  objectKeySha256Prefix: string;
  uploadId: string;
  partSizeBytes: number;
  totalSizeBytes: number;
  presignedParts: PresignedPartTarget[];
}

export interface SpikeCompleteRequest {
  objectKey: string;
  uploadId: string;
  parts: Array<{
    partNumber: number;
    etag: string;
  }>;
}

export interface SpikeCompleteResponse {
  objectKey: string;
  objectKeySha256Prefix: string;
  etag: string;
}

export interface SpikeHeadVerificationResponse {
  objectKey: string;
  objectKeySha256Prefix: string;
  exists: boolean;
  sizeBytes: number;
  etag: string | null;
  contentType: string | null;
}

export interface SpikeBucketEmptyCheckResponse {
  empty: boolean;
  sampleObjectCount: number;
}

export interface SpikeCleanupResult {
  action: 'delete_object' | 'abort_multipart' | 'none';
  runId: string;
  objectKeySha256Prefix: string;
  succeeded: boolean;
  errorCategory?: SanitizedErrorCategory;
}

export interface SpikeRunReport {
  succeeded: boolean;
  runId: string;
  objectKeySha256Prefix: string;
  expectedTotalBytes: number;
  verifiedHeadBytes: number | null;
  uploadedPartsCount: number;
  completedMultipart: boolean;
  cleanup: SpikeCleanupResult;
  logs: SanitizedSpikeLogEntry[];
  failureCategory?: SanitizedErrorCategory;
}
