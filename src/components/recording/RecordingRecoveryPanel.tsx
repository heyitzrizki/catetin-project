import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RotateCcw, Trash2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { formatSeconds } from '@/lib/transcript';
import type { RecordingSession } from '@/features/recording/recording-types';

interface RecordingRecoveryPanelProps {
  sessions: RecordingSession[];
  onRecover: (session: RecordingSession) => void;
  onDiscard: (session: RecordingSession) => void;
  isRecovering?: boolean;
}

export const RecordingRecoveryPanel: React.FC<RecordingRecoveryPanelProps> = ({
  sessions,
  onRecover,
  onDiscard,
  isRecovering = false,
}) => {
  if (sessions.length === 0) return null;

  return (
    <section
      aria-label={t('Rekaman lokal belum selesai')}
      className="recovery-panel my-5 p-4 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 grid place-items-center flex-shrink-0 mt-0.5">
          <AlertCircle className="size-4" aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-[var(--foreground)]">
            {t('Rekaman lokal belum selesai')}
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed mt-1">
            {t('Catetin akan memulihkan bagian audio yang sudah tersimpan di perangkat.')}
          </p>

          <div className="mt-3 space-y-2.5">
            {sessions.map((session) => {
              const activeSec = Math.floor(session.activeDurationMs / 1000);
              const formattedDuration = formatSeconds(activeSec);
              const hasRecoverableAudio = session.archiveChunkCount > 0 && session.archiveTotalBytes > 0;
              const updatedDate = new Date(session.lastUpdatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={session.sessionId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-[var(--card)] text-[var(--foreground)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="block text-xs font-semibold truncate">
                        {session.title || t('Rekaman Rapat')}
                      </strong>
                      {session.status === 'failed' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200">
                          {t('Terhenti')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)] mt-0.5">
                      <span>{t('Durasi aktif:')} {formattedDuration}</span>
                      <span>•</span>
                      <span>{t('Diperbarui:')} {updatedDate}</span>
                      {!hasRecoverableAudio && (
                        <>
                          <span>•</span>
                          <span>{t('Belum ada bagian audio yang tersimpan pada draft ini.')}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isRecovering}
                      onClick={() => onDiscard(session)}
                      className="min-h-[44px] text-xs text-red-600 dark:text-red-400 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 border-[var(--border)]"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span>{t('Hapus draft')}</span>
                    </Button>

                    {hasRecoverableAudio && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={isRecovering}
                        onClick={() => onRecover(session)}
                        className="min-h-[44px] text-xs gap-1.5"
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        <span>{t('Pulihkan rekaman')}</span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
