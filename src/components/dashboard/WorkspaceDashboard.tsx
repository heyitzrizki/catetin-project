import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  CalendarDays,
  Cpu,
  FileAudio,
  Folder,
  FolderPlus,
  HardDrive,
  Menu,
  Mic,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t, useLanguage } from '@/lib/i18n';
import { StorageSection } from './StorageSection';
import { WorkspaceSidebar, type WorkspaceSectionId } from './WorkspaceSidebar';
import { WorkspaceLibrary } from './WorkspaceLibrary';
import { ContinueWorkPanel } from './ContinueWorkPanel';
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
  onMoveFolderClick: (recording: Recording) => void;
  onExportClick?: (scope: 'project' | 'workspace', projectId?: string) => void;
  onImportClick?: () => void;
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
  onMoveFolderClick,
  onExportClick,
  onImportClick,
  onStartRecordingClick,
  recoverableSessions = [],
  onRecoverSession,
  onDiscardSession,
  isRecoveringSession = false,
}: WorkspaceDashboardProps) {
  const language = useLanguage() as 'id' | 'en';
  const hasProjects = projects.length > 0;

  // Sidebar & Shell Navigation State
  const [activeSection, setActiveSection] = useState<WorkspaceSectionId>('workspace');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [libraryViewMode, setLibraryViewMode] = useState<'projects' | 'recordings'>('projects');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'duration'>('recent');
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const storageSectionRef = useRef<HTMLDivElement>(null);

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

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [, setIsSearching] = useState(false);

  // Filter state
  const [selectedProjectId, setSelectedProjectId] = useState<string | 'all'>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all' | 'none'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Execute global search when debounced query changes
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

  const handleSelectSidebarSection = (section: WorkspaceSectionId) => {
    setActiveSection(section);
    if (section === 'projects') {
      setLibraryViewMode('projects');
    } else if (section === 'recordings') {
      setLibraryViewMode('recordings');
    } else if (section === 'folders-tags') {
      setAdvancedFiltersOpen(true);
    } else if (section === 'storage') {
      requestAnimationFrame(() => {
        storageSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  // Relevant folders based on selected project
  const relevantFolders = useMemo(() => {
    if (selectedProjectId === 'all') return folders;
    return folders.filter(f => f.projectId === selectedProjectId);
  }, [folders, selectedProjectId]);

  // Filtered and sorted recordings
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

  // Filtered projects for grouped view
  const displayedProjects = useMemo(() => {
    let list = projects;
    if (selectedProjectId !== 'all') {
      list = list.filter(p => p.id === selectedProjectId);
    } else if (selectedFolderId !== 'all' || selectedTag !== null) {
      const matchingProjIds = new Set(filteredRecordings.map(r => r.projectId));
      list = list.filter(p => matchingProjIds.has(p.id));
    }

    return [...list].sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'duration') {
        return (b.totalDurationSec || 0) - (a.totalDurationSec || 0);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }, [projects, selectedProjectId, selectedFolderId, selectedTag, filteredRecordings, sortBy]);

  const hasActiveFilters =
    selectedProjectId !== 'all' ||
    selectedFolderId !== 'all' ||
    selectedTag !== null ||
    Boolean(searchQuery.trim());

  const clearAllFilters = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedProjectId('all');
    setSelectedFolderId('all');
    setSelectedTag(null);
  };

  // Derive latest recording for ContinueWorkPanel from real recentRecordings / allRecordings
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

  const showAdvancedBar =
    advancedFiltersOpen ||
    activeSection === 'folders-tags' ||
    selectedProjectId !== 'all' ||
    selectedTag !== null;

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
        onExportWorkspace={() => onExportClick?.('workspace')}
        onImportBackup={() => onImportClick?.()}
      />

      {/* Main Workspace Canvas */}
      <div className="workspace-dashboard-main flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 md:py-8 max-w-[1440px]">
        {/* Hero Header + Primary & Secondary Actions */}
        <header className="dashboard-header flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-6">
          <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label={t('Buka navigasi')}
              className="md:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border border-[var(--border)] bg-white text-[#172F49] shrink-0 mt-0.5 shadow-2xs"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <h1
                className="text-2xl sm:text-3xl md:text-[34px] font-normal tracking-tight text-[#152B41] leading-tight"
                style={{ fontFamily: 'var(--lp-serif)' }}
              >
                {t('Workspace lokal')}
              </h1>
              <p className="text-xs sm:text-sm text-[#526171] mt-1 leading-relaxed">
                {t('Rekam pertemuan, transkripsikan secara lokal, dan kelola semua project Anda.')}
              </p>
            </div>
          </div>

          <div className="dashboard-actions flex items-center flex-wrap gap-2.5 shrink-0">
            {onStartRecordingClick && (
              <Button
                onClick={onStartRecordingClick}
                className="min-h-[44px] px-4 rounded-xl bg-[#172F49] hover:bg-[#1E3B5B] text-white font-semibold gap-2.5 shadow-xs"
              >
                <Mic className="size-4 text-[#CFE2F1] shrink-0" aria-hidden="true" />
                <span>{t('Rekam pertemuan')}</span>
                <span className="sr-only">({t('Lokal di perangkat')})</span>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => onOpenRecordingClick()}
              className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-[var(--accent)] border-[var(--border)] text-[#152B41] font-semibold gap-2"
            >
              <Upload className="size-4 text-[#172F49] shrink-0" aria-hidden="true" />
              <span>{t('Buka rekaman')}</span>
            </Button>
          </div>
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

        {/* Controls Bar: Segmented View Switch, Search Input, Folder Filter, Sort, More Filters */}
        <section
          aria-label={t('Pencarian')}
          className="workspace-controls-bar flex flex-col gap-3 pb-5 border-b border-[var(--border)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Segmented Switch: Project / Rekaman */}
            <div
              role="group"
              aria-label={t('Pilih tampilan')}
              className="inline-flex items-center p-1 rounded-xl bg-[#EEF2F6] border border-[var(--border)]"
            >
              <button
                type="button"
                aria-pressed={libraryViewMode === 'projects'}
                onClick={() => setLibraryViewMode('projects')}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
                  libraryViewMode === 'projects'
                    ? 'bg-[#F4EFE6] text-[#152B41] shadow-2xs border border-[#E5DEC9]'
                    : 'text-[#526171] hover:text-[#152B41]'
                }`}
              >
                <Folder className="size-3.5 text-[#172F49]" aria-hidden="true" />
                <span>{t('Project')}</span>
              </button>
              <button
                type="button"
                aria-pressed={libraryViewMode === 'recordings'}
                onClick={() => setLibraryViewMode('recordings')}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
                  libraryViewMode === 'recordings'
                    ? 'bg-[#F4EFE6] text-[#152B41] shadow-2xs border border-[#E5DEC9]'
                    : 'text-[#526171] hover:text-[#152B41]'
                }`}
              >
                <AudioLines className="size-3.5 text-[#172F49]" aria-hidden="true" />
                <span>{t('Rekaman')}</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[#526171] pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('Cari workspace')}
                aria-label={t('Cari rekaman, naskah, pembicara, tag, atau project...')}
                className="w-full min-h-[44px] pl-10 pr-9 py-2 text-xs sm:text-sm rounded-xl border border-[var(--border)] bg-white text-[#152B41] placeholder:text-[#687787] shadow-2xs focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[var(--accent)] text-[#526171]"
                  aria-label={t('Hapus semua filter')}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Folder Filter, Sort Select, and More Filters Toggle */}
            <div className="flex items-center flex-wrap gap-2">
              {hasProjects && (
                <div className="relative inline-flex items-center">
                  <Folder
                    className="absolute left-3 size-3.5 text-[#172F49] pointer-events-none"
                    aria-hidden="true"
                  />
                  <select
                    value={selectedFolderId}
                    onChange={e => setSelectedFolderId(e.target.value)}
                    aria-label={t('Folder')}
                    className="min-h-[44px] pl-8 pr-7 py-2 text-xs font-medium rounded-xl border border-[var(--border)] bg-white text-[#152B41] shadow-2xs focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                  >
                    <option value="all">{t('Semua folder')}</option>
                    <option value="none">{t('Tanpa folder')}</option>
                    {relevantFolders.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="relative inline-flex items-center">
                <CalendarDays
                  className="absolute left-3 size-3.5 text-[#172F49] pointer-events-none"
                  aria-hidden="true"
                />
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'recent' | 'title' | 'duration')}
                  aria-label={t('Urutkan')}
                  className="min-h-[44px] pl-8 pr-7 py-2 text-xs font-medium rounded-xl border border-[var(--border)] bg-white text-[#152B41] shadow-2xs focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                >
                  <option value="recent">{t('Terakhir dibuka')}</option>
                  <option value="title">{t('Judul A-Z')}</option>
                  <option value="duration">{t('Durasi terpanjang')}</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => setAdvancedFiltersOpen(prev => !prev)}
                aria-expanded={showAdvancedBar}
                aria-label={t('Filter lanjutan')}
                title={t('Filter lanjutan')}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border transition-colors inline-flex items-center justify-center gap-1.5 text-xs font-medium ${
                  showAdvancedBar
                    ? 'bg-[#E8F1F8] border-[#B8CADA] text-[#172F49]'
                    : 'bg-white border-[var(--border)] text-[#526171] hover:bg-[var(--accent)] hover:text-[#152B41]'
                }`}
              >
                <SlidersHorizontal className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Secondary / Contextual Bar: Project Filter, New Project, New Folder, Tag Pills */}
          {hasProjects && showAdvancedBar && (
            <div
              aria-label={t('Filter aktif')}
              className="flex flex-col gap-2.5 pt-2.5 border-t border-[var(--border)]/70"
            >
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Project Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#526171]">{t('Project')}:</span>
                    <select
                      value={selectedProjectId}
                      onChange={e => {
                        setSelectedProjectId(e.target.value);
                        setSelectedFolderId('all');
                      }}
                      aria-label={t('Project')}
                      className="min-h-[38px] text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-white text-[#152B41]"
                    >
                      <option value="all">{t('Semua project')}</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Contextual Project Creation */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCreateProjectClick}
                    className="min-h-[38px] text-xs gap-1.5 bg-white"
                  >
                    <FolderPlus className="size-3.5" aria-hidden="true" />
                    {t('Project baru')}
                  </Button>

                  {/* Contextual Folder Creation */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onCreateFolderClick(selectedProjectId === 'all' ? undefined : selectedProjectId)
                    }
                    className="min-h-[38px] text-xs gap-1 bg-white"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t('Folder baru')}
                  </Button>
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="min-h-[38px] text-xs text-[var(--primary)] hover:underline"
                  >
                    {t('Hapus semua filter')}
                  </Button>
                )}
              </div>

              {/* Tag Filter Pills */}
              {allWorkspaceTags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-[#526171] inline-flex items-center gap-1 mr-1">
                    <Tag className="size-3" aria-hidden="true" />
                    {t('Tag')}:
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedTag(null)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors min-h-[32px] ${
                      selectedTag === null
                        ? 'bg-[#172F49] text-white border-[#172F49] font-medium'
                        : 'bg-white border-[var(--border)] text-[#152B41] hover:bg-[var(--accent)]'
                    }`}
                  >
                    {t('Semua tag')}
                  </button>
                  {allWorkspaceTags.map(tag => (
                    <button
                      key={tag.toLowerCase()}
                      type="button"
                      onClick={() =>
                        setSelectedTag(prev =>
                          prev?.toLowerCase() === tag.toLowerCase() ? null : tag
                        )
                      }
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors min-h-[32px] ${
                        selectedTag?.toLowerCase() === tag.toLowerCase()
                          ? 'bg-[#172F49] text-white border-[#172F49] font-medium'
                          : 'bg-white border-[var(--border)] text-[#152B41] hover:bg-[var(--accent)]'
                      }`}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Loading State */}
        {loading ? (
          <div className="py-12 text-center text-sm text-[#526171]" role="status">
            {t('Memuat workspace lokal...')}
          </div>
        ) : debouncedQuery ? (
          /* VIEW MODE 1: SEARCH ACTIVE */
          <section aria-label={t('Hasil pencarian')} className="my-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#152B41]">
                {t('Hasil pencarian untuk')} "{debouncedQuery}" ({searchResults.length})
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                {t('Hapus semua filter')}
              </Button>
            </div>

            {searchResults.length === 0 ? (
              <div className="bg-white border border-[var(--border)] rounded-xl p-8 text-center max-w-lg mx-auto shadow-2xs my-6">
                <Search className="size-10 mx-auto text-[#526171] mb-3" aria-hidden="true" />
                <h3 className="font-semibold text-base text-[#152B41]">
                  {t('Tidak ada rekaman yang cocok')}
                </h3>
                <p className="text-sm text-[#526171] mt-2 mb-4 leading-relaxed">
                  {t('Tidak ada hasil yang sesuai dengan kata kunci atau filter saat ini.')}
                </p>
                <Button onClick={clearAllFilters} className="min-h-[44px]">
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
                    className="search-result-card text-left bg-white hover:bg-[var(--accent)] border border-[var(--border)] rounded-xl p-4 transition-colors group flex flex-col gap-2 min-h-[64px]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileAudio className="size-4 text-[#172F49] shrink-0" aria-hidden="true" />
                        <strong className="text-sm font-semibold text-[#152B41] truncate group-hover:text-[var(--primary)]">
                          {result.recordingTitle}
                        </strong>
                      </div>
                      <span className="text-xs text-[#526171] shrink-0">
                        {formatDurationHuman(result.durationSec, language)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#526171]">
                      <span>{result.projectTitle}</span>
                      {result.folderName && (
                        <span className="inline-flex items-center gap-1 bg-[#EEF2F6] px-2 py-0.5 rounded text-[11px]">
                          <Folder className="size-3" aria-hidden="true" />
                          {result.folderName}
                        </span>
                      )}
                      {result.tags.map(tag => (
                        <span
                          key={tag}
                          className="bg-[#E8F1F8] text-[#172F49] px-2 py-0.5 rounded-full text-[10px] font-medium"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-[#526171] mt-0.5">
                      <span>{t('Cocok pada')}:</span>
                      {result.matchedFields.map(field => {
                        const labelMap: Record<string, string> = {
                          title: t('Judul'),
                          filename: t('Nama berkas'),
                          project: t('Project'),
                          folder: t('Folder'),
                          tag: t('Tag'),
                          speaker: t('Pembicara'),
                          transcript: t('Isi naskah'),
                        };
                        return (
                          <span
                            key={field}
                            className="border border-[var(--border)] px-1.5 py-0.2 rounded font-medium bg-white"
                          >
                            {labelMap[field] || field}
                          </span>
                        );
                      })}
                    </div>

                    {result.snippet && (
                      <blockquote className="text-xs text-[#152B41] bg-[#F8FAFC] p-2 rounded border border-[var(--border)] mt-1 italic leading-relaxed">
                        {result.segmentTime && (
                          <span className="font-mono text-[10px] mr-1.5 font-normal text-[#526171]">
                            [{result.segmentTime}]
                          </span>
                        )}
                        "{result.snippet}"
                      </blockquote>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : !hasProjects ? (
          /* EMPTY STATE A: WORKSPACE BELUM ADA PROJECT (Honest Empty Workspace) */
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px] gap-8 my-6 items-start">
            <section
              aria-label={t('Belum ada project lokal')}
              className="dashboard-empty-state bg-white border border-[var(--border)] rounded-2xl p-6 md:p-8 shadow-2xs"
            >
              <div className="max-w-2xl">
                <span className="eyebrow block text-xs tracking-wider uppercase text-[#172F49] font-semibold mb-2">
                  {t('STUDIO CATETIN')}
                </span>
                <h2 className="text-xl md:text-2xl font-bold text-[#152B41] tracking-tight">
                  {t('Belum ada project lokal')}
                </h2>
                <p className="text-sm text-[#526171] mt-2 leading-relaxed">
                  {t(
                    'Semua rekaman dan naskah tersimpan sepenuhnya di perangkat ini tanpa akun atau koneksi server.'
                  )}
                </p>
              </div>

              <div className="onboarding-grid grid grid-cols-1 md:grid-cols-3 gap-4 my-6">
                <article className="onboarding-card bg-[#F8FAFC] border border-[var(--border)] rounded-xl p-4">
                  <div className="icon-wrap w-9 h-9 rounded-lg bg-[#E8F1F8] text-[#172F49] grid place-items-center mb-3">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold text-xs sm:text-sm text-[#152B41]">
                    {t('Privasi penuh di perangkat')}
                  </h3>
                  <p className="text-xs text-[#526171] mt-1.5 leading-relaxed">
                    {t(
                      'Audio dan transkrip Anda diproses langsung di peramban dan tidak pernah diunggah ke server mana pun.'
                    )}
                  </p>
                </article>

                <article className="onboarding-card bg-[#F8FAFC] border border-[var(--border)] rounded-xl p-4">
                  <div className="icon-wrap w-9 h-9 rounded-lg bg-[#E8F1F8] text-[#172F49] grid place-items-center mb-3">
                    <Cpu className="size-4" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold text-xs sm:text-sm text-[#152B41]">
                    {t('Transkripsi lokal Whisper')}
                  </h3>
                  <p className="text-xs text-[#526171] mt-1.5 leading-relaxed">
                    {t(
                      'Model dijalankan di perangkat Anda melalui WebGPU atau WebAssembly tanpa batas kuota cloud.'
                    )}
                  </p>
                </article>

                <article className="onboarding-card bg-[#F8FAFC] border border-[var(--border)] rounded-xl p-4">
                  <div className="icon-wrap w-9 h-9 rounded-lg bg-[#E8F1F8] text-[#172F49] grid place-items-center mb-3">
                    <HardDrive className="size-4" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold text-xs sm:text-sm text-[#152B41]">
                    {t('Penyimpanan browser mandiri')}
                  </h3>
                  <p className="text-xs text-[#526171] mt-1.5 leading-relaxed">
                    {t(
                      'Draf naskah tersimpan di IndexedDB browser Anda dan dapat diekspor kapan saja sebagai TXT, SRT, atau Word.'
                    )}
                  </p>
                </article>
              </div>

              <div className="empty-actions flex flex-wrap items-center gap-3 pt-1">
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

            {/* Right Panel in Empty State */}
            <ContinueWorkPanel
              latestRecording={null}
              fullRecording={null}
              onOpenRecording={onOpenRecording}
              onOpenProject={onOpenProject}
              onMoveFolderClick={onMoveFolderClick}
              onManageTagsClick={onManageTagsClick}
              onOpenRecordingClick={() => onOpenRecordingClick()}
            />
          </div>
        ) : hasActiveFilters && filteredRecordings.length === 0 ? (
          /* EMPTY STATE B / C: FILTER / FOLDER KOSONG */
          <section className="bg-white border border-[var(--border)] rounded-xl p-8 text-center max-w-lg mx-auto shadow-2xs my-8">
            {selectedFolderId !== 'all' && selectedFolderId !== 'none' ? (
              <>
                <Folder className="size-10 mx-auto text-[#526171] mb-3" aria-hidden="true" />
                <h3 className="font-semibold text-base text-[#152B41]">
                  {t('Folder ini masih kosong')}
                </h3>
                <p className="text-sm text-[#526171] mt-2 mb-4 leading-relaxed">
                  {t('Belum ada rekaman di dalam folder ini. Buka rekaman baru atau pindahkan rekaman ke sini.')}
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <Button
                    onClick={() =>
                      onOpenRecordingClick(
                        selectedProjectId === 'all' ? undefined : selectedProjectId,
                        selectedFolderId
                      )
                    }
                    className="min-h-[44px]"
                  >
                    {t('Buka rekaman')}
                  </Button>
                  <Button variant="outline" onClick={clearAllFilters} className="min-h-[44px]">
                    {t('Hapus semua filter')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Search className="size-10 mx-auto text-[#526171] mb-3" aria-hidden="true" />
                <h3 className="font-semibold text-base text-[#152B41]">
                  {t('Tidak ada rekaman yang cocok')}
                </h3>
                <p className="text-sm text-[#526171] mt-2 mb-4 leading-relaxed">
                  {t('Tidak ada hasil yang sesuai dengan kata kunci atau filter saat ini.')}
                </p>
                <Button onClick={clearAllFilters} className="min-h-[44px]">
                  {t('Hapus semua filter')}
                </Button>
              </>
            )}
          </section>
        ) : (
          /* POPULATED WORKSPACE: GROUPED LIBRARY + CONTINUE WORK PANEL */
          <div className="workspace-content-grid flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] gap-8 pt-5 items-start">
            {/* On mobile (<lg), ContinueWorkPanel moves above the library per spec */}
            <div className="order-2 lg:order-1 w-full min-w-0">
              <WorkspaceLibrary
                viewMode={libraryViewMode}
                projects={displayedProjects}
                folders={folders}
                recordings={filteredRecordings}
                onOpenProject={onOpenProject}
                onOpenRecording={onOpenRecording}
                onMoveFolderClick={onMoveFolderClick}
                onManageTagsClick={onManageTagsClick}
                onExportProject={
                  onExportClick ? projId => onExportClick('project', projId) : undefined
                }
                onRenameFolderClick={onRenameFolderClick}
                onDeleteFolderClick={onDeleteFolderClick}
              />

              {/* Secondary Contextual Actions below Library */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-4 mt-4 border-t border-[var(--border)]/70">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCreateProjectClick}
                    className="min-h-[44px] text-xs gap-1.5 bg-white"
                  >
                    <FolderPlus className="size-3.5 text-[#172F49]" aria-hidden="true" />
                    <span>{t('Project baru')}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onCreateFolderClick(
                        selectedProjectId === 'all' ? undefined : selectedProjectId
                      )
                    }
                    className="min-h-[44px] text-xs gap-1.5 bg-white"
                  >
                    <Plus className="size-3.5 text-[#172F49]" aria-hidden="true" />
                    <span>{t('Folder baru')}</span>
                  </Button>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2 w-full min-w-0">
              <ContinueWorkPanel
                latestRecording={latestRecording}
                fullRecording={latestFullRecording}
                onOpenRecording={onOpenRecording}
                onOpenProject={onOpenProject}
                onMoveFolderClick={onMoveFolderClick}
                onManageTagsClick={onManageTagsClick}
                onOpenRecordingClick={() => onOpenRecordingClick()}
              />
            </div>
          </div>
        )}

        {/* Detailed Storage & Backup Section (Shown when Storage nav item is selected) */}
        {activeSection === 'storage' && (
          <div ref={storageSectionRef} className="mt-8 pt-6 border-t border-[var(--border)]">
            <StorageSection
              onExportWorkspace={() => onExportClick?.('workspace')}
              onImportBackup={() => onImportClick?.()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
