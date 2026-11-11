/**
 * Structured S3 Presigner for Phase R3B-A:
 * Cloudflare R2 Multipart Interoperability Spike.
 *
 * Enforces:
 * 1. Official aws4fetch AwsClient runtime signing.
 * 2. Structured URL construction via standard URL and URLSearchParams.
 * 3. Zero manual query parameter string concatenation.
 * 4. Single canonical query signing pass without double-encoding.
 */

import { AwsClient } from 'aws4fetch';
import {
  SPIKE_DEFAULT_PRESIGN_TTL_SECONDS,
  type PresignedPartTarget,
} from './protocol.ts';

export interface AwsSignOptions {
  aws?: {
    signQuery?: boolean;
    service?: string;
    region?: string;
    datetime?: string;
    allHeaders?: boolean;
  };
}

export interface AwsClientLike {
  sign(input: Request | string, init?: AwsSignOptions): Promise<Request>;
}

export interface R2PresignerConfig {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  awsClient?: AwsClientLike;
}

export interface PresignUploadPartInput {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  expectedByteLength: number;
  expiresInSeconds?: number;
  nowMs?: number;
}

/**
 * Instantiates the official aws4fetch AwsClient configured for Cloudflare R2 S3 API.
 */
export function createOfficialR2AwsClient(config: {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}): AwsClient {
  if (!config.accessKeyId.trim() || !config.secretAccessKey.trim()) {
    throw new Error('Missing R2 S3 credentials for AwsClient');
  }
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region ?? 'auto',
  });
}

/**
 * Builds the structured R2 S3 endpoint URL for an UploadPart operation
 * using URL and URLSearchParams without manual string encoding.
 */
export function buildStructuredUploadPartUrl(params: {
  accountId: string;
  bucketName: string;
  objectKey: string;
  partNumber: number;
  uploadId: string;
  expiresInSeconds?: number;
}): URL {
  const {
    accountId,
    bucketName,
    objectKey,
    partNumber,
    uploadId,
    expiresInSeconds = SPIKE_DEFAULT_PRESIGN_TTL_SECONDS,
  } = params;

  if (!accountId.trim() || !bucketName.trim() || !objectKey.trim() || !uploadId.trim()) {
    throw new Error('Invalid R2 endpoint parameters');
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    throw new Error(`Invalid partNumber: ${partNumber}`);
  }
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 604800) {
    throw new Error(`Invalid expiresInSeconds: ${expiresInSeconds}`);
  }

  const normalizedKey = objectKey.replace(/^\/+/, '');
  const endpoint = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${normalizedKey}`
  );

  // Set query parameters structurally via URLSearchParams
  endpoint.searchParams.set('partNumber', String(partNumber));
  endpoint.searchParams.set('uploadId', uploadId);
  endpoint.searchParams.set('X-Amz-Expires', String(expiresInSeconds));

  return endpoint;
}

/**
 * Signs a single R2 UploadPart PUT URL using structured URL construction
 * and official aws4fetch AwsClient.sign() with signQuery: true.
 */
export async function presignR2UploadPart(
  config: R2PresignerConfig,
  input: PresignUploadPartInput
): Promise<PresignedPartTarget> {
  const expiresInSeconds = input.expiresInSeconds ?? SPIKE_DEFAULT_PRESIGN_TTL_SECONDS;
  const nowMs = input.nowMs ?? Date.now();

  const endpoint = buildStructuredUploadPartUrl({
    accountId: config.accountId,
    bucketName: config.bucketName,
    objectKey: input.objectKey,
    partNumber: input.partNumber,
    uploadId: input.uploadId,
    expiresInSeconds,
  });

  const client: AwsClientLike =
    config.awsClient ??
    createOfficialR2AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region ?? 'auto',
    });

  const signedRequest = await client.sign(
    new Request(endpoint.toString(), { method: 'PUT' }),
    {
      aws: { signQuery: true, service: 's3', region: config.region ?? 'auto' },
    }
  );

  return {
    partNumber: input.partNumber,
    expectedByteLength: input.expectedByteLength,
    uploadUrl: signedRequest.url,
    expiresAtMs: nowMs + expiresInSeconds * 1000,
  };
}
