/**
 * Browser Storage Adapter for Catetin
 * Provides safe, wrapped access to navigator.storage.estimate() and navigator.storage.persist().
 * Works safely across desktop, mobile, and test environments.
 */

export interface StorageEstimateInfo {
  supported: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  usagePercent: number | null;
  usageFormatted: string;
  quotaFormatted: string;
}

export type StoragePersistenceStatus = 'persisted' | 'not-persisted' | 'denied' | 'unsupported';

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, unitIndex);
  return `${val.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export async function getStorageEstimate(
  nav?: Partial<Navigator> | null
): Promise<StorageEstimateInfo> {
  const currentNav = nav ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!currentNav?.storage?.estimate) {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      usagePercent: null,
      usageFormatted: '-',
      quotaFormatted: '-',
    };
  }

  try {
    const estimate = await currentNav.storage.estimate();
    const usage = typeof estimate.usage === 'number' ? estimate.usage : null;
    const quota = typeof estimate.quota === 'number' ? estimate.quota : null;
    let usagePercent: number | null = null;

    if (usage !== null && quota !== null && quota > 0) {
      usagePercent = Math.min(100, Math.max(0, Math.round((usage / quota) * 100)));
    }

    return {
      supported: true,
      usageBytes: usage,
      quotaBytes: quota,
      usagePercent,
      usageFormatted: formatBytes(usage),
      quotaFormatted: formatBytes(quota),
    };
  } catch {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      usagePercent: null,
      usageFormatted: '-',
      quotaFormatted: '-',
    };
  }
}

export async function getStoragePersistence(
  nav?: Partial<Navigator> | null
): Promise<StoragePersistenceStatus> {
  const currentNav = nav ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!currentNav?.storage?.persisted) {
    return 'unsupported';
  }

  try {
    const isPersisted = await currentNav.storage.persisted();
    return isPersisted ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

export async function requestStoragePersistence(
  nav?: Partial<Navigator> | null
): Promise<{ persisted: boolean; status: StoragePersistenceStatus }> {
  const currentNav = nav ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!currentNav?.storage?.persist) {
    return { persisted: false, status: 'unsupported' };
  }

  try {
    const persisted = await currentNav.storage.persist();
    return {
      persisted,
      status: persisted ? 'persisted' : 'denied',
    };
  } catch {
    return { persisted: false, status: 'denied' };
  }
}

