import { win } from '../account/dom-setup.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import 'fake-indexeddb/auto';
import { setLanguage } from '../../src/lib/i18n.ts';
import { WorkspaceSidebar, type WorkspaceSidebarSection } from '../../src/components/dashboard/WorkspaceSidebar.tsx';
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
  win.location.hash = '#studio';
});

afterEach(() => {
  cleanBody();
  win.location.hash = '';
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

test('Task 1: WorkspaceSidebar merender 6 navigasi lengkap, reversed brand lockup, active state, status storage & backup, serta mobile drawer', async () => {
  let selectedSection: WorkspaceSidebarSection = 'workspace';
  let mobileClosed = false;
  let accountOpened = false;

  mount(
    <WorkspaceSidebar
      activeSection={selectedSection}
      onSelectSection={sec => {
        selectedSection = sec;
      }}
      mobileOpen={true}
      onMobileClose={() => {
        mobileClosed = true;
      }}
      onOpenAccount={() => {
        accountOpened = true;
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

  // All 5 primary navigation buttons MUST exist
  const navIds: WorkspaceSidebarSection[] = ['workspace', 'projects', 'recordings', 'folders-tags', 'storage'];
  for (const id of navIds) {
    const btn = sidebar.querySelector(`button[data-nav-id="${id}"]`) as HTMLButtonElement | null;
    assert.ok(btn, `Navigasi [data-nav-id="${id}"] harus ada di sidebar`);
    assert.ok(btn.className.includes('min-h-[44px]'), `Target sentuh ${id} minimal 44px`);
  }

  // Active section check: Workspace as active
  const workspaceNavBtn = sidebar.querySelector('button[data-nav-id="workspace"]') as HTMLButtonElement | null;
  assert.equal(workspaceNavBtn?.getAttribute('aria-current'), 'page');

  // Account button in footer utility
  const accountBtn = sidebar.querySelector('button[data-nav-id="account"]') as HTMLButtonElement | null;
  assert.ok(accountBtn, 'Tombol Account harus ada di bagian bawah utility sidebar');
  await act(async () => {
    accountBtn.click();
  });
  assert.equal(accountOpened, true, 'Klik tombol Account harus memanggil callback onOpenAccount');

  // Storage & backup status in footer
  assert.ok(sidebar.textContent?.includes('Penyimpanan lokal'), 'Sidebar harus menampilkan status Penyimpanan lokal');
  assert.ok(sidebar.textContent?.includes('Backup siap'), 'Sidebar harus menampilkan status Backup siap');

  // Mobile drawer close button & interaction
  const closeDrawerBtn = win.document.querySelector('[data-testid="workspace-drawer-close"]') as HTMLButtonElement | null;
  assert.ok(closeDrawerBtn, 'Tombol tutup drawer mobile harus ada saat mobileOpen=true');
  await act(async () => {
    closeDrawerBtn.click();
  });
  assert.equal(mobileClosed, true);
});

test('Task 2: View 1 Workspace adalah overview (Lanjutkan pekerjaan tanpa fake progress, Terbaru di workspace max 3, no tabs)', async () => {
  let startRecCalled = false;
  let openUploadCalled = false;
  let openedRecording: { id: string; projectId?: string } | null = null;

  mount(
    <WorkspaceDashboard
      projects={sampleProjects}
      folders={sampleFolders}
      allRecordings={sampleRecordings}
      recentRecordings={sampleRecents}
      stats={sampleStats}
      allWorkspaceTags={['roadmap', 'prioritas', 'eksperimen', 'teknis']}
      onOpenProject={() => {}}
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

  // 1. Primary actions: Rekam pertemuan and Buka rekaman
  const recordBtns = Array.from(win.document.querySelectorAll('button')).filter(b =>
    b.textContent?.includes('Rekam pertemuan')
  );
  assert.ok(recordBtns.length >= 1, 'Harus ada tombol Rekam pertemuan');
  const micSvg = recordBtns[0].querySelector('svg');
  assert.ok(micSvg, 'Tombol Rekam pertemuan harus memiliki ikon Mic');
  const micClass = micSvg.getAttribute('class') || '';
  assert.ok(!micClass.includes('text-red-500'), 'Ikon Mic TIDAK boleh berwarna merah/destructive');

  await act(async () => {
    recordBtns[0].click();
  });
  assert.equal(startRecCalled, true);

  const uploadBtns = Array.from(win.document.querySelectorAll('button')).filter(b =>
    b.textContent?.includes('Buka rekaman')
  );
  assert.ok(uploadBtns.length >= 1, 'Tombol Buka rekaman harus tersedia');
  await act(async () => {
    uploadBtns[0].click();
  });
  assert.equal(openUploadCalled, true);

  // 2. Overview MUST NOT contain tabs or full library
  assert.equal(win.document.querySelector('[role="group"][aria-label="Pilih tampilan"]'), null, 'Overview tidak boleh punya tab Project/Rekaman');

  // 3. Section Lanjutkan pekerjaan
  const continueCard = win.document.querySelector('[data-testid="workspace-continue-card"]') as HTMLElement | null;
  assert.ok(continueCard, 'Card Lanjutkan pekerjaan harus dirender');
  assert.ok(win.document.body.textContent?.includes('Lanjutkan pekerjaan'), 'Judul Lanjutkan pekerjaan harus tampil');
  assert.ok(
    continueCard.textContent?.includes('Sinkronisasi tim engineering'),
    'Harus menampilkan rekaman terakhir (Sinkronisasi tim engineering)'
  );
  // Verify NO fake progress bar
  assert.equal(continueCard.querySelector('[role="progressbar"]'), null, 'Tidak boleh ada progress bar palsu');

  // Action button Lanjutkan transkrip
  const continueBtn = continueCard.querySelector('button') as HTMLButtonElement | null;
  assert.ok(continueBtn, 'Tombol Lanjutkan transkrip harus ada');
  await act(async () => {
    continueBtn.click();
  });
  assert.deepEqual(openedRecording, { id: 'rec-3', projectId: 'proj-eng' });

  // 4. Section Terbaru di workspace (max 3 items)
  const recentSection = win.document.querySelector('[data-testid="workspace-recent-section"]') as HTMLElement | null;
  assert.ok(recentSection, 'Section Terbaru di workspace harus dirender');
  const recentRows = recentSection.querySelectorAll('[data-recent-item-id]');
  assert.ok(recentRows.length > 0 && recentRows.length <= 3, 'Terbaru di workspace maksimal 3 item');

  // Lihat semua link switches view to recordings
  const viewAllBtn = recentSection.querySelector('[data-testid="workspace-view-all-recordings"]') as HTMLButtonElement | null;
  assert.ok(viewAllBtn, 'Tombol Lihat semua rekaman harus ada');
  await act(async () => {
    viewAllBtn.click();
  });
  await flushAsync();

  // Switched to recordings view
  const recViewTitle = win.document.querySelector('h1');
  assert.equal(recViewTitle?.textContent?.trim(), 'Rekaman', 'Klik Lihat semua harus berpindah ke view Rekaman');
});

test('Task 3: Dedicated Views (Projects, Rekaman, Folder & tag, Penyimpanan) merender konten spesifik dan aksi fungsional', async () => {
  let createProjCalled = false;
  let createFolderCalled = false;
  let openedRecording: { id: string; projectId?: string } | null = null;
  let taggedRecording: Recording | null = null;
  let movedRecording: Recording | null = null;

  const { root } = mount(
    <WorkspaceDashboard
      projects={sampleProjects}
      folders={sampleFolders}
      allRecordings={sampleRecordings}
      recentRecordings={sampleRecents}
      stats={sampleStats}
      allWorkspaceTags={['roadmap', 'prioritas', 'eksperimen', 'teknis']}
      onOpenProject={() => {}}
      onOpenRecording={(id, pid) => {
        openedRecording = { id, projectId: pid };
      }}
      onCreateProjectClick={() => {
        createProjCalled = true;
      }}
      onOpenRecordingClick={() => {}}
      onTryDemo={() => {}}
      onCreateFolderClick={() => {
        createFolderCalled = true;
      }}
      onRenameFolderClick={() => {}}
      onDeleteFolderClick={() => {}}
      onManageTagsClick={rec => {
        taggedRecording = rec;
      }}
      onMoveFolderClick={rec => {
        movedRecording = rec;
      }}
      onStartRecordingClick={() => {}}
    />
  );
  await flushAsync();

  // 1. Projects View
  const projectsNavBtn = win.document.querySelector('button[data-nav-id="projects"]') as HTMLButtonElement | null;
  assert.ok(projectsNavBtn, 'Navigasi Projects harus ada');
  await act(async () => {
    projectsNavBtn.click();
  });
  await flushAsync();

  const projectsTitle = win.document.querySelector('h1');
  assert.equal(projectsTitle?.textContent?.trim(), 'Projects');
  assert.ok(win.document.body.textContent?.includes('Product'));
  assert.ok(win.document.body.textContent?.includes('Engineering'));

  const newProjBtn = Array.from(win.document.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Buat project')
  );
  assert.ok(newProjBtn, 'Tombol Buat project harus ada di Projects view');
  await act(async () => {
    newProjBtn.click();
  });
  assert.equal(createProjCalled, true);

  // 2. Rekaman View
  const recNavBtn = win.document.querySelector('button[data-nav-id="recordings"]') as HTMLButtonElement | null;
  assert.ok(recNavBtn, 'Navigasi Rekaman harus ada');
  await act(async () => {
    recNavBtn.click();
  });
  await flushAsync();

  const recTitle = win.document.querySelector('h1');
  assert.equal(recTitle?.textContent?.trim(), 'Rekaman');
  assert.ok(win.document.body.textContent?.includes('Review roadmap produk'));
  assert.ok(win.document.body.textContent?.includes('Evaluasi eksperimen fitur'));
  assert.ok(win.document.body.textContent?.includes('Sinkronisasi tim engineering'));

  // Test row menu actions: Pindahkan, Tag
  const menuTrigger = win.document.querySelector('button[aria-label="Aksi rekaman Review roadmap produk"]') as HTMLButtonElement | null;
  assert.ok(menuTrigger, 'Menu trigger aksi rekaman harus ada di Rekaman view');
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

  // 3. Folder & Tag View
  const foldersNavBtn = win.document.querySelector('button[data-nav-id="folders-tags"]') as HTMLButtonElement | null;
  assert.ok(foldersNavBtn, 'Navigasi Folder & tag harus ada');
  await act(async () => {
    foldersNavBtn.click();
  });
  await flushAsync();

  const folderTitle = win.document.querySelector('h1');
  assert.equal(folderTitle?.textContent?.trim(), 'Folder & tag');
  assert.ok(win.document.body.textContent?.includes('Riset Q2'), 'Folder Riset Q2 harus tampil');
  assert.ok(win.document.body.textContent?.includes('roadmap'), 'Tag roadmap harus tampil');

  const newFolderBtn = Array.from(win.document.querySelectorAll('button')).find(b =>
    b.textContent?.includes('Folder baru')
  );
  assert.ok(newFolderBtn, 'Tombol Folder baru harus ada');
  await act(async () => {
    newFolderBtn.click();
  });
  assert.equal(createFolderCalled, true);

  // 4. Penyimpanan View
  const storageNavBtn = win.document.querySelector('button[data-nav-id="storage"]') as HTMLButtonElement | null;
  assert.ok(storageNavBtn, 'Navigasi Penyimpanan harus ada');
  await act(async () => {
    storageNavBtn.click();
  });
  await flushAsync();

  const storageTitle = win.document.querySelector('h1');
  assert.equal(storageTitle?.textContent?.trim(), 'Penyimpanan');
  assert.ok(win.document.body.textContent?.includes('Data dan penyimpanan'), 'Harus merender StorageSection');
});

test('Task 4: Empty workspace onboarding (4 tindakan), sinkronisasi window.location.hash, dan lokalisasi EN', async () => {
  let createProjCalled = false;
  let tryDemoCalled = false;

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
    />
  );
  await flushAsync();

  // 1. Empty state in Workspace overview
  assert.ok(win.document.body.textContent?.includes('Mulai workspace pertama Anda'), 'Judul onboarding empty state harus tampil');
  assert.ok(!win.document.body.textContent?.includes('Review roadmap produk'), 'Tidak boleh ada data palsu saat kosong');

  const emptyCard = win.document.querySelector('.dashboard-empty-state') as HTMLElement | null;
  assert.ok(emptyCard, 'Empty state onboarding harus ada');

  // 4 Actions in empty state
  const emptyRecBtn = Array.from(emptyCard.querySelectorAll('button')).find(b => b.textContent?.includes('Rekam pertemuan'));
  assert.ok(emptyRecBtn, 'Aksi Rekam pertemuan harus ada');
  const emptyOpenBtn = Array.from(emptyCard.querySelectorAll('button')).find(b => b.textContent?.includes('Buka rekaman'));
  assert.ok(emptyOpenBtn, 'Aksi Buka rekaman harus ada');
  const emptyProjBtn = Array.from(emptyCard.querySelectorAll('button')).find(b => b.textContent?.includes('Buat project'));
  assert.ok(emptyProjBtn, 'Aksi Buat project harus ada');
  await act(async () => {
    emptyProjBtn.click();
  });
  assert.equal(createProjCalled, true);

  const emptyDemoBtn = Array.from(emptyCard.querySelectorAll('button')).find(b => b.textContent?.includes('Coba contoh'));
  assert.ok(emptyDemoBtn, 'Aksi Coba contoh harus ada');
  await act(async () => {
    emptyDemoBtn.click();
  });
  assert.equal(tryDemoCalled, true);

  // 2. Hash routing synchronization
  // Setting hash to #studio/projects should switch view to projects
  await act(async () => {
    win.location.hash = '#studio/projects';
    win.dispatchEvent(new win.Event('hashchange'));
  });
  await flushAsync();
  assert.equal(win.document.querySelector('h1')?.textContent?.trim(), 'Projects', 'Hashchange ke #studio/projects harus mengubah view ke Projects');

  // Setting hash to #studio/recordings should switch view to recordings
  await act(async () => {
    win.location.hash = '#studio/recordings';
    win.dispatchEvent(new win.Event('hashchange'));
  });
  await flushAsync();
  assert.equal(win.document.querySelector('h1')?.textContent?.trim(), 'Rekaman', 'Hashchange ke #studio/recordings harus mengubah view ke Rekaman');

  // 3. Localization EN
  await act(async () => {
    setLanguage('en');
    win.location.hash = '#studio';
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
  assert.ok(win.document.body.textContent?.includes('Continue work'), 'Card EN Continue work harus tampil');
  assert.ok(win.document.body.textContent?.includes('Recent in workspace'), 'Section EN Recent in workspace harus tampil');
});
