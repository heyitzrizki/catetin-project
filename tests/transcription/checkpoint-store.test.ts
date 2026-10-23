import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  deleteCheckpoint, findResumableCheckpoint, listCheckpointSummaries,
  purgeExpiredCheckpoints, saveCheckpoint, setCheckpointRetention,
  type TranscriptionCheckpoint,
} from '../../src/features/transcription/checkpoint-store';
import type { JobCompatibility } from '../../src/features/transcription/types';

const DAY = 86_400_000;
const compatibility: JobCompatibility = {
  checkpointSchema: '1', transcriptionProtocol: '1', transformersVersion: '4.3.1',
  modelRepository: 'onnx-community/whisper-tiny', modelRevision: 'main',
  chunkPolicyVersion: '1', mergerVersion: '1', transcriptSchemaVersion: '1',
};
const settings = { model: 'tiny' as const, language: 'id' as const, backend: 'wasm' as const };

function checkpoint(overrides: Partial<TranscriptionCheckpoint> = {}): TranscriptionCheckpoint {
  return {
    id: 'job-1', inputFingerprint: 'sample:123', settings, compatibility,
    backendHistory: ['wasm'], chunks: [], state: 'resumable',
    createdAt: 0, updatedAt: 0, retentionMode: 'timed', ...overrides,
  };
}

async function deleteDatabase(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => {
  await deleteDatabase('catetin-transcription');
  await deleteDatabase('catetin-local');
});

test('resumes only an exact fingerprint, settings, and compatibility match', async () => {
  await saveCheckpoint(checkpoint());
  assert.equal((await findResumableCheckpoint('sample:123', settings, compatibility))?.id, 'job-1');
  assert.equal(await findResumableCheckpoint('other', settings, compatibility), null);
  assert.equal(await findResumableCheckpoint('sample:123', { ...settings, language: 'en' }, compatibility), null);
  assert.equal(await findResumableCheckpoint('sample:123', settings, { ...compatibility, mergerVersion: '2' }), null);
  assert.equal((await listCheckpointSummaries(0))[0].compatible, undefined);
});

test('expires timed checkpoints at 30 days and warns during the final seven days', async () => {
  await saveCheckpoint(checkpoint());
  const warning = (await listCheckpointSummaries(23 * DAY))[0];
  assert.equal(warning.expiresAt, 30 * DAY);
  assert.equal(warning.expiringSoon, true);
  assert.deepEqual(await purgeExpiredCheckpoints(30 * DAY), ['job-1']);
  assert.equal((await listCheckpointSummaries(30 * DAY)).length, 0);
});

test('manual retention never expires and can be changed explicitly', async () => {
  await saveCheckpoint(checkpoint());
  await setCheckpointRetention('job-1', 'manual');
  assert.deepEqual(await purgeExpiredCheckpoints(365 * DAY), []);
  assert.equal((await listCheckpointSummaries(365 * DAY))[0].expiresAt, null);
  await deleteCheckpoint('job-1');
  assert.equal((await listCheckpointSummaries(365 * DAY)).length, 0);
});

test('purging checkpoints cannot delete the editable workspace database', async () => {
  const open = indexedDB.open('catetin-local', 1);
  await new Promise<void>((resolve, reject) => {
    open.onupgradeneeded = () => open.result.createObjectStore('workspace');
    open.onsuccess = () => {
      const tx = open.result.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put({ transcript: 'tetap ada' }, 'current');
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
  await saveCheckpoint(checkpoint());
  await purgeExpiredCheckpoints(31 * DAY);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('catetin-local', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction('workspace').objectStore('workspace').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  assert.deepEqual(value, { transcript: 'tetap ada' });
});
