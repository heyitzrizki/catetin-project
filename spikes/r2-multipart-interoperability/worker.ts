/**
 * Isolated Spike Worker for Phase R3B-A:
 * Cloudflare R2 Multipart Interoperability Spike.
 *
 * Handles native Worker R2 binding operations:
 * - createMultipartUpload
 * - resumeMultipartUpload().complete()
 * - head()
 * - delete()
 * - resumeMultipartUpload().abort()
 * - list() for bucket emptiness verification
 *
 * Enforces mandatory Authorization: Bearer <SPIKE_CONTROL_TOKEN> on all
 * non-OPTIONS requests using constant-time SHA-256 digest comparison.
 */

import {
  presignR2UploadPart,
  type AwsClientLike,
} from './presigner.ts';
import {
  SPIKE_FINAL_PART_SIZE_BYTES,
  SPIKE_PART_SIZE_BYTES,
  SPIKE_TOTAL_SIZE_BYTES,
  type SpikeBucketEmptyCheckResponse,
  type SpikeCleanupResult,
  type SpikeCompleteRequest,
  type SpikeCompleteResponse,
  type SpikeHeadVerificationResponse,
  type SpikeInitiateResponse,
} from './protocol.ts';

export interface R2UploadedPart {
  partNumber: number;
  etag: string;
}

export interface R2ObjectBinding {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  httpMetadata?: {
    contentType?: string;
  };
}

export interface R2ObjectsListResult {
  objects: R2ObjectBinding[];
  truncated: boolean;
}

export interface R2MultipartUploadBinding {
  key: string;
  uploadId: string;
  complete(uploadedParts: R2UploadedPart[]): Promise<R2ObjectBinding>;
  abort(): Promise<void>;
}

export interface R2BucketBinding {
  createMultipartUpload(
    key: string,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    }
  ): Promise<R2MultipartUploadBinding>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUploadBinding;
  head(key: string): Promise<R2ObjectBinding | null>;
  delete(keys: string | string[]): Promise<void>;
  list?(options?: { limit?: number; prefix?: string }): Promise<R2ObjectsListResult>;
}

export interface SpikeWorkerEnv {
  AUDIO_SPIKE_BUCKET: R2BucketBinding;
  R2_ACCOUNT_ID: string;
  R2_SPIKE_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  SPIKE_CONTROL_TOKEN: string;
  SPIKE_ALLOWED_ORIGIN?: string;
  awsClient?: AwsClientLike;
}

export function generateSpikeRunIdentity(): { runId: string; objectKey: string } {
  const runId = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const assetUuid = crypto.randomUUID();
  const shard = assetUuid.slice(0, 2);
  return {
    runId,
    objectKey: `v1/spike/${runId}/${shard}/${assetUuid}`,
  };
}

export async function computeObjectKeySha256Prefix(objectKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(objectKey);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies Authorization: Bearer <SPIKE_CONTROL_TOKEN> using constant-time
 * comparison over fixed-length 32-byte SHA-256 digests so neither token length
 * nor prefix differences leak via timing.
 */
export async function verifySpikeControlToken(
  request: Request,
  expectedToken: string | undefined
): Promise<boolean> {
  if (!expectedToken || expectedToken.trim().length < 16) {
    return false;
  }

  const authHeader = request.headers.get('Authorization') ?? request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const providedToken = authHeader.slice('Bearer '.length).trim();
  if (!providedToken) {
    return false;
  }

  const encoder = new TextEncoder();
  const providedBytes = encoder.encode(providedToken);
  const expectedBytes = encoder.encode(expectedToken.trim());

  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', providedBytes.buffer as ArrayBuffer),
    crypto.subtle.digest('SHA-256', expectedBytes.buffer as ArrayBuffer),
  ]);

  const subtleWithTimingSafe = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView | ArrayBuffer, b: ArrayBufferView | ArrayBuffer) => boolean;
  };

  if (typeof subtleWithTimingSafe.timingSafeEqual === 'function') {
    return subtleWithTimingSafe.timingSafeEqual(providedDigest, expectedDigest);
  }

  const viewA = new Uint8Array(providedDigest);
  const viewB = new Uint8Array(expectedDigest);
  if (viewA.byteLength !== viewB.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < viewA.byteLength; i++) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

export async function createAndSignSpikeMultipartSession(
  env: SpikeWorkerEnv,
  options?: {
    runId?: string;
    objectKey?: string;
    contentType?: string;
    nowMs?: number;
  }
): Promise<SpikeInitiateResponse> {
  const identity = generateSpikeRunIdentity();
  const runId = options?.runId ?? identity.runId;
  const objectKey = options?.objectKey ?? identity.objectKey;
  const objectKeySha256Prefix = await computeObjectKeySha256Prefix(objectKey);
  const contentType = options?.contentType ?? 'audio/webm';

  const multipart = await env.AUDIO_SPIKE_BUCKET.createMultipartUpload(objectKey, {
    httpMetadata: { contentType },
  });

  if (!multipart.uploadId || !multipart.uploadId.trim()) {
    throw new Error('R2 createMultipartUpload returned an empty uploadId');
  }

  const partSizes = [
    { partNumber: 1, expectedByteLength: SPIKE_PART_SIZE_BYTES },
    { partNumber: 2, expectedByteLength: SPIKE_PART_SIZE_BYTES },
    { partNumber: 3, expectedByteLength: SPIKE_FINAL_PART_SIZE_BYTES },
  ];

  const presignedParts = await Promise.all(
    partSizes.map((part) =>
      presignR2UploadPart(
        {
          accountId: env.R2_ACCOUNT_ID,
          bucketName: env.R2_SPIKE_BUCKET_NAME,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          awsClient: env.awsClient,
        },
        {
          objectKey,
          uploadId: multipart.uploadId,
          partNumber: part.partNumber,
          expectedByteLength: part.expectedByteLength,
          nowMs: options?.nowMs,
        }
      )
    )
  );

  return {
    runId,
    objectKey,
    objectKeySha256Prefix,
    uploadId: multipart.uploadId,
    partSizeBytes: SPIKE_PART_SIZE_BYTES,
    totalSizeBytes: SPIKE_TOTAL_SIZE_BYTES,
    presignedParts,
  };
}

export async function completeSpikeMultipartSession(
  env: SpikeWorkerEnv,
  request: SpikeCompleteRequest
): Promise<SpikeCompleteResponse> {
  if (!request.objectKey || !request.uploadId) {
    throw new Error('Missing objectKey or uploadId for multipart complete');
  }
  if (!Array.isArray(request.parts) || request.parts.length !== 3) {
    throw new Error('Expected exactly 3 uploaded parts for 18 MiB spike');
  }

  // Sort parts canonically by partNumber ascending and reject empty ETags
  const sortedParts = [...request.parts].sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < sortedParts.length; i++) {
    const part = sortedParts[i];
    if (part.partNumber !== i + 1) {
      throw new Error(`Non-sequential partNumber at index ${i}: ${part.partNumber}`);
    }
    if (!part.etag || !part.etag.trim()) {
      throw new Error(`Empty ETag for partNumber ${part.partNumber}`);
    }
  }

  const multipart = env.AUDIO_SPIKE_BUCKET.resumeMultipartUpload(
    request.objectKey,
    request.uploadId
  );
  const completedObject = await multipart.complete(sortedParts);
  const objectKeySha256Prefix = await computeObjectKeySha256Prefix(completedObject.key);

  return {
    objectKey: completedObject.key,
    objectKeySha256Prefix,
    etag: completedObject.httpEtag || completedObject.etag,
  };
}

export async function verifySpikeObjectHead(
  env: SpikeWorkerEnv,
  objectKey: string
): Promise<SpikeHeadVerificationResponse> {
  const objectKeySha256Prefix = await computeObjectKeySha256Prefix(objectKey);
  const headObj = await env.AUDIO_SPIKE_BUCKET.head(objectKey);
  if (!headObj) {
    return {
      objectKey,
      objectKeySha256Prefix,
      exists: false,
      sizeBytes: 0,
      etag: null,
      contentType: null,
    };
  }

  return {
    objectKey: headObj.key,
    objectKeySha256Prefix,
    exists: true,
    sizeBytes: headObj.size,
    etag: headObj.httpEtag || headObj.etag,
    contentType: headObj.httpMetadata?.contentType ?? null,
  };
}

export async function cleanupDeleteSpikeObject(
  env: SpikeWorkerEnv,
  objectKey: string,
  runId: string = 'unknown_run'
): Promise<SpikeCleanupResult> {
  const objectKeySha256Prefix = await computeObjectKeySha256Prefix(objectKey);
  try {
    await env.AUDIO_SPIKE_BUCKET.delete(objectKey);
    return {
      action: 'delete_object',
      runId,
      objectKeySha256Prefix,
      succeeded: true,
    };
  } catch {
    return {
      action: 'delete_object',
      runId,
      objectKeySha256Prefix,
      succeeded: false,
      errorCategory: 'CLEANUP_FAILED',
    };
  }
}

export async function cleanupAbortSpikeMultipart(
  env: SpikeWorkerEnv,
  objectKey: string,
  uploadId: string,
  runId: string = 'unknown_run'
): Promise<SpikeCleanupResult> {
  const objectKeySha256Prefix = await computeObjectKeySha256Prefix(objectKey);
  try {
    const multipart = env.AUDIO_SPIKE_BUCKET.resumeMultipartUpload(objectKey, uploadId);
    await multipart.abort();
    return {
      action: 'abort_multipart',
      runId,
      objectKeySha256Prefix,
      succeeded: true,
    };
  } catch {
    return {
      action: 'abort_multipart',
      runId,
      objectKeySha256Prefix,
      succeeded: false,
      errorCategory: 'CLEANUP_FAILED',
    };
  }
}

export async function verifySpikeBucketEmpty(
  env: SpikeWorkerEnv
): Promise<SpikeBucketEmptyCheckResponse> {
  if (typeof env.AUDIO_SPIKE_BUCKET.list !== 'function') {
    throw new Error('R2Bucket.list binding is required to verify bucket emptiness');
  }
  const listed = await env.AUDIO_SPIKE_BUCKET.list({ limit: 10 });
  return {
    empty: listed.objects.length === 0,
    sampleObjectCount: listed.objects.length,
  };
}

function buildCorsHeaders(env: SpikeWorkerEnv): Record<string, string> {
  const allowedOrigin = env.SPIKE_ALLOWED_ORIGIN || 'http://localhost:3000';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, Accept-Ranges',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export default {
  async fetch(request: Request, env: SpikeWorkerEnv): Promise<Response> {
    const corsHeaders = buildCorsHeaders(env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const authorized = await verifySpikeControlToken(request, env.SPIKE_CONTROL_TOKEN);
    if (!authorized) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'POST' && url.pathname === '/spike/multipart/initiate') {
        const result = await createAndSignSpikeMultipartSession(env);
        return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
      }

      if (request.method === 'POST' && url.pathname === '/spike/multipart/complete') {
        const body = (await request.json()) as SpikeCompleteRequest;
        const result = await completeSpikeMultipartSession(env, body);
        return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
      }

      if (request.method === 'GET' && url.pathname === '/spike/multipart/head') {
        const objectKey = url.searchParams.get('objectKey') || '';
        const result = await verifySpikeObjectHead(env, objectKey);
        return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
      }

      if (request.method === 'POST' && url.pathname === '/spike/multipart/cleanup-delete') {
        const body = (await request.json()) as { objectKey: string; runId?: string };
        const result = await cleanupDeleteSpikeObject(env, body.objectKey, body.runId);
        return new Response(JSON.stringify(result), {
          status: result.succeeded ? 200 : 500,
          headers: corsHeaders,
        });
      }

      if (request.method === 'POST' && url.pathname === '/spike/multipart/cleanup-abort') {
        const body = (await request.json()) as {
          objectKey: string;
          uploadId: string;
          runId?: string;
        };
        const result = await cleanupAbortSpikeMultipart(
          env,
          body.objectKey,
          body.uploadId,
          body.runId
        );
        return new Response(JSON.stringify(result), {
          status: result.succeeded ? 200 : 500,
          headers: corsHeaders,
        });
      }

      if (request.method === 'GET' && url.pathname === '/spike/multipart/verify-empty') {
        const result = await verifySpikeBucketEmpty(env);
        return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
        status: 404,
        headers: corsHeaders,
      });
    } catch {
      return new Response(
        JSON.stringify({ error: 'SPIKE_OPERATION_FAILED' }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
