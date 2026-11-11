/**
 * Deterministic Runner & Cleanup Orchestrator for Phase R3B-A:
 * Cloudflare R2 Multipart Interoperability Spike.
 *
 * Implements:
 * - Deterministic 18 MiB payload generation (8 MiB + 8 MiB + 2 MiB)
 * - Bounded parallel part upload (max 3 concurrent)
 * - Strict ETag extraction and ascending partNumber sorting
 * - Guaranteed finally-block cleanup (abort before complete, delete after complete)
 * - Control-plane Authorization: Bearer <SPIKE_CONTROL_TOKEN> sent ONLY to Worker
 * - Sanitized structured logging (zero secrets, zero tokens, zero signed URLs, zero raw uploadIds)
 */

import {
  SPIKE_FINAL_PART_SIZE_BYTES,
  SPIKE_MAX_PARALLEL_PARTS,
  SPIKE_PART_SIZE_BYTES,
  SPIKE_TOTAL_SIZE_BYTES,
  type PartSliceDescriptor,
  type PresignedPartTarget,
  type SanitizedErrorCategory,
  type SanitizedSpikeLogEntry,
  type SpikeCleanupResult,
  type SpikeCompleteRequest,
  type SpikeCompleteResponse,
  type SpikeHeadVerificationResponse,
  type SpikeInitiateResponse,
  type SpikePhase,
  type SpikeRunReport,
  type UploadedPartReceipt,
} from './protocol.ts';

export class SpikeCategorizedError extends Error {
  readonly category: SanitizedErrorCategory;
  readonly httpStatus?: number;
  readonly partNumber?: number;

  constructor(
    category: SanitizedErrorCategory,
    message: string,
    details?: { httpStatus?: number; partNumber?: number }
  ) {
    super(message);
    this.name = 'SpikeCategorizedError';
    this.category = category;
    this.httpStatus = details?.httpStatus;
    this.partNumber = details?.partNumber;
  }
}

export interface SanitizedSpikeLogger {
  setRunContext(runId: string, objectKeySha256Prefix?: string): void;
  record(entry: Omit<SanitizedSpikeLogEntry, 'timestamp' | 'runId'> & { runId?: string }): void;
  getEntries(): SanitizedSpikeLogEntry[];
}

/**
 * Creates a sanitized logger that strips any non-whitelisted properties
 * so credentials, control tokens, Authorization headers, signed URLs,
 * raw uploadIds, and binary buffers can never leak.
 */
export function createSanitizedSpikeLogger(
  nowIsoFn: () => string = () => new Date().toISOString()
): SanitizedSpikeLogger {
  const entries: SanitizedSpikeLogEntry[] = [];
  let activeRunId = 'unassigned_run';
  let activeKeyPrefix: string | undefined;

  return {
    setRunContext(runId: string, objectKeySha256Prefix?: string): void {
      if (runId && runId.trim()) {
        activeRunId = runId.trim();
      }
      if (objectKeySha256Prefix && objectKeySha256Prefix.trim()) {
        activeKeyPrefix = objectKeySha256Prefix.trim();
      }
    },
    record(
      raw: Omit<SanitizedSpikeLogEntry, 'timestamp' | 'runId'> & { runId?: string }
    ): void {
      const safeEntry: SanitizedSpikeLogEntry = {
        timestamp: nowIsoFn(),
        runId: raw.runId ?? activeRunId,
        phase: raw.phase,
      };
      if (typeof raw.partNumber === 'number') {
        safeEntry.partNumber = raw.partNumber;
      }
      if (typeof raw.byteCount === 'number') {
        safeEntry.byteCount = raw.byteCount;
      }
      if (typeof raw.httpStatus === 'number') {
        safeEntry.httpStatus = raw.httpStatus;
      }
      if (typeof raw.errorCategory === 'string') {
        safeEntry.errorCategory = raw.errorCategory;
      }
      if (typeof raw.cleanupAction === 'string') {
        safeEntry.cleanupAction = raw.cleanupAction;
      }
      if (typeof raw.cleanupSucceeded === 'boolean') {
        safeEntry.cleanupSucceeded = raw.cleanupSucceeded;
      }
      const keyPrefix = raw.objectKeySha256Prefix ?? activeKeyPrefix;
      if (typeof keyPrefix === 'string' && keyPrefix.length > 0) {
        safeEntry.objectKeySha256Prefix = keyPrefix;
      }
      entries.push(safeEntry);
    },
    getEntries(): SanitizedSpikeLogEntry[] {
      return [...entries];
    },
  };
}

/**
 * Generates a deterministic 18 MiB (18,874,368 byte) binary buffer.
 * Each 4 KiB block is stamped with its block index so Part 1, Part 2, and Part 3
 * have distinct, reproducible cryptographic checksums and ETags.
 */
export function createDeterministic18MiBPayload(
  totalBytes: number = SPIKE_TOTAL_SIZE_BYTES
): Uint8Array {
  const buffer = new Uint8Array(totalBytes);
  const view = new DataView(buffer.buffer);
  const blockSize = 4096;

  for (let offset = 0; offset < totalBytes; offset += blockSize) {
    const blockIndex = Math.floor(offset / blockSize);
    if (offset + 4 <= totalBytes) {
      view.setUint32(offset, blockIndex, false);
    }
    const fillByte = (blockIndex & 0xff) ^ 0x5a;
    const end = Math.min(offset + blockSize, totalBytes);
    buffer.fill(fillByte, offset + 4, end);
  }

  return buffer;
}

/**
 * Slices a payload into fixed-size multipart chunks (default 8 MiB) and
 * validates R2 uniform non-trailing part size constraints.
 */
export function sliceMultipartPayload(
  payload: Uint8Array,
  partSizeBytes: number = SPIKE_PART_SIZE_BYTES
): PartSliceDescriptor[] {
  if (payload.byteLength <= 0) {
    throw new SpikeCategorizedError('INVALID_PART_SIZE', 'Payload cannot be empty');
  }
  if (partSizeBytes < 5 * 1024 * 1024) {
    throw new SpikeCategorizedError(
      'INVALID_PART_SIZE',
      'R2 minimum non-final part size is 5 MiB'
    );
  }

  const slices: PartSliceDescriptor[] = [];
  let offset = 0;
  let partNumber = 1;

  while (offset < payload.byteLength) {
    const remaining = payload.byteLength - offset;
    const sliceLength = Math.min(partSizeBytes, remaining);
    const slice = payload.subarray(offset, offset + sliceLength);

    slices.push({
      partNumber,
      offsetBytes: offset,
      byteLength: slice.byteLength,
      payload: slice,
    });

    offset += sliceLength;
    partNumber += 1;
  }

  validatePartSlicesUniformity(slices, partSizeBytes);
  return slices;
}

/**
 * Validates that all non-trailing parts have the exact uniform partSizeBytes
 * and the trailing part is between 1 and partSizeBytes.
 */
export function validatePartSlicesUniformity(
  slices: PartSliceDescriptor[],
  expectedPartSizeBytes: number = SPIKE_PART_SIZE_BYTES
): void {
  if (slices.length === 0) {
    throw new SpikeCategorizedError('INVALID_PART_SIZE', 'Part slices cannot be empty');
  }

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const isFinalPart = i === slices.length - 1;

    if (slice.partNumber !== i + 1) {
      throw new SpikeCategorizedError(
        'INVALID_PART_SIZE',
        `Part number out of sequence at index ${i}`
      );
    }

    if (!isFinalPart && slice.byteLength !== expectedPartSizeBytes) {
      throw new SpikeCategorizedError(
        'INVALID_PART_SIZE',
        `Non-trailing part ${slice.partNumber} must be exactly ${expectedPartSizeBytes} bytes`,
        { partNumber: slice.partNumber }
      );
    }

    if (isFinalPart && (slice.byteLength < 1 || slice.byteLength > expectedPartSizeBytes)) {
      throw new SpikeCategorizedError(
        'INVALID_PART_SIZE',
        `Final part ${slice.partNumber} has invalid byte length ${slice.byteLength}`,
        { partNumber: slice.partNumber }
      );
    }
  }
}

/**
 * Validates and sorts uploaded part receipts in ascending partNumber order.
 * Rejects missing or empty ETags and duplicate/non-sequential partNumbers.
 */
export function normalizeAndSortUploadedParts(
  receipts: UploadedPartReceipt[],
  expectedTotalParts: number
): Array<{ partNumber: number; etag: string }> {
  if (receipts.length !== expectedTotalParts) {
    throw new SpikeCategorizedError(
      'COMPLETE_MULTIPART_FAILED',
      `Expected ${expectedTotalParts} uploaded parts, got ${receipts.length}`
    );
  }

  const sorted = [...receipts].sort((a, b) => a.partNumber - b.partNumber);

  return sorted.map((receipt, index) => {
    const expectedPartNumber = index + 1;
    if (receipt.partNumber !== expectedPartNumber) {
      throw new SpikeCategorizedError(
        'COMPLETE_MULTIPART_FAILED',
        `Expected partNumber ${expectedPartNumber} at sorted index ${index}, got ${receipt.partNumber}`,
        { partNumber: receipt.partNumber }
      );
    }

    const trimmedEtag = receipt.etag ? receipt.etag.trim() : '';
    if (!trimmedEtag || trimmedEtag === '""') {
      throw new SpikeCategorizedError(
        'MISSING_ETAG',
        `Missing or empty ETag for part ${receipt.partNumber}`,
        { partNumber: receipt.partNumber }
      );
    }

    return {
      partNumber: receipt.partNumber,
      etag: trimmedEtag,
    };
  });
}

export interface SpikeRunnerControlPlane {
  initiate(): Promise<SpikeInitiateResponse>;
  uploadPart(target: PresignedPartTarget, body: Uint8Array): Promise<Response>;
  complete(request: SpikeCompleteRequest): Promise<SpikeCompleteResponse>;
  verifyHead(objectKey: string): Promise<SpikeHeadVerificationResponse>;
  cleanupDeleteObject(objectKey: string, runId: string): Promise<SpikeCleanupResult>;
  cleanupAbortMultipart(
    objectKey: string,
    uploadId: string,
    runId: string
  ): Promise<SpikeCleanupResult>;
}

/**
 * Creates an HTTP-based SpikeRunnerControlPlane that attaches
 * Authorization: Bearer <controlToken> ONLY to control-plane Worker requests
 * and NEVER to presigned R2 PUT requests.
 */
export function createHttpSpikeControlPlane(options: {
  workerBaseUrl: string;
  controlToken: string;
  fetchImpl?: typeof fetch;
}): SpikeRunnerControlPlane {
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = options.workerBaseUrl.replace(/\/+$/, '');
  const controlAuthHeaders = {
    Authorization: `Bearer ${options.controlToken}`,
    'Content-Type': 'application/json',
  };

  return {
    async initiate(): Promise<SpikeInitiateResponse> {
      const response = await fetchFn(`${baseUrl}/spike/multipart/initiate`, {
        method: 'POST',
        headers: controlAuthHeaders,
      });
      if (response.status === 401) {
        throw new SpikeCategorizedError('UNAUTHORIZED', 'Control plane returned 401 Unauthorized', {
          httpStatus: 401,
        });
      }
      if (!response.ok) {
        throw new SpikeCategorizedError(
          'CREATE_MULTIPART_FAILED',
          `Initiate failed with HTTP ${response.status}`,
          { httpStatus: response.status }
        );
      }
      return (await response.json()) as SpikeInitiateResponse;
    },

    async uploadPart(target: PresignedPartTarget, body: Uint8Array): Promise<Response> {
      // IMPORTANT: Never send Authorization header to presigned R2 S3 URLs
      const payloadBuffer = body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength
      ) as ArrayBuffer;
      return fetchFn(target.uploadUrl, {
        method: 'PUT',
        body: payloadBuffer,
      });
    },

    async complete(request: SpikeCompleteRequest): Promise<SpikeCompleteResponse> {
      const response = await fetchFn(`${baseUrl}/spike/multipart/complete`, {
        method: 'POST',
        headers: controlAuthHeaders,
        body: JSON.stringify(request),
      });
      if (response.status === 401) {
        throw new SpikeCategorizedError('UNAUTHORIZED', 'Control plane returned 401 Unauthorized', {
          httpStatus: 401,
        });
      }
      if (!response.ok) {
        throw new SpikeCategorizedError(
          'COMPLETE_MULTIPART_FAILED',
          `Complete failed with HTTP ${response.status}`,
          { httpStatus: response.status }
        );
      }
      return (await response.json()) as SpikeCompleteResponse;
    },

    async verifyHead(objectKey: string): Promise<SpikeHeadVerificationResponse> {
      const url = new URL(`${baseUrl}/spike/multipart/head`);
      url.searchParams.set('objectKey', objectKey);
      const response = await fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.controlToken}`,
        },
      });
      if (response.status === 401) {
        throw new SpikeCategorizedError('UNAUTHORIZED', 'Control plane returned 401 Unauthorized', {
          httpStatus: 401,
        });
      }
      if (!response.ok) {
        throw new SpikeCategorizedError(
          'HEAD_VERIFICATION_FAILED',
          `HEAD verification failed with HTTP ${response.status}`,
          { httpStatus: response.status }
        );
      }
      return (await response.json()) as SpikeHeadVerificationResponse;
    },

    async cleanupDeleteObject(objectKey: string, runId: string): Promise<SpikeCleanupResult> {
      const response = await fetchFn(`${baseUrl}/spike/multipart/cleanup-delete`, {
        method: 'POST',
        headers: controlAuthHeaders,
        body: JSON.stringify({ objectKey, runId }),
      });
      return (await response.json()) as SpikeCleanupResult;
    },

    async cleanupAbortMultipart(
      objectKey: string,
      uploadId: string,
      runId: string
    ): Promise<SpikeCleanupResult> {
      const response = await fetchFn(`${baseUrl}/spike/multipart/cleanup-abort`, {
        method: 'POST',
        headers: controlAuthHeaders,
        body: JSON.stringify({ objectKey, uploadId, runId }),
      });
      return (await response.json()) as SpikeCleanupResult;
    },
  };
}

/**
 * Uploads part slices to their presigned R2 URLs with a strict concurrency cap
 * (default 3 parallel uploads) and verifies ETag presence on every response.
 */
export async function uploadPartsWithConcurrency(params: {
  slices: PartSliceDescriptor[];
  presignedParts: PresignedPartTarget[];
  uploadPartFn: (target: PresignedPartTarget, body: Uint8Array) => Promise<Response>;
  logger: SanitizedSpikeLogger;
  maxParallel?: number;
  strictCorsEtagErrorCategory?: boolean;
}): Promise<UploadedPartReceipt[]> {
  const {
    slices,
    presignedParts,
    uploadPartFn,
    logger,
    maxParallel = SPIKE_MAX_PARALLEL_PARTS,
    strictCorsEtagErrorCategory = false,
  } = params;

  if (slices.length !== presignedParts.length) {
    throw new SpikeCategorizedError(
      'INVALID_PART_SIZE',
      'Mismatch between payload slices count and presigned parts count'
    );
  }

  const targetByPart = new Map<number, PresignedPartTarget>();
  for (const target of presignedParts) {
    targetByPart.set(target.partNumber, target);
  }

  const receipts: UploadedPartReceipt[] = [];
  let cursor = 0;

  async function workerLoop(): Promise<void> {
    while (cursor < slices.length) {
      const currentIndex = cursor;
      cursor += 1;
      const slice = slices[currentIndex];
      const target = targetByPart.get(slice.partNumber);

      if (!target) {
        throw new SpikeCategorizedError(
          'PRESIGN_FAILED',
          `Missing presigned target for part ${slice.partNumber}`,
          { partNumber: slice.partNumber }
        );
      }

      if (target.expectedByteLength !== slice.byteLength) {
        throw new SpikeCategorizedError(
          'INVALID_PART_SIZE',
          `Slice byte length mismatch for part ${slice.partNumber}`,
          { partNumber: slice.partNumber }
        );
      }

      const response = await uploadPartFn(target, slice.payload);
      const status = response.status;

      if (status < 200 || status >= 300) {
        logger.record({
          phase: 'upload_part',
          partNumber: slice.partNumber,
          byteCount: slice.byteLength,
          httpStatus: status,
          errorCategory: 'PART_UPLOAD_HTTP_ERROR',
        });
        throw new SpikeCategorizedError(
          'PART_UPLOAD_HTTP_ERROR',
          `UploadPart failed with HTTP ${status}`,
          { httpStatus: status, partNumber: slice.partNumber }
        );
      }

      const rawEtag = response.headers.get('etag') ?? response.headers.get('ETag') ?? '';
      const trimmedEtag = rawEtag.trim();

      if (!trimmedEtag || trimmedEtag === '""') {
        const missingCategory: SanitizedErrorCategory = strictCorsEtagErrorCategory
          ? 'CORS_ETAG_NOT_EXPOSED'
          : 'MISSING_ETAG';
        logger.record({
          phase: 'upload_part',
          partNumber: slice.partNumber,
          byteCount: slice.byteLength,
          httpStatus: status,
          errorCategory: missingCategory,
        });
        throw new SpikeCategorizedError(
          missingCategory,
          `UploadPart response missing exposed ETag header for part ${slice.partNumber}`,
          { httpStatus: status, partNumber: slice.partNumber }
        );
      }

      logger.record({
        phase: 'upload_part',
        partNumber: slice.partNumber,
        byteCount: slice.byteLength,
        httpStatus: status,
      });

      receipts.push({
        partNumber: slice.partNumber,
        etag: trimmedEtag,
        byteLength: slice.byteLength,
        httpStatus: status,
      });
    }
  }

  const workerCount = Math.max(1, Math.min(maxParallel, slices.length));
  const workers = Array.from({ length: workerCount }, () => workerLoop());
  await Promise.all(workers);

  return receipts;
}

/**
 * Executes the full R3B-A multipart interoperability lifecycle and guarantees
 * deterministic resource cleanup in the finally block:
 * - Before complete succeeds -> abort multipart upload
 * - After complete succeeds -> delete assembled object
 */
export async function runMultipartInteroperabilitySpike(
  controlPlane: SpikeRunnerControlPlane,
  options?: {
    payload?: Uint8Array;
    logger?: SanitizedSpikeLogger;
    strictCorsEtagErrorCategory?: boolean;
  }
): Promise<SpikeRunReport> {
  const logger = options?.logger ?? createSanitizedSpikeLogger();
  const payload = options?.payload ?? createDeterministic18MiBPayload();

  let runId = 'uninitialized_run';
  let objectKey = '';
  let objectKeySha256Prefix = 'none';
  let uploadId = '';
  let completedMultipart = false;
  let verifiedHeadBytes: number | null = null;
  let uploadedPartsCount = 0;
  let failureCategory: SanitizedErrorCategory | undefined;
  let currentPhase: SpikePhase = 'init';

  let cleanupResult: SpikeCleanupResult = {
    action: 'none',
    runId,
    objectKeySha256Prefix,
    succeeded: true,
  };

  try {
    currentPhase = 'slice_payload';
    const slices = sliceMultipartPayload(payload, SPIKE_PART_SIZE_BYTES);
    if (
      slices.length !== 3 ||
      slices[0].byteLength !== SPIKE_PART_SIZE_BYTES ||
      slices[1].byteLength !== SPIKE_PART_SIZE_BYTES ||
      slices[2].byteLength !== SPIKE_FINAL_PART_SIZE_BYTES
    ) {
      throw new SpikeCategorizedError(
        'INVALID_PART_SIZE',
        'Spike requires exact 8 MiB + 8 MiB + 2 MiB part distribution'
      );
    }
    logger.record({
      phase: 'slice_payload',
      byteCount: payload.byteLength,
    });

    currentPhase = 'create_multipart';
    const initiated = await controlPlane.initiate();
    runId = initiated.runId;
    objectKey = initiated.objectKey;
    objectKeySha256Prefix = initiated.objectKeySha256Prefix;
    uploadId = initiated.uploadId;
    logger.setRunContext(runId, objectKeySha256Prefix);

    logger.record({
      phase: 'create_multipart',
      byteCount: initiated.totalSizeBytes,
      httpStatus: 200,
    });

    currentPhase = 'upload_part';
    const receipts = await uploadPartsWithConcurrency({
      slices,
      presignedParts: initiated.presignedParts,
      uploadPartFn: (target, body) => controlPlane.uploadPart(target, body),
      logger,
      maxParallel: SPIKE_MAX_PARALLEL_PARTS,
      strictCorsEtagErrorCategory: options?.strictCorsEtagErrorCategory,
    });
    uploadedPartsCount = receipts.length;

    currentPhase = 'complete_multipart';
    const orderedParts = normalizeAndSortUploadedParts(receipts, slices.length);
    await controlPlane.complete({
      objectKey,
      uploadId,
      parts: orderedParts,
    });
    completedMultipart = true;
    logger.record({
      phase: 'complete_multipart',
      byteCount: payload.byteLength,
      httpStatus: 200,
    });

    currentPhase = 'verify_head';
    const headResult = await controlPlane.verifyHead(objectKey);
    if (!headResult.exists) {
      throw new SpikeCategorizedError(
        'HEAD_VERIFICATION_FAILED',
        'R2 HEAD returned non-existent object after CompleteMultipartUpload'
      );
    }

    verifiedHeadBytes = headResult.sizeBytes;
    if (headResult.sizeBytes !== payload.byteLength) {
      throw new SpikeCategorizedError(
        'SIZE_MISMATCH',
        `R2 HEAD size (${headResult.sizeBytes}) does not match expected ${payload.byteLength}`
      );
    }

    logger.record({
      phase: 'verify_head',
      byteCount: headResult.sizeBytes,
      httpStatus: 200,
    });
  } catch (err) {
    if (err instanceof SpikeCategorizedError) {
      failureCategory = err.category;
    } else if (currentPhase === 'create_multipart') {
      failureCategory = 'CREATE_MULTIPART_FAILED';
    } else if (currentPhase === 'complete_multipart') {
      failureCategory = 'COMPLETE_MULTIPART_FAILED';
    } else if (currentPhase === 'verify_head') {
      failureCategory = 'HEAD_VERIFICATION_FAILED';
    } else {
      failureCategory = 'UNEXPECTED_ERROR';
    }

    logger.record({
      phase: currentPhase,
      errorCategory: failureCategory,
    });
  } finally {
    if (objectKey && completedMultipart) {
      cleanupResult = await controlPlane.cleanupDeleteObject(objectKey, runId);
      logger.record({
        phase: 'cleanup_delete_object',
        cleanupAction: 'delete_object',
        cleanupSucceeded: cleanupResult.succeeded,
        objectKeySha256Prefix: cleanupResult.objectKeySha256Prefix,
        errorCategory: cleanupResult.errorCategory,
      });
    } else if (objectKey && uploadId && !completedMultipart) {
      cleanupResult = await controlPlane.cleanupAbortMultipart(objectKey, uploadId, runId);
      logger.record({
        phase: 'cleanup_abort_multipart',
        cleanupAction: 'abort_multipart',
        cleanupSucceeded: cleanupResult.succeeded,
        objectKeySha256Prefix: cleanupResult.objectKeySha256Prefix,
        errorCategory: cleanupResult.errorCategory,
      });
    }
  }

  const succeeded =
    !failureCategory &&
    completedMultipart &&
    verifiedHeadBytes === payload.byteLength &&
    cleanupResult.succeeded;

  return {
    succeeded,
    runId,
    objectKeySha256Prefix,
    expectedTotalBytes: payload.byteLength,
    verifiedHeadBytes,
    uploadedPartsCount,
    completedMultipart,
    cleanup: cleanupResult,
    logs: logger.getEntries(),
    failureCategory: failureCategory ?? (cleanupResult.succeeded ? undefined : 'CLEANUP_FAILED'),
  };
}
