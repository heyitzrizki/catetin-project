import React, { useState } from 'react';
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Ellipsis,
  Folder,
  LoaderCircle,
  Pencil,
  Tag,
  Trash2,
} from 'lucide-react';
import { t, useLanguage } from '@/lib/i18n';
import type { Recording } from '@/lib/transcript';
import type { FolderRecord, ProjectSummary } from '@/features/workspace/workspace-store';

export interface WorkspaceLibraryProps {
  viewMode: 'projects' | 'recordings';
  projects: ProjectSummary[];
  folders: FolderRecord[];
  recordings: Recording[];
  onOpenProject: (projectId: string) => void;
  onOpenRecording: (recordingId: string, projectId?: string) => void;
  onMoveFolderClick: (recording: Recording) => void;
  onManageTagsClick: (recording: Recording) => void;
  onExportProject?: (projectId: string) => void;
  onRenameFolderClick?: (folder: FolderRecord) => void;
  onDeleteFolderClick?: (folderId: string) => void;
}

function formatDurationTable(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}j ${String(m).padStart(2, '0')}m`;
  }
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatLastOpened(timestamp: number | undefined, lang: 'id' | 'en'): string {
  if (!timestamp) return t('Baru saja');
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  const timeStr = date.toLocaleTimeString(lang === 'id' ? 'id-ID' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  if (isToday) {
    return `${t('Hari ini')}, ${timeStr}`;
  }
  if (isYesterday) {
    return `${t('Kemarin')}, ${timeStr}`;
  }

  const dayMonth = new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);

  return `${dayMonth}, ${timeStr}`;
}

function countDistinctSpeakers(rec: Recording): number {
  const segs = rec.segments ?? [];
  if (segs.length === 0) return 1;
  const set = new Set<string>();
  for (const s of segs) {
    if (s.speaker && s.speaker.trim()) {
      set.add(s.speaker.trim());
    }
  }
  return Math.max(1, set.size);
}

export const WorkspaceLibrary: React.FC<WorkspaceLibraryProps> = ({
  viewMode,
  projects,
  folders,
  recordings,
  onOpenProject,
  onOpenRecording,
  onMoveFolderClick,
  onManageTagsClick,
  onExportProject,
  onRenameFolderClick,
  onDeleteFolderClick,
}) => {
  const language = useLanguage() as 'id' | 'en';
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const folderMap = new Map(folders.map(f => [f.id, f]));
  const projectMap = new Map(projects.map(p => [p.id, p]));

  const toggleProjectGroup = (projectId: string) => {
    setCollapsedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const renderRecordingRow = (rec: Recording, showProjectSubtitle = false) => {
    const speakerCount = countDistinctSpeakers(rec);
    const hasTranscript = (rec.segments?.length ?? 0) > 0;
    const folder = rec.folderId ? folderMap.get(rec.folderId) : undefined;
    const proj = rec.projectId ? projectMap.get(rec.projectId) : undefined;
    const isMenuOpen = openMenuId === rec.id;

    return (
      <div
        key={rec.id}
        className="workspace-library-row group border-b border-[var(--border)]/70 last:border-b-0 hover:bg-[#F7FAFC] transition-colors"
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_68px_68px_118px_124px_36px] items-center gap-2 md:gap-2.5 py-3 px-2 md:px-3">
          {/* Primary Column: Icon + Title + Subtitle */}
          <button
            type="button"
            data-recording-id={rec.id}
            onClick={() => onOpenRecording(rec.id, rec.projectId)}
            className="flex items-start sm:items-center gap-2.5 min-w-0 text-left min-h-[44px] focus-visible:outline-2 focus-visible:outline-[var(--primary)] rounded-lg pr-1"
          >
            <div className="w-8 h-8 rounded-lg bg-[#E8F1F8] text-[#172F49] grid place-items-center shrink-0 mt-0.5 sm:mt-0">
              <AudioLines className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <strong className="block text-[13px] font-semibold text-[#152B41] truncate group-hover:text-[var(--primary)]">
                {rec.title}
              </strong>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[var(--muted-foreground)] mt-0.5">
                <span className="whitespace-nowrap">
                  {speakerCount} {t('pembicara')} • {t('Transkrip lokal')}
                </span>
                {showProjectSubtitle && proj && (
                  <>
                    <span>•</span>
                    <span className="truncate max-w-[140px]">{proj.title}</span>
                  </>
                )}
                {folder && (
                  <span className="inline-flex items-center gap-1 bg-[#EFF4F9] text-[#172F49] px-1.5 py-0.2 rounded text-[10px] font-medium">
                    <Folder className="size-2.5" aria-hidden="true" />
                    <span className="truncate max-w-[100px]">{folder.name}</span>
                  </span>
                )}
                {(rec.tags ?? []).map(tag => (
                  <span
                    key={tag}
                    className="bg-[#EFF4F9] text-[#172F49] px-1.5 py-0.2 rounded-full text-[10px] font-medium md:hidden xl:inline-flex"
                  >
                    #{tag}
                  </span>
                ))}
              </div>

              {/* Mobile Stacked Summary Meta */}
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-[var(--muted-foreground)] md:hidden">
                <span className="font-mono text-[#152B41] font-medium">
                  {formatDurationTable(rec.durationSec)}
                </span>
                <span>•</span>
                <span>{formatLastOpened(rec.updatedAt ?? rec.createdAt, language)}</span>
              </div>
            </div>
          </button>

          {/* Desktop Column: Duration */}
          <div className="hidden md:block text-xs font-medium text-[#152B41] tabular-nums">
            {formatDurationTable(rec.durationSec)}
          </div>

          {/* Desktop Column: Speakers */}
          <div className="hidden md:block text-xs font-medium text-[#152B41] text-center tabular-nums">
            {speakerCount}
          </div>

          {/* Desktop Column: Last Opened */}
          <div className="hidden md:block text-xs text-[var(--muted-foreground)] truncate">
            {formatLastOpened(rec.updatedAt ?? rec.createdAt, language)}
          </div>

          {/* Status Pill + Mobile Actions */}
          <div className="flex items-center justify-between md:justify-start gap-2">
            {hasTranscript ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#E6F5EC] text-[#17663A] border border-[#C6E9D3]">
                <Check className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{t('Selesai')}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#E8F1FB] text-[#1D4E89] border border-[#C9DDF5]">
                <LoaderCircle className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{t('Siap ditranskripsi')}</span>
              </span>
            )}

            {/* Mobile inline quick actions */}
            <div className="flex md:hidden items-center gap-1">
              <button
                type="button"
                onClick={() => onMoveFolderClick(rec)}
                className="min-h-[44px] px-2.5 rounded-lg text-[11px] font-medium text-[#172F49] hover:bg-[var(--accent)]"
              >
                {t('Pindahkan')}
              </button>
              <button
                type="button"
                onClick={() => onManageTagsClick(rec)}
                className="min-h-[44px] px-2.5 rounded-lg text-[11px] font-medium text-[#172F49] hover:bg-[var(--accent)]"
              >
                {t('Tag')}
              </button>
            </div>
          </div>

          {/* Desktop Row Menu Trigger */}
          <div className="hidden md:flex items-center justify-end relative">
            <button
              type="button"
              onClick={() => setOpenMenuId(prev => (prev === rec.id ? null : rec.id))}
              aria-expanded={isMenuOpen}
              aria-label={`${t('Aksi rekaman')} ${rec.title}`}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#526171] hover:bg-[var(--accent)] hover:text-[#152B41] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
            >
              <Ellipsis className="size-4" aria-hidden="true" />
            </button>

            {isMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-11 z-20 w-44 rounded-xl bg-white border border-[var(--border)] shadow-lg p-1.5 space-y-0.5"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuId(null);
                    onOpenRecording(rec.id, rec.projectId);
                  }}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg text-left text-xs font-medium text-[#152B41] hover:bg-[var(--accent)] flex items-center gap-2"
                >
                  <AudioLines className="size-3.5 text-[#172F49]" aria-hidden="true" />
                  <span>{t('Buka')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuId(null);
                    onMoveFolderClick(rec);
                  }}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg text-left text-xs font-medium text-[#152B41] hover:bg-[var(--accent)] flex items-center gap-2"
                >
                  <Folder className="size-3.5 text-[#172F49]" aria-hidden="true" />
                  <span>{t('Pindahkan')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuId(null);
                    onManageTagsClick(rec);
                  }}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg text-left text-xs font-medium text-[#152B41] hover:bg-[var(--accent)] flex items-center gap-2"
                >
                  <Tag className="size-3.5 text-[#172F49]" aria-hidden="true" />
                  <span>{t('Tag')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section
      data-testid="workspace-library"
      aria-label={t('Semua project')}
      className="workspace-library min-w-0 flex-1"
    >
      {/* Desktop Table Column Header */}
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_68px_68px_118px_124px_36px] items-center gap-2.5 px-3 pb-2.5 border-b border-[var(--border)] text-[11px] font-semibold tracking-wider uppercase text-[#526171]">
        <span>{t('NAMA PROJECT / REKAMAN')}</span>
        <span>{t('DURASI')}</span>
        <span className="text-center">{t('PEMBICARA')}</span>
        <span>{t('TERAKHIR DIBUKA')}</span>
        <span>{t('STATUS')}</span>
        <span className="sr-only">{t('Aksi rekaman')}</span>
      </div>

      {viewMode === 'recordings' ? (
        <div className="divide-y divide-[var(--border)]/70">
          {recordings.map(rec => renderRecordingRow(rec, true))}
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {projects.map(project => {
            const projectRecordings = recordings.filter(r => r.projectId === project.id);
            const projectFolders = folders.filter(f => f.projectId === project.id);
            const isCollapsed = Boolean(collapsedProjects[project.id]);

            return (
              <div key={project.id} className="workspace-project-group py-1.5">
                {/* Project Group Header */}
                <div className="flex items-center justify-between gap-2 px-1 py-1.5">
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => toggleProjectGroup(project.id)}
                      aria-expanded={!isCollapsed}
                      aria-label={`${project.title} (${projectRecordings.length})`}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#526171] hover:bg-[var(--accent)] hover:text-[#152B41]"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-4" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="size-4" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id)}
                      className="min-h-[44px] px-2 rounded-lg inline-flex items-center gap-2.5 text-left min-w-0 hover:bg-[var(--accent)] transition-colors"
                    >
                      <Folder className="size-4 text-[#172F49] shrink-0" aria-hidden="true" />
                      <strong className="text-sm font-bold text-[#152B41] truncate">
                        {project.title}
                      </strong>
                      <span className="text-xs font-medium text-[#526171] shrink-0">
                        ({projectRecordings.length})
                      </span>
                    </button>
                  </div>

                  {/* Contextual Project Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {onExportProject && (
                      <button
                        type="button"
                        onClick={() => onExportProject(project.id)}
                        className="min-h-[44px] px-2.5 rounded-lg text-xs font-medium text-[#526171] hover:text-[#152B41] hover:bg-[var(--accent)] inline-flex items-center gap-1.5 transition-colors"
                        title={`Export ${project.title}`}
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline">{t('Export')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id)}
                      className="min-h-[44px] px-2.5 rounded-lg text-xs font-semibold text-[#172F49] hover:bg-[var(--accent)] inline-flex items-center gap-1 transition-colors"
                    >
                      <span>{t('Buka')}</span>
                    </button>
                  </div>
                </div>

                {/* Folder Management Chips inside Project Group */}
                {!isCollapsed && projectFolders.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap pl-11 pr-3 pb-2">
                    <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
                      {t('Folder')}:
                    </span>
                    {projectFolders.map(folder => (
                      <div
                        key={folder.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-white px-2.5 py-1 rounded-md border border-[var(--border)]"
                      >
                        <span className="truncate max-w-[120px]">{folder.name}</span>
                        {onRenameFolderClick && (
                          <button
                            type="button"
                            onClick={() => onRenameFolderClick(folder)}
                            className="text-[10px] text-[var(--primary)] hover:underline inline-flex items-center gap-0.5"
                            aria-label={`${t('Ganti nama folder')} ${folder.name}`}
                          >
                            <Pencil className="size-2.5" aria-hidden="true" />
                            <span>{t('Ganti nama')}</span>
                          </button>
                        )}
                        {onDeleteFolderClick && (
                          <button
                            type="button"
                            onClick={() => onDeleteFolderClick(folder.id)}
                            className="text-[10px] text-[var(--destructive)] hover:underline ml-1 inline-flex items-center gap-0.5"
                            aria-label={`${t('Hapus folder')} ${folder.name}`}
                          >
                            <Trash2 className="size-2.5" aria-hidden="true" />
                            <span>{t('Hapus')}</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Grouped Recordings */}
                {!isCollapsed && (
                  <div className="pl-1 sm:pl-2">
                    {projectRecordings.length === 0 ? (
                      <div className="py-3 px-4 text-xs text-[var(--muted-foreground)] italic">
                        {t('Belum ada rekaman di project ini.')}
                      </div>
                    ) : (
                      projectRecordings.map(rec => renderRecordingRow(rec, false))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
