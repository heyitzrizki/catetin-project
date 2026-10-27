import React from 'react';
import { ArrowRight, Clock, Cpu, FileAudio, Folder, FolderPlus, HardDrive, ShieldCheck, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t, useLanguage } from '@/lib/i18n';
import type { ProjectSummary, RecentRecording, WorkspaceStats } from '@/features/workspace/workspace-store';

export interface WorkspaceDashboardProps {
  projects: ProjectSummary[];
  recentRecordings: RecentRecording[];
  stats: WorkspaceStats;
  loading?: boolean;
  onOpenProject: (projectId: string) => void;
  onOpenRecording: (recordingId: string, projectId?: string) => void;
  onCreateProjectClick: () => void;
  onOpenRecordingClick: (projectId?: string) => void;
  onTryDemo: () => void;
}

function formatDurationHuman(seconds: number, lang: 'id' | 'en'): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return lang === 'id' ? `${h}j ${m}m` : `${h}h ${m}m`;
  }
  if (m > 0) {
    return lang === 'id' ? `${m}m ${s}s` : `${m}m ${s}s`;
  }
  return `${s}s`;
}

function formatRelativeDate(timestamp: number | null, lang: 'id' | 'en'): string {
  if (!timestamp) return t('Belum ada pembaruan');
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return t('Baru saja');
  if (diffMinutes < 60) return `${diffMinutes} ${lang === 'id' ? 'menit lalu' : 'min ago'}`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ${lang === 'id' ? 'jam lalu' : 'hours ago'}`;
  return new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

export function WorkspaceDashboard({
  projects,
  recentRecordings,
  stats,
  loading = false,
  onOpenProject,
  onOpenRecording,
  onCreateProjectClick,
  onOpenRecordingClick,
  onTryDemo,
}: WorkspaceDashboardProps) {
  const language = useLanguage() as 'id' | 'en';
  const hasProjects = projects.length > 0;

  return (
    <div className="dashboard-container py-6 px-4 md:px-8 max-w-[1248px] mx-auto w-full">
      <header className="dashboard-header flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-[var(--border)]">
        <div>
          <span className="eyebrow block text-xs tracking-wider uppercase text-[var(--primary)] font-semibold">
            {t('Workspace lokal')}
          </span>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[var(--foreground)] mt-1">
            {t('Dashboard')}
          </h1>
        </div>
        <div className="dashboard-actions flex items-center flex-wrap gap-3">
          <Button variant="outline" onClick={onCreateProjectClick} className="gap-2 min-h-[44px]">
            <FolderPlus className="size-4" aria-hidden="true" />
            {t('Project baru')}
          </Button>
          <Button onClick={() => onOpenRecordingClick()} className="gap-2 min-h-[44px]">
            <Upload className="size-4" aria-hidden="true" />
            {t('Buka rekaman')}
          </Button>
        </div>
      </header>

      {/* Workspace Statistics */}
      <section
        aria-label={t('Statistik workspace')}
        className="dashboard-stats grid grid-cols-2 lg:grid-cols-4 gap-4 my-6"
      >
        <article className="stat-card bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 shadow-sm">
          <span className="stat-label text-xs font-medium text-[var(--muted-foreground)] block">
            {t('Total project')}
          </span>
          <strong className="stat-value text-2xl font-bold text-[var(--foreground)] block mt-1">
            {loading ? '-' : stats.projectCount}
          </strong>
        </article>
        <article className="stat-card bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 shadow-sm">
          <span className="stat-label text-xs font-medium text-[var(--muted-foreground)] block">
            {t('Total rekaman')}
          </span>
          <strong className="stat-value text-2xl font-bold text-[var(--foreground)] block mt-1">
            {loading ? '-' : stats.recordingCount}
          </strong>
        </article>
        <article className="stat-card bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 shadow-sm">
          <span className="stat-label text-xs font-medium text-[var(--muted-foreground)] block">
            {t('Total durasi')}
          </span>
          <strong className="stat-value text-2xl font-bold text-[var(--foreground)] block mt-1">
            {loading ? '-' : formatDurationHuman(stats.totalDurationSec, language)}
          </strong>
        </article>
        <article className="stat-card bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 shadow-sm">
          <span className="stat-label text-xs font-medium text-[var(--muted-foreground)] block">
            {t('Terakhir diperbarui')}
          </span>
          <strong className="stat-value text-sm md:text-base font-semibold text-[var(--foreground)] block mt-2 truncate">
            {loading ? '-' : formatRelativeDate(stats.lastUpdatedAt, language)}
          </strong>
        </article>
      </section>

      {/* Main Content Area: Empty State & Onboarding VS Projects & Recents */}
      {!hasProjects ? (
        <section
          aria-label={t('Belum ada project lokal')}
          className="dashboard-empty-state bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 md:p-10 my-8 shadow-sm"
        >
          <div className="max-w-2xl">
            <span className="eyebrow block text-xs tracking-wider uppercase text-[var(--primary)] font-semibold mb-2">
              {t('STUDIO CATETIN')}
            </span>
            <h2 className="text-xl md:text-2xl font-bold text-[var(--foreground)] tracking-tight">
              {t('Belum ada project lokal')}
            </h2>
            <p className="text-sm md:text-base text-[var(--muted-foreground)] mt-2 leading-relaxed">
              {t('Semua rekaman dan naskah tersimpan sepenuhnya di perangkat ini tanpa akun atau koneksi server.')}
            </p>
          </div>

          <div className="onboarding-grid grid grid-cols-1 md:grid-cols-3 gap-6 my-8">
            <article className="onboarding-card bg-[var(--background)] border border-[var(--border)] rounded-lg p-5">
              <div className="icon-wrap w-10 h-10 rounded-md bg-[var(--accent)] text-[var(--primary)] grid place-items-center mb-3">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-sm text-[var(--foreground)]">
                {t('Privasi penuh di perangkat')}
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-2 leading-relaxed">
                {t('Audio dan transkrip Anda diproses langsung di peramban dan tidak pernah diunggah ke server mana pun.')}
              </p>
            </article>

            <article className="onboarding-card bg-[var(--background)] border border-[var(--border)] rounded-lg p-5">
              <div className="icon-wrap w-10 h-10 rounded-md bg-[var(--accent)] text-[var(--primary)] grid place-items-center mb-3">
                <Cpu className="size-5" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-sm text-[var(--foreground)]">
                {t('Transkripsi lokal Whisper')}
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-2 leading-relaxed">
                {t('Model dijalankan di perangkat Anda melalui WebGPU atau WebAssembly tanpa batas kuota cloud.')}
              </p>
            </article>

            <article className="onboarding-card bg-[var(--background)] border border-[var(--border)] rounded-lg p-5">
              <div className="icon-wrap w-10 h-10 rounded-md bg-[var(--accent)] text-[var(--primary)] grid place-items-center mb-3">
                <HardDrive className="size-5" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-sm text-[var(--foreground)]">
                {t('Penyimpanan browser mandiri')}
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-2 leading-relaxed">
                {t('Draf naskah tersimpan di IndexedDB browser Anda dan dapat diekspor kapan saja sebagai TXT, SRT, atau Word.')}
              </p>
            </article>
          </div>

          <div className="empty-actions flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={onCreateProjectClick} className="min-h-[44px]">
              {t('Buat project pertama')}
            </Button>
            <Button variant="outline" onClick={() => onOpenRecordingClick()} className="min-h-[44px]">
              {t('Buka rekaman')}
            </Button>
            <Button variant="ghost" onClick={onTryDemo} className="min-h-[44px] gap-2">
              {t('Coba contoh')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      ) : (
        <div className="dashboard-grid grid grid-cols-1 lg:grid-cols-12 gap-8 my-6">
          {/* Projects Column */}
          <section aria-label={t('Semua project')} className="lg:col-span-7 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                {t('Semua project')}
              </h2>
              <span className="text-xs text-[var(--muted-foreground)]">
                {projects.length} {t('Project')}
              </span>
            </div>

            <div className="projects-list flex flex-col gap-3">
              {projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  className="project-card text-left bg-[var(--card)] hover:bg-[var(--accent)] border border-[var(--border)] rounded-lg p-4 transition-colors flex items-center justify-between gap-4 group min-h-[64px]"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-[var(--muted)] text-[var(--primary)] grid place-items-center flex-shrink-0 mt-0.5">
                      <Folder className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-[var(--foreground)] truncate group-hover:text-[var(--primary)]">
                        {project.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-xs text-[var(--muted-foreground)]">
                        <span>{project.recordingCount} {t('rekaman')}</span>
                        <span>•</span>
                        <span>{formatDurationHuman(project.totalDurationSec, language)}</span>
                        <span>•</span>
                        <span>{formatRelativeDate(project.updatedAt, language)}</span>
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-[var(--muted-foreground)] group-hover:text-[var(--primary)] group-hover:translate-x-1 transition-all flex-shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>

          {/* Recent Recordings Column */}
          <section aria-label={t('Rekaman terbaru')} className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                {t('Rekaman terbaru')}
              </h2>
            </div>

            {recentRecordings.length === 0 ? (
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-6 text-center text-sm text-[var(--muted-foreground)]">
                <p>{t('Belum ada rekaman')}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenRecordingClick()}
                  className="mt-3 min-h-[44px]"
                >
                  {t('Buka rekaman')}
                </Button>
              </div>
            ) : (
              <div className="recents-list flex flex-col gap-2">
                {recentRecordings.map(rec => (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => onOpenRecording(rec.id, rec.projectId)}
                    className="recent-item text-left bg-[var(--card)] hover:bg-[var(--accent)] border border-[var(--border)] rounded-lg p-3 transition-colors flex items-center justify-between gap-3 group min-h-[56px]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-md bg-[var(--muted)] text-[var(--primary)] grid place-items-center flex-shrink-0">
                        <FileAudio className="size-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <strong className="block text-xs font-semibold text-[var(--foreground)] truncate group-hover:text-[var(--primary)]">
                          {rec.title}
                        </strong>
                        <span className="block text-[11px] text-[var(--muted-foreground)] truncate mt-0.5">
                          {rec.projectTitle} · {formatDurationHuman(rec.durationSec, language)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-[var(--muted-foreground)] whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                      <Clock className="size-3" aria-hidden="true" />
                      {formatRelativeDate(rec.updatedAt, language)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
