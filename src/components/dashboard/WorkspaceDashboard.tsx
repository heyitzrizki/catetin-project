import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  Cpu,
  FileAudio,
  Folder,
  FolderPlus,
  HardDrive,
  MoreVertical,
  Plus,
  Search,
  ShieldCheck,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t, useLanguage } from '@/lib/i18n';
import type {
  FolderRecord,
  ProjectSummary,
  RecentRecording,
  SearchMatch,
  WorkspaceStats,
} from '@/features/workspace/workspace-store';
import { searchLocalWorkspace } from '@/features/workspace/workspace-store';
import type { Recording } from '@/lib/transcript';

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
  folders,
  allRecordings,
  recentRecordings,
  stats,
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
}: WorkspaceDashboardProps) {
  const language = useLanguage() as 'id' | 'en';
  const hasProjects = projects.length > 0;

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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

  // Relevant folders based on selected project
  const relevantFolders = useMemo(() => {
    if (selectedProjectId === 'all') return folders;
    return folders.filter(f => f.projectId === selectedProjectId);
  }, [folders, selectedProjectId]);

  // Filtered recordings based on project, folder, tag
  const filteredRecordings = useMemo(() => {
    return allRecordings.filter(rec => {
      if (selectedProjectId !== 'all' && rec.projectId !== selectedProjectId) return false;
      if (selectedFolderId === 'none' && rec.folderId !== null && rec.folderId !== undefined) return false;
      if (selectedFolderId !== 'all' && selectedFolderId !== 'none' && rec.folderId !== selectedFolderId) return false;
      if (selectedTag && !(rec.tags ?? []).some(t => t.toLowerCase() === selectedTag.toLowerCase())) return false;
      return true;
    });
  }, [allRecordings, selectedProjectId, selectedFolderId, selectedTag]);

  const hasActiveFilters = selectedProjectId !== 'all' || selectedFolderId !== 'all' || selectedTag !== null || Boolean(searchQuery.trim());

  const clearAllFilters = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedProjectId('all');
    setSelectedFolderId('all');
    setSelectedTag(null);
  };

  const folderMap = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);
  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

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

      {/* Global Search Bar */}
      <section aria-label={t('Pencarian')} className="my-5">
        <div className="relative flex items-center w-full">
          <Search className="absolute left-3.5 size-4 text-[var(--muted-foreground)] pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('Cari rekaman, naskah, pembicara, tag, atau project...')}
            className="w-full pl-10 pr-10 py-2.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] min-h-[44px] shadow-sm focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
            aria-label={t('Cari rekaman, naskah, pembicara, tag, atau project...')}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 p-1 rounded hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
              aria-label={t('Hapus semua filter')}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

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

      {/* Filter Toolbar (Visible when there are projects) */}
      {hasProjects && (
        <section aria-label={t('Filter aktif')} className="filter-toolbar bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 my-4 shadow-sm flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Project Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--muted-foreground)]">{t('Project')}:</span>
                <select
                  value={selectedProjectId}
                  onChange={e => {
                    setSelectedProjectId(e.target.value);
                    setSelectedFolderId('all');
                  }}
                  className="text-xs px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] min-h-[36px]"
                  aria-label={t('Project')}
                >
                  <option value="all">{t('Semua project')}</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              {/* Folder Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--muted-foreground)]">{t('Folder')}:</span>
                <select
                  value={selectedFolderId}
                  onChange={e => setSelectedFolderId(e.target.value)}
                  className="text-xs px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] min-h-[36px]"
                  aria-label={t('Folder')}
                >
                  <option value="all">{t('Semua folder')}</option>
                  <option value="none">{t('Tanpa folder')}</option>
                  {relevantFolders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              {/* Add folder button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCreateFolderClick(selectedProjectId === 'all' ? undefined : selectedProjectId)}
                className="text-xs gap-1 min-h-[36px]"
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
                className="text-xs text-[var(--primary)] hover:underline min-h-[36px]"
              >
                {t('Hapus semua filter')}
              </Button>
            )}
          </div>

          {/* Tag Filter Pills */}
          {allWorkspaceTags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[var(--border)]">
              <span className="text-xs font-semibold text-[var(--muted-foreground)] flex items-center gap-1">
                <Tag className="size-3" aria-hidden="true" />
                {t('Tag')}:
              </span>
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors min-h-[28px] ${
                  selectedTag === null
                    ? 'bg-[var(--primary)] text-white border-[var(--primary)] font-medium'
                    : 'bg-[var(--background)] border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)]'
                }`}
              >
                {t('Semua tag')}
              </button>
              {allWorkspaceTags.map(tag => (
                <button
                  key={tag.toLowerCase()}
                  type="button"
                  onClick={() => setSelectedTag(prev => prev?.toLowerCase() === tag.toLowerCase() ? null : tag)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors min-h-[28px] ${
                    selectedTag?.toLowerCase() === tag.toLowerCase()
                      ? 'bg-[var(--primary)] text-white border-[var(--primary)] font-medium'
                      : 'bg-[var(--background)] border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)]'
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* VIEW MODE 1: SEARCH ACTIVE */}
      {debouncedQuery ? (
        <section aria-label={t('Hasil pencarian')} className="my-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[var(--foreground)]">
              {t('Hasil pencarian untuk')} "{debouncedQuery}" ({searchResults.length})
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
              {t('Hapus semua filter')}
            </Button>
          </div>

          {searchResults.length === 0 ? (
            /* EMPTY STATE C: PENCARIAN KOSONG */
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center max-w-lg mx-auto shadow-sm my-6">
              <Search className="size-10 mx-auto text-[var(--muted-foreground)] mb-3" aria-hidden="true" />
              <h3 className="font-semibold text-base text-[var(--foreground)]">
                {t('Tidak ada rekaman yang cocok')}
              </h3>
              <p className="text-sm text-[var(--muted-foreground)] mt-2 mb-4 leading-relaxed">
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
                  className="search-result-card text-left bg-[var(--card)] hover:bg-[var(--accent)] border border-[var(--border)] rounded-lg p-4 transition-colors group flex flex-col gap-2 min-h-[64px]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileAudio className="size-4 text-[var(--primary)] flex-shrink-0" aria-hidden="true" />
                      <strong className="text-sm font-semibold text-[var(--foreground)] truncate group-hover:text-[var(--primary)]">
                        {result.recordingTitle}
                      </strong>
                    </div>
                    <span className="text-xs text-[var(--muted-foreground)] flex-shrink-0">
                      {formatDurationHuman(result.durationSec, language)}
                    </span>
                  </div>

                  {/* Metadata labels */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <span>{result.projectTitle}</span>
                    {result.folderName && (
                      <span className="inline-flex items-center gap-1 bg-[var(--muted)] px-2 py-0.5 rounded text-[11px]">
                        <Folder className="size-3" aria-hidden="true" />
                        {result.folderName}
                      </span>
                    )}
                    {result.tags.map(t => (
                      <span key={t} className="bg-[var(--accent)] text-[var(--primary)] px-2 py-0.5 rounded-full text-[10px] font-medium">
                        #{t}
                      </span>
                    ))}
                  </div>

                  {/* Matched fields badges */}
                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted-foreground)] mt-0.5">
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
                        <span key={field} className="border border-[var(--border)] px-1.5 py-0.2 rounded font-medium bg-[var(--card)]">
                          {labelMap[field] || field}
                        </span>
                      );
                    })}
                  </div>

                  {/* Transcript snippet if matched */}
                  {result.snippet && (
                    <blockquote className="text-xs text-[var(--foreground)] bg-[var(--background)] p-2 rounded border border-[var(--border)] mt-1 italic leading-relaxed">
                      {result.segmentTime && <span className="font-mono text-[10px] mr-1.5 font-normal text-[var(--muted-foreground)]">[{result.segmentTime}]</span>}
                      "{result.snippet}"
                    </blockquote>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : !hasProjects ? (
        /* EMPTY STATE A: WORKSPACE BELUM ADA PROJECT */
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
      ) : hasActiveFilters && filteredRecordings.length === 0 ? (
        /* EMPTY STATE B / C: FILTER / FOLDER KOSONG */
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center max-w-lg mx-auto shadow-sm my-8">
          {selectedFolderId !== 'all' && selectedFolderId !== 'none' ? (
            /* EMPTY STATE B: FOLDER KOSONG */
            <>
              <Folder className="size-10 mx-auto text-[var(--muted-foreground)] mb-3" aria-hidden="true" />
              <h3 className="font-semibold text-base text-[var(--foreground)]">
                {t('Folder ini masih kosong')}
              </h3>
              <p className="text-sm text-[var(--muted-foreground)] mt-2 mb-4 leading-relaxed">
                {t('Belum ada rekaman di dalam folder ini. Buka rekaman baru atau pindahkan rekaman ke sini.')}
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button
                  onClick={() => onOpenRecordingClick(selectedProjectId === 'all' ? undefined : selectedProjectId, selectedFolderId)}
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
            /* EMPTY STATE C: FILTER TIDAK ADA HASIL */
            <>
              <Search className="size-10 mx-auto text-[var(--muted-foreground)] mb-3" aria-hidden="true" />
              <h3 className="font-semibold text-base text-[var(--foreground)]">
                {t('Tidak ada rekaman yang cocok')}
              </h3>
              <p className="text-sm text-[var(--muted-foreground)] mt-2 mb-4 leading-relaxed">
                {t('Tidak ada hasil yang sesuai dengan kata kunci atau filter saat ini.')}
              </p>
              <Button onClick={clearAllFilters} className="min-h-[44px]">
                {t('Hapus semua filter')}
              </Button>
            </>
          )}
        </section>
      ) : (
        /* NORMAL DASHBOARD VIEW: PROJECTS, FOLDERS, RECORDINGS */
        <div className="dashboard-grid grid grid-cols-1 lg:grid-cols-12 gap-8 my-6">
          {/* Projects & Folders Column */}
          <section aria-label={t('Semua project')} className="lg:col-span-7 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                {t('Semua project')}
              </h2>
              <span className="text-xs text-[var(--muted-foreground)]">
                {projects.length} {t('Project')}
              </span>
            </div>

            <div className="projects-list flex flex-col gap-3">
              {projects.map(project => {
                const projectFolders = folders.filter(f => f.projectId === project.id);
                return (
                  <div
                    key={project.id}
                    className="project-box bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 flex flex-col gap-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="flex items-start gap-3 min-w-0 text-left group flex-1"
                      >
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
                      </button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenProject(project.id)}
                        className="gap-1 min-h-[44px] text-xs"
                      >
                        {t('Buka')}
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    </div>

                    {/* Folders in this project */}
                    {projectFolders.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[var(--border)]">
                        <span className="text-[11px] text-[var(--muted-foreground)] font-medium">
                          {t('Folder')}:
                        </span>
                        {projectFolders.map(folder => (
                          <div
                            key={folder.id}
                            className="inline-flex items-center gap-1.5 text-xs bg-[var(--background)] px-2.5 py-1 rounded-md border border-[var(--border)]"
                          >
                            <span className="truncate max-w-[120px]">{folder.name}</span>
                            <button
                              type="button"
                              onClick={() => onRenameFolderClick(folder)}
                              className="text-[10px] text-[var(--primary)] hover:underline"
                              aria-label={`${t('Ganti nama folder')} ${folder.name}`}
                            >
                              {t('Ganti nama')}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteFolderClick(folder.id)}
                              className="text-[10px] text-[var(--destructive)] hover:underline ml-1"
                              aria-label={`${t('Hapus folder')} ${folder.name}`}
                            >
                              {t('Hapus')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recordings List Column (Filtered or Recents) */}
          <section aria-label={t('Rekaman terbaru')} className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                {hasActiveFilters ? t('Rekaman') : t('Rekaman terbaru')}
              </h2>
              {hasActiveFilters && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  {filteredRecordings.length} {t('rekaman')}
                </span>
              )}
            </div>

            {hasActiveFilters ? (
              <div className="recents-list flex flex-col gap-2.5">
                {filteredRecordings.map(rec => {
                  const proj = projectMap.get(rec.projectId ?? '');
                  const folder = rec.folderId ? folderMap.get(rec.folderId) : undefined;
                  return (
                    <div
                      key={rec.id}
                      className="recording-card bg-[var(--card)] hover:bg-[var(--accent)] border border-[var(--border)] rounded-lg p-3.5 transition-colors flex flex-col gap-2 group shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => onOpenRecording(rec.id, rec.projectId)}
                          className="flex items-center gap-2.5 min-w-0 text-left flex-1"
                        >
                          <FileAudio className="size-4 text-[var(--primary)] flex-shrink-0" aria-hidden="true" />
                          <strong className="block text-xs font-semibold text-[var(--foreground)] truncate group-hover:text-[var(--primary)]">
                            {rec.title}
                          </strong>
                        </button>
                        <span className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0">
                          {formatDurationHuman(rec.durationSec, language)}
                        </span>
                      </div>

                      {/* Folder & Tags */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {folder && (
                            <span className="inline-flex items-center gap-1 bg-[var(--muted)] px-2 py-0.5 rounded text-[10px] text-[var(--foreground)]">
                              <Folder className="size-3 text-[var(--primary)]" aria-hidden="true" />
                              {folder.name}
                            </span>
                          )}
                          {(rec.tags ?? []).map(tag => (
                            <span key={tag} className="bg-[var(--accent)] text-[var(--primary)] px-2 py-0.5 rounded-full text-[10px] font-medium border border-[var(--border)]">
                              #{tag}
                            </span>
                          ))}
                        </div>

                        {/* Quick Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onMoveFolderClick(rec)}
                            className="text-[11px] text-[var(--primary)] hover:underline min-h-[32px] px-1"
                          >
                            {t('Pindahkan')}
                          </button>
                          <button
                            type="button"
                            onClick={() => onManageTagsClick(rec)}
                            className="text-[11px] text-[var(--primary)] hover:underline min-h-[32px] px-1"
                          >
                            {t('Tag')}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : recentRecordings.length === 0 ? (
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-6 text-center text-sm text-[var(--muted-foreground)] shadow-sm">
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
