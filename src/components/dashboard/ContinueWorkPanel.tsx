import React from 'react';
import {
  AudioLines,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  HardDrive,
  Pencil,
} from 'lucide-react';
import { t, useLanguage } from '@/lib/i18n';
import type { Recording } from '@/lib/transcript';
import type { RecentRecording } from '@/features/workspace/workspace-store';

export interface ContinueWorkPanelProps {
  latestRecording: RecentRecording | null;
  fullRecording?: Recording | null;
  onOpenRecording: (recordingId: string, projectId?: string) => void;
  onOpenProject: (projectId: string) => void;
  onMoveFolderClick?: (recording: Recording) => void;
  onManageTagsClick?: (recording: Recording) => void;
  onOpenRecordingClick: () => void;
}

function formatDurationShort(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export const ContinueWorkPanel: React.FC<ContinueWorkPanelProps> = ({
  latestRecording,
  fullRecording,
  onOpenRecording,
  onOpenProject,
  onMoveFolderClick,
  onManageTagsClick,
  onOpenRecordingClick,
}) => {
  const language = useLanguage() as 'id' | 'en';
  const hasTranscriptSegments = (fullRecording?.segments?.length ?? 0) > 0;

  return (
    <aside
      data-testid="continue-work-panel"
      aria-label={t('Lanjutkan pekerjaan')}
      className="continue-work-panel flex flex-col justify-between gap-6 lg:pl-7 lg:border-l border-[var(--border)] min-w-0"
    >
      <div className="space-y-4">
        <div>
          <h2
            className="text-xl font-normal tracking-tight text-[#152B41]"
            style={{ fontFamily: 'var(--lp-serif)' }}
          >
            {t('Lanjutkan pekerjaan')}
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
            {t('Lanjutkan dari transkrip terakhir yang Anda buka.')}
          </p>
        </div>

        {latestRecording ? (
          <div className="space-y-4">
            {/* Active / Recent Recording Header */}
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-[var(--border)] shadow-2xs">
              <div className="w-10 h-10 rounded-xl bg-[#E8F1F8] text-[#172F49] grid place-items-center shrink-0">
                <AudioLines className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <strong className="block text-sm font-semibold text-[#152B41] truncate">
                  {latestRecording.title}
                </strong>
                <span className="block text-xs text-[var(--muted-foreground)] truncate mt-0.5">
                  {t('Transkrip lokal')} • {latestRecording.projectTitle}
                </span>
                <div className="flex items-center justify-between gap-2 mt-2.5 text-[11px] text-[var(--muted-foreground)]">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {hasTranscriptSegments ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0" aria-hidden="true" />
                        <span className="text-emerald-700 font-semibold">{t('Selesai')}</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-[#1D4E89] inline-block shrink-0" aria-hidden="true" />
                        <span className="text-[#1D4E89] font-medium">{t('Siap ditranskripsi')}</span>
                      </>
                    )}
                  </span>
                  <span className="font-mono text-[#172F49] font-medium">
                    {formatDurationShort(latestRecording.durationSec)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Stack */}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                data-testid="continue-work-primary-btn"
                onClick={() => onOpenRecording(latestRecording.id, latestRecording.projectId)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#F4EFE6] hover:bg-[#EAE2D3] text-[#152B41] text-xs font-semibold flex items-center justify-between gap-2 transition-colors border border-[#E5DEC9]"
              >
                <span className="inline-flex items-center gap-2.5 min-w-0">
                  <FileText className="size-4 text-[#172F49] shrink-0" aria-hidden="true" />
                  <span className="truncate">{t('Lanjutkan transkrip')}</span>
                </span>
                <ChevronRight className="size-4 text-[#526171] shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onOpenRecording(latestRecording.id, latestRecording.projectId)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-lg hover:bg-[var(--accent)] text-[#152B41] text-xs font-medium flex items-center gap-2.5 transition-colors text-left border-b border-[var(--border)]/60"
              >
                <Pencil className="size-4 text-[#526171] shrink-0" aria-hidden="true" />
                <span className="truncate">{t('Edit transkrip')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (fullRecording && onMoveFolderClick) {
                    onMoveFolderClick(fullRecording);
                  } else {
                    onOpenProject(latestRecording.projectId);
                  }
                }}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-lg hover:bg-[var(--accent)] text-[#152B41] text-xs font-medium flex items-center gap-2.5 transition-colors text-left border-b border-[var(--border)]/60"
              >
                <Folder className="size-4 text-[#526171] shrink-0" aria-hidden="true" />
                <span className="truncate">{t('Buka folder')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (fullRecording && onManageTagsClick) {
                    onManageTagsClick(fullRecording);
                  } else {
                    onOpenRecording(latestRecording.id, latestRecording.projectId);
                  }
                }}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-lg hover:bg-[var(--accent)] text-[#152B41] text-xs font-medium flex items-center gap-2.5 transition-colors text-left"
              >
                <ExternalLink className="size-4 text-[#526171] shrink-0" aria-hidden="true" />
                <span className="truncate">{t('Lihat detail')}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-white p-4 space-y-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#E8F1F8] text-[#172F49] grid place-items-center">
              <AudioLines className="size-4" aria-hidden="true" />
            </div>
            <strong className="block text-xs font-semibold text-[#152B41]">
              {t('Belum ada transkrip terakhir')}
            </strong>
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              {t('Mulai rekam pertemuan atau buka rekaman audio untuk melanjutkan pekerjaan di sini.')}
            </p>
            <button
              type="button"
              onClick={onOpenRecordingClick}
              className="min-h-[44px] px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)] text-xs font-semibold text-[#172F49] inline-flex items-center gap-1.5 transition-colors"
            >
              <span>{t('Buka rekaman')}</span>
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom Local Reassurance Card */}
      <div className="rounded-xl border border-[var(--border)] bg-white p-3.5 flex items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#F3F6FA] text-[#172F49] grid place-items-center shrink-0">
            <HardDrive className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <strong className="block text-xs font-semibold text-[#152B41] truncate">
              {t('Tersimpan lokal')}
            </strong>
            <span className="block text-[11px] text-[var(--muted-foreground)] truncate">
              {language === 'en' ? 'All data on this device.' : t('Semua data di perangkat ini.')}
            </span>
          </div>
        </div>
        <span className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 inline-flex items-center justify-center shrink-0">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </aside>
  );
};
