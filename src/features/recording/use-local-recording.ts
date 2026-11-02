import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingEngine } from './recording-engine';
import { RecordingStore } from './recording-store';
import { checkRecordingCapabilities } from './recording-capabilities';
import { finalizeRecordingSession, type FinalizeRecordingResult } from './recording-finalizer';
import type {
  BrowserCapabilities,
  RecordingEngineState,
  RecordingError,
  RecordingSession,
} from './recording-types';
import type { DialogSegment } from '../../lib/transcript';
import type { RecordingRecord } from '../workspace/workspace-store';
import { t, useLanguage } from '@/lib/i18n';
import { getRecordingErrorMessage } from './recording-error-messages';

export function getDefaultRecordingTitle(d = new Date(), lang: 'id' | 'en' = 'id'): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const monthsId = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = lang === 'en' ? monthsEn : monthsId;
  const prefix = lang === 'en' ? 'Meeting Recording' : 'Rekaman Pertemuan';
  return `${prefix} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function stopStreamSafely(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach(track => {
      try {
        track.onended = null;
        if (track.readyState !== 'ended') {
          track.stop();
        }
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

export interface UseLocalRecordingOptions {
  store?: RecordingStore;
  capabilities?: BrowserCapabilities;
  activeProjectId?: string;
  projects?: Array<{ id: string; title: string }>;
  segmentCoreSeconds?: number;
  segmentOverlapSeconds?: number;
  saveToWorkspaceFn?: (
    recording: RecordingRecord,
    audioBlob: Blob,
    segments: DialogSegment[],
    speakerNames: Record<string, string>
  ) => Promise<void>;
  onSaveSuccess?: (result: FinalizeRecordingResult) => void;
  notify?: (message: string) => void;
  getMediaStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
}

/**
 * Resolves the target project ID synchronously:
 * - When projects exist: uses activeProjectId if valid in projects, otherwise defaults to projects[0].id.
 * - When projects is explicitly empty ([]): uses 'project-default'.
 * - When projects is not provided: uses activeProjectId || 'project-default'.
 */
export function resolveTargetProjectId(
  projects?: Array<{ id: string; title: string }>,
  activeProjectId?: string
): string {
  if (projects && projects.length > 0) {
    if (activeProjectId && projects.some(p => p.id === activeProjectId)) {
      return activeProjectId;
    }
    return projects[0].id;
  }
  if (projects && projects.length === 0) {
    return 'project-default';
  }
  return activeProjectId || 'project-default';
}

export function useLocalRecording(options: UseLocalRecordingOptions = {}) {
  const language = useLanguage();
  const storeRef = useRef<RecordingStore>(options.store ?? new RecordingStore());
  const store = storeRef.current;

  const capabilities = options.capabilities ?? checkRecordingCapabilities();
  const [engineState, setEngineState] = useState<RecordingEngineState>({
    status: 'idle',
    sessionId: null,
    activeDurationMs: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    pendingWrites: 0,
    error: null,
  });

  const [activeDurationMs, setActiveDurationMs] = useState(0);
  const [isConsentOpen, setIsConsentOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isRecordingOpen, setIsRecordingOpen] = useState(false);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  const [discardTarget, setDiscardTarget] = useState<'active' | RecordingSession | null>(null);
  const [discardDialogTitle, setDiscardDialogTitle] = useState('');
  const [discardDialogDescription, setDiscardDialogDescription] = useState('');
  const [discardCancelLabel, setDiscardCancelLabel] = useState('');
  const [discardConfirmLabel, setDiscardConfirmLabel] = useState('');

  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizingPhase, setFinalizingPhase] = useState<string>('');
  const [recordingError, setRecordingError] = useState<RecordingError | null>(null);

  const [recordingTitle, setRecordingTitle] = useState(() => getDefaultRecordingTitle(new Date(), language));
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() =>
    resolveTargetProjectId(options.projects, options.activeProjectId)
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedDeviceName, setSelectedDeviceName] = useState<string>('');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  const [setupStream, setSetupStream] = useState<MediaStream | null>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [recoverableSessions, setRecoverableSessions] = useState<RecordingSession[]>([]);
  const [isRecovering, setIsRecovering] = useState(false);
  const [lastEngineSegmentConfig, setLastEngineSegmentConfig] = useState<{
    segmentCoreSeconds: number;
    segmentOverlapSeconds: number;
  } | null>(null);

  const mountedRef = useRef(true);
  const setupStreamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<RecordingEngine | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Synchronous concurrency guards
  const permissionRequestInFlightRef = useRef(false);
  const startInFlightRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const retryInFlightRef = useRef(false);

  const releaseSetupStream = useCallback(() => {
    if (setupStreamRef.current) {
      stopStreamSafely(setupStreamRef.current);
      setupStreamRef.current = null;
    }
    setSetupStream(prev => {
      if (prev) stopStreamSafely(prev);
      return null;
    });
  }, []);

  // Scan recoverable draft sessions on mount without requesting microphone permission
  const refreshRecoverable = useCallback(async () => {
    try {
      const list = await store.listRecoverableSessions();
      if (mountedRef.current) {
        setRecoverableSessions(list);
      }
    } catch {
      // ignore read error
    }
  }, [store]);

  useEffect(() => {
    void refreshRecoverable();
  }, [refreshRecoverable]);

  // Sync default title on language change when idle
  useEffect(() => {
    if (!isRecordingOpen && !isSetupOpen) {
      setRecordingTitle(getDefaultRecordingTitle(new Date(), language));
    }
  }, [language, isRecordingOpen, isSetupOpen]);

  // Keep selectedProjectId synchronized with available workspace projects when not actively recording
  useEffect(() => {
    if (isRecordingOpen) return;
    if (options.projects && options.projects.length > 0) {
      const isCurrentValid = options.projects.some(p => p.id === selectedProjectId);
      if (!isCurrentValid) {
        setSelectedProjectId(resolveTargetProjectId(options.projects, options.activeProjectId));
      }
    } else if (options.projects && options.projects.length === 0 && selectedProjectId !== 'project-default') {
      setSelectedProjectId('project-default');
    }
  }, [options.projects, options.activeProjectId, isRecordingOpen, selectedProjectId]);

  // Window beforeunload guard to protect active recording
  useEffect(() => {
    const isActivelyRecording = engineState.status === 'recording' || engineState.status === 'paused';
    if (!isActivelyRecording) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [engineState.status]);

  // Non-destructive cleanup on unmount: preserve draft for recovery instead of cancelling
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      if (setupStreamRef.current) {
        stopStreamSafely(setupStreamRef.current);
        setupStreamRef.current = null;
      }
      if (engineRef.current) {
        void engineRef.current.preserveForRecovery();
        engineRef.current = null;
      }
    };
  }, []);

  // 1. User clicks "Rekam pertemuan" on Dashboard
  const openConsent = useCallback(() => {
    setRecordingError(null);
    setRecordingTitle(getDefaultRecordingTitle(new Date(), language));
    setSelectedProjectId(resolveTargetProjectId(options.projects, options.activeProjectId));
    setIsConsentOpen(true);
  }, [language, options.activeProjectId, options.projects]);

  // 2. User confirms consent and proceeds to microphone setup
  const proceedToSetup = useCallback(async () => {
    if (permissionRequestInFlightRef.current || startInFlightRef.current) {
      return;
    }
    permissionRequestInFlightRef.current = true;
    setIsRequestingPermission(true);
    setRecordingError(null);

    let acquiredStream: MediaStream | null = null;

    // Call getUserMedia ONLY after explicit consent action
    try {
      releaseSetupStream();

      const getStreamFn =
        options.getMediaStream ??
        (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
          ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)
          : null);

      if (!getStreamFn) {
        throw new Error('navigator.mediaDevices.getUserMedia tidak tersedia');
      }

      const stream = await getStreamFn({ audio: true, video: false });
      acquiredStream = stream;

      if (!mountedRef.current) {
        stopStreamSafely(acquiredStream);
        acquiredStream = null;
        return;
      }

      // Enumerate available audio input devices before transferring stream ownership
      const enumFn =
        options.enumerateDevices ??
        (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices
          ? () => navigator.mediaDevices.enumerateDevices()
          : null);

      let inputs: MediaDeviceInfo[] = [];
      if (enumFn) {
        const allDevices = await enumFn();
        inputs = allDevices.filter(d => d.kind === 'audioinput');
      }

      if (!mountedRef.current) {
        stopStreamSafely(acquiredStream);
        acquiredStream = null;
        return;
      }

      // Transfer ownership to setup state only after all async setup steps succeed
      setupStreamRef.current = acquiredStream;
      setSetupStream(acquiredStream);
      acquiredStream = null;

      setAudioDevices(inputs);
      if (inputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(inputs[0].deviceId);
        setSelectedDeviceName(inputs[0].label || t('Mikrofon bawaan'));
      }

      setIsConsentOpen(false);
      setIsSetupOpen(true);
    } catch (err: any) {
      if (acquiredStream) {
        stopStreamSafely(acquiredStream);
        acquiredStream = null;
      }
      releaseSetupStream();
      setIsConsentOpen(false);
      setIsSetupOpen(false);

      const code =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'permission-denied'
          : err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError'
            ? 'microphone-not-found'
            : 'microphone-unreadable';

      const errorPayload: RecordingError = {
        code,
        message: getRecordingErrorMessage(code),
        retryable: true,
      };

      setRecordingError(errorPayload);
      options.notify?.(errorPayload.message);
    } finally {
      permissionRequestInFlightRef.current = false;
      if (mountedRef.current) {
        setIsRequestingPermission(false);
      }
    }
  }, [options, releaseSetupStream, selectedDeviceId]);

  const backToConsent = useCallback(() => {
    releaseSetupStream();
    setIsSetupOpen(false);
    setIsConsentOpen(true);
  }, [releaseSetupStream]);

  const handleSetSetupOpen = useCallback(
    (open: boolean) => {
      if (!open) {
        releaseSetupStream();
      }
      setIsSetupOpen(open);
    },
    [releaseSetupStream]
  );

  // 3. User clicks "Mulai merekam" in Setup Dialog
  const startRecording = useCallback(async () => {
    if (startInFlightRef.current || permissionRequestInFlightRef.current) {
      return;
    }
    const existingStatus = engineRef.current?.getState().status;
    if (existingStatus === 'recording' || existingStatus === 'paused' || existingStatus === 'stopping' || existingStatus === 'finalizing') {
      return;
    }

    startInFlightRef.current = true;
    setIsStarting(true);

    // Release preview setup stream before engine takes over
    releaseSetupStream();

    setIsSetupOpen(false);
    setRecordingError(null);
    setIsFinalizing(false);

    const getStreamFn =
      options.getMediaStream ??
      (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
        ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)
        : null);

    // Segment timing overrides are accepted only through explicit UseLocalRecordingOptions dependency injection.
    const segmentCoreSeconds = options.segmentCoreSeconds;
    const segmentOverlapSeconds = options.segmentOverlapSeconds;

    const engine = new RecordingEngine({
      store,
      capabilities,
      segmentCoreSeconds,
      segmentOverlapSeconds,
      saveToWorkspaceFn: options.saveToWorkspaceFn,
      getMediaStream: async () => {
        if (!getStreamFn) {
          throw new Error('navigator.mediaDevices.getUserMedia tidak tersedia');
        }
        const effectiveConstraints: MediaStreamConstraints = {
          audio: selectedDeviceId
            ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                deviceId: { exact: selectedDeviceId },
              }
            : {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
          video: false,
        };
        return getStreamFn(effectiveConstraints);
      },
    });

    engine.setEvents({
      onStateChange: (state) => {
        if (!mountedRef.current) return;
        setEngineState(state);
        setActiveDurationMs(state.activeDurationMs);
        if (state.error) {
          setRecordingError(state.error);
        }
      },
      onError: (err) => {
        if (!mountedRef.current) return;
        setRecordingError(err);
      },
    });

    engineRef.current = engine;
    setLastEngineSegmentConfig(engine.getSegmentConfig());

    const effectiveProjectId =
      options.projects && options.projects.length > 0
        ? options.projects.some(p => p.id === selectedProjectId)
          ? selectedProjectId
          : resolveTargetProjectId(options.projects, options.activeProjectId)
        : options.projects && options.projects.length === 0
          ? 'project-default'
          : selectedProjectId || options.activeProjectId || 'project-default';

    if (effectiveProjectId !== selectedProjectId) {
      setSelectedProjectId(effectiveProjectId);
    }

    try {
      await engine.start({
        targetProjectId: effectiveProjectId,
        title: recordingTitle.trim() || getDefaultRecordingTitle(new Date(), language),
      });

      if (!mountedRef.current) {
        await engine.preserveForRecovery();
        return;
      }

      // Capture active stream from engine for VU feedback
      const activeMediaStream = (engine as any).stream as MediaStream | null;
      setActiveStream(activeMediaStream);

      setIsRecordingOpen(true);

      // Start duration tick timer
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      durationTimerRef.current = setInterval(() => {
        if (engineRef.current && mountedRef.current) {
          setActiveDurationMs(engineRef.current.getActiveDurationMs());
        }
      }, 250);
    } catch {
      const code = engine.getState().error?.code || 'storage-write-failed';
      const errorPayload: RecordingError = {
        code,
        message: getRecordingErrorMessage(code),
        retryable: true,
      };
      if (mountedRef.current) {
        setRecordingError(errorPayload);
      }
      options.notify?.(errorPayload.message);
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current) {
        setIsStarting(false);
      }
    }
  }, [capabilities, language, options, recordingTitle, releaseSetupStream, selectedDeviceId, selectedProjectId, store]);

  const pauseRecording = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.pause();
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.resume();
    }
  }, []);

  // 4. User clicks "Selesai" in Active Recording Dialog
  const stopRecording = useCallback(async () => {
    if (!engineRef.current || stopInFlightRef.current || retryInFlightRef.current) {
      return;
    }

    stopInFlightRef.current = true;
    setIsFinalizing(true);
    setFinalizingPhase(t('Menyelesaikan rekaman'));

    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    try {
      setFinalizingPhase(t('Menyimpan audio'));
      const result = await engineRef.current.stop();

      if (mountedRef.current) {
        setFinalizingPhase(t('Merapikan hasil'));
        setIsRecordingOpen(false);
        setIsFinalizing(false);
        setActiveStream(null);
      }
      engineRef.current = null;

      options.notify?.(t('Rekaman berhasil disimpan ke workspace.'));
      options.onSaveSuccess?.(result);
      void refreshRecoverable();
    } catch (stopErr: any) {
      const isRecoverable =
        stopErr?.retryable === true ||
        stopErr?.code === 'checkpoint-read-failed' ||
        stopErr?.code === 'workspace-save-failed';
      const code = stopErr?.code || 'archive-finalization-failed';
      const errorPayload: RecordingError = {
        code,
        message: getRecordingErrorMessage(code),
        retryable: isRecoverable,
      };
      if (mountedRef.current) {
        setIsFinalizing(false);
        setRecordingError(errorPayload);
      }
      void refreshRecoverable();
    } finally {
      stopInFlightRef.current = false;
    }
  }, [options, refreshRecoverable]);

  // 5. Retry finalization for recoverable session
  const retryFinalization = useCallback(async () => {
    if (!engineRef.current || retryInFlightRef.current || stopInFlightRef.current) {
      return;
    }

    retryInFlightRef.current = true;
    setIsFinalizing(true);
    setFinalizingPhase(t('Menyimpan audio'));
    setRecordingError(null);

    try {
      const result = await engineRef.current.retryFinalization();
      if (mountedRef.current) {
        setIsRecordingOpen(false);
        setIsFinalizing(false);
        setActiveStream(null);
      }
      engineRef.current = null;

      options.notify?.(t('Rekaman berhasil disimpan ke workspace.'));
      options.onSaveSuccess?.(result);
      void refreshRecoverable();
    } catch (retryErr: any) {
      const code = retryErr?.code || 'archive-finalization-failed';
      const errorPayload: RecordingError = {
        code,
        message: getRecordingErrorMessage(code),
        retryable: true,
      };
      if (mountedRef.current) {
        setIsFinalizing(false);
        setRecordingError(errorPayload);
      }
    } finally {
      retryInFlightRef.current = false;
    }
  }, [options, refreshRecoverable]);

  // 6. User clicks cancel on active recording or discard on recovery panel
  const requestCancel = useCallback(() => {
    setDiscardTarget('active');
    setDiscardDialogTitle(t('Batalkan rekaman?'));
    setDiscardDialogDescription(t('Audio yang belum diselesaikan akan dihapus dari draft lokal.'));
    setDiscardCancelLabel(t('Lanjut merekam'));
    setDiscardConfirmLabel(t('Batalkan dan hapus'));
    setIsDiscardOpen(true);
  }, []);

  const requestDiscardDraft = useCallback((session: RecordingSession) => {
    setDiscardTarget(session);
    setDiscardDialogTitle(t('Hapus draft rekaman?'));
    setDiscardDialogDescription(t('Draft rekaman ini akan dihapus permanen dari browser perangkat Anda.'));
    setDiscardCancelLabel(t('Batal'));
    setDiscardConfirmLabel(t('Hapus draft'));
    setIsDiscardOpen(true);
  }, []);

  const confirmDiscard = useCallback(async () => {
    if (discardTarget === 'active') {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      if (engineRef.current) {
        await engineRef.current.cancel();
        engineRef.current = null;
      }
      if (mountedRef.current) {
        setActiveStream(null);
        setIsRecordingOpen(false);
        setIsFinalizing(false);
        setRecordingError(null);
      }
      void refreshRecoverable();
    } else if (discardTarget && typeof discardTarget === 'object') {
      try {
        await store.deleteSessionData(discardTarget.sessionId);
        options.notify?.(t('Draft rekaman berhasil dihapus.'));
        void refreshRecoverable();
      } catch {
        // ignore
      }
    }
    if (mountedRef.current) {
      setDiscardTarget(null);
    }
  }, [discardTarget, options, refreshRecoverable, store]);

  // 7. Recover session from draft panel using centralized transcript-aware finalization
  const recoverDraftSession = useCallback(async (session: RecordingSession) => {
    if (retryInFlightRef.current || stopInFlightRef.current) {
      return;
    }
    retryInFlightRef.current = true;
    setIsRecovering(true);
    try {
      const result = await finalizeRecordingSession(session.sessionId, store, {
        saveToWorkspaceFn: options.saveToWorkspaceFn,
      });
      options.notify?.(t('Rekaman berhasil disimpan ke workspace.'));
      options.onSaveSuccess?.(result);
      void refreshRecoverable();
    } catch (recErr: any) {
      options.notify?.(getRecordingErrorMessage(recErr?.code || 'archive-finalization-failed'));
      void refreshRecoverable();
    } finally {
      retryInFlightRef.current = false;
      if (mountedRef.current) {
        setIsRecovering(false);
      }
    }
  }, [options, refreshRecoverable, store]);

  const closeAfterError = useCallback(() => {
    setIsRecordingOpen(false);
    setRecordingError(null);
    void refreshRecoverable();
  }, [refreshRecoverable]);

  return {
    // Dialog visibility states
    isConsentOpen,
    setConsentOpen: setIsConsentOpen,
    isSetupOpen,
    setSetupOpen: handleSetSetupOpen,
    isRecordingOpen,
    isDiscardOpen,
    setDiscardOpen: setIsDiscardOpen,

    // Discard Dialog props
    discardDialogTitle,
    discardDialogDescription,
    discardCancelLabel,
    discardConfirmLabel,

    // Setup fields
    recordingTitle,
    setRecordingTitle,
    selectedProjectId,
    setSelectedProjectId,
    selectedDeviceId,
    setSelectedDeviceId: (id: string) => {
      setSelectedDeviceId(id);
      const match = audioDevices.find(d => d.deviceId === id);
      if (match) setSelectedDeviceName(match.label || t('Mikrofon bawaan'));
    },
    selectedDeviceName,
    audioDevices,
    setupStream,
    activeStream,

    // Engine & recording state
    engineState,
    lastEngineSegmentConfig,
    getEngineSegmentConfig: () => engineRef.current?.getSegmentConfig() ?? lastEngineSegmentConfig,
    activeDurationMs,
    isRequestingPermission,
    isStarting,
    isFinalizing,
    finalizingPhase,
    recordingError,
    recoverableSessions,
    isRecovering,
    capabilities,

    // Action handlers
    openConsent,
    proceedToSetup,
    backToConsent,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    retryFinalization,
    requestCancel,
    requestDiscardDraft,
    confirmDiscard,
    recoverDraftSession,
    closeAfterError,
    refreshRecoverable,
  };
}
