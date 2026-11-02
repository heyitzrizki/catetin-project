import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Mic,
  Pause,
  Play,
  Square,
  X,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { formatSeconds } from '@/lib/transcript';
import type { RecordingEngineState, RecordingError } from '@/features/recording/recording-types';
import { getRecordingErrorMessage } from '@/features/recording/recording-error-messages';
import { AudioLevelMeter } from './AudioLevelMeter';

interface ActiveRecordingDialogProps {
  open: boolean;
  engineState: RecordingEngineState;
  title: string;
  selectedDeviceName?: string;
  activeDurationMs: number;
  stream: MediaStream | null;
  isFinalizing: boolean;
  finalizingPhase?: string;
  error: RecordingError | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetryFinalize: () => void;
  onRequestCancel: () => void;
  onCloseAfterError?: () => void;
}

export const ActiveRecordingDialog: React.FC<ActiveRecordingDialogProps> = ({
  open,
  engineState,
  title,
  selectedDeviceName,
  activeDurationMs,
  stream,
  isFinalizing,
  finalizingPhase,
  error,
  onPause,
  onResume,
  onStop,
  onRetryFinalize,
  onRequestCancel,
  onCloseAfterError,
}) => {
  const isPaused = engineState.status === 'paused';
  const isRecoverable = engineState.status === 'recoverable' || (error?.retryable === true);
  const activeSeconds = Math.floor(activeDurationMs / 1000);
  const formattedTime = formatSeconds(activeSeconds);

  // Accessible live status for screen reader without announcing every second
  const screenReaderStatus = isPaused
    ? t('Rekaman dijeda')
    : isFinalizing
      ? finalizingPhase || t('Menyelesaikan rekaman')
      : isRecoverable
        ? t('Penyimpanan lokal mengalami gangguan. Audio yang sudah tersimpan tetap dipertahankan.')
        : t('Sedang merekam');

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md sm:max-w-lg"
        onPointerDownOutside={(e) => {
          // Strictly prevent backdrop click from silently closing the active recording
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          // Escape key must trigger confirmation instead of closing
          e.preventDefault();
          if (!isFinalizing) {
            onRequestCancel();
          }
        }}
      >
        {/* Screen Reader Live Region (Announces status changes, not individual clock seconds) */}
        <div className="sr-only" aria-live="polite" role="status">
          {screenReaderStatus}
        </div>

        <DialogHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            {/* Status indicator: uses color + icon + text label */}
            <div
              className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                isPaused
                  ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'
                  : isFinalizing
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200'
                    : isRecoverable
                      ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                      : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  isPaused
                    ? 'bg-amber-500'
                    : isFinalizing
                      ? 'bg-blue-500'
                      : isRecoverable
                        ? 'bg-amber-500'
                        : 'bg-red-600 animate-pulse'
                }`}
                aria-hidden="true"
              />
              <span>
                {isPaused
                  ? t('Rekaman dijeda')
                  : isFinalizing
                    ? finalizingPhase || t('Menyelesaikan rekaman')
                    : isRecoverable
                      ? t('Perlu tindakan')
                      : t('Sedang merekam')}
              </span>
            </div>

            {/* Custom cancel button in header */}
            {!isFinalizing && (
              <button
                type="button"
                onClick={onRequestCancel}
                className="p-2 rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] min-h-[44px] min-w-[44px] grid place-items-center"
                aria-label={t('Batalkan rekaman')}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <DialogTitle className="text-xl font-bold text-[var(--foreground)] truncate text-left">
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--muted-foreground)] text-left flex items-center gap-1.5 truncate">
            <Mic className="size-3.5 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{selectedDeviceName || t('Mikrofon bawaan')}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Recoverable Error Banner */}
        {isRecoverable && error && (
          <div
            className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5 my-1"
            role="alert"
          >
            <AlertCircle className="size-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div className="space-y-1">
              <strong className="block font-semibold">
                {getRecordingErrorMessage(error.code)}
              </strong>
              <p className="leading-relaxed text-[11px]">
                {t('Audio rekaman dan draft Anda tetap aman tersimpan di perangkat ini.')}
              </p>
            </div>
          </div>
        )}

        {/* Central Display: Monotonic Duration Timer & VU Level */}
        <div className="my-4 space-y-4">
          <div className="text-center py-5 px-4 rounded-xl border border-[var(--border)] bg-[var(--background)]">
            <span
              className="text-4xl sm:text-5xl font-mono font-bold tracking-tight text-[var(--foreground)] block select-all"
              aria-hidden="true"
            >
              {formattedTime}
            </span>
            <span className="block text-xs text-[var(--muted-foreground)] mt-2 font-medium">
              {isPaused ? t('Waktu aktif dijeda') : t('Durasi rekaman aktif')}
            </span>
          </div>

          {/* VU Meter Visual Feedback */}
          {!isFinalizing && !isRecoverable && (
            <AudioLevelMeter stream={stream} isPaused={isPaused} />
          )}

          {/* Finalization Progress Bar (indeterminate) */}
          {isFinalizing && (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span>{finalizingPhase || t('Menyelesaikan rekaman')}</span>
                <span className="animate-pulse">{t('Mohon tunggu...')}</span>
              </div>
              <progress
                className="w-full h-2 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-[var(--muted)] [&::-webkit-progress-value]:bg-[var(--primary)]"
                aria-label={finalizingPhase || t('Menyelesaikan rekaman')}
              />
            </div>
          )}
        </div>

        {/* Control Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2 border-t border-[var(--border)]">
          {!isFinalizing && !isRecoverable ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onRequestCancel}
                className="order-3 sm:order-1 min-h-[44px]"
              >
                {t('Batalkan')}
              </Button>

              <div className="order-1 sm:order-2 flex items-center gap-2 flex-1 justify-end">
                {isPaused ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onResume}
                    className="min-h-[44px] gap-2 flex-1 sm:flex-initial"
                  >
                    <Play className="size-4" aria-hidden="true" />
                    {t('Lanjutkan')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onPause}
                    className="min-h-[44px] gap-2 flex-1 sm:flex-initial"
                  >
                    <Pause className="size-4" aria-hidden="true" />
                    {t('Jeda')}
                  </Button>
                )}

                <Button
                  type="button"
                  onClick={onStop}
                  className="min-h-[44px] gap-2 flex-1 sm:flex-initial bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  <Square className="size-4 fill-current" aria-hidden="true" />
                  {t('Selesai')}
                </Button>
              </div>
            </>
          ) : isRecoverable ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 w-full">
              {onCloseAfterError && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCloseAfterError}
                  className="min-h-[44px]"
                >
                  {t('Kembali ke Dashboard')}
                </Button>
              )}
              <Button
                type="button"
                onClick={onRetryFinalize}
                className="min-h-[44px] gap-2"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {t('Coba simpan lagi')}
              </Button>
            </div>
          ) : (
            <div className="py-2 text-center text-xs text-[var(--muted-foreground)] w-full">
              {t('Menyimpan audio ke penyimpanan lokal...')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
