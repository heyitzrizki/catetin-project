import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import {
  SPIKE_FINAL_PART_SIZE_BYTES,
  SPIKE_PART_SIZE_BYTES,
  SPIKE_TOTAL_SIZE_BYTES,
  type PartSliceDescriptor,
  type UploadedPartReceipt,
} from '../protocol.ts';
import {
  buildStructuredUploadPartUrl,
  createOfficialR2AwsClient,
  presignR2UploadPart,
  type AwsClientLike,
} from '../presigner.ts';
import {
  SpikeCategorizedError,
  createDeterministic18MiBPayload,
  createHttpSpikeControlPlane,
  createSanitizedSpikeLogger,
  normalizeAndSortUploadedParts,
  runMultipartInteroperabilitySpike,
  sliceMultipartPayload,
  validatePartSlicesUniformity,
} from '../runner.ts';
import { runBrowserMultipartCorsSpike } from '../browser-runner.ts';
import spikeWorker, {
  type R2BucketBinding,
  type R2ObjectBinding,
  type R2UploadedPart,
  type SpikeWorkerEnv,
} from '../worker.ts';

const TEST_CONTROL_TOKEN = 'spike_ctrl_token_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

test('1. Official aws4fetch AwsClient is used at runtime and signs structured URL once', async () => {
  const officialClient = createOfficialR2AwsClient({
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
  assert.ok(
    officialClient instanceof AwsClient,
    'Runtime client must be an instance of official aws4fetch AwsClient'
  );

  let signCallCount = 0;
  let capturedInputUrl = '';

  const spySigner: AwsClientLike = {
    async sign(input, init) {
      signCallCount += 1;
      const req = typeof input === 'string' ? new Request(input) : input;
      capturedInputUrl = req.url;
      return officialClient.sign(req, init);
    },
  };

  const target = await presignR2UploadPart(
    {
      accountId: '56304fb6c6e984eec2317ec554802a2d',
      bucketName: 'workspace-audio-spike',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      awsClient: spySigner,
    },
    {
      objectKey: 'v1/spike/run_01/ab/test-object-uuid',
      uploadId: 'r2-upload-id-001',
      partNumber: 2,
      expectedByteLength: SPIKE_PART_SIZE_BYTES,
      expiresInSeconds: 900,
      nowMs: 1762740000000,
    }
  );

  assert.equal(signCallCount, 1, 'aws4fetch AwsClient.sign must be called once per part');
  assert.ok(capturedInputUrl.includes('partNumber=2'));
  assert.ok(capturedInputUrl.includes('uploadId=r2-upload-id-001'));
  assert.ok(capturedInputUrl.includes('X-Amz-Expires=900'));

  const signedUrl = new URL(target.uploadUrl);
  assert.equal(
    signedUrl.origin,
    'https://56304fb6c6e984eec2317ec554802a2d.r2.cloudflarestorage.com'
  );
  assert.equal(
    signedUrl.pathname,
    '/workspace-audio-spike/v1/spike/run_01/ab/test-object-uuid'
  );
  assert.equal(signedUrl.searchParams.get('partNumber'), '2');
  assert.equal(signedUrl.searchParams.get('uploadId'), 'r2-upload-id-001');
  assert.equal(signedUrl.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(signedUrl.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(signedUrl.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(signedUrl.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
});

test('2. Official aws4fetch handles uploadId with +, /, =, spaces, and percent sequences without double-encoding', async () => {
  const trickyUploadIds = [
    'upload+id/with=base64==',
    'upload id with spaces/and+plus=equals',
    'already%2Bencoded%2Fsegment%3D1%20end',
  ];

  for (const rawUploadId of trickyUploadIds) {
    const structuredUrl = buildStructuredUploadPartUrl({
      accountId: '56304fb6c6e984eec2317ec554802a2d',
      bucketName: 'workspace-audio-spike',
      objectKey: 'v1/spike/run_02/cd/encoding-check',
      partNumber: 1,
      uploadId: rawUploadId,
    });

    assert.equal(structuredUrl.searchParams.get('uploadId'), rawUploadId);

    // Sign using the real official aws4fetch AwsClient (no fake/custom signer)
    const presigned = await presignR2UploadPart(
      {
        accountId: '56304fb6c6e984eec2317ec554802a2d',
        bucketName: 'workspace-audio-spike',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      {
        objectKey: 'v1/spike/run_02/cd/encoding-check',
        uploadId: rawUploadId,
        partNumber: 1,
        expectedByteLength: SPIKE_PART_SIZE_BYTES,
      }
    );

    const parsedSigned = new URL(presigned.uploadUrl);
    assert.equal(
      parsedSigned.searchParams.get('uploadId'),
      rawUploadId,
      `Decoded uploadId from aws4fetch signed URL must match original rawUploadId: ${rawUploadId}`
    );

    if (rawUploadId === 'upload+id/with=base64==') {
      assert.ok(
        presigned.uploadUrl.includes('uploadId=upload%2Bid%2Fwith%3Dbase64%3D%3D'),
        'Special characters +, /, = must be encoded once in signed URL'
      );
      assert.ok(
        !presigned.uploadUrl.includes('%252B') && !presigned.uploadUrl.includes('%252F'),
        'aws4fetch signed URL must never double-encode percent sequences'
      );
    }
  }
});

test('3. Part slicing produces exact 8 MiB + 8 MiB + 2 MiB (18 MiB) and rejects non-uniform parts', () => {
  const payload = createDeterministic18MiBPayload();
  assert.equal(payload.byteLength, SPIKE_TOTAL_SIZE_BYTES);
  assert.equal(payload.byteLength, 18 * 1024 * 1024);

  const slices = sliceMultipartPayload(payload, SPIKE_PART_SIZE_BYTES);
  assert.equal(slices.length, 3);

  assert.equal(slices[0].partNumber, 1);
  assert.equal(slices[0].offsetBytes, 0);
  assert.equal(slices[0].byteLength, SPIKE_PART_SIZE_BYTES);
  assert.equal(slices[0].byteLength, 8_388_608);

  assert.equal(slices[1].partNumber, 2);
  assert.equal(slices[1].offsetBytes, SPIKE_PART_SIZE_BYTES);
  assert.equal(slices[1].byteLength, SPIKE_PART_SIZE_BYTES);
  assert.equal(slices[1].byteLength, 8_388_608);

  assert.equal(slices[2].partNumber, 3);
  assert.equal(slices[2].offsetBytes, SPIKE_PART_SIZE_BYTES * 2);
  assert.equal(slices[2].byteLength, SPIKE_FINAL_PART_SIZE_BYTES);
  assert.equal(slices[2].byteLength, 2_097_152);

  assert.notDeepEqual(slices[0].payload.subarray(0, 64), slices[1].payload.subarray(0, 64));
  assert.notDeepEqual(slices[1].payload.subarray(0, 64), slices[2].payload.subarray(0, 64));

  const malformedSlices: PartSliceDescriptor[] = [
    { partNumber: 1, offsetBytes: 0, byteLength: 6 * 1024 * 1024, payload: new Uint8Array(10) },
    { partNumber: 2, offsetBytes: 6 * 1024 * 1024, byteLength: 8 * 1024 * 1024, payload: new Uint8Array(10) },
    { partNumber: 3, offsetBytes: 14 * 1024 * 1024, byteLength: 2 * 1024 * 1024, payload: new Uint8Array(10) },
  ];

  assert.throws(
    () => validatePartSlicesUniformity(malformedSlices, SPIKE_PART_SIZE_BYTES),
    (err: unknown) =>
      err instanceof SpikeCategorizedError && err.category === 'INVALID_PART_SIZE'
  );
});

test('4. Uploaded parts are sorted ascending by partNumber and missing/empty ETags are rejected', () => {
  const outOfOrderReceipts: UploadedPartReceipt[] = [
    { partNumber: 3, etag: '"etag-part-3"', byteLength: SPIKE_FINAL_PART_SIZE_BYTES, httpStatus: 200 },
    { partNumber: 1, etag: '"etag-part-1"', byteLength: SPIKE_PART_SIZE_BYTES, httpStatus: 200 },
    { partNumber: 2, etag: '"etag-part-2"', byteLength: SPIKE_PART_SIZE_BYTES, httpStatus: 200 },
  ];

  const sorted = normalizeAndSortUploadedParts(outOfOrderReceipts, 3);
  assert.deepEqual(sorted, [
    { partNumber: 1, etag: '"etag-part-1"' },
    { partNumber: 2, etag: '"etag-part-2"' },
    { partNumber: 3, etag: '"etag-part-3"' },
  ]);

  const emptyEtagReceipts: UploadedPartReceipt[] = [
    { partNumber: 1, etag: '"etag-part-1"', byteLength: SPIKE_PART_SIZE_BYTES, httpStatus: 200 },
    { partNumber: 2, etag: '   ', byteLength: SPIKE_PART_SIZE_BYTES, httpStatus: 200 },
    { partNumber: 3, etag: '"etag-part-3"', byteLength: SPIKE_FINAL_PART_SIZE_BYTES, httpStatus: 200 },
  ];

  assert.throws(
    () => normalizeAndSortUploadedParts(emptyEtagReceipts, 3),
    (err: unknown) => err instanceof SpikeCategorizedError && err.category === 'MISSING_ETAG'
  );
});

test('5. Control-plane authorization: rejects missing/wrong token with 401 and never sends Authorization to R2 PUT URLs', async () => {
  const storedObjects = new Map<string, number>();
  const mockBucket: R2BucketBinding = {
    async createMultipartUpload(key) {
      return {
        key,
        uploadId: 'auth+test/uploadId=1',
        async complete() {
          throw new Error('Not used');
        },
        async abort() {},
      };
    },
    resumeMultipartUpload(key, uploadId) {
      return {
        key,
        uploadId,
        async complete(): Promise<R2ObjectBinding> {
          storedObjects.set(key, SPIKE_TOTAL_SIZE_BYTES);
          return {
            key,
            size: SPIKE_TOTAL_SIZE_BYTES,
            etag: 'etag-18mib',
            httpEtag: '"etag-18mib"',
          };
        },
        async abort() {},
      };
    },
    async head(key) {
      const size = storedObjects.get(key);
      if (size === undefined) return null;
      return {
        key,
        size,
        etag: 'etag-18mib',
        httpEtag: '"etag-18mib"',
      };
    },
    async delete(keys) {
      const k = Array.isArray(keys) ? keys[0] : keys;
      storedObjects.delete(k);
    },
    async list() {
      return {
        objects: Array.from(storedObjects.entries()).map(([key, size]) => ({
          key,
          size,
          etag: 'e',
          httpEtag: '"e"',
        })),
        truncated: false,
      };
    },
  };

  const env: SpikeWorkerEnv = {
    AUDIO_SPIKE_BUCKET: mockBucket,
    R2_ACCOUNT_ID: '56304fb6c6e984eec2317ec554802a2d',
    R2_SPIKE_BUCKET_NAME: 'workspace-audio-spike',
    R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    SPIKE_CONTROL_TOKEN: TEST_CONTROL_TOKEN,
  };

  // A. OPTIONS preflight does not require token
  const optionsRes = await spikeWorker.fetch(
    new Request('http://localhost:8789/spike/multipart/initiate', { method: 'OPTIONS' }),
    env
  );
  assert.equal(optionsRes.status, 204);

  // B. Missing Authorization header -> 401 generic body
  const unauthRes = await spikeWorker.fetch(
    new Request('http://localhost:8789/spike/multipart/initiate', { method: 'POST' }),
    env
  );
  assert.equal(unauthRes.status, 401);
  assert.deepEqual(await unauthRes.json(), { error: 'UNAUTHORIZED' });

  // C. Wrong bearer token -> 401 generic body
  const wrongTokenRes = await spikeWorker.fetch(
    new Request('http://localhost:8789/spike/multipart/initiate', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong_token_value_12345678901234567890' },
    }),
    env
  );
  assert.equal(wrongTokenRes.status, 401);
  assert.deepEqual(await wrongTokenRes.json(), { error: 'UNAUTHORIZED' });

  // D. Valid bearer token via HTTP Control Plane + verify R2 PUT receives zero Authorization header
  const workerAuthHeadersSeen: Array<string | null> = [];
  const r2PutAuthHeadersSeen: Array<string | null> = [];

  const customFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      r2PutAuthHeadersSeen.push(req.headers.get('Authorization'));
      const partNo = url.searchParams.get('partNumber') ?? '1';
      return new Response(null, {
        status: 200,
        headers: { ETag: `"etag-part-${partNo}"` },
      });
    }
    workerAuthHeadersSeen.push(req.headers.get('Authorization'));
    return spikeWorker.fetch(req, env);
  };

  const controlPlane = createHttpSpikeControlPlane({
    workerBaseUrl: 'http://localhost:8789',
    controlToken: TEST_CONTROL_TOKEN,
    fetchImpl: customFetch,
  });

  const report = await runMultipartInteroperabilitySpike(controlPlane);
  assert.equal(report.succeeded, true);
  assert.equal(report.verifiedHeadBytes, SPIKE_TOTAL_SIZE_BYTES);
  assert.equal(report.cleanup.action, 'delete_object');
  assert.equal(report.cleanup.succeeded, true);

  assert.equal(r2PutAuthHeadersSeen.length, 3);
  for (const r2Auth of r2PutAuthHeadersSeen) {
    assert.equal(r2Auth, null, 'Presigned R2 PUT request must NEVER carry Authorization header');
  }
  assert.ok(workerAuthHeadersSeen.length >= 4);
  for (const workerAuth of workerAuthHeadersSeen) {
    assert.equal(workerAuth, `Bearer ${TEST_CONTROL_TOKEN}`);
  }
});

test('6. Cleanup safety & Browser CORS runner: fails explicitly with CORS_ETAG_NOT_EXPOSED when ETag is hidden', async () => {
  let abortedCount = 0;
  let deletedCount = 0;

  const mockBucket: R2BucketBinding = {
    async createMultipartUpload(key) {
      return {
        key,
        uploadId: 'cors-test-upload-id',
        async complete() {
          throw new Error('Should not complete');
        },
        async abort() {
          abortedCount += 1;
        },
      };
    },
    resumeMultipartUpload(key, uploadId) {
      return {
        key,
        uploadId,
        async complete(): Promise<R2ObjectBinding> {
          return { key, size: SPIKE_TOTAL_SIZE_BYTES, etag: 'e', httpEtag: '"e"' };
        },
        async abort() {
          abortedCount += 1;
        },
      };
    },
    async head() {
      return null;
    },
    async delete() {
      deletedCount += 1;
    },
  };

  const env: SpikeWorkerEnv = {
    AUDIO_SPIKE_BUCKET: mockBucket,
    R2_ACCOUNT_ID: '56304fb6c6e984eec2317ec554802a2d',
    R2_SPIKE_BUCKET_NAME: 'workspace-audio-spike',
    R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    SPIKE_CONTROL_TOKEN: TEST_CONTROL_TOKEN,
  };

  // Simulate browser fetch where R2 returns 200 OK on PUT, but CORS ExposeHeaders is missing ETag
  const browserFetchWithoutExposedEtag: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      return new Response(null, { status: 200 });
    }
    return spikeWorker.fetch(req, env);
  };

  const corsFailReport = await runBrowserMultipartCorsSpike({
    workerBaseUrl: 'http://localhost:8789',
    controlToken: TEST_CONTROL_TOKEN,
    fetchImpl: browserFetchWithoutExposedEtag,
  });

  assert.equal(corsFailReport.succeeded, false);
  assert.equal(corsFailReport.completedMultipart, false);
  assert.equal(corsFailReport.failureCategory, 'CORS_ETAG_NOT_EXPOSED');
  assert.equal(corsFailReport.cleanup.action, 'abort_multipart');
  assert.equal(corsFailReport.cleanup.succeeded, true);
  assert.match(corsFailReport.runId, /^run_[0-9a-f]{12}$/);
  assert.match(corsFailReport.objectKeySha256Prefix, /^[0-9a-f]{16}$/);
  assert.equal(abortedCount, 1);
  assert.equal(deletedCount, 0);
});

test('7. Sanitized logging & cleanup failure diagnostics never leak tokens, signed URLs, or raw uploadId', () => {
  const logger = createSanitizedSpikeLogger(() => '2026-11-10T02:00:00.000Z');
  logger.setRunContext('run_abcdef123456', '0123456789abcdef');

  const untrustedEntry = {
    phase: 'cleanup_abort_multipart' as const,
    cleanupAction: 'abort_multipart' as const,
    cleanupSucceeded: false,
    errorCategory: 'CLEANUP_FAILED' as const,
    uploadUrl: 'https://secret.r2.cloudflarestorage.com/workspace-audio-spike?X-Amz-Signature=deadbeef',
    uploadId: 'sensitive-raw-upload-id-999',
    secretAccessKey: 'SUPER_SECRET_KEY_VALUE',
    controlToken: TEST_CONTROL_TOKEN,
  };

  logger.record(untrustedEntry);
  const serialized = JSON.stringify(logger.getEntries());

  assert.ok(!serialized.includes('deadbeef'), 'Signed URL signature must never appear in logs');
  assert.ok(!serialized.includes('sensitive-raw-upload-id-999'), 'Raw uploadId must never appear in logs');
  assert.ok(!serialized.includes('SUPER_SECRET_KEY_VALUE'), 'Secret key must never appear in logs');
  assert.ok(!serialized.includes(TEST_CONTROL_TOKEN), 'Control token must never appear in logs');
  assert.ok(serialized.includes('run_abcdef123456'), 'Sanitized runId must be recorded');
  assert.ok(serialized.includes('0123456789abcdef'), 'Sanitized objectKeySha256Prefix must be recorded');
});

test('8. Isolation & Blocker verification: official aws4fetch imported, custom WebCryptoAwsClient removed, config files valid', () => {
  const spikeDir = path.resolve(process.cwd(), 'spikes/r2-multipart-interoperability');
  const sourceFiles = [
    'protocol.ts',
    'presigner.ts',
    'worker.ts',
    'runner.ts',
    'browser-runner.ts',
  ];

  const presignerSource = fs.readFileSync(path.join(spikeDir, 'presigner.ts'), 'utf8');
  assert.ok(
    presignerSource.includes("from 'aws4fetch'"),
    'presigner.ts must import official aws4fetch package'
  );
  assert.ok(
    !presignerSource.includes('WebCryptoAwsClient'),
    'Custom WebCryptoAwsClient must be completely removed'
  );

  for (const file of sourceFiles) {
    const content = fs.readFileSync(path.join(spikeDir, file), 'utf8');
    assert.ok(
      !content.includes('WebCryptoAwsClient'),
      `${file} must not reference WebCryptoAwsClient`
    );
    assert.ok(
      !content.includes('encodeURIComponent(uploadId)') &&
        !content.includes('encodeURIComponent(r2UploadId)'),
      `${file} must not contain manual encodeURIComponent(uploadId)`
    );
    assert.ok(
      !/from\s+['"](\.\.\/)+worker\//.test(content) &&
        !/from\s+['"](\.\.\/)+src\//.test(content),
      `${file} must remain strictly isolated from worker/ and src/`
    );
  }

  // Verify isolated Wrangler spike config, CORS config, and Lifecycle config
  const wranglerSpikeRaw = fs.readFileSync(path.join(spikeDir, 'wrangler.spike.jsonc'), 'utf8');
  const wranglerSpike = JSON.parse(wranglerSpikeRaw);
  assert.equal(wranglerSpike.name, 'catetin-r2-multipart-spike');
  assert.equal(wranglerSpike.main, 'worker.ts');
  assert.equal(wranglerSpike.r2_buckets[0].binding, 'AUDIO_SPIKE_BUCKET');
  assert.equal(wranglerSpike.r2_buckets[0].bucket_name, 'workspace-audio-spike');

  const corsSpike = JSON.parse(fs.readFileSync(path.join(spikeDir, 'cors-spike.json'), 'utf8'));
  assert.ok(Array.isArray(corsSpike.rules));
  assert.ok(corsSpike.rules[0].exposeHeaders.includes('ETag'));
  assert.ok(corsSpike.rules[0].allowed.methods.includes('PUT'));

  const lifecycleSpike = JSON.parse(
    fs.readFileSync(path.join(spikeDir, 'lifecycle-spike.json'), 'utf8')
  );
  assert.ok(Array.isArray(lifecycleSpike.rules));
  assert.equal(
    lifecycleSpike.rules[0].abortMultipartUploadsTransition.condition.maxAge,
    604800
  );

  assert.ok(fs.existsSync(path.join(spikeDir, '.dev.vars.example')));
  assert.ok(fs.existsSync(path.join(spikeDir, 'browser-runner.html')));
});
