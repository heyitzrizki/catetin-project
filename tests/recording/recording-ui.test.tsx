import { win } from '../account/dom-setup.ts';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { indexedDB as fakeIDB, IDBKeyRange as fakeIDBKeyRange } from 'fake-indexeddb';

// Ensure indexedDB is bound on both globalThis and happy-dom window
globalThis.indexedDB = fakeIDB;
(win as any).indexedDB = fakeIDB;
globalThis.IDBKeyRange = fakeIDBKeyRange;
(win as any).IDBKeyRange = fakeIDBKeyRange;

let activeRoots: Array<{ root: ReactDOM.Root; el: any }> = [];

function mountTestApp(ui: React.ReactElement) {
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);
  activeRoots.push({ root, el: rootEl });
  act(() => {
    root.render(ui);
  });
  return { root, rootEl };
}

afterEach(async () => {
  for (const item of activeRoots) {
    try {
      await act(async () => {
        item.root.unmount();
      });
      item.el.remove();
    } catch {
      // ignore
    }
  }
  activeRoots = [];
  cleanBody();
  setLanguage('id');
});

import { WorkspaceDashboard } from '../../src/components/dashboard/WorkspaceDashboard';
import { RecordingConsentDialog } from '../../src/components/recording/RecordingConsentDialog';
import { RecordingSetupDialog } from '../../src/components/recording/RecordingSetupDialog';
import { ActiveRecordingDialog } from '../../src/components/recording/ActiveRecordingDialog';
import { DiscardRecordingDialog } from '../../src/components/recording/DiscardRecordingDialog';
import { RecordingRecoveryPanel } from '../../src/components/recording/RecordingRecoveryPanel';
import { AudioLevelMeter } from '../../src/components/recording/AudioLevelMeter';
import { RecordingStore } from '../../src/features/recording/recording-store';
import { checkRecordingCapabilities } from '../../src/features/recording/recording-capabilities';
import { useLocalRecording } from '../../src/features/recording/use-local-recording';
import { t, setLanguage } from '../../src/lib/i18n';
import type { BrowserCapabilities, RecordingSession } from '../../src/features/recording/recording-types';
import type { DialogSegment } from '../../src/lib/transcript';
import type { RecordingRecord } from '../../src/features/workspace/workspace-store';

function cleanBody() {
  win.document.body.innerHTML = '';
}

async function flushAsync(ms = 25) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

// Mock Stream & Track
class MockAudioTrack {
  kind = 'audio';
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  stopped = false;
  onended: (() => void) | null = null;
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
}

class MockMediaStream {
  tracks: MockAudioTrack[];
  constructor(tracks = [new MockAudioTrack()]) {
    this.tracks = tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  static isTypeSupported(mime: string) {
    return mime.includes('webm');
  }

  constructor(public stream: any, options: { mimeType?: string } = {}) {
    this.mimeType = options.mimeType || 'audio/webm;codecs=opus';
    MockMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number) {
    this.state = 'recording';
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      if (this.onstop) this.onstop();
    });
  }

  requestData() {
    queueMicrotask(() => {
      if (this.ondataavailable) {
        this.ondataavailable({
          data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
          timeStamp: Date.now(),
        });
      }
    });
  }
}

(globalThis as any).MediaRecorder = MockMediaRecorder;

const supportedCapabilities: BrowserCapabilities = {
  supported: true,
  isSecureContext: true,
  hasMediaDevices: true,
  hasMediaRecorder: true,
  selectedMimeType: 'audio/webm;codecs=opus',
  reason: null,
};

const unsupportedCapabilities: BrowserCapabilities = {
  supported: false,
  isSecureContext: true,
  hasMediaDevices: true,
  hasMediaRecorder: false,
  selectedMimeType: null,
  reason: 'Perekaman lokal belum didukung di peramban ini pada tahap awal.',
};

beforeEach(() => {
  MockMediaRecorder.instances = [];
  cleanBody();
  setLanguage('id');
});

// Helper component that mounts the hook and all dialogs
function TestRecordingApp({
  store,
  capabilities = supportedCapabilities,
  getMediaStream,
  enumerateDevices,
  saveToWorkspaceFn,
  onSaveSuccess,
  notify,
  hasProjects = true,
  onExposeRecording,
}: {
  store: RecordingStore;
  capabilities?: BrowserCapabilities;
  getMediaStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  saveToWorkspaceFn?: (
    recording: RecordingRecord,
    audioBlob: Blob,
    segments: DialogSegment[],
    speakerNames: Record<string, string>
  ) => Promise<void>;
  onSaveSuccess?: () => void;
  notify?: (msg: string) => void;
  hasProjects?: boolean;
  onExposeRecording?: (rec: ReturnType<typeof useLocalRecording>) => void;
}) {
  const recording = useLocalRecording({
    store,
    capabilities,
    getMediaStream,
    enumerateDevices,
    saveToWorkspaceFn,
    onSaveSuccess,
    notify,
  });

  if (onExposeRecording) {
    onExposeRecording(recording);
  }

  const projectsList = hasProjects
    ? [{ id: 'proj-1', title: 'Rapat Proyek', folderId: null, tags: [], createdAt: 0, updatedAt: 0, recordingCount: 0, totalDurationSec: 0 }]
    : [];

  return (
    <div>
      <WorkspaceDashboard
        projects={projectsList}
        folders={[]}
        allRecordings={[]}
        recentRecordings={[]}
        stats={{ projectCount: projectsList.length, recordingCount: 0, totalDurationSec: 0, lastUpdatedAt: null }}
        allWorkspaceTags={[]}
        onOpenProject={() => {}}
        onOpenRecording={() => {}}
        onCreateProjectClick={() => {}}
        onOpenRecordingClick={() => {}}
        onTryDemo={() => {}}
        onCreateFolderClick={() => {}}
        onRenameFolderClick={() => {}}
        onDeleteFolderClick={() => {}}
        onManageTagsClick={() => {}}
        onMoveFolderClick={() => {}}
        onStartRecordingClick={recording.openConsent}
        recoverableSessions={recording.recoverableSessions}
        onRecoverSession={recording.recoverDraftSession}
        onDiscardSession={recording.requestDiscardDraft}
        isRecoveringSession={recording.isRecovering}
      />

      <RecordingConsentDialog
        open={recording.isConsentOpen}
        capabilities={recording.capabilities}
        isRequestingPermission={recording.isRequestingPermission}
        onOpenChange={recording.setConsentOpen}
        onProceed={recording.proceedToSetup}
      />

      <RecordingSetupDialog
        open={recording.isSetupOpen}
        projects={projectsList}
        selectedProjectId={recording.selectedProjectId}
        onSelectProjectId={recording.setSelectedProjectId}
        title={recording.recordingTitle}
        onChangeTitle={recording.setRecordingTitle}
        devices={recording.audioDevices}
        selectedDeviceId={recording.selectedDeviceId}
        onSelectDeviceId={recording.setSelectedDeviceId}
        stream={recording.setupStream}
        isStarting={recording.isStarting}
        onBack={recording.backToConsent}
        onStart={recording.startRecording}
      />

      <ActiveRecordingDialog
        open={recording.isRecordingOpen}
        engineState={recording.engineState}
        title={recording.recordingTitle}
        selectedDeviceName={recording.selectedDeviceName}
        activeDurationMs={recording.activeDurationMs}
        stream={recording.activeStream}
        isFinalizing={recording.isFinalizing}
        finalizingPhase={recording.finalizingPhase}
        error={recording.recordingError}
        onPause={recording.pauseRecording}
        onResume={recording.resumeRecording}
        onStop={recording.stopRecording}
        onRetryFinalize={recording.retryFinalization}
        onRequestCancel={recording.requestCancel}
        onCloseAfterError={recording.closeAfterError}
      />

      <DiscardRecordingDialog
        open={recording.isDiscardOpen}
        onOpenChange={recording.setDiscardOpen}
        title={recording.discardDialogTitle}
        description={recording.discardDialogDescription}
        cancelLabel={recording.discardCancelLabel}
        confirmLabel={recording.discardConfirmLabel}
        onConfirm={recording.confirmDiscard}
      />
    </div>
  );
}

test('1. Dashboard menampilkan tepat satu tombol "Rekam pertemuan" pada setiap state (IMPORTANT 2)', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-1-${Date.now()}`);
  let clicked = false;

  // Empty workspace state (!hasProjects)
  const { root } = mountTestApp(
    <WorkspaceDashboard
      projects={[]}
      folders={[]}
      allRecordings={[]}
      recentRecordings={[]}
      stats={{ projectCount: 0, recordingCount: 0, totalDurationSec: 0, lastUpdatedAt: null }}
      allWorkspaceTags={[]}
      onOpenProject={() => {}}
      onOpenRecording={() => {}}
      onCreateProjectClick={() => {}}
      onOpenRecordingClick={() => {}}
      onTryDemo={() => {}}
      onCreateFolderClick={() => {}}
      onRenameFolderClick={() => {}}
      onDeleteFolderClick={() => {}}
      onManageTagsClick={() => {}}
      onMoveFolderClick={() => {}}
      onStartRecordingClick={() => { clicked = true; }}
    />
  );
  await flushAsync();

  const emptyStateRecordBtns = Array.from(win.document.querySelectorAll('button')).filter(
    b => b.textContent?.includes('Rekam pertemuan')
  );
  assert.equal(emptyStateRecordBtns.length, 1, 'Empty workspace harus hanya memiliki tepat 1 tombol Rekam pertemuan');
  assert.ok(emptyStateRecordBtns[0].textContent?.includes('Lokal di perangkat'));

  await act(async () => {
    emptyStateRecordBtns[0].click();
  });
  assert.equal(clicked, true);

  // Populated workspace state (hasProjects)
  await act(async () => {
    root.render(
      <WorkspaceDashboard
        projects={[{ id: 'p1', title: 'Proyek Utama', folderId: null, tags: [], createdAt: 0, updatedAt: 0, recordingCount: 1, totalDurationSec: 60 }]}
        folders={[]}
        allRecordings={[]}
        recentRecordings={[]}
        stats={{ projectCount: 1, recordingCount: 1, totalDurationSec: 60, lastUpdatedAt: null }}
        allWorkspaceTags={[]}
        onOpenProject={() => {}}
        onOpenRecording={() => {}}
        onCreateProjectClick={() => {}}
        onOpenRecordingClick={() => {}}
        onTryDemo={() => {}}
        onCreateFolderClick={() => {}}
        onRenameFolderClick={() => {}}
        onDeleteFolderClick={() => {}}
        onManageTagsClick={() => {}}
        onMoveFolderClick={() => {}}
        onStartRecordingClick={() => {}}
      />
    );
  });
  await flushAsync();

  const populatedRecordBtns = Array.from(win.document.querySelectorAll('button')).filter(
    b => b.textContent?.includes('Rekam pertemuan')
  );
  assert.equal(populatedRecordBtns.length, 1, 'Populated workspace harus hanya memiliki tepat 1 tombol Rekam pertemuan');

  store.close();
});

test('2. Membuka disclosure tidak meminta microphone permission', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-2-${Date.now()}`);
  let getUserMediaCalls = 0;
  const mockGetMediaStream = async () => {
    getUserMediaCalls++;
    return new MockMediaStream() as any;
  };

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={mockGetMediaStream}
    />
  );
  await flushAsync();

  const recordBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Rekam pertemuan')
  );
  assert.ok(recordBtn);

  await act(async () => {
    recordBtn.click();
  });
  await flushAsync();

  assert.ok(win.document.body.textContent?.includes('Rekam pertemuan di perangkat ini'));
  assert.equal(getUserMediaCalls, 0, 'getUserMedia tidak boleh dipanggil saat dialog consent baru dibuka');

  store.close();
});

test('3. Permission baru diminta setelah checkbox & action eksplisit, dan consent direset saat ditutup/diulangi (IMPORTANT 5)', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-3-${Date.now()}`);
  let getUserMediaCalls = 0;
  const mockGetMediaStream = async () => {
    getUserMediaCalls++;
    return new MockMediaStream() as any;
  };

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={mockGetMediaStream}
    />
  );
  await flushAsync();

  // Open consent dialog
  const recordBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Rekam pertemuan')
  )!;
  await act(async () => {
    recordBtn.click();
  });
  await flushAsync();

  const proceedBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Lanjut pilih mikrofon')
  ) as HTMLButtonElement | undefined;
  assert.ok(proceedBtn);
  assert.equal(proceedBtn.disabled, true, 'Tombol lanjut harus disabled sebelum checkbox dicentang');

  // Check consent checkbox
  const checkbox = win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement;
  assert.ok(checkbox);
  await act(async () => {
    checkbox.click();
  });
  await flushAsync();
  assert.equal(checkbox.checked, true);

  // Close dialog via "Batal"
  const cancelBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.trim() === 'Batal'
  )!;
  await act(async () => {
    cancelBtn.click();
  });
  await flushAsync();

  // Reopen consent dialog: checkbox MUST be reset to false!
  await act(async () => {
    recordBtn.click();
  });
  await flushAsync();

  const reopenedCheckbox = win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement;
  const reopenedProceedBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Lanjut pilih mikrofon')
  ) as unknown as HTMLButtonElement;
  assert.equal(reopenedCheckbox.checked, false, 'Checkbox consent harus reset ketika disclosure dibuka kembali');
  assert.equal(reopenedProceedBtn.disabled, true);
  assert.equal(getUserMediaCalls, 0);

  // Check again and proceed
  await act(async () => {
    reopenedCheckbox.click();
  });
  await flushAsync();

  await act(async () => {
    reopenedProceedBtn.click();
  });
  await flushAsync();

  assert.equal(getUserMediaCalls, 1, 'getUserMedia dipanggil tepat satu kali setelah aksi eksplisit');

  // Click Kembali from Setup Dialog to Consent Dialog: checkbox must also reset
  const backBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.trim() === 'Kembali'
  )!;
  await act(async () => {
    backBtn.click();
  });
  await flushAsync();

  const afterBackCheckbox = win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement;
  assert.equal(afterBackCheckbox.checked, false, 'Checkbox harus reset ketika kembali dari Setup');

  store.close();
});

test('4. Permission denied menampilkan recovery instruction', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-4-${Date.now()}`);
  let notified = '';
  const mockGetMediaStream = async () => {
    const err = new Error('Permission denied by user');
    err.name = 'NotAllowedError';
    throw err;
  };

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={mockGetMediaStream}
      notify={msg => { notified = msg; }}
    />
  );
  await flushAsync();

  const recordBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Rekam pertemuan')
  )!;
  await act(async () => {
    recordBtn.click();
  });
  await flushAsync();

  const checkbox = win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement;
  await act(async () => {
    checkbox.click();
  });
  await flushAsync();

  const proceedBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Lanjut pilih mikrofon')
  )!;
  await act(async () => {
    proceedBtn.click();
  });
  await flushAsync();

  assert.match(notified, /Akses mikrofon belum diberikan/);

  store.close();
});

test('5. Honest Chromium gating: Chromium desktop supported, Firefox/Safari/mobile unsupported dan tidak memanggil getUserMedia (IMPORTANT 1)', { timeout: 10000 }, async () => {
  // 1. Chromium desktop via userAgentData
  const chromeCap = checkRecordingCapabilities({
    isSecureContext: true,
    hasMediaDevices: true,
    hasMediaRecorder: true,
    isTypeSupported: m => m.includes('webm'),
    userAgentData: {
      mobile: false,
      brands: [
        { brand: 'Chromium', version: '130' },
        { brand: 'Google Chrome', version: '130' },
      ],
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  assert.equal(chromeCap.supported, true);

  // 2. Edge desktop via userAgentData
  const edgeCap = checkRecordingCapabilities({
    isSecureContext: true,
    hasMediaDevices: true,
    hasMediaRecorder: true,
    isTypeSupported: m => m.includes('webm'),
    userAgentData: {
      mobile: false,
      brands: [
        { brand: 'Chromium', version: '130' },
        { brand: 'Microsoft Edge', version: '130' },
      ],
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  });
  assert.equal(edgeCap.supported, true);

  // 3. Firefox desktop (even if WebM is supported by MediaRecorder) MUST be gated as unsupported
  const firefoxCap = checkRecordingCapabilities({
    isSecureContext: true,
    hasMediaDevices: true,
    hasMediaRecorder: true,
    isTypeSupported: m => m.includes('webm'),
    userAgentData: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  });
  assert.equal(firefoxCap.supported, false);
  assert.match(firefoxCap.reason || '', /belum didukung di peramban ini pada tahap awal/);

  // 4. Safari macOS MUST be gated as unsupported
  const safariCap = checkRecordingCapabilities({
    isSecureContext: true,
    hasMediaDevices: true,
    hasMediaRecorder: true,
    isTypeSupported: () => true,
    userAgentData: null,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    vendor: 'Apple Computer, Inc.',
  });
  assert.equal(safariCap.supported, false);

  // 5. Mobile Chromium MUST be gated as unsupported
  const mobileChromeCap = checkRecordingCapabilities({
    isSecureContext: true,
    hasMediaDevices: true,
    hasMediaRecorder: true,
    isTypeSupported: m => m.includes('webm'),
    userAgentData: {
      mobile: true,
      brands: [{ brand: 'Chromium', version: '130' }],
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  });
  assert.equal(mobileChromeCap.supported, false);

  // 6. UI blocks getUserMedia on unsupported browser
  const store = new RecordingStore(`test-ui-5-${Date.now()}`);
  let getUserMediaCalls = 0;

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={firefoxCap}
      getMediaStream={async () => {
        getUserMediaCalls++;
        return new MockMediaStream() as any;
      }}
    />
  );
  await flushAsync();

  const recordBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Rekam pertemuan')
  )!;
  await act(async () => {
    recordBtn.click();
  });
  await flushAsync();

  assert.ok(win.document.body.textContent?.includes('Peramban belum didukung'));
  assert.ok(win.document.body.textContent?.includes('Perekaman lokal belum didukung di peramban ini pada tahap awal.'));

  const checkbox = win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement;
  assert.equal(checkbox.disabled, true);
  assert.equal(getUserMediaCalls, 0);

  store.close();
});

test('6. Start menampilkan active recording state & Setup menampilkan copy storage jujur (IMPORTANT 6)', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-6-${Date.now()}`);
  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={async () => new MockMediaStream() as any}
    />
  );
  await flushAsync();

  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Rekam pertemuan'))!).click();
  });
  await flushAsync();

  await act(async () => {
    (win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement).click();
  });
  await flushAsync();

  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Lanjut pilih mikrofon'))!).click();
  });
  await flushAsync();

  assert.ok(win.document.body.textContent?.includes('Atur rekaman pertemuan'));
  // IMPORTANT 6: Honest non-persistent storage copy
  assert.ok(
    win.document.body.textContent?.includes(
      'Penyimpanan persisten belum aktif. Browser dapat membersihkan data lokal saat ruang perangkat terbatas. Selesaikan dan ekspor rekaman penting sebagai cadangan.'
    ),
    'Harus menampilkan copy non-persistent storage yang jujur'
  );
  assert.ok(
    !win.document.body.textContent?.includes('Rekaman tetap aman di browser perangkat ini.'),
    'Tidak boleh menampilkan klaim "Rekaman tetap aman" saat storage belum persisten'
  );

  const startBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Mulai merekam')
  )!;
  await act(async () => {
    startBtn.click();
  });
  await flushAsync();

  assert.ok(win.document.body.textContent?.includes('Sedang merekam'));
  assert.ok(win.document.body.textContent?.includes('Durasi rekaman aktif'));

  store.close();
});

test('7. Pause/resume memanggil engine tepat satu kali', { timeout: 10000 }, async () => {
  let pauseCalls = 0;
  let resumeCalls = 0;

  const { root } = mountTestApp(
    <ActiveRecordingDialog
      open={true}
      engineState={{
        status: 'recording',
        sessionId: 's-1',
        activeDurationMs: 15000,
        archiveTotalBytes: 1000,
        segmentCount: 1,
        pendingWrites: 0,
        error: null,
      }}
      title="Rapat Evaluasi"
      activeDurationMs={15000}
      stream={new MockMediaStream() as any}
      isFinalizing={false}
      error={null}
      onPause={() => { pauseCalls++; }}
      onResume={() => { resumeCalls++; }}
      onStop={() => {}}
      onRetryFinalize={() => {}}
      onRequestCancel={() => {}}
    />
  );
  await flushAsync();

  const pauseBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Jeda')
  );
  assert.ok(pauseBtn);

  await act(async () => {
    pauseBtn.click();
  });
  assert.equal(pauseCalls, 1);
  assert.equal(resumeCalls, 0);

  await act(async () => {
    root.render(
      <ActiveRecordingDialog
        open={true}
        engineState={{
          status: 'paused',
          sessionId: 's-1',
          activeDurationMs: 15000,
          archiveTotalBytes: 1000,
          segmentCount: 1,
          pendingWrites: 0,
          error: null,
        }}
        title="Rapat Evaluasi"
        activeDurationMs={15000}
        stream={new MockMediaStream() as any}
        isFinalizing={false}
        error={null}
        onPause={() => { pauseCalls++; }}
        onResume={() => { resumeCalls++; }}
        onStop={() => {}}
        onRetryFinalize={() => {}}
        onRequestCancel={() => {}}
      />
    );
  });
  await flushAsync();

  const resumeBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Lanjutkan')
  );
  assert.ok(resumeBtn);

  await act(async () => {
    resumeBtn.click();
  });
  assert.equal(resumeCalls, 1);
});

test('8. Stop mencegah double-submit dan menunggu finalization', { timeout: 10000 }, async () => {
  let stopCalls = 0;
  mountTestApp(
    <ActiveRecordingDialog
      open={true}
      engineState={{
        status: 'finalizing',
        sessionId: 's-1',
        activeDurationMs: 30000,
        archiveTotalBytes: 5000,
        segmentCount: 1,
        pendingWrites: 0,
        error: null,
      }}
      title="Rapat Selesai"
      activeDurationMs={30000}
      stream={null}
      isFinalizing={true}
      finalizingPhase="Menyimpan audio"
      error={null}
      onPause={() => {}}
      onResume={() => {}}
      onStop={() => { stopCalls++; }}
      onRetryFinalize={() => {}}
      onRequestCancel={() => {}}
    />
  );
  await flushAsync();

  const stopBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Selesai')
  );
  assert.equal(stopBtn, undefined, 'Tombol Selesai harus hilang saat sedang finalisasi');
  assert.ok(win.document.body.textContent?.includes('Menyimpan audio'));
  assert.equal(stopCalls, 0);
});

test('9. Backdrop/Escape tidak membuang active recording dan Escape memicu confirmation callback (IMPORTANT 7)', { timeout: 10000 }, async () => {
  let cancelRequested = 0;
  mountTestApp(
    <ActiveRecordingDialog
      open={true}
      engineState={{
        status: 'recording',
        sessionId: 's-1',
        activeDurationMs: 10000,
        archiveTotalBytes: 1000,
        segmentCount: 1,
        pendingWrites: 0,
        error: null,
      }}
      title="Rapat Penting"
      activeDurationMs={10000}
      stream={new MockMediaStream() as any}
      isFinalizing={false}
      error={null}
      onPause={() => {}}
      onResume={() => {}}
      onStop={() => {}}
      onRetryFinalize={() => {}}
      onRequestCancel={() => { cancelRequested += 1; }}
    />
  );
  await flushAsync();

  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => {
    win.document.dispatchEvent(event as any);
  });
  await flushAsync();

  assert.equal(cancelRequested, 1, 'Escape harus memicu safety callback onRequestCancel tepat 1 kali');
  assert.ok(win.document.body.textContent?.includes('Rapat Penting'), 'Dialog rekaman aktif harus tetap terbuka');
});

test('10. Cancel membutuhkan confirmation dengan fokus aman', { timeout: 10000 }, async () => {
  let confirmed = false;
  mountTestApp(
    <DiscardRecordingDialog
      open={true}
      onOpenChange={() => {}}
      title="Batalkan rekaman?"
      description="Audio yang belum diselesaikan akan dihapus dari draft lokal."
      cancelLabel="Lanjut merekam"
      confirmLabel="Batalkan dan hapus"
      onConfirm={() => { confirmed = true; }}
    />
  );
  await flushAsync();

  assert.ok(win.document.body.textContent?.includes('Batalkan rekaman?'));
  assert.ok(win.document.body.textContent?.includes('Audio yang belum diselesaikan akan dihapus'));

  const keepBtn = win.document.querySelector('#discard-dialog-cancel-btn') as HTMLButtonElement | null;
  assert.ok(keepBtn, 'Tombol lanjut merekam harus ada dan memiliki focus default');

  const deleteBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Batalkan dan hapus')
  );
  assert.ok(deleteBtn);

  await act(async () => {
    deleteBtn.click();
  });
  assert.equal(confirmed, true);
});

test('11. Recoverable error mempertahankan draft dan menampilkan retry', { timeout: 10000 }, async () => {
  let retryCalls = 0;
  mountTestApp(
    <ActiveRecordingDialog
      open={true}
      engineState={{
        status: 'recoverable',
        sessionId: 's-rec-1',
        activeDurationMs: 45000,
        archiveTotalBytes: 2000,
        segmentCount: 1,
        pendingWrites: 0,
        error: {
          code: 'checkpoint-read-failed',
          message: 'Catetin belum dapat membaca hasil sementara.',
          retryable: true,
        },
      }}
      title="Rapat Pemulihan"
      activeDurationMs={45000}
      stream={null}
      isFinalizing={false}
      error={{
        code: 'checkpoint-read-failed',
        message: 'Catetin belum dapat membaca hasil sementara.',
        retryable: true,
      }}
      onPause={() => {}}
      onResume={() => {}}
      onStop={() => {}}
      onRetryFinalize={() => { retryCalls++; }}
      onRequestCancel={() => {}}
      onCloseAfterError={() => {}}
    />
  );
  await flushAsync();

  assert.ok(win.document.body.textContent?.includes('Catetin belum dapat membaca hasil sementara'));
  assert.ok(win.document.body.textContent?.includes('Audio rekaman dan draft Anda tetap aman'));

  const retryBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Coba simpan lagi')
  );
  assert.ok(retryBtn);

  await act(async () => {
    retryBtn.click();
  });
  assert.equal(retryCalls, 1);
});

test('12. retryFinalization terhubung ke hook/engine dan tidak memulai recording baru (IMPORTANT 7)', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-12-${Date.now()}`);
  let getUserMediaCalls = 0;
  let saveAttempts = 0;
  let savedRecords: Array<{ recording: RecordingRecord; segments: DialogSegment[] }> = [];

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={async () => {
        getUserMediaCalls++;
        return new MockMediaStream() as any;
      }}
      saveToWorkspaceFn={async (recording, _blob, segments) => {
        saveAttempts++;
        if (saveAttempts === 1) {
          throw new Error('Disk sementara sibuk');
        }
        savedRecords.push({ recording, segments });
      }}
    />
  );
  await flushAsync();

  // 1. Start recording through full flow
  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Rekam pertemuan'))!).click();
  });
  await flushAsync();
  await act(async () => {
    (win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement).click();
  });
  await flushAsync();
  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Lanjut pilih mikrofon'))!).click();
  });
  await flushAsync();
  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Mulai merekam'))!).click();
  });
  await flushAsync();

  // 2 occurrences of getUserMedia: 1 for Setup preview, 1 for Engine start
  assert.equal(getUserMediaCalls, 2);

  // 2. Click "Selesai" -> first save attempt fails -> enters recoverable state
  const stopBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Selesai')
  )!;
  await act(async () => {
    stopBtn.click();
  });
  await flushAsync(40);

  assert.equal(saveAttempts, 1);
  assert.equal(savedRecords.length, 0);
  assert.ok(win.document.body.textContent?.includes('Coba simpan lagi'), 'Tombol Coba simpan lagi harus muncul saat save gagal');

  // 3. Click "Coba simpan lagi" -> calls engine.retryFinalization() WITHOUT calling getUserMedia or creating a new session
  const retryBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Coba simpan lagi')
  )!;
  await act(async () => {
    retryBtn.click();
  });
  await flushAsync(40);

  assert.equal(saveAttempts, 2, 'Workspace save harus dicoba kembali');
  assert.equal(savedRecords.length, 1, 'Rekaman berhasil disimpan pada retry');
  assert.equal(getUserMediaCalls, 2, 'retryFinalization TIDAK boleh memanggil getUserMedia lagi');

  const remainingSessions = await store.listRecoverableSessions();
  assert.equal(remainingSessions.length, 0, 'Draft dibersihkan setelah retry berhasil');

  store.close();
});

test('13. Recovery panel muncul dari store scan (termasuk failed & recoverable) tanpa meminta permission (IMPORTANT 3 & IMPORTANT 7)', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-13-${Date.now()}`);
  let getUserMediaCalls = 0;

  // Populate store with 1 recoverable session (with audio) and 1 failed session (without audio)
  await store.saveSession({
    sessionId: 'rec-recoverable-1',
    targetProjectId: 'proj-1',
    title: 'Rapat Kemarin Sore',
    status: 'recoverable',
    startedAt: Date.now() - 3600000,
    lastUpdatedAt: Date.now() - 3600000,
    activeDurationMs: 125000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 2,
    archiveTotalBytes: 50000,
    segmentCount: 1,
    errorCode: 'checkpoint-read-failed',
    errorMessage: null,
  });

  await store.saveSession({
    sessionId: 'rec-failed-empty',
    targetProjectId: 'proj-1',
    title: 'Rapat Gagal Awal',
    status: 'failed',
    startedAt: Date.now() - 1800000,
    lastUpdatedAt: Date.now() - 1800000,
    activeDurationMs: 0,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: 'device-ended',
    errorMessage: null,
  });

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={async () => {
        getUserMediaCalls++;
        return new MockMediaStream() as any;
      }}
    />
  );
  await flushAsync(40);

  assert.equal(getUserMediaCalls, 0, 'Store recovery scan saat mount tidak boleh meminta izin mikrofon');
  assert.ok(win.document.body.textContent?.includes('Rekaman lokal belum selesai'));
  assert.ok(win.document.body.textContent?.includes('Rapat Kemarin Sore'));
  assert.ok(win.document.body.textContent?.includes('Rapat Gagal Awal'));
  assert.ok(win.document.body.textContent?.includes('Belum ada bagian audio yang tersimpan pada draft ini.'));

  // Only the session with saved audio should have "Pulihkan rekaman" button (1 button total)
  const recoverBtns = Array.from(win.document.querySelectorAll('button')).filter(
    b => b.textContent?.includes('Pulihkan rekaman')
  );
  assert.equal(recoverBtns.length, 1, 'Hanya sesi dengan data audio tersimpan yang menampilkan tombol Pulihkan rekaman');

  // Both sessions have "Hapus draft" button (2 buttons total)
  const discardBtns = Array.from(win.document.querySelectorAll('button')).filter(
    b => b.textContent?.includes('Hapus draft')
  );
  assert.equal(discardBtns.length, 2);

  store.close();
});

test('14. Recovery finalization memuat archive + durable transcript checkpoints secara utuh ke workspace (CRITICAL 4)', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-14-${Date.now()}`);
  const sessionId = 'rec-with-transcript';

  await store.saveSession({
    sessionId,
    targetProjectId: 'proj-1',
    title: 'Rapat Strategi Produk',
    status: 'recoverable',
    startedAt: Date.now() - 60000,
    lastUpdatedAt: Date.now() - 10000,
    activeDurationMs: 65000,
    mimeType: 'audio/webm;codecs=opus',
    archiveChunkCount: 0,
    archiveTotalBytes: 0,
    segmentCount: 0,
    errorCode: null,
    errorMessage: null,
  });

  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: new Blob([new Uint8Array([10, 20, 30, 40])], { type: 'audio/webm;codecs=opus' }),
    sizeBytes: 4,
    timestampMs: 1000,
    activeDurationMs: 65000,
    createdAt: Date.now(),
  });

  const durableDialogs: DialogSegment[] = [
    { id: 1, speaker: 'Pembicara 1', text: 'Keputusan kuartal empat disetujui.', seconds: 5, time: '00:05' },
    { id: 2, speaker: 'Pembicara 2', text: 'Siap dilanjutkan minggu depan.', seconds: 18, time: '00:18' },
  ];

  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 0,
    blob: new Blob([new Uint8Array([99, 98])]),
    sizeBytes: 2,
    durationSec: 60,
    plannedStartSec: 0,
    plannedEndSec: 65,
    overlapStartSec: 0,
    overlapEndSec: 5,
    transcribed: true,
    transcriptDialogs: durableDialogs,
    createdAt: Date.now(),
  });

  const savedToWorkspace: Array<{
    recording: RecordingRecord;
    audioBlob: Blob;
    segments: DialogSegment[];
  }> = [];

  let shouldFailSave = true;

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      saveToWorkspaceFn={async (recording, audioBlob, segments) => {
        if (shouldFailSave) {
          throw new Error('Simulasi gagal simpan workspace');
        }
        savedToWorkspace.push({ recording, audioBlob, segments });
      }}
    />
  );
  await flushAsync(40);

  const recoverBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Pulihkan rekaman')
  )!;
  assert.ok(recoverBtn);

  // 1. First recovery attempt fails workspace save -> draft and checkpoints MUST remain intact
  await act(async () => {
    recoverBtn.click();
  });
  await flushAsync(40);

  assert.equal(savedToWorkspace.length, 0);
  const chunksAfterFail = await store.getOrderedArchiveChunks(sessionId);
  const segsAfterFail = await store.getTranscriptionSegments(sessionId);
  assert.equal(chunksAfterFail.length, 1, 'Archive chunks harus tetap utuh saat recovery gagal');
  assert.equal(segsAfterFail.length, 1, 'Transcript checkpoints harus tetap utuh saat recovery gagal');

  // 2. Second recovery attempt succeeds -> workspace receives BOTH audio AND reconstructed transcript
  shouldFailSave = false;
  const recoverBtnRetry = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Pulihkan rekaman')
  )!;
  await act(async () => {
    recoverBtnRetry.click();
  });
  await flushAsync(40);

  assert.equal(savedToWorkspace.length, 1, 'Workspace menerima hasil pemulihan');
  assert.equal(savedToWorkspace[0].recording.title, 'Rapat Strategi Produk');
  assert.equal(savedToWorkspace[0].audioBlob.size, 4);
  assert.equal(savedToWorkspace[0].segments.length, 2, 'Transkrip dari durable checkpoints tidak boleh hilang saat recovery');
  assert.equal(savedToWorkspace[0].segments[0].text, 'Keputusan kuartal empat disetujui.');
  assert.equal(savedToWorkspace[0].segments[1].text, 'Siap dilanjutkan minggu depan.');

  // 3. Draft is cleaned up after successful workspace save
  const chunksAfterSuccess = await store.getOrderedArchiveChunks(sessionId);
  const segsAfterSuccess = await store.getTranscriptionSegments(sessionId);
  assert.equal(chunksAfterSuccess.length, 0);
  assert.equal(segsAfterSuccess.length, 0);

  store.close();
});

test('15. Discard recovery membutuhkan confirmation dialog', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-15-${Date.now()}`);
  const sessionId = 'rec-discard-confirm';

  await store.saveSession({
    sessionId,
    targetProjectId: 'proj-1',
    title: 'Draft Rapat Batal',
    status: 'failed',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeDurationMs: 60000,
    mimeType: 'audio/webm',
    archiveChunkCount: 1,
    archiveTotalBytes: 1000,
    segmentCount: 1,
    errorCode: null,
    errorMessage: null,
  });

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
    />
  );
  await flushAsync(40);

  const deleteBtn = Array.from(win.document.querySelectorAll('button')).find(
    b => b.textContent?.includes('Hapus draft')
  )!;
  assert.ok(deleteBtn);

  // Clicking "Hapus draft" opens confirmation dialog without deleting immediately
  await act(async () => {
    deleteBtn.click();
  });
  await flushAsync();

  assert.ok(win.document.body.textContent?.includes('Hapus draft rekaman?'));
  assert.ok(await store.getSession(sessionId), 'Draft belum boleh terhapus sebelum dikonfirmasi');

  // Confirm deletion inside DiscardRecordingDialog
  const confirmBtns = Array.from(win.document.querySelectorAll('button')).filter(
    b => b.textContent?.trim() === 'Hapus draft'
  );
  const modalConfirmBtn = confirmBtns[confirmBtns.length - 1];
  await act(async () => {
    modalConfirmBtn.click();
  });
  await flushAsync(40);

  assert.equal(await store.getSession(sessionId), null, 'Draft dihapus setelah dikonfirmasi');

  store.close();
});

test('16. Timer tidak menjadi noisy live region', { timeout: 10000 }, async () => {
  mountTestApp(
    <ActiveRecordingDialog
      open={true}
      engineState={{
        status: 'recording',
        sessionId: 's-16',
        activeDurationMs: 12000,
        archiveTotalBytes: 1000,
        segmentCount: 1,
        pendingWrites: 0,
        error: null,
      }}
      title="Timer A11y"
      activeDurationMs={12000}
      stream={null}
      isFinalizing={false}
      error={null}
      onPause={() => {}}
      onResume={() => {}}
      onStop={() => {}}
      onRetryFinalize={() => {}}
      onRequestCancel={() => {}}
    />
  );
  await flushAsync();

  const clockDigits = win.document.querySelector('.text-4xl, .text-5xl');
  assert.ok(clockDigits);
  assert.equal(clockDigits.getAttribute('aria-hidden'), 'true');

  const liveRegion = win.document.querySelector('[aria-live="polite"]');
  assert.ok(liveRegion);
  assert.equal(liveRegion.textContent?.trim(), 'Sedang merekam');
});

test('17. AudioLevelMeter lifecycle cleanup: RAF, reduced-motion timeout, visibilitychange, dan AudioContext.close (IMPORTANT 4 & IMPORTANT 7)', { timeout: 10000 }, async () => {
  let audioCtxClosed = 0;
  let sourceDisconnected = 0;
  let analyserDisconnected = 0;

  class MockAudioContext {
    state = 'running';
    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() {
          sourceDisconnected++;
        },
      };
    }
    createAnalyser() {
      return {
        fftSize: 64,
        smoothingTimeConstant: 0.5,
        frequencyBinCount: 32,
        getByteFrequencyData(arr: Uint8Array) {
          arr.fill(64);
        },
        disconnect() {
          analyserDisconnected++;
        },
      };
    }
    async close() {
      this.state = 'closed';
      audioCtxClosed++;
    }
  }

  const origAudioContext = (win as any).AudioContext;
  const origMatchMedia = win.matchMedia;
  const origRAF = globalThis.requestAnimationFrame;
  const origCAF = globalThis.cancelAnimationFrame;

  (win as any).AudioContext = MockAudioContext;
  // Enable reduced-motion to test both timeout tracking AND RAF tracking
  win.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as any;

  let rafScheduled = 0;
  let rafCancelled = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafScheduled++;
    return setTimeout(() => cb(performance.now()), 5) as unknown as number;
  }) as any;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafCancelled++;
    clearTimeout(id as any);
  }) as any;

  const origAddListener = document.addEventListener.bind(document);
  const origRemoveListener = document.removeEventListener.bind(document);
  let visibilityAdded = 0;
  let visibilityRemoved = 0;

  document.addEventListener = ((type: string, listener: any, options?: any) => {
    if (type === 'visibilitychange') visibilityAdded++;
    return origAddListener(type, listener, options);
  }) as any;
  document.removeEventListener = ((type: string, listener: any, options?: any) => {
    if (type === 'visibilitychange') visibilityRemoved++;
    return origRemoveListener(type, listener, options);
  }) as any;

  try {
    const stream = new MockMediaStream();
    const { root } = mountTestApp(<AudioLevelMeter stream={stream as any} />);
    await flushAsync(20);

    assert.equal(visibilityAdded, 1, 'visibilitychange listener harus terdaftar');
    assert.ok(rafScheduled >= 1, 'RAF harus dijadwalkan saat komponen aktif');

    // Simulate tab becoming hidden while reduced-motion 100ms timeout is pending
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const rafCountWhenHidden = rafScheduled;
    // Wait longer than the 100ms reduced-motion timeout to prove it was cancelled and does NOT restart RAF while hidden!
    await flushAsync(130);
    assert.equal(rafScheduled, rafCountWhenHidden, 'Pending reduced-motion timeout TIDAK boleh menyalakan RAF kembali saat tab hidden');

    // Unmount component and verify all resources are cleaned up
    await act(async () => {
      root.unmount();
    });

    assert.equal(visibilityRemoved, 1, 'visibilitychange listener harus dihapus saat unmount');
    assert.equal(sourceDisconnected, 1, 'MediaStreamAudioSourceNode harus disconnect saat unmount');
    assert.equal(analyserDisconnected, 1, 'AnalyserNode harus disconnect saat unmount');
    assert.equal(audioCtxClosed, 1, 'Owned AudioContext harus ditutup saat unmount');
  } finally {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    (win as any).AudioContext = origAudioContext;
    win.matchMedia = origMatchMedia;
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
    document.addEventListener = origAddListener;
    document.removeEventListener = origRemoveListener;
  }
});

test('18. ID/EN copy tersedia dan bebas dari em dash', { timeout: 10000 }, async () => {
  setLanguage('id');
  assert.equal(t('Rekam pertemuan'), 'Rekam pertemuan');
  assert.equal(t('Lokal di perangkat'), 'Lokal di perangkat');
  assert.equal(t('Batalkan rekaman?'), 'Batalkan rekaman?');
  assert.ok(!t('Penyimpanan persisten belum aktif. Browser dapat membersihkan data lokal saat ruang perangkat terbatas. Selesaikan dan ekspor rekaman penting sebagai cadangan.').includes('—'));

  setLanguage('en');
  assert.equal(t('Rekam pertemuan'), 'Record meeting');
  assert.equal(t('Lokal di perangkat'), 'Local on device');
  assert.equal(t('Batalkan rekaman?'), 'Cancel recording?');
  assert.equal(
    t('Penyimpanan persisten belum aktif. Browser dapat membersihkan data lokal saat ruang perangkat terbatas. Selesaikan dan ekspor rekaman penting sebagai cadangan.'),
    'Persistent storage is not active yet. The browser may clear local data when device space is low. Finish and export important recordings as a backup.'
  );

  setLanguage('id');
});

test('19. Tidak ada network/cloud call dari recording UI flow', { timeout: 10000 }, async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error('Network should never be contacted during recording UI flow');
  };

  try {
    const store = new RecordingStore(`test-ui-19-${Date.now()}`);
    mountTestApp(
      <TestRecordingApp
        store={store}
        capabilities={supportedCapabilities}
        getMediaStream={async () => new MockMediaStream() as any}
      />
    );
    await flushAsync();

    assert.equal(fetchCalls, 0, 'Harus 0 network/cloud calls pada recording UI');
    store.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('20. CRITICAL 1: Unmount hook/App tidak menghapus draft, menghentikan tracks, dan session ditemukan oleh recovery scan', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-crit1-${Date.now()}`);
  const activeTrack = new MockAudioTrack();
  const setupTrack = new MockAudioTrack();
  let callIndex = 0;

  const { root } = mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={async () => {
        callIndex++;
        return new MockMediaStream([callIndex === 1 ? setupTrack : activeTrack]) as any;
      }}
    />
  );
  await flushAsync();

  // Start recording
  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Rekam pertemuan'))!).click();
  });
  await flushAsync();
  await act(async () => {
    (win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement).click();
  });
  await flushAsync();
  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Lanjut pilih mikrofon'))!).click();
  });
  await flushAsync();
  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Mulai merekam'))!).click();
  });
  await flushAsync();

  const sessionsDuringRec = await store.listRecoverableSessions();
  assert.equal(sessionsDuringRec.length, 1);
  const sessionId = sessionsDuringRec[0].sessionId;

  // Write a durable archive chunk and a transcript checkpoint while recording
  await store.appendArchiveChunk({
    sessionId,
    chunkIndex: 0,
    blob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
    sizeBytes: 5,
    timestampMs: 1000,
    activeDurationMs: 1000,
    createdAt: Date.now(),
  });
  await store.appendTranscriptionSegment({
    sessionId,
    segmentIndex: 0,
    blob: new Blob([new Uint8Array([7, 8])]),
    sizeBytes: 2,
    durationSec: 60,
    plannedStartSec: 0,
    plannedEndSec: 65,
    overlapStartSec: 0,
    overlapEndSec: 5,
    transcribed: true,
    transcriptDialogs: [{ id: 1, speaker: 'S1', text: 'Penting jangan hilang', seconds: 1, time: '00:01' }],
    createdAt: Date.now(),
  });

  // Unmount React App while recording is active (simulating navigation or unexpected unmount)
  await act(async () => {
    root.unmount();
  });
  await flushAsync(40);

  // 1. Hardware track MUST be stopped immediately
  assert.equal(activeTrack.stopped, true, 'MediaStreamTrack harus dihentikan saat unmount');

  // 2. Session, archive chunks, and checkpoints MUST NOT be deleted
  const preservedSession = await store.getSession(sessionId);
  assert.ok(preservedSession, 'Session tidak boleh dihapus saat unmount');
  assert.equal(preservedSession.status, 'recoverable');

  const preservedChunks = await store.getOrderedArchiveChunks(sessionId);
  assert.ok(preservedChunks.length >= 1, 'Archive chunks tidak boleh dihapus saat unmount');

  const preservedSegs = await store.getTranscriptionSegments(sessionId);
  assert.ok(preservedSegs.some(s => s.transcribed && s.transcriptDialogs?.[0]?.text === 'Penting jangan hilang'), 'Checkpoints tidak boleh dihapus saat unmount');

  // 3. Session MUST be discoverable by recovery scan
  const recoverableList = await store.listRecoverableSessions();
  assert.equal(recoverableList.length, 1);
  assert.equal(recoverableList[0].sessionId, sessionId);

  store.close();
});

test('21. CRITICAL 2: Stream leak prevention ketika enumerateDevices gagal setelah getUserMedia berhasil', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-crit2-${Date.now()}`);
  const leakedTrackCandidate = new MockAudioTrack();
  let notifiedError = '';

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      getMediaStream={async () => new MockMediaStream([leakedTrackCandidate]) as any}
      enumerateDevices={async () => {
        throw new Error('Hardware device enumeration failed');
      }}
      notify={msg => { notifiedError = msg; }}
    />
  );
  await flushAsync();

  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Rekam pertemuan'))!).click();
  });
  await flushAsync();
  await act(async () => {
    (win.document.querySelector('#consent-checkbox') as unknown as HTMLInputElement).click();
  });
  await flushAsync();
  await act(async () => {
    (Array.from(win.document.querySelectorAll('button')).find(b => b.textContent?.includes('Lanjut pilih mikrofon'))!).click();
  });
  await flushAsync();

  // Track acquired from getUserMedia MUST be stopped when enumerateDevices fails!
  assert.equal(leakedTrackCandidate.stopped, true, 'Track mikrofon wajib dihentikan jika enumerateDevices gagal');
  assert.equal(leakedTrackCandidate.readyState, 'ended');
  // Setup dialog must NOT open
  assert.ok(!win.document.body.textContent?.includes('Atur rekaman pertemuan'));
  assert.ok(notifiedError.length > 0);

  store.close();
});

test('22. CRITICAL 3: Double permission & double start race guard', { timeout: 10000 }, async () => {
  const store = new RecordingStore(`test-ui-crit3-${Date.now()}`);
  let getUserMediaCalls = 0;
  let createdTracks: MockAudioTrack[] = [];
  let exposedHook: ReturnType<typeof useLocalRecording> | null = null;

  let resolveFirstStream!: (s: MediaStream) => void;
  const firstStreamPromise = new Promise<MediaStream>(res => {
    resolveFirstStream = res;
  });

  mountTestApp(
    <TestRecordingApp
      store={store}
      capabilities={supportedCapabilities}
      onExposeRecording={rec => { exposedHook = rec; }}
      getMediaStream={async () => {
        getUserMediaCalls++;
        const t = new MockAudioTrack();
        createdTracks.push(t);
        if (getUserMediaCalls === 1) {
          return firstStreamPromise;
        }
        return new MockMediaStream([t]) as any;
      }}
    />
  );
  await flushAsync();
  assert.ok(exposedHook);

  // 1. Trigger proceedToSetup twice synchronously before first promise resolves
  let p1!: Promise<void>;
  let p2!: Promise<void>;
  act(() => {
    p1 = exposedHook!.proceedToSetup();
    p2 = exposedHook!.proceedToSetup();
  });

  assert.equal(getUserMediaCalls, 1, 'Synchronous guard harus mencegah pemanggilan getUserMedia kedua');

  await act(async () => {
    resolveFirstStream(new MockMediaStream([createdTracks[0]]) as any);
    await Promise.all([p1, p2]);
  });
  await flushAsync();

  // 2. Trigger startRecording twice synchronously before first start resolves
  let s1!: Promise<void>;
  let s2!: Promise<void>;
  await act(async () => {
    s1 = exposedHook!.startRecording();
    s2 = exposedHook!.startRecording();
    await Promise.all([s1, s2]);
  });
  await flushAsync();

  // Total getUserMedia calls must be exactly 2 (1 for setup, 1 for single engine start)
  assert.equal(getUserMediaCalls, 2, 'Hanya satu RecordingEngine yang boleh meminta stream pada double start');

  const sessions = await store.listRecoverableSessions();
  assert.equal(sessions.length, 1, 'Hanya satu sesi rekaman yang boleh dibuat');

  store.close();
});
