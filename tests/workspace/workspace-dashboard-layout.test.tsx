import { win } from '../account/dom-setup.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import 'fake-indexeddb/auto';
import { setLanguage } from '../../src/lib/i18n.ts';
import { WorkspaceSidebar } from '../../src/components/dashboard/WorkspaceSidebar.tsx';
import { WorkspaceDashboard } from '../../src/components/dashboard/WorkspaceDashboard.tsx';
import type {
  FolderRecord,
  ProjectSummary,
  RecentRecording,
  WorkspaceStats,
} from '../../src/features/workspace/workspace-store.ts';
import type { Recording } from '../../src/lib/transcript.ts';

let activeRoots: Array<{ root: ReactDOM.Root; container: HTMLElement }> = [];

function cleanBody() {
  for (const item of activeRoots) {
    try {
      act(() => {
        item.root.unmount();
      });
    } catch {}
    try {
      item.container.remove();
    } catch {}
  }
  activeRoots = [];
  win.document.body.innerHTML = '';
}

function mount(node: React.ReactElement) {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);
  activeRoots.push({ root, container: container as any });
  act(() => {
    root.render(node);
  });
  return { root, container: container as any };
}

async function flushAsync(ms = 30) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  cleanBody();
  setLanguage('id');
});

afterEach(() => {
  cleanBody();
});

const sampleProjects: ProjectSummary[] = [
  {
    id: 'proj-product',
    title: 'Product',
    folderId: null,
    tags: [],
    createdAt: 1700000000000,
    updatedAt: 1700000500000,
    recordingCount: 2,
    totalDurationSec: 3563,
  },
  {
    id: 'proj-eng',
    title: 'Engineering',
    folderId: null,
    tags: [],
    createdAt: 1700000000000,
    updatedAt: 1700000900000,
    recordingCount: 1,
    totalDurationSec: 2767,
  },
];

const sampleFolders: FolderRecord[] = [
  {
    id: 'folder-q2',
    projectId: 'proj-product',
    name: 'Riset Q2',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

const sampleRecordings: Recording[] = [
  {
    id: 'rec-1',
    title: 'Review roadmap produk',
    category: 'Rapat',
    filename: 'roadmap.mp3',
    durationSec: 1938,
    projectId: 'proj-product',
    folderId: 'folder-q2',
    tags: ['roadmap', 'prioritas'],
    createdAt: 1700000100000,
    updatedAt: 1700000500000,
    segments: [
      { id: 1, time: '00:10', seconds: 10, speaker: 'Nadia', text: 'Kita fokus pada stabilitas.' },
      { id: 2, time: '00:25', seconds: 25, speaker: 'Raka', text: 'Setuju, rilis bertahap.' },
      { id: 3, time: '00:40', seconds: 40, speaker: 'Budi', text: 'Siap dieksekusi.' },
    ],
  },
  {
    id: 'rec-2',
    title: 'Evaluasi eksperimen fitur',
    category: 'Rapat',
    filename: 'evaluasi.mp3',
    durationSec: 1625,
    projectId: 'proj-product',
    folderId: null,
    tags: ['eksperimen'],
    createdAt: 1700000200000,
    updatedAt: 1700000400000,
    segments: [],
  },
  {
    id: 'rec-3',
    title: 'Sinkronisasi tim engineering',
    category: 'Rapat',
    filename: 'sinkronisasi.wav',
    durationSec: 2767,
    projectId: 'proj-eng',
    folderId: null,
    tags: ['teknis'],
    createdAt: 1700000300000,
    updatedAt: 1700000900000,
    segments: [
      { id: 1, time: '00:05', seconds: 5, speaker: 'Arif', text: 'Arsitektur lokal berjalan lancar.' },
      { id: 2, time: '00:20', seconds: 20, speaker: 'Dina', text: 'Tes unit sudah hijau.' },
    ],
  },
];

const sampleRecents: RecentRecording[] = [
  {
    id: 'rec-3',
    title: 'Sinkronisasi tim engineering',
    projectId: 'proj-eng',
    projectTitle: 'Engineering',
    category: 'Rapat',
    filename: 'sinkronisasi.wav',
    durationSec: 2767,
    updatedAt: 1700000900000,
  },
  {
    id: 'rec-1',
    title: 'Review roadmap produk',
    projectId: 'proj-product',
    projectTitle: 'Product',
    category: 'Rapat',
    filename: 'roadmap.mp3',
    durationSec: 1938,
    updatedAt: 1700000500000,
  },
];

const sampleStats: WorkspaceStats = {
  projectCount: 2,
  recordingCount: 3,
  totalDurationSec: 6330,
  lastUpdatedAt: 1700000900000,
};

test('Task 1: WorkspaceSidebar merender reversed brand lockup/mark, navigasi dengan active state, storage & backup summary, serta mobile drawer', async () => {
  let selectedSection = 'workspace';
  let mobileClosed = false;

  mount(
    <WorkspaceSidebar
      activeSection={selectedSection as any}
      onSelectSection={sec => {
        selectedSection = sec;
      }}
      mobileOpen={true}
      onMobileClose={() => {
        mobileClosed = true;
      }}
      onExportWorkspace={() => {}}
      onImportBackup={() => {}}
    />
  );
  await flushAsync();

  const sidebar = win.document.querySelector('[data-testid="workspace-sidebar"]') as HTMLElement | null;
  assert.ok(sidebar, 'WorkspaceSidebar harus dirender');

  // Reversed brand assets check
  const lockupImg = sidebar.querySelector('img[src*="catetin-lockup-reversed.svg"]');
  const markImg = sidebar.querySelector('img[src*="catetin-mark-reversed.svg"]');
  assert.ok(lockupImg, 'Sidebar harus memuat catetin-lockup-reversed.svg');
  assert.ok(markImg, 'Sidebar harus memuat catetin-mark-reversed.svg untuk mode kompak/sempit');

  // Active section check: Workspace as sole primary nav
  const workspaceNavBtn = sidebar.querySelector('button[data-nav-id="workspace"]') as HTMLButtonElement | null;
  assert.ok(workspaceNavBtn, 'Tombol navigasi Workspace harus ada');
  assert.equal(workspaceNavBtn.getAttribute('aria-current'), 'page');
  assert.ok(workspaceNavBtn.className.includes('min-h-[44px]'), 'Target sentuh navigasi minimal 44px');

  // Must NOT contain removed duplicate nav items
  assert.equal(sidebar.querySelector('button[data-nav-id="projects"]'), null, 'Nav Projects tidak boleh ada di sidebar');
  assert.equal(sidebar.querySelector('button[data-nav-id="recordings"]'), null, 'Nav Rekaman tidak boleh ada di sidebar');
  assert.equal(sidebar.querySelector('button[data-nav-id="folders-tags"]'), null, 'Nav Folder & tag tidak boleh ada di sidebar');
  assert.equal(sidebar.querySelector('button[data-nav-id="storage"]'), null, 'Nav Penyimpanan tidak boleh menjadi menu terpisah di atas');

  // Account button in utility footer
  const accountBtn = sidebar.querySelector('button[data-nav-id="account"]') as HTMLButtonElement | null;
  assert.ok(accountBtn, 'Tombol Account harus ada di bagian bawah utility sidebar');

  // Storage & backup footer summary in sidebar
  assert.ok(sidebar.textContent?.includes('Penyimpanan lokal'), 'Sidebar harus menampilkan status Penyimpanan lokal');
  assert.ok(sidebar.textContent?.includes('Backup siap'), 'Sidebar harus menampilkan status Backup siap');

  // Mobile drawer close button & Escape handling
  const closeDrawerBtn = win.document.querySelector('[data-testid="workspace-drawer-close"]') as HTMLButtonElement | null;
  assert.ok(closeDrawerBtn, 'Tombol tutup drawer mobile harus ada saat mobileOpen=true');
  await act(async () => {
    closeDrawerBtn.click();
  });
  assert.equal(mobileClosed, true);
});

test('Task 2: Dashboard library-first hierarchy menampilkan Rekam pertemuan (Mic non-merah), Buka rekaman, pengelompokan project/rekaman, dan panel Lanjutkan pekerjaan', async () => {
  let startRecCalled = false;
  let openUploadCalled = false;
  let openedRecording: { id: string; projectId?: string } | null = null;
  let openedProject: string | null = null;

  mount(
    <WorkspaceDashboard
      projects={sampleProjects}
      folders={sampleFolders}
      allRecordings={sampleRecordings}
      recentRecordings={sampleRecents}
      stats={sampleStats}
      allWorkspaceTags={['roadmap', 'prioritas', 'eksperimen', 'teknis']}
      onOpenProject={id => {
        openedProject = id;
      }}
      onOpenRecording={(id, pid) => {
        openedRecording = { id, projectId: pid };
      }}
      onCreateProjectClick={() => {}}
      onOpenRecordingClick={() => {
        openUploadCalled = true;
      }}
      onTryDemo={() => {}}
      onCreateFolderClick={() => {}}
      onRenameFolderClick={() => {}}
      onDeleteFolderClick={() => {}}
      onManageTagsClick={() => {}}
      onMoveFolderClick={() => {}}
      onStartRecordingClick={() => {
        startRecCalled = true;
      }}
    />
  );
  await flushAsync();

  // 1. Primary action: Rekam pertemuan (exact 1 button, monoline Mic without red-500)
  const recordBtns = Array.from(win.document.querySelectorAll('button')).filter(b =>
    b.textContent?.includes('Rekam pertemuan')
  );
  assert.equal(recordBtns.length, 1, 'Harus ada tepat 1 tombol Rekam pertemuan');
  const micSvg = recordBtns[0].querySelector('svg');
  assert.ok(micSvg, 'Tombol Rekam pertemuan harus memiliki ikon Mic');
  const micClass = micSvg.getAttribute('class') || '';
  assert.ok(!micClass.includes('text-red-500'), 'Ikon Mic TIDAK boleh berwarna merah/destructive');

  await act(async () => {
    recordBtns[0].click();
  });
  assert.equal(startRecCalled, true);

  // 2. Secondary action: Buka rekaman
  const uploadBtns = Array.from(win.document.querySelectorAll('button')).filter(b =>
    b.textContent?.includes('Buka rekaman')
  );
  assert.ok(uploadBtns.length >= 1, 'Tombol Buka rekaman harus tersedia');
  await act(async () => {
    uploadBtns[0].click();
  });
  assert.equal(openUploadCalled, true);

  // 3. Four equal KPI stat-cards removed from primary hierarchy
  const oldStatCards = win.document.querySelectorAll('.dashboard-stats .stat-card');
  assert.equal(oldStatCards.length, 0, 'Empat KPI stat-card lama tidak boleh menjadi hierarki utama');

  // 4. Grouped project/recording library
  const library = win.document.querySelector('[data-testid="workspace-library"]') as HTMLElement | null;
  assert.ok(library, 'WorkspaceLibrary harus dirender');
  assert.ok(library.textContent?.includes('Product'), 'Group project Product harus tampil');
  assert.ok(library.textContent?.includes('Engineering'), 'Group project Engineering harus tampil');
  assert.ok(library.textContent?.includes('Review roadmap produk'), 'Rekaman Review roadmap produk harus tampil');
  assert.ok(library.textContent?.includes('Evaluasi eksperimen fitur'), 'Rekaman Evaluasi eksperimen fitur harus tampil');
  assert.ok(library.textContent?.includes('Sinkronisasi tim engineering'), 'Rekaman Sinkronisasi tim engineering harus tampil');

  // Click recording row opens recording
  const roadmapRow = win.document.querySelector('[data-recording-id="rec-1"]') as HTMLElement | null;
  assert.ok(roadmapRow, 'Baris rekaman rec-1 harus ada');
  await act(async () => {
    roadmapRow.click();
  });
  assert.deepEqual(openedRecording, { id: 'rec-1', projectId: 'proj-product' });

  // 5. ContinueWorkPanel ("Lanjutkan pekerjaan")
  const continuePanel = win.document.querySelector('[data-testid="continue-work-panel"]') as HTMLElement | null;
  assert.ok(continuePanel, 'ContinueWorkPanel harus dirender');
  assert.ok(continuePanel.textContent?.includes('Lanjutkan pekerjaan'), 'Judul Lanjutkan pekerjaan harus tampil');
  assert.ok(
    continuePanel.textContent?.includes('Sinkronisasi tim engineering'),
    'ContinueWorkPanel harus menampilkan rekaman terbaru (Sinkronisasi tim engineering)'
  );
  assert.ok(continuePanel.textContent?.includes('Tersimpan lokal'), 'Kartu Tersimpan lokal harus tampil di panel kanan');

  const continueBtn = continuePanel.querySelector('[data-testid="continue-work-primary-btn"]') as HTMLButtonElement | null;
  assert.ok(continueBtn, 'Tombol Lanjutkan transkrip di ContinueWorkPanel harus ada');
  await act(async () => {
    continueBtn.click();
  });
  assert.deepEqual(openedRecording, { id: 'rec-3', projectId: 'proj-eng' });
});

test('Task 3: Empty workspace, filter kosong, pencarian, recoverable session, dan lokalisasi EN bekerja jujur tanpa data palsu', async () => {
  let createProjCalled = false;
  let tryDemoCalled = false;
  let recoverCalled = false;

  // Empty workspace render
  const { root } = mount(
    <WorkspaceDashboard
      projects={[]}
      folders={[]}
      allRecordings={[]}
      recentRecordings={[]}
      stats={{ projectCount: 0, recordingCount: 0, totalDurationSec: 0, lastUpdatedAt: null }}
      allWorkspaceTags={[]}
      onOpenProject={() => {}}
      onOpenRecording={() => {}}
      onCreateProjectClick={() => {
        createProjCalled = true;
      }}
      onOpenRecordingClick={() => {}}
      onTryDemo={() => {
        tryDemoCalled = true;
      }}
      onCreateFolderClick={() => {}}
      onRenameFolderClick={() => {}}
      onDeleteFolderClick={() => {}}
      onManageTagsClick={() => {}}
      onMoveFolderClick={() => {}}
      onStartRecordingClick={() => {}}
      recoverableSessions={[
        {
          sessionId: 'sess-rec-1',
          targetProjectId: 'project-default',
          title: 'Draf Rapat Darurat',
          status: 'recoverable',
          startedAt: Date.now() - 60000,
          lastUpdatedAt: Date.now() - 10000,
          activeDurationMs: 45000,
          mimeType: 'audio/webm;codecs=opus',
          archiveChunkCount: 3,
          archiveTotalBytes: 24576,
          segmentCount: 1,
          errorCode: null,
          errorMessage: null,
        },
      ]}
      onRecoverSession={() => {
        recoverCalled = true;
      }}
      onDiscardSession={() => {}}
    />
  );
  await flushAsync();

  // Must not show fake mockup projects/recordings when empty
  assert.ok(!win.document.body.textContent?.includes('Review roadmap produk'), 'Tidak boleh menampilkan rekaman palsu saat kosong');
  assert.ok(!win.document.body.textContent?.includes('Sinkronisasi tim engineering'), 'Tidak boleh menampilkan rekaman palsu di Lanjutkan pekerjaan');

  // Recoverable session banner visible & actionable
  assert.ok(win.document.body.textContent?.includes('Draf Rapat Darurat'), 'Sesi recoverable harus tetap terlihat');
  const recoverBtn = Array.from(win.document.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Pulihkan rekaman')
  );
  assert.ok(recoverBtn, 'Tombol Pulihkan rekaman harus ada');
  await act(async () => {
    recoverBtn!.click();
  });
  assert.equal(recoverCalled, true);

  // Empty state title & absence of old 3 educational cards
  assert.ok(win.document.body.textContent?.includes('Mulai workspace pertama Anda'), 'Harus menampilkan judul Mulai workspace pertama Anda');
  assert.ok(!win.document.body.textContent?.includes('Privasi penuh di perangkat'), 'Kartu edukasi Privasi penuh harus dihapus');
  assert.ok(!win.document.body.textContent?.includes('Transkripsi lokal Whisper'), 'Kartu edukasi Whisper harus dihapus');
  assert.ok(!win.document.body.textContent?.includes('Penyimpanan browser mandiri'), 'Kartu edukasi Penyimpanan browser mandiri harus dihapus');

  // Starting paths in empty workspace: 4 jalur mulai
  const emptySection = win.document.querySelector('.dashboard-empty-state') as HTMLElement | null;
  assert.ok(emptySection, 'Section empty state onboarding harus ada');

  const emptyRecBtn = Array.from(emptySection.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Rekam pertemuan')
  );
  assert.ok(emptyRecBtn, 'Empty state harus memiliki tombol Rekam pertemuan');

  const emptyUploadBtn = Array.from(emptySection.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Buka rekaman')
  );
  assert.ok(emptyUploadBtn, 'Empty state harus memiliki tombol Buka rekaman');

  const createProjBtn = Array.from(emptySection.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Buat project')
  );
  assert.ok(createProjBtn, 'Tombol Buat project harus ada pada empty workspace');
  await act(async () => {
    createProjBtn!.click();
  });
  assert.equal(createProjCalled, true);

  const demoBtn = Array.from(emptySection.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Coba contoh')
  );
  assert.ok(demoBtn, 'Tombol Coba contoh harus ada pada empty workspace');
  await act(async () => {
    demoBtn!.click();
  });
  assert.equal(tryDemoCalled, true);

  // Switch to EN and verify localized headings & actions
  await act(async () => {
    setLanguage('en');
    root.render(
      <WorkspaceDashboard
        projects={sampleProjects}
        folders={sampleFolders}
        allRecordings={sampleRecordings}
        recentRecordings={sampleRecents}
        stats={sampleStats}
        allWorkspaceTags={['roadmap']}
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

  assert.ok(win.document.body.textContent?.includes('Local workspace'), 'Judul EN Local workspace harus tampil');
  assert.ok(win.document.body.textContent?.includes('Record meeting'), 'Tombol EN Record meeting harus tampil');
  assert.ok(win.document.body.textContent?.includes('Continue work'), 'Panel EN Continue work harus tampil');
});

test('Task 3b: View switch Project/Rekaman, filter folder/tag, menu aksi baris, dan loading state berfungsi lengkap', async () => {
  let movedRecording: Recording | null = null;
  let taggedRecording: Recording | null = null;
  let exportedProject: string | null = null;

  // 1. Loading state check
  const { root } = mount(
    <WorkspaceDashboard
      projects={sampleProjects}
      folders={sampleFolders}
      allRecordings={sampleRecordings}
      recentRecordings={sampleRecents}
      stats={sampleStats}
      allWorkspaceTags={['roadmap', 'eksperimen', 'teknis']}
      loading={true}
      onOpenProject={() => {}}
      onOpenRecording={() => {}}
      onCreateProjectClick={() => {}}
      onOpenRecordingClick={() => {}}
      onTryDemo={() => {}}
      onCreateFolderClick={() => {}}
      onRenameFolderClick={() => {}}
      onDeleteFolderClick={() => {}}
      onManageTagsClick={rec => {
        taggedRecording = rec;
      }}
      onMoveFolderClick={rec => {
        movedRecording = rec;
      }}
      onExportClick={(scope, pid) => {
        if (scope === 'project' && pid) exportedProject = pid;
      }}
      onStartRecordingClick={() => {}}
    />
  );
  await flushAsync();

  const statusEl = win.document.querySelector('[role="status"]');
  assert.ok(statusEl?.textContent?.includes('Memuat workspace lokal'), 'Loading state harus menampilkan indikator pemuatan');

  // 2. Render populated (loading=false)
  await act(async () => {
    root.render(
      <WorkspaceDashboard
        projects={sampleProjects}
        folders={sampleFolders}
        allRecordings={sampleRecordings}
        recentRecordings={sampleRecents}
        stats={sampleStats}
        allWorkspaceTags={['roadmap', 'eksperimen', 'teknis']}
        loading={false}
        onOpenProject={() => {}}
        onOpenRecording={() => {}}
        onCreateProjectClick={() => {}}
        onOpenRecordingClick={() => {}}
        onTryDemo={() => {}}
        onCreateFolderClick={() => {}}
        onRenameFolderClick={() => {}}
        onDeleteFolderClick={() => {}}
        onManageTagsClick={rec => {
          taggedRecording = rec;
        }}
        onMoveFolderClick={rec => {
          movedRecording = rec;
        }}
        onExportClick={(scope, pid) => {
          if (scope === 'project' && pid) exportedProject = pid;
        }}
        onStartRecordingClick={() => {}}
      />
    );
  });
  await flushAsync();

  // 3. Switch to 'Rekaman' flat view
  const viewSwitchGroup = win.document.querySelector('[role="group"][aria-label="Pilih tampilan"]');
  assert.ok(viewSwitchGroup, 'Segmented switch Project / Rekaman harus ada');
  const rekamanTabBtn = Array.from(viewSwitchGroup.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Rekaman')
  ) as HTMLButtonElement | undefined;
  assert.ok(rekamanTabBtn, 'Tombol switch Rekaman harus ada');
  await act(async () => {
    rekamanTabBtn.click();
  });
  assert.equal(rekamanTabBtn.getAttribute('aria-pressed'), 'true');

  // 4. Open row menu and trigger Move folder & Tag
  const menuTrigger = win.document.querySelector(
    'button[aria-label="Aksi rekaman Review roadmap produk"]'
  ) as HTMLButtonElement | null;
  assert.ok(menuTrigger, 'Tombol menu aksi rekaman harus ada');
  await act(async () => {
    menuTrigger.click();
  });

  const moveMenuItem = Array.from(win.document.querySelectorAll('[role="menuitem"]')).find(b =>
    b.textContent?.includes('Pindahkan')
  ) as HTMLButtonElement | undefined;
  assert.ok(moveMenuItem, 'Menu item Pindahkan harus ada');
  await act(async () => {
    moveMenuItem.click();
  });
  assert.equal((movedRecording as Recording | null)?.id, 'rec-1');

  // Reopen menu and click Tag
  await act(async () => {
    menuTrigger.click();
  });
  const tagMenuItem = Array.from(win.document.querySelectorAll('[role="menuitem"]')).find(b =>
    b.textContent?.includes('Tag')
  ) as HTMLButtonElement | undefined;
  assert.ok(tagMenuItem, 'Menu item Tag harus ada');
  await act(async () => {
    tagMenuItem.click();
  });
  assert.equal((taggedRecording as Recording | null)?.id, 'rec-1');

  // 5. Switch back to 'Project' view and test Export project
  const projectTabBtn = Array.from(viewSwitchGroup.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Project')
  ) as HTMLButtonElement | undefined;
  await act(async () => {
    projectTabBtn!.click();
  });

  const exportProjBtn = win.document.querySelector('button[title="Export Product"]') as HTMLButtonElement | null;
  assert.ok(exportProjBtn, 'Tombol Export project harus tersedia');
  await act(async () => {
    exportProjBtn.click();
  });
  assert.equal(exportedProject, 'proj-product');

  // 6. Click Storage utility card in sidebar reveals StorageSection
  const storageUtilityBtn = win.document.querySelector('[data-testid="sidebar-storage-status"]') as HTMLButtonElement | null;
  assert.ok(storageUtilityBtn, 'Tombol status penyimpanan di utility sidebar harus ada');
  await act(async () => {
    storageUtilityBtn.click();
  });
  await flushAsync();
  assert.ok(
    win.document.body.textContent?.includes('Data dan penyimpanan'),
    'Klik Penyimpanan di sidebar harus menampilkan seksi Data dan penyimpanan'
  );
});
