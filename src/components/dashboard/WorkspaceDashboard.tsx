import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  ChevronRight,
  Ellipsis,
  FileAudio,
  Folder,
  FolderPlus,
  Menu,
  Mic,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t, useLanguage } from '@/lib/i18n';
import { StorageSection } from './StorageSection';
import { WorkspaceSidebar, type WorkspaceSectionId } from './WorkspaceSidebar';
import { WorkspaceLibrary } from './WorkspaceLibrary';
import {
  getStorageEstimate,
  getStoragePersistence,
  type StorageEstimateInfo,
  type StoragePersistenceStatus,
} from '@/features/workspace/storage-adapter';
import type {
  FolderRecord,
  ProjectSummary,
  RecentRecording,
  SearchMatch,
  WorkspaceStats,
} from '@/features/workspace/workspace-store';
import { searchLocalWorkspace } from '@/features/workspace/workspace-store';
import type { Recording } from '@/lib/transcript';
import { RecordingRecoveryPanel } from '../recording/RecordingRecoveryPanel';
import type { RecordingSession } from '@/features/recording/recording-types';

export interface WorkspaceDashboardProps {
  projects: ProjectSummary[];
  folders: FolderRecord[];
  allRecordings: Recording[];
  recentRecordings: RecentRecording[];
  stats: WorkspaceStats;
  allWorkspaceTags: string[];
  loading?: boolean;
  onOpenProject: (projectId: string) => void;
  onOpenRecording: (recordingId: string, projectId?: string) => void;
  onCreateProjectClick: () => void;
  onOpenRecordingClick: (projectId?: string, folderId?: string | null) => void;
  onTryDemo: () => void;
  onCreateFolderClick: (projectId?: string) => void;
  onRenameFolderClick: (folder: FolderRecord) => void;
  onDeleteFolderClick: (folderId: string) => void;
  onManageTagsClick: (recording: Recording) => void;
  onRenameTagClick?: (oldTag: string, newTag: string) => void;
  onDeleteTagClick?: (tag: string) => void;
  onMoveFolderClick: (recording: Recording) => void;
  onExportClick?: (scope: 'project' | 'workspace', projectId?: string) => void;
  onImportClick?: () => void;
  onOpenAccount?: () => void;
  onStartRecordingClick?: () => void;
  recoverableSessions?: RecordingSession[];
  onRecoverSession?: (session: RecordingSession) => void;
  onDiscardSession?: (session: RecordingSession) => void;
  isRecoveringSession?: boolean;
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

function formatItemDate(timestamp: number, lang: 'id' | 'en'): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const getSectionFromHash = (): WorkspaceSectionId => {
  if (typeof window === 'undefined') return 'workspace';
  const h = window.location.hash;
  if (h === '#studio/projects') return 'projects';
  if (h === '#studio/recordings') return 'recordings';
  if (h === '#studio/folders-tags') return 'folders-tags';
  if (h === '#studio/storage') return 'storage';
  return 'workspace';
};

export function WorkspaceDashboard({
  projects,
  folders,
  allRecordings,
  recentRecordings,
  stats: _stats,
  allWorkspaceTags,
  loading = false,
  onOpenProject,
  onOpenRecording,
  onCreateProjectClick,
  onOpenRecordingClick,
  onTryDemo,
  onCreateFolderClick,
  onRenameFolderClick,
  onDeleteFolderClick,
  onManageTagsClick,
  onRenameTagClick,
  onDeleteTagClick,
  onMoveFolderClick,
  onExportClick,
  onImportClick,
  onOpenAccount,
  onStartRecordingClick,
  recoverableSessions = [],
  onRecoverSession,
  onDiscardSession,
  isRecoveringSession = false,
}: WorkspaceDashboardProps) {
  const language = useLanguage() as 'id' | 'en';
  const hasProjects = projects.length > 0;
  const hasRecordings = allRecordings.length > 0;
  const isWorkspaceCompletelyEmpty = !hasProjects && !hasRecordings;

  // Sidebar & Shell Navigation State: lightweight hash sync
  const [activeSection, setActiveSection] = useState<WorkspaceSectionId>(getSectionFromHash);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Sync hash changes (browser Back / Forward / direct link)
  useEffect(() => {
    const syncHash = () => {
      setActiveSection(getSectionFromHash());
    };
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const handleSelectSidebarSection = (section: WorkspaceSectionId) => {
    setActiveSection(section);
    if (typeof window !== 'undefined') {
      const targetHash = section === 'workspace' ? '#studio' : `#studio/${section}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }
  };

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [, setIsSearching] = useState(false);

  // Filter state for Recordings view
  const [selectedProjectId, setSelectedProjectId] = useState<string | 'all'>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all' | 'none'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'duration'>('recent');

  // Filter state for Projects view
  const [projectSearchQuery, setProjectSearchQuery] = useState('');

  // Row menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Storage Summary State for Sidebar
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateInfo>({
    supported: false,
    usageBytes: null,
    quotaBytes: null,
    usagePercent: null,
    usageFormatted: '-',
    quotaFormatted: '-',
  });
  const [persistenceStatus, setPersistenceStatus] = useState<StoragePersistenceStatus>('unsupported');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getStorageEstimate(), getStoragePersistence()])
      .then(([est, pers]) => {
        if (!cancelled) {
          setStorageEstimate(est);
          setPersistenceStatus(pers);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce global search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Global search execution
  useEffect(() => {
    let cancelled = false;
    if (!debouncedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchLocalWorkspace(debouncedQuery)
      .then(results => {
        if (!cancelled) {
          setSearchResults(results);
          setIsSearching(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSearchResults([]);
          setIsSearching(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Derive latest recording for View 1 'Lanjutkan pekerjaan'
  const latestRecording: RecentRecording | null = useMemo(() => {
    if (recentRecordings.length > 0) {
      return recentRecordings[0];
    }
    if (allRecordings.length > 0) {
      const sorted = [...allRecordings].sort(
        (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
      );
      const top = sorted[0];
      const proj = projects.find(p => p.id === top.projectId);
      return {
        id: top.id,
        title: top.title,
        projectId: top.projectId ?? '',
        projectTitle: proj?.title ?? t('Rekaman saya'),
        category: top.category,
        filename: top.filename,
        durationSec: top.durationSec,
        updatedAt: top.updatedAt ?? top.createdAt ?? 0,
      };
    }
    return null;
  }, [recentRecordings, allRecordings, projects]);

  const latestFullRecording = useMemo(() => {
    if (!latestRecording) return null;
    return allRecordings.find(r => r.id === latestRecording.id) ?? null;
  }, [latestRecording, allRecordings]);

  const hasTranscriptSegments = (latestFullRecording?.segments?.length ?? 0) > 0;

  // Derive up to 3 combined items for View 1 'Terbaru di workspace'
  const recentCombinedItems = useMemo(() => {
    type CombinedItem =
      | {
          type: 'recording';
          id: string;
          title: string;
          projectId?: string;
          durationSec: number;
          timestamp: number;
        }
      | {
          type: 'project';
          id: string;
          title: string;
          recordingCount: number;
          timestamp: number;
        };

    const items: CombinedItem[] = [];

    for (const rec of allRecordings) {
      items.push({
        type: 'recording',
        id: rec.id,
        title: rec.title,
        projectId: rec.projectId,
        durationSec: rec.durationSec,
        timestamp: rec.updatedAt ?? rec.createdAt ?? 0,
      });
    }

    for (const proj of projects) {
      items.push({
        type: 'project',
        id: proj.id,
        title: proj.title,
        recordingCount: proj.recordingCount,
        timestamp: proj.updatedAt || proj.createdAt || 0,
      });
    }

    items.sort((a, b) => b.timestamp - a.timestamp);
    return items.slice(0, 3);
  }, [allRecordings, projects]);

  // Filtered and sorted recordings for View 3
  const filteredRecordings = useMemo(() => {
    const base = allRecordings.filter(rec => {
      if (selectedProjectId !== 'all' && rec.projectId !== selectedProjectId) return false;
      if (selectedFolderId === 'none' && rec.folderId !== null && rec.folderId !== undefined) return false;
      if (selectedFolderId !== 'all' && selectedFolderId !== 'none' && rec.folderId !== selectedFolderId) return false;
      if (selectedTag && !(rec.tags ?? []).some(t => t.toLowerCase() === selectedTag.toLowerCase())) return false;
      return true;
    });

    return [...base].sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'duration') {
        return (b.durationSec || 0) - (a.durationSec || 0);
      }
      return (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0);
    });
  }, [allRecordings, selectedProjectId, selectedFolderId, selectedTag, sortBy]);

  // Filtered projects for View 2
  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(p => p.title.toLowerCase().includes(query));
  }, [projects, projectSearchQuery]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedProjectId('all');
    setSelectedFolderId('all');
    setSelectedTag(null);
  };

  return (
    <div className="workspace-dashboard-shell flex min-h-[calc(100dvh-62px)] w-full bg-[#F8FAFC] text-[#152B41]">
      {/* Left Navigation Sidebar Rail & Mobile Drawer */}
      <WorkspaceSidebar
        activeSection={activeSection}
        onSelectSection={handleSelectSidebarSection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
        mobileOpen={mobileDrawerOpen}
        onMobileClose={() => setMobileDrawerOpen(false)}
        storageEstimate={storageEstimate}
        persistenceStatus={persistenceStatus}
        onOpenAccount={onOpenAccount}
        onOpenStorage={() => handleSelectSidebarSection('storage')}
        onExportWorkspace={() => onExportClick?.('workspace')}
        onImportBackup={() => onImportClick?.()}
      />

      {/* Main Workspace Canvas with Unified Alignment & Spacing */}
      <div className="workspace-dashboard-main flex-1 min-w-0 px-4 sm:px-8 lg:px-12 py-6 md:py-10 max-w-[1360px]">
        {/* Mobile Navigation Header Trigger */}
        <div className="md:hidden flex items-center justify-between pb-4 border-b border-[var(--border)] mb-6">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label={t('Buka navigasi')}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border border-[var(--border)] bg-white text-[#172F49] shadow-2xs"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <span className="text-sm font-bold text-[#172F49] capitalize">
            {t(activeSection === 'folders-tags' ? 'Folder & tag' : activeSection === 'storage' ? 'Penyimpanan' : activeSection)}
          </span>
        </div>

        {/* Global Search Results Overlay (Active when search query entered) */}
        {debouncedQuery ? (
          <section aria-label={t('Hasil pencarian')} className="my-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#152B41]">
                {t('Hasil pencarian untuk')} "{debouncedQuery}" ({searchResults.length})
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')} className="min-h-[44px]">
                {t('Hapus semua filter')}
              </Button>
            </div>

            {searchResults.length === 0 ? (
              <div className="w-full bg-white border border-[var(--border)] rounded-2xl p-8 sm:p-12 text-center shadow-2xs my-6 flex flex-col items-center">
                <div className="w-14 h-14 rounded-2xl bg-[#E8F1F8] text-[#172F49] flex items-center justify-center mb-4 shrink-0 shadow-2xs">
                  <Search className="size-7 text-[#526171]" aria-hidden="true" />
                </div>
                <h3 className="font-bold text-lg text-[#152B41]">
                  {t('Tidak ada rekaman yang cocok')}
                </h3>
                <p className="text-sm sm:text-base text-[#526171] mt-2 mb-6 max-w-md leading-relaxed">
                  {t('Tidak ada hasil yang sesuai dengan kata kunci atau filter saat ini.')}
                </p>
                <Button onClick={clearAllFilters} className="min-h-[44px] px-5 rounded-xl font-semibold">
                  {t('Hapus semua filter')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {searchResults.map(result => (
                  <button
                    key={result.recordingId}
                    type="button"
                    onClick={() => onOpenRecording(result.recordingId, result.projectId)}
                    className="search-result-card text-left bg-white hover:bg-[var(--accent)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 transition-colors group flex flex-col gap-2 min-h-[64px] shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileAudio className="size-5 text-[#172F49] shrink-0" aria-hidden="true" />
                        <strong className="text-sm sm:text-base font-semibold text-[#152B41] truncate group-hover:text-[var(--primary)]">
                          {result.recordingTitle}
                        </strong>
                      </div>
                      <span className="text-xs sm:text-sm text-[#526171] shrink-0">
                        {formatDurationHuman(result.durationSec, language)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#526171]">
                      <span className="font-medium text-[#152B41]">{result.projectTitle}</span>
                      {result.folderName && (
                        <span className="inline-flex items-center gap-1 bg-[#EEF2F6] px-2 py-0.5 rounded text-[11px]">
                          <Folder className="size-3" aria-hidden="true" />
                          {result.folderName}
                        </span>
                      )}
                      {result.tags.map(tag => (
                        <span
                          key={tag}
                          className="bg-[#E8F1F8] text-[#172F49] px-2 py-0.5 rounded-full text-[11px] font-medium"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : loading ? (
          <div className="text-center py-20 text-base text-[var(--muted-foreground)]">
            {t('Memuat workspace lokal...')}
          </div>
        ) : (
          /* MUTUALLY EXCLUSIVE VIEWS */
          <>
            {/* ========================================================================= */}
            {/* VIEW 1: WORKSPACE (Overview matching .design visual target)               */}
            {/* ========================================================================= */}
            {activeSection === 'workspace' && (
              <div className="workspace-overview-view space-y-8">
                {/* Header: Title + Primary & Secondary Actions */}
                <header className="dashboard-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2">
                  <div>
                    <h1
                      className="text-2xl sm:text-3xl lg:text-[36px] font-normal tracking-tight text-[#152B41] leading-tight"
                      style={{ fontFamily: 'var(--lp-serif)' }}
                    >
                      {t('Workspace lokal')}
                    </h1>
                    <p className="text-sm sm:text-base text-[#526171] mt-1.5 leading-relaxed">
                      {t('Kelola pekerjaan transkrip Anda secara lokal di perangkat ini.')}
                    </p>
                  </div>

                  {!isWorkspaceCompletelyEmpty && (
                    <div className="dashboard-actions flex items-center flex-wrap gap-3 shrink-0">
                      {onStartRecordingClick && (
                        <Button
                          onClick={onStartRecordingClick}
                          className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2.5 shadow-xs"
                        >
                          <Mic className="size-4 text-[#CFE2F1] shrink-0" aria-hidden="true" />
                          <span>{t('Rekam pertemuan')}</span>
                          <span className="sr-only">({t('Lokal di perangkat')})</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => onOpenRecordingClick()}
                        className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-[var(--accent)] border-[var(--border)] text-[#152B41] text-sm font-semibold gap-2 shadow-2xs"
                      >
                        <Upload className="size-4 text-[#172F49] shrink-0" aria-hidden="true" />
                        <span>{t('Buka rekaman')}</span>
                      </Button>
                    </div>
                  )}
                </header>

                {/* Recovery Banner for Unfinished Local Recording Sessions */}
                {recoverableSessions.length > 0 && onRecoverSession && onDiscardSession && (
                  <RecordingRecoveryPanel
                    sessions={recoverableSessions}
                    onRecover={onRecoverSession}
                    onDiscard={onDiscardSession}
                    isRecovering={isRecoveringSession}
                  />
                )}

                {isWorkspaceCompletelyEmpty ? (
                  /* EMPTY WORKSPACE ONBOARDING: Horizontal Balanced Card */
                  <section
                    aria-label={t('Mulai workspace pertama Anda')}
                    className="dashboard-empty-state w-full bg-white border border-[var(--border)] rounded-2xl p-6 sm:p-10 shadow-2xs"
                  >
                    <span className="eyebrow block text-xs tracking-wider uppercase text-[#172F49] font-semibold mb-2">
                      {t('STUDIO CATETIN')}
                    </span>
                    <h2
                      className="text-2xl sm:text-3xl lg:text-[32px] font-normal text-[#152B41] tracking-tight leading-tight"
                      style={{ fontFamily: 'var(--lp-serif)' }}
                    >
                      {t('Mulai workspace pertama Anda')}
                    </h2>
                    <p className="text-sm sm:text-base text-[#526171] mt-2 max-w-2xl leading-relaxed">
                      {t(
                        'Rekaman dan naskah tetap tersimpan di browser perangkat ini, bukan di akun Catetin atau cloud.'
                      )}
                    </p>

                    <div className="empty-actions flex flex-wrap items-center gap-3 pt-6 mt-6 border-t border-[var(--border)]/70">
                      {onStartRecordingClick && (
                        <Button
                          onClick={onStartRecordingClick}
                          className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2.5 shadow-xs"
                        >
                          <Mic className="size-4 text-[#CFE2F1] shrink-0" aria-hidden="true" />
                          <span>{t('Rekam pertemuan')}</span>
                          <span className="sr-only">({t('Lokal di perangkat')})</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => onOpenRecordingClick()}
                        className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-[var(--accent)] border-[var(--border)] text-[#152B41] text-sm font-semibold gap-2 shadow-2xs"
                      >
                        <Upload className="size-4 text-[#172F49] shrink-0" aria-hidden="true" />
                        <span>{t('Buka rekaman')}</span>
                      </Button>
                      <Button
                        variant="outline"
                        onClick={onCreateProjectClick}
                        className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-[var(--accent)] border-[var(--border)] text-[#152B41] text-sm font-semibold gap-2 shadow-2xs"
                      >
                        <FolderPlus className="size-4 text-[#172F49] shrink-0" aria-hidden="true" />
                        <span>{t('Buat project')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={onTryDemo}
                        className="min-h-[44px] px-3.5 text-sm font-semibold text-[#172F49] hover:bg-[var(--accent)] gap-1.5"
                      >
                        <span>{t('Coba contoh')}</span>
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </section>
                ) : (
                  <>
                    {/* SECTION 1: Lanjutkan pekerjaan */}
                    <section aria-label={t('Lanjutkan pekerjaan')} className="space-y-3">
                      <div>
                        <h2
                          className="text-xl sm:text-2xl font-normal tracking-tight text-[#152B41]"
                          style={{ fontFamily: 'var(--lp-serif)' }}
                        >
                          {t('Lanjutkan pekerjaan')}
                        </h2>
                        <p className="text-xs sm:text-sm text-[#526171] mt-0.5">
                          {t('Lanjutkan dari pekerjaan terakhir yang belum selesai.')}
                        </p>
                      </div>

                      {latestRecording ? (
                        <div
                          data-testid="workspace-continue-card"
                          className="bg-white border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="w-12 h-12 rounded-xl bg-[#E8F1F8] text-[#172F49] grid place-items-center shrink-0">
                              <AudioLines className="size-6" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <strong className="block text-base sm:text-lg font-semibold text-[#152B41] truncate">
                                {latestRecording.title}
                              </strong>
                              <span className="block text-xs sm:text-sm text-[#526171] truncate mt-1">
                                {t('Transkrip')} • {formatItemDate(latestRecording.updatedAt, language)} • {formatDurationHuman(latestRecording.durationSec, language)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                            {hasTranscriptSegments ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#E6F5EC] text-[#17663A] border border-[#C6E9D3]">
                                {t('Selesai')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#E8F1FB] text-[#1D4E89] border border-[#C9DDF5]">
                                {t('Transkrip belum selesai')}
                              </span>
                            )}
                            <Button
                              variant="outline"
                              onClick={() => onOpenRecording(latestRecording.id, latestRecording.projectId)}
                              className="min-h-[44px] px-4 rounded-xl border-[var(--border)] text-sm font-semibold text-[#152B41] hover:bg-[var(--accent)] gap-1.5 shadow-2xs"
                            >
                              <span>{t('Lanjutkan transkrip')}</span>
                              <ChevronRight className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          data-testid="workspace-continue-card"
                          className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-6 text-center"
                        >
                          <p className="text-sm text-[#526171]">{t('Belum ada transkrip terakhir')}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenRecordingClick()}
                            className="mt-3 text-xs min-h-[44px]"
                          >
                            {t('Buka rekaman')}
                          </Button>
                        </div>
                      )}
                    </section>

                    {/* SECTION 2: Terbaru di workspace (Max 3 items) */}
                    <section
                      aria-label={t('Terbaru di workspace')}
                      data-testid="workspace-recent-section"
                      className="space-y-3 pt-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2
                            className="text-xl sm:text-2xl font-normal tracking-tight text-[#152B41]"
                            style={{ fontFamily: 'var(--lp-serif)' }}
                          >
                            {t('Terbaru di workspace')}
                          </h2>
                          <p className="text-xs sm:text-sm text-[#526171] mt-0.5">
                            {recentCombinedItems.length} {t('pekerjaan terakhir di workspace Anda.')}
                          </p>
                        </div>
                        <button
                          type="button"
                          data-testid="workspace-view-all-recordings"
                          onClick={() => handleSelectSidebarSection('recordings')}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-[#172F49] hover:underline min-h-[44px] px-2"
                        >
                          <span>{t('Lihat semua')}</span>
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="bg-white border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)]/70 shadow-2xs overflow-hidden">
                        {recentCombinedItems.map(item => {
                          const isRec = item.type === 'recording';
                          const isMenuOpen = openMenuId === `overview-${item.id}`;
                          return (
                            <div
                              key={`${item.type}-${item.id}`}
                              data-recent-item-id={`${item.type}-${item.id}`}
                              className="group flex items-center justify-between gap-3 p-4 sm:p-5 hover:bg-[#F8FAFC] transition-colors"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (isRec) {
                                    onOpenRecording(item.id, item.projectId);
                                  } else {
                                    onOpenProject(item.id);
                                  }
                                }}
                                className="flex items-center gap-4 min-w-0 text-left min-h-[44px] flex-1 focus-visible:outline-2 focus-visible:outline-[var(--primary)] rounded-lg"
                              >
                                <div className="w-11 h-11 rounded-xl bg-[#E8F1F8] text-[#172F49] grid place-items-center shrink-0">
                                  {isRec ? (
                                    <AudioLines className="size-5" aria-hidden="true" />
                                  ) : (
                                    <Folder className="size-5" aria-hidden="true" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <strong className="block text-sm sm:text-base font-semibold text-[#152B41] truncate group-hover:text-[var(--primary)]">
                                    {item.title}
                                  </strong>
                                  <span className="block text-xs sm:text-sm text-[#526171] truncate mt-1">
                                    {isRec
                                      ? `${t('Transkrip')} • ${formatItemDate(item.timestamp, language)} • ${formatDurationHuman(item.durationSec, language)}`
                                      : `${t('Project')} • ${formatItemDate(item.timestamp, language)} • ${item.recordingCount} ${t('rekaman')}`}
                                  </span>
                                </div>
                              </button>

                              {/* Row menu */}
                              <div className="relative shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenMenuId(prev =>
                                      prev === `overview-${item.id}` ? null : `overview-${item.id}`
                                    )
                                  }
                                  aria-expanded={isMenuOpen}
                                  aria-label={`${t('Aksi')} ${item.title}`}
                                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#526171] hover:bg-[var(--accent)] hover:text-[#152B41]"
                                >
                                  <Ellipsis className="size-4" aria-hidden="true" />
                                </button>

                                {isMenuOpen && (
                                  <div
                                    role="menu"
                                    className="absolute right-0 top-12 z-20 w-44 rounded-xl bg-white border border-[var(--border)] shadow-lg p-1.5 space-y-1"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        if (isRec) {
                                          onOpenRecording(item.id, item.projectId);
                                        } else {
                                          onOpenProject(item.id);
                                        }
                                      }}
                                      className="w-full min-h-[40px] px-3 py-2 rounded-lg text-left text-xs sm:text-sm font-medium text-[#152B41] hover:bg-[var(--accent)] flex items-center gap-2"
                                    >
                                      <span>{t('Buka')}</span>
                                    </button>
                                    {!isRec && onExportClick && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setOpenMenuId(null);
                                          onExportClick('project', item.id);
                                        }}
                                        className="w-full min-h-[40px] px-3 py-2 rounded-lg text-left text-xs sm:text-sm font-medium text-[#152B41] hover:bg-[var(--accent)] flex items-center gap-2"
                                      >
                                        <span>{t('Export')}</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 2: PROJECTS (Dedicated Project Management View)                      */}
            {/* ========================================================================= */}
            {activeSection === 'projects' && (
              <div className="workspace-projects-view space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[var(--border)]">
                  <div>
                    <h1
                      className="text-2xl sm:text-3xl lg:text-[36px] font-normal tracking-tight text-[#152B41] leading-tight"
                      style={{ fontFamily: 'var(--lp-serif)' }}
                    >
                      {t('Projects')}
                    </h1>
                    <p className="text-sm sm:text-base text-[#526171] mt-1.5 leading-relaxed">
                      {t('Kelola seluruh project lokal Anda.')}
                    </p>
                  </div>
                  <Button
                    onClick={onCreateProjectClick}
                    className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2 shadow-xs shrink-0 self-start sm:self-auto"
                  >
                    <FolderPlus className="size-4 text-[#CFE2F1]" aria-hidden="true" />
                    <span>{t('Buat project')}</span>
                  </Button>
                </header>

                {/* Project Search Bar */}
                <div className="relative max-w-md">
                  <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#526171]" aria-hidden="true" />
                  <input
                    type="search"
                    value={projectSearchQuery}
                    onChange={e => setProjectSearchQuery(e.target.value)}
                    placeholder={t('Cari project...')}
                    className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-[var(--border)] bg-white text-sm text-[#152B41] placeholder:text-[#526171] shadow-2xs"
                  />
                </div>

                {filteredProjects.length === 0 ? (
                  <div className="w-full bg-white border border-[var(--border)] rounded-2xl p-8 sm:p-12 text-center shadow-2xs my-4 flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-[#E8F1F8] text-[#172F49] flex items-center justify-center mb-4 shrink-0 shadow-2xs">
                      <Folder className="size-7" aria-hidden="true" />
                    </div>
                    <h3 className="font-bold text-lg sm:text-xl text-[#152B41]">
                      {t('Belum ada project lokal')}
                    </h3>
                    <p className="text-sm sm:text-base text-[#526171] mt-2 mb-6 max-w-md leading-relaxed">
                      {t('Mulai dengan membuat project baru atau mencoba contoh naskah.')}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <Button
                        onClick={onCreateProjectClick}
                        className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2 shadow-xs"
                      >
                        <FolderPlus className="size-4 text-[#CFE2F1]" aria-hidden="true" />
                        <span>{t('Buat project pertama')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={onTryDemo}
                        className="min-h-[44px] px-4 text-sm font-semibold text-[#172F49] hover:bg-[var(--accent)] gap-1.5"
                      >
                        <span>{t('Coba contoh')}</span>
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredProjects.map(proj => (
                      <div
                        key={proj.id}
                        className="bg-white border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-2xs hover:shadow-sm transition-shadow flex flex-col justify-between gap-5 group"
                      >
                        <div>
                          <div className="w-12 h-12 rounded-xl bg-[#E8F1F8] text-[#172F49] grid place-items-center mb-3.5">
                            <Folder className="size-6" aria-hidden="true" />
                          </div>
                          <h3 className="font-bold text-base sm:text-lg text-[#152B41] truncate group-hover:text-[var(--primary)]">
                            {proj.title}
                          </h3>
                          <div className="text-xs sm:text-sm text-[#526171] mt-1 space-y-1">
                            <div>
                              {proj.recordingCount} {t('rekaman')} • {formatDurationHuman(proj.totalDurationSec, language)}
                            </div>
                            {proj.updatedAt > 0 && (
                              <div className="text-[12px] text-[var(--muted-foreground)]">
                                {t('Terakhir diperbarui')}: {formatItemDate(proj.updatedAt, language)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-4 border-t border-[var(--border)]/70">
                          <button
                            type="button"
                            onClick={() => onCreateFolderClick(proj.id)}
                            className="min-h-[44px] px-3 rounded-xl text-xs sm:text-sm font-medium text-[#526171] hover:text-[#152B41] hover:bg-[var(--accent)] inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Plus className="size-4" aria-hidden="true" />
                            <span>{t('Folder baru')}</span>
                          </button>
                          <div className="flex items-center gap-2">
                            {onExportClick && (
                              <button
                                type="button"
                                onClick={() => onExportClick('project', proj.id)}
                                className="min-h-[44px] px-3 rounded-xl text-xs sm:text-sm font-medium text-[#526171] hover:text-[#152B41] hover:bg-[var(--accent)] transition-colors"
                              >
                                {t('Export')}
                              </button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => onOpenProject(proj.id)}
                              className="min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-semibold"
                            >
                              {t('Buka')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 3: REKAMAN (Dedicated Cross-Project Recordings View)                 */}
            {/* ========================================================================= */}
            {activeSection === 'recordings' && (
              <div className="workspace-recordings-view space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[var(--border)]">
                  <div>
                    <h1
                      className="text-2xl sm:text-3xl lg:text-[36px] font-normal tracking-tight text-[#152B41] leading-tight"
                      style={{ fontFamily: 'var(--lp-serif)' }}
                    >
                      {t('Rekaman')}
                    </h1>
                    <p className="text-sm sm:text-base text-[#526171] mt-1.5 leading-relaxed">
                      {t('Semua rekaman dan naskah percakapan di workspace lokal Anda.')}
                    </p>
                  </div>

                  <div className="flex items-center flex-wrap gap-3 shrink-0 self-start sm:self-auto">
                    {onStartRecordingClick && (
                      <Button
                        onClick={onStartRecordingClick}
                        className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2 shadow-xs"
                      >
                        <Mic className="size-4 text-[#CFE2F1]" aria-hidden="true" />
                        <span>{t('Rekam pertemuan')}</span>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => onOpenRecordingClick()}
                      className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-[var(--accent)] border-[var(--border)] text-[#152B41] text-sm font-semibold gap-2 shadow-2xs"
                    >
                      <Upload className="size-4 text-[#172F49]" aria-hidden="true" />
                      <span>{t('Buka rekaman')}</span>
                    </Button>
                  </div>
                </header>

                {/* Filter & Search Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[var(--border)] shadow-2xs">
                  <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
                    {/* Search */}
                    <div className="relative min-w-[200px] flex-1 max-w-sm">
                      <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#526171]" aria-hidden="true" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={t('Cari workspace')}
                        className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-[var(--border)] text-sm text-[#152B41] placeholder:text-[#526171]"
                      />
                    </div>

                    {/* Filter Project */}
                    <select
                      value={selectedProjectId}
                      onChange={e => {
                        setSelectedProjectId(e.target.value);
                        setSelectedFolderId('all');
                      }}
                      aria-label={t('Project')}
                      className="min-h-[44px] text-sm px-3 py-2 rounded-xl border border-[var(--border)] bg-white text-[#152B41]"
                    >
                      <option value="all">{t('Semua project')}</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>

                    {/* Filter Folder */}
                    <select
                      value={selectedFolderId}
                      onChange={e => setSelectedFolderId(e.target.value as any)}
                      aria-label={t('Folder')}
                      className="min-h-[44px] text-sm px-3 py-2 rounded-xl border border-[var(--border)] bg-white text-[#152B41]"
                    >
                      <option value="all">{t('Semua folder')}</option>
                      <option value="none">{t('Tanpa folder')}</option>
                      {folders
                        .filter(f => selectedProjectId === 'all' || f.projectId === selectedProjectId)
                        .map(f => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>

                    {/* Filter Tag */}
                    {allWorkspaceTags.length > 0 && (
                      <select
                        value={selectedTag ?? ''}
                        onChange={e => setSelectedTag(e.target.value ? e.target.value : null)}
                        aria-label={t('Tag')}
                        className="min-h-[44px] text-sm px-3 py-2 rounded-xl border border-[var(--border)] bg-white text-[#152B41]"
                      >
                        <option value="">{t('Semua tag')}</option>
                        {allWorkspaceTags.map(tag => (
                          <option key={tag} value={tag}>
                            #{tag}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Sort */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-medium text-[#526171]">{t('Urutkan')}:</span>
                    <select
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value as any)}
                      aria-label={t('Urutkan')}
                      className="min-h-[44px] text-sm px-3 py-2 rounded-xl border border-[var(--border)] bg-white text-[#152B41]"
                    >
                      <option value="recent">{t('Terakhir dibuka')}</option>
                      <option value="title">{t('Judul A-Z')}</option>
                      <option value="duration">{t('Durasi terpanjang')}</option>
                    </select>
                  </div>
                </div>

                {filteredRecordings.length === 0 ? (
                  <div className="w-full bg-white border border-[var(--border)] rounded-2xl p-8 sm:p-12 text-center shadow-2xs my-4 flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-[#E8F1F8] text-[#172F49] flex items-center justify-center mb-4 shrink-0 shadow-2xs">
                      <AudioLines className="size-7" aria-hidden="true" />
                    </div>
                    <h3 className="font-bold text-lg sm:text-xl text-[#152B41]">
                      {t('Belum ada rekaman di workspace.')}
                    </h3>
                    <p className="text-sm sm:text-base text-[#526171] mt-2 mb-6 max-w-md leading-relaxed">
                      {t('Rekam langsung atau buka audio yang sudah ada untuk mulai membuat naskah.')}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      {onStartRecordingClick && (
                        <Button
                          onClick={onStartRecordingClick}
                          className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2 shadow-xs"
                        >
                          <Mic className="size-4 text-[#CFE2F1]" aria-hidden="true" />
                          <span>{t('Rekam pertemuan')}</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => onOpenRecordingClick()}
                        className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-[var(--accent)] border-[var(--border)] text-[#152B41] text-sm font-semibold gap-2 shadow-2xs"
                      >
                        <Upload className="size-4 text-[#172F49]" aria-hidden="true" />
                        <span>{t('Buka rekaman')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={onTryDemo}
                        className="min-h-[44px] px-4 text-sm font-semibold text-[#172F49] hover:bg-[var(--accent)] gap-1.5"
                      >
                        <span>{t('Coba contoh')}</span>
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white border border-[var(--border)] rounded-2xl shadow-2xs overflow-hidden">
                    <WorkspaceLibrary
                      viewMode="recordings"
                      projects={projects}
                      folders={folders}
                      recordings={filteredRecordings}
                      onOpenProject={onOpenProject}
                      onOpenRecording={onOpenRecording}
                      onMoveFolderClick={onMoveFolderClick}
                      onManageTagsClick={onManageTagsClick}
                      onExportProject={onExportClick ? pid => onExportClick('project', pid) : undefined}
                      onRenameFolderClick={onRenameFolderClick}
                      onDeleteFolderClick={onDeleteFolderClick}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 4: FOLDER & TAG (Workspace Organization View)                        */}
            {/* ========================================================================= */}
            {activeSection === 'folders-tags' && (
              <div className="workspace-folders-tags-view space-y-8">
                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[var(--border)]">
                  <div>
                    <h1
                      className="text-2xl sm:text-3xl lg:text-[36px] font-normal tracking-tight text-[#152B41] leading-tight"
                      style={{ fontFamily: 'var(--lp-serif)' }}
                    >
                      {t('Folder & tag')}
                    </h1>
                    <p className="text-sm sm:text-base text-[#526171] mt-1.5 leading-relaxed">
                      {t('Atur struktur dan pengelompokan rekaman dengan folder per project dan tag.')}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      if (projects.length === 0) {
                        onCreateProjectClick();
                      } else {
                        onCreateFolderClick();
                      }
                    }}
                    className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2 shadow-xs shrink-0 self-start sm:self-auto"
                  >
                    <Plus className="size-4 text-[#CFE2F1]" aria-hidden="true" />
                    <span>{t('Folder baru')}</span>
                  </Button>
                </header>

                {/* Section A: Folders per Project */}
                <section aria-label={t('Folder per project')} className="space-y-4">
                  <h2
                    className="text-xl sm:text-2xl font-normal tracking-tight text-[#152B41]"
                    style={{ fontFamily: 'var(--lp-serif)' }}
                  >
                    {t('Folder per project')}
                  </h2>

                  {projects.length === 0 ? (
                    <div className="w-full bg-white border border-[var(--border)] rounded-2xl p-8 sm:p-10 text-center shadow-2xs flex flex-col items-center">
                      <div className="w-14 h-14 rounded-2xl bg-[#E8F1F8] text-[#172F49] flex items-center justify-center mb-4 shrink-0 shadow-2xs">
                        <Folder className="size-7" aria-hidden="true" />
                      </div>
                      <h3 className="font-bold text-base sm:text-lg text-[#152B41]">
                        {t('Belum ada project untuk membuat folder')}
                      </h3>
                      <p className="text-sm sm:text-base text-[#526171] mt-2 mb-6 max-w-md leading-relaxed">
                        {t('Folder dibuat di dalam project. Buat project pertama Anda untuk mulai mengelompokkan rekaman.')}
                      </p>
                      <Button
                        onClick={onCreateProjectClick}
                        className="min-h-[44px] px-5 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white text-sm font-semibold gap-2 shadow-xs"
                      >
                        <FolderPlus className="size-4 text-[#CFE2F1]" aria-hidden="true" />
                        <span>{t('Buat project dahulu')}</span>
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {projects.map(proj => {
                        const projectFolders = folders.filter(f => f.projectId === proj.id);
                        return (
                          <div
                            key={proj.id}
                            className="bg-white border border-[var(--border)] rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4"
                          >
                            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--border)]/70">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Folder className="size-5 text-[#172F49] shrink-0" aria-hidden="true" />
                                <strong className="text-base font-bold text-[#152B41] truncate">
                                  {proj.title}
                                </strong>
                              </div>
                              <button
                                type="button"
                                onClick={() => onCreateFolderClick(proj.id)}
                                className="text-xs sm:text-sm font-semibold text-[#172F49] hover:underline inline-flex items-center gap-1 min-h-[44px] px-2.5"
                              >
                                <Plus className="size-3.5" aria-hidden="true" />
                                <span>{t('Folder baru')}</span>
                              </button>
                            </div>

                            {projectFolders.length === 0 ? (
                              <p className="text-sm text-[var(--muted-foreground)] italic py-3">
                                {t('Belum ada folder di project ini.')}
                              </p>
                            ) : (
                              <div className="space-y-2.5">
                                {projectFolders.map(folder => {
                                  const count = allRecordings.filter(r => r.folderId === folder.id).length;
                                  return (
                                    <div
                                      key={folder.id}
                                      className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F8FAFC] border border-[var(--border)]"
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <Folder className="size-4 text-[#526171] shrink-0" aria-hidden="true" />
                                        <span className="text-sm font-semibold text-[#152B41] truncate">
                                          {folder.name}
                                        </span>
                                        <span className="text-xs text-[#526171] shrink-0">
                                          ({count} {t('rekaman')})
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => onRenameFolderClick(folder)}
                                          aria-label={`${t('Ganti nama folder')} ${folder.name}`}
                                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#526171] hover:text-[#152B41] hover:bg-white"
                                        >
                                          <Pencil className="size-4" aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onDeleteFolderClick(folder.id)}
                                          aria-label={`${t('Hapus folder')} ${folder.name}`}
                                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-rose-600 hover:text-rose-700 hover:bg-white"
                                        >
                                          <Trash2 className="size-4" aria-hidden="true" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Section B: Workspace Tags */}
                <section aria-label={t('Tag workspace')} className="space-y-4 pt-2">
                  <h2
                    className="text-xl sm:text-2xl font-normal tracking-tight text-[#152B41]"
                    style={{ fontFamily: 'var(--lp-serif)' }}
                  >
                    {t('Tag workspace')}
                  </h2>

                  {allWorkspaceTags.length === 0 ? (
                    <div className="w-full bg-white border border-[var(--border)] rounded-2xl p-8 sm:p-10 text-center shadow-2xs flex flex-col items-center">
                      <div className="w-14 h-14 rounded-2xl bg-[#E8F1F8] text-[#172F49] flex items-center justify-center mb-4 shrink-0 shadow-2xs">
                        <Tag className="size-7" aria-hidden="true" />
                      </div>
                      <h3 className="font-bold text-base sm:text-lg text-[#152B41]">
                        {t('Belum ada tag di workspace')}
                      </h3>
                      <p className="text-sm sm:text-base text-[#526171] mt-2 max-w-md leading-relaxed">
                        {t('Tag ditambahkan langsung saat mengelola rekaman untuk memudahkan pencarian lintas topik.')}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white border border-[var(--border)] rounded-2xl p-6 shadow-2xs flex flex-wrap items-center gap-3">
                      {allWorkspaceTags.map(tag => {
                        const count = allRecordings.filter(r => (r.tags ?? []).includes(tag)).length;
                        return (
                          <div
                            key={tag}
                            className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#EFF4F9] text-[#172F49] border border-[#D5E3F0] text-sm font-semibold"
                          >
                            <Tag className="size-3.5" aria-hidden="true" />
                            <span>#{tag}</span>
                            <span className="text-xs text-[#526171] font-normal">({count})</span>
                            {onRenameTagClick && (
                              <button
                                type="button"
                                onClick={() => {
                                  const newName = window.prompt(t('Ganti nama tag'), tag);
                                  if (newName && newName.trim() && newName !== tag) {
                                    onRenameTagClick(tag, newName.trim());
                                  }
                                }}
                                aria-label={`${t('Ganti nama tag')} #${tag}`}
                                className="text-[#526171] hover:text-[#172F49] ml-1 p-1"
                              >
                                <Pencil className="size-3.5" aria-hidden="true" />
                              </button>
                            )}
                            {onDeleteTagClick && (
                              <button
                                type="button"
                                onClick={() => onDeleteTagClick(tag)}
                                aria-label={`${t('Hapus tag')} #${tag}`}
                                className="text-rose-500 hover:text-rose-700 ml-0.5 p-1"
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 5: PENYIMPANAN (Dedicated Full Storage & Backup View)                 */}
            {/* ========================================================================= */}
            {activeSection === 'storage' && (
              <div className="workspace-storage-view space-y-6">
                <header className="pb-4 border-b border-[var(--border)]">
                  <h1
                    className="text-2xl sm:text-3xl lg:text-[36px] font-normal tracking-tight text-[#152B41] leading-tight"
                    style={{ fontFamily: 'var(--lp-serif)' }}
                  >
                    {t('Penyimpanan')}
                  </h1>
                  <p className="text-sm sm:text-base text-[#526171] mt-1.5 leading-relaxed">
                    {t('Kelola penyimpanan peramban lokal dan buat cadangan data workspace Anda.')}
                  </p>
                </header>

                <div className="bg-white border border-[var(--border)] rounded-2xl p-6 sm:p-8 shadow-2xs">
                  <StorageSection
                    onExportWorkspace={() => onExportClick?.('workspace')}
                    onImportBackup={() => onImportClick?.()}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
