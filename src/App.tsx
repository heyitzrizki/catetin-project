import { LanguageSelect } from '@/components/LanguageSelect';
import { AccountControl } from '@/components/account/AccountControl';
import { t, useLanguage } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileAudio, Folder, Info, Plus, Tag, Upload, X } from 'lucide-react';
import { LandingPage, questions } from '@/components/LandingPage';
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader';
import { ContinuousTranscriptEditor } from '@/components/workspace/ContinuousTranscriptEditor';
import { ContextualUtilityPanel } from '@/components/workspace/ContextualUtilityPanel';
import { AudioDock } from '@/components/workspace/AudioDock';
import { WhisperDrawer } from '@/components/workspace/WhisperDrawer';
import { WorkspaceDashboard } from '@/components/dashboard/WorkspaceDashboard';
import { NewProjectDialog } from '@/components/dashboard/NewProjectDialog';
import { FolderDialog } from '@/components/dashboard/FolderDialog';
import { ManageTagsDialog } from '@/components/dashboard/ManageTagsDialog';
import { MoveFolderDialog } from '@/components/dashboard/MoveFolderDialog';
import { ExportDialog } from '@/components/dashboard/ExportDialog';
import { ImportDialog } from '@/components/dashboard/ImportDialog';
import { CatetinBrand } from '@/components/brand/CatetinBrand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { downloadTranscript, formatSeconds, recordings, transcriptText, type DialogSegment, type Recording } from '@/lib/transcript';
import {
  createFolder,
  createProject,
  deleteFolder,
  getWorkspaceStats,
  isDemoRecordingId,
  listAllTags,
  listFolders,
  listProjectSummaries,
  listRecentRecordings,
  loadWorkspace,
  renameFolder,
  saveWorkspace,
  setRecordingFolder,
  setRecordingTags,
  type FolderRecord,
  type ProjectSummary,
  type RecentRecording,
  type WorkspaceStats,
} from '@/features/workspace/workspace-store';
import { decodeAudio } from '@/lib/transcription';
import { inspectAudioFile } from '@/features/transcription/audio-preparation';
import { TranscriptionJobController, createIdleSnapshot, type TranscriptionUiSnapshot } from '@/features/transcription/job-controller';

type InfoPage = 'about' | 'faq' | 'pricing' | null;

export default function App() {
  const language = useLanguage();
  const [page, setPage] = useState<'landing' | 'studio'>(() => location.hash === '#studio' ? 'studio' : 'landing');
  const [studioView, setStudioView] = useState<'dashboard' | 'editor'>('dashboard');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [dashboardProjects, setDashboardProjects] = useState<ProjectSummary[]>([]);
  const [dashboardRecents, setDashboardRecents] = useState<RecentRecording[]>([]);
  const [dashboardStats, setDashboardStats] = useState<WorkspaceStats>({
    projectCount: 0,
    recordingCount: 0,
    totalDurationSec: 0,
    lastUpdatedAt: null,
  });
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Dialog states
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [newProjectTitleForUpload, setNewProjectTitleForUpload] = useState('');
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogTargetProjectId, setFolderDialogTargetProjectId] = useState<string | undefined>(undefined);
  const [folderDialogEditingFolder, setFolderDialogEditingFolder] = useState<FolderRecord | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagDialogTargetRecording, setTagDialogTargetRecording] = useState<Recording | null>(null);
  const [moveFolderDialogOpen, setMoveFolderDialogOpen] = useState(false);
  const [moveFolderTargetRecording, setMoveFolderTargetRecording] = useState<Recording | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'project' | 'workspace'>('workspace');
  const [exportProjectId, setExportProjectId] = useState<string | undefined>(undefined);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Studio editor sidebar folder filter
  const [sidebarFolderFilter, setSidebarFolderFilter] = useState<string | 'all' | 'none'>('all');

  const [availableRecordings, setAvailableRecordings] = useState<Recording[]>([]);
  const [activeId, setActiveId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, DialogSegment[]>>({});
  const [speakerNamesByRecording, setSpeakerNames] = useState<Record<string, Record<string, string>>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'naskah' | 'waktu'>('naskah');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [audioSources, setAudioSources] = useState<Record<string, string>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [overwriteConfirm, setOverwriteConfirm] = useState<{ resume: boolean } | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionUiSnapshot>(createIdleSnapshot);
  const [resumableChunks, setResumableChunks] = useState(0);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [infoPage, setInfoPage] = useState<InfoPage>(null);
  const [toast, setToast] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const objectUrls = useRef<string[]>([]);
  const audioFiles = useRef<Record<string, Blob>>({});
  const jobControllerRef = useRef<TranscriptionJobController | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const active = availableRecordings.find(item => item.id === activeId) ?? availableRecordings[0] ?? recordings[0];
  const effectiveId = active?.id ?? '';
  const segments = drafts[effectiveId] ?? active?.segments ?? [];
  const speakerNames = speakerNamesByRecording[effectiveId] ?? {};
  const audioSrc = audioSources[effectiveId];
  const isCustom = Boolean(audioSrc);

  const activeProjectTitle = activeProjectId === 'demo'
    ? t('Mode contoh')
    : dashboardProjects.find(p => p.id === activeProjectId)?.title ?? t('Rekaman saya');

  // Filter recordings for active project in Studio
  const baseProjectRecordings = activeProjectId === 'demo'
    ? availableRecordings.filter(r => isDemoRecordingId(r.id))
    : activeProjectId
      ? availableRecordings.filter(r => r.projectId === activeProjectId)
      : availableRecordings.filter(r => !isDemoRecordingId(r.id));

  const displayedProjectRecordings = baseProjectRecordings.filter(rec => {
    if (activeProjectId === 'demo') return true;
    if (sidebarFolderFilter === 'all') return true;
    if (sidebarFolderFilter === 'none') return !rec.folderId;
    return rec.folderId === sidebarFolderFilter;
  });

  const activeProjectFolders = folders.filter(f => f.projectId === activeProjectId);
  const activeFolder = active?.folderId ? folders.find(f => f.id === active.folderId) : undefined;

  const refreshDashboardData = async () => {
    try {
      const [summaries, recents, stats, folderList, tagList] = await Promise.all([
        listProjectSummaries(),
        listRecentRecordings(6),
        getWorkspaceStats(),
        listFolders(),
        listAllTags(),
      ]);
      setDashboardProjects(summaries);
      setDashboardRecents(recents);
      setDashboardStats(stats);
      setFolders(folderList);
      setAllTags(tagList);
      return summaries;
    } catch {
      return [];
    }
  };

  useEffect(() => () => {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url));
    jobControllerRef.current?.dispose();
    clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadWorkspace().then(async saved => {
      if (cancelled) return;
      if (saved) {
        const restoredSources: Record<string, string> = {};
        audioFiles.current = saved.audioFiles ?? {};
        Object.entries(audioFiles.current).forEach(([id, blob]) => {
          const url = URL.createObjectURL(blob);
          objectUrls.current.push(url);
          restoredSources[id] = url;
        });
        if (saved.recordings?.length) {
          setAvailableRecordings(saved.recordings);
          const chosenRec = (saved.activeId ? saved.recordings.find(item => item.id === saved.activeId) : undefined)
            ?? saved.recordings[0];
          setActiveId(chosenRec.id);
          if (chosenRec.projectId) setActiveProjectId(chosenRec.projectId);
        }
        if (saved.folders?.length) {
          setFolders(saved.folders);
        }
        setDrafts(saved.drafts ?? {});
        setSpeakerNames(saved.speakerNames ?? {});
        setAudioSources(restoredSources);
      }
      await refreshDashboardData();
    }).catch(() => notify(t('Draf lokal tidak dapat dipulihkan.'))).finally(() => { if (!cancelled) setWorkspaceReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const timer = window.setTimeout(() => {
      saveWorkspace({
        recordings: availableRecordings,
        drafts,
        speakerNames: speakerNamesByRecording,
        audioFiles: audioFiles.current,
        activeId: effectiveId || undefined,
        selectedModel: 'tiny',
      }).catch(() => notify(t('Draf lokal tidak dapat disimpan. Periksa ruang penyimpanan browser.')));
    }, 500);
    return () => clearTimeout(timer);
  }, [workspaceReady, availableRecordings, drafts, speakerNamesByRecording, effectiveId]);

  useEffect(() => {
    const syncPage = () => {
      if (location.hash === '#studio') {
        setPage('studio');
      } else {
        setPage('landing');
      }
    };
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    document.title = page === 'studio'
      ? (studioView === 'dashboard' ? `Dashboard · Catetin Studio` : `${t(active.title)} · Catetin Studio`)
      : t('Page title');
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }));
  }, [page, studioView, active?.title]);

  useEffect(() => {
    document.title = page === 'studio'
      ? (studioView === 'dashboard' ? `Dashboard · Catetin Studio` : `${t(active.title)} · Catetin Studio`)
      : t('Page title');
  }, [language, page, studioView, active?.title]);

  useEffect(() => {
    if (!isPlaying || isCustom || page !== 'studio' || studioView !== 'editor') return;
    const timer = window.setInterval(() => setCurrentTime(time => {
      if (time + playbackSpeed >= active.durationSec) { setIsPlaying(false); return active.durationSec; }
      return time + playbackSpeed;
    }), 1000);
    return () => clearInterval(timer);
  }, [isPlaying, isCustom, playbackSpeed, active?.durationSec, page, studioView]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, audioSrc]);

  useEffect(() => {
    if (page === 'landing') { audioRef.current?.pause(); setIsPlaying(false); }
  }, [page]);

  const notify = (message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  };

  if (!jobControllerRef.current) {
    jobControllerRef.current = new TranscriptionJobController({
      decodeWholeFile: decodeAudio,
      onStatusChange: setTranscription,
      onComplete: (nextSegments, meta) => {
        const targetId = meta.recordingId ?? activeIdRef.current;
        setDrafts(previous => ({ ...previous, [targetId]: nextSegments }));
        if (meta.durationSec > 0) {
          setAvailableRecordings(previous => previous.map(item => item.id === targetId && !item.durationSec ? { ...item, durationSec: meta.durationSec } : item));
        }
        setResumableChunks(0);
        notify(t('Transkripsi lokal selesai. Periksa hasilnya sebelum mengekspor.'));
        void refreshDashboardData();
      },
    });
  }

  useEffect(() => {
    let cancelled = false;
    const file = audioFiles.current[effectiveId];
    const running = ['validating', 'preparing-model', 'preparing-audio', 'transcribing', 'assembling-result'].includes(transcription.status);
    if (!file || running || !jobControllerRef.current) {
      setResumableChunks(0);
      return;
    }
    jobControllerRef.current.findCompatibleCheckpoint({
      file: file as Blob & { name?: string; type?: string },
      language,
    }).then(checkpoint => {
      if (!cancelled) setResumableChunks(checkpoint?.chunks.length ?? 0);
    }).catch(() => {
      if (!cancelled) setResumableChunks(0);
    });
    return () => { cancelled = true; };
  }, [effectiveId, language, transcription.status, audioSources]);

  const loadRecording = (id: string) => {
    if (id === activeId) return;
    audioRef.current?.pause();
    setActiveId(id);
    setCurrentTime(0);
    setIsPlaying(false);
    setSearchQuery('');
    setSpeakerFilter(null);
    setAudioError('');
    setAudioLoading(Boolean(audioSources[id]));
  };

  const openStudio = (sampleId?: string) => {
    if (sampleId) {
      if (!availableRecordings.some(r => r.id === sampleId)) {
        setAvailableRecordings(previous => {
          const needed = recordings.filter(r => r.id === sampleId && !previous.some(p => p.id === r.id));
          return [...previous, ...needed];
        });
      }
      loadRecording(sampleId);
      setActiveProjectId('demo');
      setStudioView('editor');
    } else {
      setStudioView('dashboard');
      void refreshDashboardData();
    }
    setPage('studio');
    if (location.hash !== '#studio') location.hash = 'studio';
  };

  const goHome = () => {
    setPage('landing');
    setStudioView('dashboard');
    history.pushState(null, '', location.pathname + location.search);
  };

  const handleOpenProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setSidebarFolderFilter('all');
    const recs = availableRecordings.filter(r => r.projectId === projectId);
    if (recs.length > 0) {
      loadRecording(recs[0].id);
    }
    setStudioView('editor');
  };

  const handleOpenRecentRecording = (recordingId: string, projectId?: string) => {
    if (projectId) setActiveProjectId(projectId);
    setSidebarFolderFilter('all');
    loadRecording(recordingId);
    setStudioView('editor');
  };

  const handleTryDemo = () => {
    setAvailableRecordings(previous => {
      const existingIds = new Set(previous.map(p => p.id));
      const needed = recordings.filter(r => !existingIds.has(r.id));
      return [...previous, ...needed];
    });
    loadRecording('wawancara');
    setActiveProjectId('demo');
    setStudioView('editor');
  };

  const handleCreateProject = async (title: string) => {
    const created = await createProject(title);
    await refreshDashboardData();
    setActiveProjectId(created.id);
    notify(t('Project berhasil dibuat.'));
  };

  const handleOpenUpload = (projectId?: string, folderId?: string | null) => {
    setPendingFile(null);
    setUploadError('');
    if (projectId && projectId !== 'demo') {
      setTargetProjectId(projectId);
    } else if (dashboardProjects.length > 0) {
      setTargetProjectId(dashboardProjects[0].id);
    } else {
      setTargetProjectId('new');
    }
    setNewProjectTitleForUpload('');
    setUploadOpen(true);
  };

  const handleCreateOrUpdateFolder = async (name: string) => {
    if (folderDialogEditingFolder) {
      await renameFolder(folderDialogEditingFolder.id, name);
      notify(t('Folder berhasil diperbarui.'));
    } else {
      const targetProj = folderDialogTargetProjectId || activeProjectId || (dashboardProjects[0]?.id ?? 'project-default');
      await createFolder(targetProj, name);
      notify(t('Folder berhasil dibuat.'));
    }
    await refreshDashboardData();
  };

  const handleDeleteFolderAction = async (folderId: string) => {
    await deleteFolder(folderId);
    setAvailableRecordings(prev => prev.map(r => r.folderId === folderId ? { ...r, folderId: null } : r));
    if (sidebarFolderFilter === folderId) setSidebarFolderFilter('all');
    await refreshDashboardData();
    notify(t('Folder berhasil dihapus.'));
  };

  const handleSaveTagsAction = async (tags: string[]) => {
    if (!tagDialogTargetRecording) return;
    await setRecordingTags(tagDialogTargetRecording.id, tags);
    setAvailableRecordings(prev => prev.map(r => r.id === tagDialogTargetRecording.id ? { ...r, tags } : r));
    await refreshDashboardData();
    notify(t('Tag berhasil diperbarui.'));
  };

  const handleMoveFolderAction = async (folderId: string | null) => {
    if (!moveFolderTargetRecording) return;
    await setRecordingFolder(moveFolderTargetRecording.id, folderId);
    setAvailableRecordings(prev => prev.map(r => r.id === moveFolderTargetRecording.id ? { ...r, folderId } : r));
    await refreshDashboardData();
    notify(t('Rekaman berhasil dipindahkan.'));
  };

  const seek = (seconds: number) => {
    const time = Math.max(0, Math.min(seconds, active.durationSec));
    setCurrentTime(time);
    if (audioRef.current && isCustom) audioRef.current.currentTime = time;
  };

  const togglePlay = async () => {
    if (audioLoading || !active.durationSec) return;
    if (currentTime >= active.durationSec) seek(0);
    if (isCustom) {
      if (isPlaying) audioRef.current?.pause();
      else try { await audioRef.current?.play(); } catch { setAudioError(t("Rekaman tidak dapat diputar. Coba berkas MP3 atau WAV lain.")); }
    } else setIsPlaying(value => !value);
  };

  const updateText = (id: number, text: string) => setDrafts(previous => ({ ...previous, [effectiveId]: (previous[effectiveId] ?? active.segments).map(s => s.id === id ? { ...s, text } : s) }));
  const addSegment = () => {
    const lastTime = segments.at(-1)?.seconds ?? -1;
    const seconds = Math.floor(Math.max(currentTime, lastTime + 1));
    if (active.durationSec && seconds >= active.durationSec) { notify(t("Naskah sudah mencapai akhir rekaman. Sunting segmen yang ada.")); return; }
    const id = Math.max(0, ...segments.map(s => s.id)) + 1;
    setDrafts(previous => ({ ...previous, [effectiveId]: [...segments, { id, seconds, time: formatSeconds(seconds), speaker: 'Pembicara', text: '' }] }));
    requestAnimationFrame(() => {
      const fields = document.querySelectorAll<HTMLElement>('.segment-text');
      fields[fields.length - 1]?.focus();
    });
  };

  const reloadWorkspaceState = async () => {
    const saved = await loadWorkspace();
    if (saved) {
      const restoredSources: Record<string, string> = {};
      audioFiles.current = saved.audioFiles ?? {};
      Object.entries(audioFiles.current).forEach(([id, blob]) => {
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        restoredSources[id] = url;
      });
      if (saved.recordings?.length) {
        setAvailableRecordings(saved.recordings);
        const chosenRec = (saved.activeId ? saved.recordings.find(item => item.id === saved.activeId) : undefined)
          ?? saved.recordings[0];
        setActiveId(chosenRec.id);
        if (chosenRec.projectId) setActiveProjectId(chosenRec.projectId);
      }
      if (saved.folders?.length) {
        setFolders(saved.folders);
      }
      setDrafts(saved.drafts ?? {});
      setSpeakerNames(saved.speakerNames ?? {});
      setAudioSources(restoredSources);
    }
    await refreshDashboardData();
  };

  const handleImportSuccess = async () => {
    await reloadWorkspaceState();
    notify(t('Data arsip berhasil dipulihkan'));
  };

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(transcriptText(segments, speakerNames)); notify(t("Naskah berhasil disalin.")); }
    catch { notify(t("Peramban tidak mengizinkan akses clipboard. Gunakan Ekspor teks polos untuk menyimpan naskah.")); }
  };

  const exportAs = (format: 'txt' | 'srt' | 'doc') => {
    if (!segments.length) return;
    downloadTranscript(format, active, segments, speakerNames);
    notify(t('Export ready', {format}));
  };

  const chooseFile = async (file?: File) => {
    setUploadError(''); setPendingFile(null);
    if (!file) return;
    const inspection = await inspectAudioFile(file);
    if (!inspection.valid) {
      if (inspection.errorCode === 'empty-file') { setUploadError(t("Berkas ini kosong. Pilih rekaman lain.")); return; }
      if (inspection.errorCode === 'exceeds-safe-limit') {
        const maxMb = Math.round(inspection.maxAllowedBytes / (1024 * 1024));
        const maxMin = Math.round(inspection.maxAllowedDurationSeconds / 60);
        setUploadError(t("Berkas melewati batas pengaman private alpha ({maxMb} MB atau {maxMin} menit untuk format ini).", { maxMb, maxMin }));
        return;
      }
      if (inspection.errorCode === 'unverified-duration') {
        setUploadError(t("Durasi berkas terkompresi tidak dapat diverifikasi dengan aman sebelum dekode."));
        return;
      }
      if (inspection.errorCode === 'corrupt-wav' || inspection.errorCode === 'unsupported-wav-codec') {
        setUploadError(t("Berkas WAV ini bukan PCM 16-bit standar atau headernya rusak."));
        return;
      }
      setUploadError(t("Format berkas belum didukung untuk transkripsi lokal."));
      return;
    }
    setPendingFile(file);
  };

  const importAudio = async () => {
    if (!pendingFile) return;

    let chosenProjectId = targetProjectId;
    if (chosenProjectId === 'new' || !chosenProjectId) {
      const titleToUse = newProjectTitleForUpload.trim() || t("Rekaman saya");
      const created = await createProject(titleToUse);
      chosenProjectId = created.id;
    }

    const id = `local-${Date.now()}`;
    const source = URL.createObjectURL(pendingFile);
    objectUrls.current.push(source);
    audioFiles.current[id] = pendingFile;
    const now = Date.now();
    const recording: Recording = {
      id,
      title: pendingFile.name.replace(/\.[^.]+$/, ''),
      filename: pendingFile.name,
      category: t("Rekaman lokal"),
      durationSec: 0,
      segments: [],
      projectId: chosenProjectId,
      folderId: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    audioRef.current?.pause();
    setAvailableRecordings(previous => [...previous.filter(r => r.id !== id), recording]);
    setAudioSources(previous => ({ ...previous, [id]: source }));
    setActiveId(id);
    setActiveProjectId(chosenProjectId);
    setSidebarFolderFilter('all');
    setCurrentTime(0);
    setIsPlaying(false);
    setAudioLoading(true);
    setAudioError('');
    setSearchQuery('');
    setSpeakerFilter(null);
    setUploadOpen(false);
    setPendingFile(null);
    setTranscription(createIdleSnapshot());
    setStudioView('editor');
    void refreshDashboardData();
  };

  const cancelTranscription = () => {
    jobControllerRef.current?.cancelActiveJob();
  };

  const executeActiveTranscription = async (resume = true) => {
    const audioFile = audioFiles.current[effectiveId];
    const running = ['validating', 'preparing-model', 'preparing-audio', 'transcribing', 'assembling-result'].includes(transcription.status);
    if (!audioFile || running) return;
    setOverwriteConfirm(null);
    if (!resume) {
      await jobControllerRef.current?.discardCheckpoint({
        file: audioFile as Blob & { name?: string; type?: string },
        language,
      });
      setResumableChunks(0);
    }
    await jobControllerRef.current?.runJob({
      file: audioFile as Blob & { name?: string; type?: string },
      language,
      recordingId: effectiveId,
      knownDurationSeconds: active.durationSec > 0 ? active.durationSec : undefined,
      resume,
    });
  };

  const runActiveTranscription = async (resume = true) => {
    const audioFile = audioFiles.current[effectiveId];
    const running = ['validating', 'preparing-model', 'preparing-audio', 'transcribing', 'assembling-result'].includes(transcription.status);
    if (!audioFile || running) return;
    const hasExistingOrEditedTranscript = segments.length > 0
      || (drafts[effectiveId]?.length ?? 0) > 0
      || Object.keys(speakerNames).length > 0;
    if (hasExistingOrEditedTranscript) {
      setOverwriteConfirm({ resume });
      return;
    }
    await executeActiveTranscription(resume);
  };

  const discardActiveCheckpoint = async () => {
    const audioFile = audioFiles.current[effectiveId];
    if (!audioFile) return;
    const deleted = await jobControllerRef.current?.discardCheckpoint({
      file: audioFile as Blob & { name?: string; type?: string },
      language,
    });
    if (deleted) {
      setResumableChunks(0);
      notify(t("Kemajuan transkripsi yang tersimpan telah dihapus."));
    }
  };

  const isTranscriptionRunning = ['validating', 'preparing-model', 'preparing-audio', 'transcribing', 'assembling-result'].includes(transcription.status);
  const isBackgroundJob = isTranscriptionRunning && Boolean(transcription.recordingId && transcription.recordingId !== effectiveId);
  const jobRecordingTitle = transcription.recordingId
    ? availableRecordings.find(item => item.id === transcription.recordingId)?.title
    : undefined;
  const activeSnapshot = !transcription.recordingId || transcription.recordingId === effectiveId || isBackgroundJob
    ? transcription
    : createIdleSnapshot();
  const canTranscribeActive = Boolean(audioFiles.current[effectiveId]);

  const exportActions = { onExportWord: () => exportAs('doc'), onExportTxt: () => exportAs('txt'), onExportSrt: () => exportAs('srt'), onCopyAll: copyAll };
  const utilityProps = {
    ...exportActions,
    viewMode,
    onChangeViewMode: setViewMode,
    segments,
    speakerNames,
    activeSpeakerFilter: speakerFilter,
    onSelectSpeakerFilter: setSpeakerFilter,
    selectedModel: 'tiny' as const,
    onOpenWhisperDrawer: () => setModelOpen(true),
    canTranscribe: canTranscribeActive,
    snapshot: activeSnapshot,
    isBackgroundJob,
    jobRecordingTitle,
    resumableChunks,
    onTranscribe: () => { void runActiveTranscription(true); },
    onResume: () => { void runActiveTranscription(true); },
    onStartFresh: () => { void runActiveTranscription(false); },
    onDiscardCheckpoint: () => { void discardActiveCheckpoint(); },
    onCancel: cancelTranscription,
  };

  return <div className={`app-shell ${page === 'studio' ? 'studio-shell' : ''}`}>
    <a className="skip-link" href="#main-content">{t("Langsung ke konten")}</a>
    <header className="site-header"><div className="page-container header-inner"><button className="brand" aria-label={t("Catetin, beranda")} onClick={goHome}><CatetinBrand hasAccessibleParent /></button>
      {page === 'landing' ? (
        <nav aria-label={t("Navigasi utama")} className="site-nav">
          <a href="#cara-kerja" className="nav-how">{t("Cara kerja")}</a>
          <a href="#privasi" className="nav-privacy">{t("Privasi")}</a>
          <a href="#contoh" className="nav-examples">{t("Contoh")}</a>
          <button onClick={() => setInfoPage('about')}>{t("Tentang")}</button>
          <Button onClick={() => openStudio()}>{t("Buka Studio")} <ArrowRight aria-hidden="true" /></Button>
        </nav>
      ) : (
        <div className="studio-nav">
          {studioView === 'editor' && (
            <Button variant="ghost" onClick={() => { setStudioView('dashboard'); void refreshDashboardData(); }}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("Dashboard")}
            </Button>
          )}
          <span>{t("Studio transkrip")}</span>
          <Button variant="ghost" onClick={goHome}><ArrowLeft aria-hidden="true" />{t("Beranda")}</Button>
        </div>
      )}
      <div className="header-actions">
        <AccountControl />
        <LanguageSelect />
      </div>
    </div></header>

    {page === 'landing' ? (
      <LandingPage onOpenStudio={openStudio} onOpenRecording={() => handleOpenUpload()} />
    ) : studioView === 'dashboard' ? (
      <main id="main-content" className="workspace-main" tabIndex={-1}>
        <WorkspaceDashboard
          projects={dashboardProjects}
          folders={folders}
          allRecordings={availableRecordings.filter(r => !isDemoRecordingId(r.id))}
          recentRecordings={dashboardRecents}
          stats={dashboardStats}
          allWorkspaceTags={allTags}
          onOpenProject={handleOpenProject}
          onOpenRecording={handleOpenRecentRecording}
          onCreateProjectClick={() => setNewProjectOpen(true)}
          onOpenRecordingClick={handleOpenUpload}
          onTryDemo={handleTryDemo}
          onCreateFolderClick={projId => {
            setFolderDialogEditingFolder(null);
            setFolderDialogTargetProjectId(projId);
            setFolderDialogOpen(true);
          }}
          onRenameFolderClick={f => {
            setFolderDialogEditingFolder(f);
            setFolderDialogTargetProjectId(f.projectId);
            setFolderDialogOpen(true);
          }}
          onDeleteFolderClick={handleDeleteFolderAction}
          onManageTagsClick={rec => {
            setTagDialogTargetRecording(rec);
            setTagDialogOpen(true);
          }}
          onMoveFolderClick={rec => {
            setMoveFolderTargetRecording(rec);
            setMoveFolderDialogOpen(true);
          }}
          onExportClick={(scope, projId) => {
            setExportScope(scope);
            setExportProjectId(projId);
            setExportDialogOpen(true);
          }}
          onImportClick={() => {
            setImportDialogOpen(true);
          }}
        />
      </main>
    ) : (
      <main id="main-content" className="workspace-main" tabIndex={-1}>
        <div className="studio-frame">
          <aside className="recording-sidebar" aria-label={t("Rekaman dalam sesi")}>
            <Button
              variant="ghost"
              onClick={() => { setStudioView('dashboard'); void refreshDashboardData(); }}
              className="mb-4 justify-start gap-2 min-h-[44px] text-xs font-semibold w-full"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("Kembali ke dashboard")}
            </Button>

            {activeProjectId === 'demo' && (
              <div className="demo-notice bg-[var(--accent)] text-[var(--primary)] text-xs p-3 rounded-md mb-4 border border-[var(--border)]">
                <span className="font-semibold block mb-1">{t("Mode contoh")}</span>
                <span className="text-[11px] leading-relaxed block">{t("Mode contoh: Rekaman ini tidak disimpan ke workspace lokal.")}</span>
              </div>
            )}

            <div className="sidebar-heading">
              <span>{activeProjectTitle.toUpperCase()}</span>
              <h2>{t("Ruang rekamanmu.")}</h2>
            </div>
            <Button variant="outline" onClick={() => handleOpenUpload(activeProjectId ?? undefined)}>
              <Upload aria-hidden="true" />{t("Buka rekaman")}
            </Button>

            {/* Folder Tabs / Selector in Sidebar (Only when not demo) */}
            {activeProjectId !== 'demo' && (
              <div className="sidebar-folders my-3 flex flex-col gap-1.5 pt-2 border-t border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">{t('Folder')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFolderDialogEditingFolder(null);
                      setFolderDialogTargetProjectId(activeProjectId ?? undefined);
                      setFolderDialogOpen(true);
                    }}
                    className="text-[10px] text-[var(--primary)] hover:underline flex items-center gap-0.5"
                    title={t('Buat folder baru')}
                  >
                    <Plus className="size-3" aria-hidden="true" />
                    <span>{t('Folder baru')}</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setSidebarFolderFilter('all')}
                    className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                      sidebarFolderFilter === 'all'
                        ? 'bg-[var(--primary)] text-white font-medium'
                        : 'bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--accent)] border border-[var(--border)]'
                    }`}
                  >
                    {t('Semua')} ({baseProjectRecordings.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarFolderFilter('none')}
                    className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                      sidebarFolderFilter === 'none'
                        ? 'bg-[var(--primary)] text-white font-medium'
                        : 'bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--accent)] border border-[var(--border)]'
                    }`}
                  >
                    {t('Tanpa folder')} ({baseProjectRecordings.filter(r => !r.folderId).length})
                  </button>
                  {activeProjectFolders.map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSidebarFolderFilter(f.id)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors truncate max-w-[140px] ${
                        sidebarFolderFilter === f.id
                          ? 'bg-[var(--primary)] text-white font-medium'
                          : 'bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--accent)] border border-[var(--border)]'
                      }`}
                    >
                      {f.name} ({baseProjectRecordings.filter(r => r.folderId === f.id).length})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="sidebar-label">{t("NASKAH TERSIMPAN LOKAL")}</p>
            <div className="recording-list">
              {displayedProjectRecordings.map(item => {
                const folder = item.folderId ? folders.find(f => f.id === item.folderId) : undefined;
                return (
                  <div
                    key={item.id}
                    className={`rounded-lg border transition-colors ${
                      activeId === item.id
                        ? 'border-[var(--primary)] bg-[var(--accent)]'
                        : 'border-transparent hover:bg-[var(--accent)]'
                    }`}
                  >
                    <button
                      type="button"
                      aria-current={activeId === item.id ? 'true' : undefined}
                      onClick={() => loadRecording(item.id)}
                      className="w-full text-left p-2 flex items-start gap-2.5 min-w-0"
                    >
                      <FileAudio className="size-4 text-[var(--primary)] mt-1 flex-shrink-0" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <span className="block font-semibold text-xs text-[var(--foreground)] truncate">
                          {t(item.title)}
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          {folder && (
                            <span className="text-[9px] bg-[var(--card)] px-1.5 py-0.2 rounded border border-[var(--border)] text-[var(--foreground)]">
                              {folder.name}
                            </span>
                          )}
                          {(item.tags ?? []).map(tg => (
                            <span key={tg} className="text-[9px] text-[var(--primary)] font-medium">
                              #{tg}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
              {displayedProjectRecordings.length === 0 && (
                <div className="text-xs text-[var(--muted-foreground)] p-4 border border-dashed border-[var(--border)] rounded-md text-center">
                  <p>{t("Belum ada rekaman di project ini.")}</p>
                </div>
              )}
            </div>
            <div className="sidebar-local">
              <Info aria-hidden="true" />
              <p>{t("Audio dan draf tersimpan lokal.")}<br/>{t("Ekspor hasil penting sebagai cadangan.")}</p>
            </div>
          </aside>

          {baseProjectRecordings.length === 0 ? (
            <div className="studio-content flex items-center justify-center min-h-[400px]">
              <div className="p-8 text-center bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md mx-auto shadow-sm">
                <FileAudio className="size-12 mx-auto text-[var(--muted-foreground)] mb-3" aria-hidden="true" />
                <h3 className="font-semibold text-base text-[var(--foreground)]">{t("Belum ada rekaman di project ini.")}</h3>
                <p className="text-sm text-[var(--muted-foreground)] mt-2 mb-5 leading-relaxed">
                  {t("Buka rekaman untuk mulai mentranskripsi atau menyunting naskah.")}
                </p>
                <Button onClick={() => handleOpenUpload(activeProjectId ?? undefined)} className="gap-2 min-h-[44px]">
                  <Upload className="size-4" aria-hidden="true" />
                  {t("Buka rekaman")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="studio-content">
              <WorkspaceHeader
                activeSample={active}
                availableRecordings={displayedProjectRecordings}
                onSelectSample={loadRecording}
                onUploadClick={() => handleOpenUpload(activeProjectId ?? undefined)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onOpenTools={() => setToolsOpen(true)}
                isCustom={isCustom}
                canExport={segments.length > 0}
                folderName={activeFolder?.name}
                tags={active?.tags ?? []}
                onOpenFolderModal={() => {
                  setMoveFolderTargetRecording(active);
                  setMoveFolderDialogOpen(true);
                }}
                onOpenTagsModal={() => {
                  setTagDialogTargetRecording(active);
                  setTagDialogOpen(true);
                }}
                {...exportActions}
              />
              {audioError && <div className="audio-error" role="alert"><Info aria-hidden="true" /><p>{t(audioError)}{t(" Anda tetap dapat menulis naskah secara manual.")}</p><Button variant="ghost" onClick={() => handleOpenUpload(activeProjectId ?? undefined)}>{t("Pilih berkas lain")}</Button></div>}
              <div className="workspace-body"><ContinuousTranscriptEditor key={effectiveId} segments={segments} speakerNames={speakerNames} currentTime={currentTime} onSeek={seek} onRenameSpeaker={(oldName, newName) => { setSpeakerNames(previous => ({ ...previous, [effectiveId]: { ...previous[effectiveId], [oldName]: newName } })); notify(t("Nama pembicara diperbarui di seluruh naskah.")); }} onUpdateText={updateText} searchQuery={searchQuery} activeSpeakerFilter={speakerFilter} viewMode={viewMode} onClearFilters={() => { setSearchQuery(''); setSpeakerFilter(null); }} onAddSegment={addSegment} isCustom={isCustom} /><aside className="desktop-utilities" aria-label={t("Alat naskah")}><ContextualUtilityPanel {...utilityProps} /></aside></div>
              <AudioDock currentTime={currentTime} durationSec={active.durationSec} isPlaying={isPlaying} playbackSpeed={playbackSpeed} onTogglePlay={togglePlay} onSeek={seek} onReset={() => { seek(0); audioRef.current?.pause(); setIsPlaying(false); }} onChangeSpeed={setPlaybackSpeed} isDemo={!isCustom} isLoading={audioLoading} />
            </div>
          )}
        </div>
      </main>
    )}

    {page === 'landing' && <footer className="site-footer page-container"><div><span className="footer-brand inline-flex items-center"><CatetinBrand height={24} /></span><p>{t("Ruang untuk setiap cerita.")}</p></div><nav aria-label={t("Navigasi footer")}><button onClick={() => setInfoPage('about')}>{t("Tentang")}</button><a href="#pertanyaan">{t("Pertanyaan")}</a><button onClick={() => setInfoPage('pricing')}>{t("Harga & lisensi")}</button></nav><span>© {new Date().getFullYear()} Catetin</span></footer>}

    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Buka rekaman Anda")}</DialogTitle>
          <DialogDescription>{t("Putar, transkripsikan, dan rapikan rekaman langsung di perangkat Anda.")}</DialogDescription>
        </DialogHeader>
        <div className="info-notice"><Info aria-hidden="true" /><p>{t("Setelah rekaman dibuka, jalankan Whisper dari menu Model & perangkat untuk membuat transkripsi lokal.")}</p></div>

        <div className="project-binding-section flex flex-col gap-1.5 my-2">
          <label htmlFor="upload-target-project" className="text-xs font-semibold text-[var(--foreground)]">
            {t("Pilih project tujuan")}
          </label>
          <select
            id="upload-target-project"
            value={targetProjectId}
            onChange={e => setTargetProjectId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] min-h-[44px]"
          >
            {dashboardProjects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
            <option value="new">{t("+ Buat project baru...")}</option>
          </select>
          {targetProjectId === 'new' && (
            <input
              type="text"
              value={newProjectTitleForUpload}
              onChange={e => setNewProjectTitleForUpload(e.target.value)}
              placeholder={t("Nama project")}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] mt-1.5 min-h-[44px]"
              maxLength={80}
            />
          )}
        </div>

        <label className={`file-picker ${pendingFile ? 'file-picked' : ''}`}><FileAudio aria-hidden="true" /><strong>{pendingFile ? pendingFile.name : t("Pilih berkas audio atau video")}</strong><span>{pendingFile ? `${(pendingFile.size / 1024 / 1024).toFixed(1)} MB · ${t('Replace file')}` : t("WAV (PCM 16-bit), MP3, M4A, atau WebM (batas pengaman private alpha berlaku)")}</span><input type="file" aria-label={t("Pilih berkas rekaman")} accept=".wav,.mp3,.m4a,.webm,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,video/webm" onChange={event => { void chooseFile(event.target.files?.[0]); }} /></label>{uploadError && <p className="form-error" role="alert">{t(uploadError)}</p>}<p className="text-sm text-muted-foreground leading-relaxed">{t("Aplikasi tidak mengunggah rekaman. Berkas dan draf disimpan di browser pada perangkat ini.")}</p><Button disabled={!pendingFile} onClick={importAudio}><Upload aria-hidden="true" />{t("Buka rekaman")}</Button>
      </DialogContent>
    </Dialog>

    <NewProjectDialog
      open={newProjectOpen}
      onOpenChange={setNewProjectOpen}
      onCreateProject={handleCreateProject}
    />

    <FolderDialog
      open={folderDialogOpen}
      onOpenChange={setFolderDialogOpen}
      folderId={folderDialogEditingFolder?.id}
      initialName={folderDialogEditingFolder?.name}
      onSubmit={handleCreateOrUpdateFolder}
    />

    <ManageTagsDialog
      open={tagDialogOpen}
      onOpenChange={setTagDialogOpen}
      recordingTitle={tagDialogTargetRecording?.title ?? ''}
      initialTags={tagDialogTargetRecording?.tags ?? []}
      allWorkspaceTags={allTags}
      onSave={handleSaveTagsAction}
    />

    <MoveFolderDialog
      open={moveFolderDialogOpen}
      onOpenChange={setMoveFolderDialogOpen}
      recordingTitle={moveFolderTargetRecording?.title ?? ''}
      currentFolderId={moveFolderTargetRecording?.folderId ?? null}
      folders={folders.filter(f => !moveFolderTargetRecording?.projectId || f.projectId === moveFolderTargetRecording.projectId)}
      onSelectFolder={handleMoveFolderAction}
    />

    <ExportDialog
      isOpen={exportDialogOpen}
      onClose={() => setExportDialogOpen(false)}
      scope={exportScope}
      projectId={exportProjectId}
      projectTitle={exportProjectId ? dashboardProjects.find(p => p.id === exportProjectId)?.title : undefined}
    />

    <ImportDialog
      isOpen={importDialogOpen}
      onClose={() => setImportDialogOpen(false)}
      onImportSuccess={handleImportSuccess}
    />

    <Dialog open={toolsOpen} onOpenChange={setToolsOpen}><DialogContent className="tools-dialog"><DialogHeader><DialogTitle>{t("Alat naskah")}</DialogTitle><DialogDescription>{t("Atur tampilan, pilih pembicara, dan ekspor naskah.")}</DialogDescription></DialogHeader><ContextualUtilityPanel {...utilityProps} /></DialogContent></Dialog>
    <WhisperDrawer
      isOpen={modelOpen}
      onClose={() => setModelOpen(false)}
      canTranscribe={canTranscribeActive}
      snapshot={activeSnapshot}
      isBackgroundJob={isBackgroundJob}
      jobRecordingTitle={jobRecordingTitle}
      resumableChunks={resumableChunks}
      onTranscribe={() => { void runActiveTranscription(true); }}
      onResume={() => { void runActiveTranscription(true); }}
      onStartFresh={() => { void runActiveTranscription(false); }}
      onDiscardCheckpoint={() => { void discardActiveCheckpoint(); }}
      onCancel={cancelTranscription}
    />

    <Dialog open={overwriteConfirm !== null} onOpenChange={open => { if (!open) setOverwriteConfirm(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Timpa naskah yang ada?")}</DialogTitle>
          <DialogDescription>{t("Rekaman ini sudah memiliki isi atau suntingan naskah. Menjalankan transkripsi baru akan menggantikan naskah saat ini.")}</DialogDescription>
        </DialogHeader>
        <div className="transcription-actions flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOverwriteConfirm(null)}>{t("Batalkan")}</Button>
          <Button onClick={() => { if (overwriteConfirm) void executeActiveTranscription(overwriteConfirm.resume); }}>{t("Timpa dan transkripsikan")}</Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={infoPage !== null} onOpenChange={open => { if (!open) setInfoPage(null); }}><DialogContent><DialogHeader><DialogTitle>{infoPage === 'about' ? t("Setiap cerita layak dicatat.") : infoPage === 'pricing' ? t("Harga & lisensi") : t("Pertanyaan tentang Catetin")}</DialogTitle><DialogDescription>{infoPage === 'about' ? t("Catetin adalah ruang kerja untuk mentranskripsikan, menyunting, dan menyiapkan naskah percakapan.") : infoPage === 'pricing' ? t("Editor ini dapat dicoba tanpa akun atau pembayaran.") : t("Yang perlu diketahui sebelum mulai.")}</DialogDescription></DialogHeader>{infoPage === 'about' ? <div className="about-copy"><p>{t("Catetin membantu mengubah rekaman menjadi naskah tanpa mengirim audio ke layanan transkripsi. Whisper berjalan langsung di perangkat Anda.")}</p><p>{t("Draf disimpan di browser dan dapat diekspor sebagai TXT, SRT, atau dokumen kompatibel Word.")}</p><Button onClick={() => { setInfoPage(null); openStudio(); }}>{t("Coba Studio")} <ArrowRight aria-hidden="true" /></Button></div> : infoPage === 'pricing' ? <div className="about-copy"><p>{t("Paket berbayar dan pembelian lisensi belum tersedia. Editor saat ini dapat digunakan tanpa biaya.")}</p><Button onClick={() => { setInfoPage(null); openStudio(); }}>{t("Buka Studio")} <ArrowRight aria-hidden="true" /></Button></div> : <Accordion type="single" collapsible>{questions.map(([question, answer], index) => <AccordionItem key={t(question)} value={String(index)}><AccordionTrigger>{t(question)}</AccordionTrigger><AccordionContent>{t(answer)}</AccordionContent></AccordionItem>)}</Accordion>}</DialogContent></Dialog>

    <audio ref={audioRef} src={audioSrc} preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) setAvailableRecordings(previous => previous.map(item => item.id === effectiveId ? { ...item, durationSec: duration } : item)); setAudioLoading(false); }} onCanPlay={() => setAudioLoading(false)} onTimeUpdate={event => { if (audioSrc) setCurrentTime(event.currentTarget.currentTime); }} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onError={() => { if (audioSrc) { setAudioLoading(false); setIsPlaying(false); setAudioError(t("Format rekaman ini tidak dapat dibaca oleh peramban.")); } }} />
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{toast && <div className="app-toast"><Check className="size-4" aria-hidden="true" /><p>{t(toast)}</p><button onClick={() => setToast('')} aria-label={t("Tutup pemberitahuan")}><X className="size-4" aria-hidden="true" /></button></div>}</div>
  </div>;
}
