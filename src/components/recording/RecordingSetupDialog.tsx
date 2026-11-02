import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, HardDrive, CheckCircle2, Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { ProjectRecord } from '@/features/workspace/workspace-store';
import {
  getStorageEstimate,
  getStoragePersistence,
  type StorageEstimateInfo,
  type StoragePersistenceStatus,
} from '@/features/workspace/storage-adapter';
import { AudioLevelMeter } from './AudioLevelMeter';

interface RecordingSetupDialogProps {
  open: boolean;
  projects: ProjectRecord[];
  selectedProjectId: string;
  onSelectProjectId: (projectId: string) => void;
  title: string;
  onChangeTitle: (title: string) => void;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelectDeviceId: (deviceId: string) => void;
  stream: MediaStream | null;
  isStarting?: boolean;
  onBack: () => void;
  onStart: () => void;
}

export const RecordingSetupDialog: React.FC<RecordingSetupDialogProps> = ({
  open,
  projects,
  selectedProjectId,
  onSelectProjectId,
  title,
  onChangeTitle,
  devices,
  selectedDeviceId,
  onSelectDeviceId,
  stream,
  isStarting = false,
  onBack,
  onStart,
}) => {
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateInfo | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<StoragePersistenceStatus>('unsupported');

  useEffect(() => {
    if (open) {
      void getStorageEstimate().then(setStorageEstimate);
      void getStoragePersistence().then(setPersistenceStatus);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !isStarting) onBack(); }}>
      <DialogContent
        className="max-w-md sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          const input = document.getElementById('recording-title-input');
          if (input) {
            e.preventDefault();
            input.focus();
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--primary)] grid place-items-center flex-shrink-0">
              <Mic className="size-4" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold text-[var(--foreground)]">
              {t('Atur rekaman pertemuan')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-[var(--muted-foreground)] leading-relaxed">
            {t('Pastikan mikrofon dan tujuan penyimpanan sudah sesuai sebelum mulai merekam.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2 text-left">
          {/* Recording Title */}
          <div>
            <label
              htmlFor="recording-title-input"
              className="block text-xs font-semibold text-[var(--foreground)] mb-1.5"
            >
              {t('Nama rekaman')}
            </label>
            <input
              id="recording-title-input"
              type="text"
              value={title}
              onChange={(e) => onChangeTitle(e.target.value)}
              disabled={isStarting}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] min-h-[44px] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
              placeholder={t('Nama rekaman')}
              required
            />
          </div>

          {/* Project Selection */}
          {projects.length > 0 && (
            <div>
              <label
                htmlFor="recording-project-select"
                className="block text-xs font-semibold text-[var(--foreground)] mb-1.5"
              >
                {t('Pilih project')}
              </label>
              <select
                id="recording-project-select"
                value={selectedProjectId}
                onChange={(e) => onSelectProjectId(e.target.value)}
                disabled={isStarting}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] min-h-[44px] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Microphone Selector */}
          <div>
            <label
              htmlFor="recording-mic-select"
              className="block text-xs font-semibold text-[var(--foreground)] mb-1.5"
            >
              {t('Pilih mikrofon')}
            </label>
            <select
              id="recording-mic-select"
              value={selectedDeviceId}
              onChange={(e) => onSelectDeviceId(e.target.value)}
              disabled={isStarting}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] min-h-[44px] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
            >
              {devices.length === 0 ? (
                <option value="">{t('Mikrofon bawaan')}</option>
              ) : (
                devices.map((device, idx) => (
                  <option key={device.deviceId || idx} value={device.deviceId}>
                    {device.label || `${t('Mikrofon bawaan')} (${idx + 1})`}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* VU Meter Audio Test */}
          <div>
            <span className="block text-xs font-semibold text-[var(--foreground)] mb-1.5">
              {t('Uji suara')}
            </span>
            <AudioLevelMeter stream={stream} />
          </div>

          {/* Storage Information */}
          <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs text-[var(--muted-foreground)] flex items-start gap-2.5">
            <HardDrive className="size-4 flex-shrink-0 mt-0.5 text-[var(--primary)]" aria-hidden="true" />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[var(--foreground)] font-medium">
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                <span>
                  {storageEstimate?.supported && storageEstimate.quotaFormatted
                    ? `${t('Ruang tersedia:')} ~${storageEstimate.quotaFormatted}`
                    : t('Penyimpanan lokal siap')}
                </span>
              </div>
              <p className="leading-relaxed">
                {persistenceStatus === 'persisted'
                  ? t('Penyimpanan browser persisten aktif.')
                  : t('Penyimpanan persisten belum aktif. Browser dapat membersihkan data lokal saat ruang perangkat terbatas. Selesaikan dan ekspor rekaman penting sebagai cadangan.')}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isStarting}
            onClick={onBack}
            className="min-h-[44px]"
          >
            {t('Kembali')}
          </Button>
          <Button
            type="button"
            disabled={!title.trim() || isStarting}
            aria-busy={isStarting}
            onClick={onStart}
            className="min-h-[44px] gap-2"
          >
            {isStarting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mic className="size-4" aria-hidden="true" />
            )}
            <span>{t('Mulai merekam')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
