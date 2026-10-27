import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  getStorageEstimate,
  getStoragePersistence,
  requestStoragePersistence,
} from '../../src/features/workspace/storage-adapter';

test('formatBytes memformat ukuran byte secara akurat dan manusiawi', () => {
  assert.equal(formatBytes(null), '-');
  assert.equal(formatBytes(-10), '-');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(1073741824), '1.0 GB');
});

test('storage estimate pada browser/lingkungan tidak didukung gagal secara aman', async () => {
  const result = await getStorageEstimate(null);
  assert.equal(result.supported, false);
  assert.equal(result.usageBytes, null);
  assert.equal(result.quotaBytes, null);
  assert.equal(result.usagePercent, null);
  assert.equal(result.usageFormatted, '-');
});

test('storage estimate pada browser didukung menghitung usage dan persentase', async () => {
  const mockNav = {
    storage: {
      estimate: async () => ({
        usage: 50 * 1024 * 1024, // 50 MB
        quota: 500 * 1024 * 1024, // 500 MB
      }),
    },
  } as unknown as Navigator;

  const result = await getStorageEstimate(mockNav);
  assert.equal(result.supported, true);
  assert.equal(result.usageBytes, 50 * 1024 * 1024);
  assert.equal(result.quotaBytes, 500 * 1024 * 1024);
  assert.equal(result.usagePercent, 10);
  assert.equal(result.usageFormatted, '50.0 MB');
  assert.equal(result.quotaFormatted, '500.0 MB');
});

test('storage persistence status: supported, persisted, not-persisted, dan unsupported', async () => {
  // Unsupported
  const unsupportedStatus = await getStoragePersistence({} as Navigator);
  assert.equal(unsupportedStatus, 'unsupported');

  // Not persisted
  const mockNotPersisted = {
    storage: {
      persisted: async () => false,
    },
  } as unknown as Navigator;
  const statusNot = await getStoragePersistence(mockNotPersisted);
  assert.equal(statusNot, 'not-persisted');

  // Persisted
  const mockPersisted = {
    storage: {
      persisted: async () => true,
    },
  } as unknown as Navigator;
  const statusYes = await getStoragePersistence(mockPersisted);
  assert.equal(statusYes, 'persisted');
});

test('requestStoragePersistence menangani status berhasil, ditolak, atau tidak didukung', async () => {
  // Unsupported
  const resUnsupported = await requestStoragePersistence({} as Navigator);
  assert.equal(resUnsupported.persisted, false);
  assert.equal(resUnsupported.status, 'unsupported');

  // Granted
  const mockGranted = {
    storage: {
      persist: async () => true,
    },
  } as unknown as Navigator;
  const resGranted = await requestStoragePersistence(mockGranted);
  assert.equal(resGranted.persisted, true);
  assert.equal(resGranted.status, 'persisted');

  // Denied
  const mockDenied = {
    storage: {
      persist: async () => false,
    },
  } as unknown as Navigator;
  const resDenied = await requestStoragePersistence(mockDenied);
  assert.equal(resDenied.persisted, false);
  assert.equal(resDenied.status, 'denied');
});

