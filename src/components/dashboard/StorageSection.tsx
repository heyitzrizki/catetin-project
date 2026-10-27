import React, { useEffect, useState } from 'react';
import { Database, Download, HardDrive, Shield, ShieldCheck, ShieldAlert, UploadCloud, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Aktif (Dilindungi)
          </span>
        );
      case 'not-persisted':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Shield className="w-3.5 h-3.5 text-amber-600" />
            Belum aktif
          </span>
        );
      case 'denied':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
            <ShieldAlert className="w-3.5 h-3.5 text-zinc-500" />
            Ditolak browser
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-500 border border-zinc-200">
            Tidak didukung
          </span>
        );
    }
  };

  return (
    <section className="bg-white rounded-xl border border-zinc-200/80 p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-zinc-600" />
            <h3 className="text-sm font-semibold text-zinc-900">Data dan penyimpanan</h3>
            {getPersistenceBadge()}
          </div>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Semua rekaman, audio, dan naskah disimpan langsung di browser perangkat Anda.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onImportBackup}
            className="h-9 px-3 text-xs font-medium text-zinc-700 border-zinc-200 hover:bg-zinc-50"
          >
            <UploadCloud className="w-3.5 h-3.5 mr-1.5 text-zinc-500" />
            Import backup
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExportWorkspace}
            className="h-9 px-3 text-xs font-medium text-zinc-700 border-zinc-200 hover:bg-zinc-50"
          >
            <Download className="w-3.5 h-3.5 mr-1.5 text-zinc-500" />
            Export seluruh workspace
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Quota stats */}
        <div className="bg-zinc-50/70 rounded-lg p-3.5 border border-zinc-200/60 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-600 font-medium flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
              Kapasitas browser
            </span>
            <span className="font-mono text-zinc-800">
              {estimate.supported
                ? `${estimate.usageFormatted} / ${estimate.quotaFormatted}`
                : 'Estimasi tidak tersedia'}
            </span>
          </div>

          {estimate.supported && estimate.usagePercent !== null && (
            <div className="space-y-1">
              <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-zinc-800 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(2, estimate.usagePercent)}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 text-right">
                {estimate.usagePercent}% dari batas alokasi browser
              </p>
            </div>
          )}
        </div>

        {/* Protection card */}
        <div className="bg-zinc-50/70 rounded-lg p-3.5 border border-zinc-200/60 flex flex-col justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-800">Perlindungan penyimpanan</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Penyimpanan persisten mengurangi kemungkinan browser menghapus data saat ruang disk perangkat menipis.
            </p>
          </div>

          {persistenceStatus === 'not-persisted' && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleProtectStorage}
                disabled={requesting}
                className="h-8 text-xs font-medium bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-100"
              >
                {requesting ? (
                  <>
                    <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                    Menghubungi browser...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                    Lindungi penyimpanan lokal
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-amber-50/60 border border-amber-200/60 rounded-lg p-3 text-xs text-amber-900 leading-relaxed">
        <strong className="font-medium text-amber-950">Catatan penting:</strong> Penyimpanan persisten bukan pengganti backup mandiri. Jika riwayat browser atau data situs dibersihkan manual, rekaman dapat terhapus. Gunakan tombol Export untuk menyimpan salinan .catetin di komputer Anda secara rutin.
      </div>
    </section>
  );
};

