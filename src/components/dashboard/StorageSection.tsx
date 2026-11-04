import React, { useEffect, useState } from 'react';
import { Database, Download, HardDrive, Shield, ShieldCheck, ShieldAlert, UploadCloud, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import {
  getStorageEstimate,
  getStoragePersistence,
  requestStoragePersistence,
  type StorageEstimateInfo,
  type StoragePersistenceStatus,
} from '@/features/workspace/storage-adapter';

export interface StorageSectionProps {
  onExportWorkspace: () => void;
  onImportBackup: () => void;
}

export const StorageSection: React.FC<StorageSectionProps> = ({
  onExportWorkspace,
  onImportBackup,
}) => {
  const [estimate, setEstimate] = useState<StorageEstimateInfo>({
    supported: false,
    usageBytes: null,
    quotaBytes: null,
    usagePercent: null,
    usageFormatted: '-',
    quotaFormatted: '-',
  });
  const [persistenceStatus, setPersistenceStatus] = useState<StoragePersistenceStatus>('unsupported');
  const [requesting, setRequesting] = useState(false);

  const refreshStorageInfo = async () => {
    const [est, pers] = await Promise.all([
      getStorageEstimate(),
      getStoragePersistence(),
    ]);
    setEstimate(est);
    setPersistenceStatus(pers);
  };

  useEffect(() => {
    refreshStorageInfo();
  }, []);

  const handleProtectStorage = async () => {
    setRequesting(true);
    try {
      const result = await requestStoragePersistence();
      setPersistenceStatus(result.status);
      await refreshStorageInfo();
    } finally {
      setRequesting(false);
    }
  };

  const getPersistenceBadge = () => {
    switch (persistenceStatus) {
      case 'persisted':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
            <span>{t('Perlindungan aktif')}</span>
          </span>
        );
      case 'not-persisted':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <Shield className="size-3.5 text-amber-600" aria-hidden="true" />
            <span>{t('Perlindungan belum aktif')}</span>
          </span>
        );
      case 'denied':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">
            <ShieldAlert className="size-3.5 text-zinc-500" aria-hidden="true" />
            <span>{t('Ditolak browser')}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600 border border-zinc-200">
            <span>{t('Tidak didukung')}</span>
          </span>
        );
    }
  };

  return (
    <section aria-label={t('Data dan penyimpanan')} className="w-full space-y-6">
      {/* Header Row: Title, Badge & Global Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="size-8 rounded-lg bg-[#E8F1F8] text-[#172F49] grid place-items-center shrink-0">
              <Database className="size-4" aria-hidden="true" />
            </div>
            <h2 className="text-base sm:text-lg font-semibold text-[#152B41]">
              {t('Data dan penyimpanan')}
            </h2>
            {getPersistenceBadge()}
          </div>
          <p className="text-xs sm:text-sm text-[#526171] leading-relaxed">
            {t('Semua rekaman, audio, dan naskah disimpan langsung di browser perangkat Anda.')}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          <Button
            variant="outline"
            onClick={onImportBackup}
            className="min-h-[44px] h-[44px] px-4 text-xs sm:text-sm font-semibold text-[#152B41] bg-white border-[var(--border)] hover:bg-[var(--accent)] gap-2 shadow-2xs"
          >
            <UploadCloud className="size-4 text-[#172F49]" aria-hidden="true" />
            <span>{t('Import backup')}</span>
          </Button>
          <Button
            variant="outline"
            onClick={onExportWorkspace}
            className="min-h-[44px] h-[44px] px-4 text-xs sm:text-sm font-semibold text-[#152B41] bg-white border-[var(--border)] hover:bg-[var(--accent)] gap-2 shadow-2xs"
          >
            <Download className="size-4 text-[#172F49]" aria-hidden="true" />
            <span>{t('Export seluruh workspace')}</span>
          </Button>
        </div>
      </div>

      {/* Internal Columns: Storage Quota & Protection without nested card clutter */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-5 border-t border-[var(--border)]/70">
        {/* Left Column: Browser Quota */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-[#152B41] font-semibold flex items-center gap-2">
              <HardDrive className="size-4 text-[#526171]" aria-hidden="true" />
              {t('Kapasitas browser')}
            </span>
            <span className="font-mono text-xs sm:text-sm font-medium text-[#152B41]">
              {estimate.supported
                ? `${estimate.usageFormatted} / ${estimate.quotaFormatted}`
                : t('Estimasi tidak tersedia')}
            </span>
          </div>

          {estimate.supported && estimate.usagePercent !== null && (
            <div className="space-y-1.5">
              <div className="w-full bg-[#E2E8F0] rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#172F49] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(2, estimate.usagePercent)}%` }}
                />
              </div>
              <p className="text-[11px] sm:text-xs text-[#526171] text-right">
                {estimate.usagePercent}% {t('dari batas alokasi browser')}
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Storage Persistence */}
        <div className="flex flex-col justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-xs sm:text-sm font-semibold text-[#152B41]">
              {t('Perlindungan penyimpanan')}
            </h3>
            <p className="text-xs sm:text-sm text-[#526171] leading-relaxed">
              {t('Penyimpanan persisten mengurangi kemungkinan browser menghapus data saat ruang disk perangkat menipis.')}
            </p>
          </div>

          {persistenceStatus === 'not-persisted' && (
            <div className="pt-1">
              <Button
                variant="outline"
                onClick={handleProtectStorage}
                disabled={requesting}
                className="min-h-[44px] h-[44px] px-4 text-xs sm:text-sm font-semibold bg-white text-[#152B41] border-[var(--border)] hover:bg-[var(--accent)] gap-2"
              >
                {requesting ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin text-[#172F49]" aria-hidden="true" />
                    <span>{t('Menghubungi browser...')}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
                    <span>{t('Lindungi penyimpanan lokal')}</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Summary Note callout */}
      <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 text-xs sm:text-sm text-[#92400E] leading-relaxed">
        <strong className="font-semibold text-[#78350F]">{t('Catatan penting:')}</strong>{' '}
        {t('Rekaman dapat terhapus jika data situs atau riwayat browser dibersihkan. Ekspor workspace secara rutin untuk menyimpan cadangan di komputer Anda.')}
      </div>
    </section>
  );
};
