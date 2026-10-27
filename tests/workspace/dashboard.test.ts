import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  DEFAULT_PROJECT_ID,
  WORKSPACE_DATABASE,
  createProject,
  getWorkspaceStats,
  listProjectSummaries,
  listProjects,
  listRecentRecordings,
  loadWorkspace,
  saveWorkspace,
  type SavedWorkspace,
} from '../../src/features/workspace/workspace-store';
import { recordings as demoRecordings } from '../../src/lib/transcript';

async function deleteDatabase(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await deleteDatabase(WORKSPACE_DATABASE);
});

async function createLegacyV1Database(legacyData: SavedWorkspace) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(WORKSPACE_DATABASE, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('workspace');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    tx.objectStore('workspace').put(legacyData, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

test('project lokal dapat dibuat dan dibaca kembali', async () => {
  const project = await createProject('Wawancara Lapangan');
  assert.ok(project.id.startsWith('project-'));
  assert.equal(project.title, 'Wawancara Lapangan');

  const allProjects = await listProjects();
  assert.equal(allProjects.length, 1);
  assert.equal(allProjects[0].id, project.id);
  assert.equal(allProjects[0].title, 'Wawancara Lapangan');

  const summaries = await listProjectSummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, project.id);
  assert.equal(summaries[0].title, 'Wawancara Lapangan');
  assert.equal(summaries[0].recordingCount, 0);
  assert.equal(summaries[0].totalDurationSec, 0);
});

test('banyak rekaman dapat terkait dengan satu project', async () => {
  const project = await createProject('Riset Q4');

  const workspace: SavedWorkspace = {
    recordings: [
      {
        id: 'rec-riset-1',
        title: 'Sesi Wawancara 1',
        category: 'Wawancara',
        filename: 'sesi1.mp3',
        durationSec: 120,
        projectId: project.id,
        segments: [],
      },
      {
        id: 'rec-riset-2',
        title: 'Sesi Wawancara 2',
        category: 'Wawancara',
        filename: 'sesi2.mp3',
        durationSec: 180,
        projectId: project.id,
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  };

  await saveWorkspace(workspace);

  const summaries = await listProjectSummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, project.id);
  assert.equal(summaries[0].title, 'Riset Q4');
  assert.equal(summaries[0].recordingCount, 2);
  assert.equal(summaries[0].totalDurationSec, 300);

  const recents = await listRecentRecordings();
  assert.equal(recents.length, 2);
  assert.equal(recents[0].projectTitle, 'Riset Q4');
  assert.equal(recents[1].projectTitle, 'Riset Q4');
});

test('sample demo tidak masuk statistik atau history', async () => {
  const workspaceWithDemo: SavedWorkspace = {
    recordings: demoRecordings,
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  };

  await saveWorkspace(workspaceWithDemo);

  const stats = await getWorkspaceStats();
  assert.equal(stats.projectCount, 0);
  assert.equal(stats.recordingCount, 0);
  assert.equal(stats.totalDurationSec, 0);
  assert.equal(stats.lastUpdatedAt, null);

  const summaries = await listProjectSummaries();
  assert.equal(summaries.length, 0);

  const recents = await listRecentRecordings();
  assert.equal(recents.length, 0);
});

test('statistik lokal dihitung benar', async () => {
  const proj1 = await createProject('Project Alpha');
  const proj2 = await createProject('Project Beta');

  await saveWorkspace({
    recordings: [
      {
        id: 'rec-a1',
        title: 'Audio A1',
        category: 'Rapat',
        filename: 'a1.mp3',
        durationSec: 100,
        projectId: proj1.id,
        segments: [],
      },
      {
        id: 'rec-a2',
        title: 'Audio A2',
        category: 'Rapat',
        filename: 'a2.mp3',
        durationSec: 200,
        projectId: proj1.id,
        segments: [],
      },
      {
        id: 'rec-b1',
        title: 'Audio B1',
        category: 'Belajar',
        filename: 'b1.wav',
        durationSec: 300,
        projectId: proj2.id,
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  const stats = await getWorkspaceStats();
  assert.equal(stats.projectCount, 2);
  assert.equal(stats.recordingCount, 3);
  assert.equal(stats.totalDurationSec, 600);
  assert.ok(stats.lastUpdatedAt !== null && stats.lastUpdatedAt > 0);
});

test('membuka project memilih recording yang benar', async () => {
  const projA = await createProject('Project A');
  const projB = await createProject('Project B');

  const recA1 = {
    id: 'rec-a1',
    title: 'Rec A1',
    category: 'Riset',
    filename: 'a1.mp3',
    durationSec: 60,
    projectId: projA.id,
    segments: [],
  };
  const recA2 = {
    id: 'rec-a2',
    title: 'Rec A2',
    category: 'Riset',
    filename: 'a2.mp3',
    durationSec: 120,
    projectId: projA.id,
    segments: [],
  };
  const recB1 = {
    id: 'rec-b1',
    title: 'Rec B1',
    category: 'Riset',
    filename: 'b1.mp3',
    durationSec: 180,
    projectId: projB.id,
    segments: [],
  };

  await saveWorkspace({
    recordings: [recA1, recA2, recB1],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  const loaded = await loadWorkspace();
  assert.ok(loaded);

  // Filter recordings for Project A
  const projectARecordings = loaded.recordings.filter(r => r.projectId === projA.id);
  assert.equal(projectARecordings.length, 2);
  assert.equal(projectARecordings[0].id, 'rec-a1');
  assert.equal(projectARecordings[1].id, 'rec-a2');

  // Filter recordings for Project B
  const projectBRecordings = loaded.recordings.filter(r => r.projectId === projB.id);
  assert.equal(projectBRecordings.length, 1);
  assert.equal(projectBRecordings[0].id, 'rec-b1');
});

test('data lama hasil migrasi tetap dapat tampil', async () => {
  const legacyAudio = new Blob(['legacy-audio-bytes'], { type: 'audio/wav' });
  const legacyWorkspace: SavedWorkspace = {
    recordings: [
      {
        id: 'legacy-rec-1',
        title: 'Legacy Title',
        category: 'Rapat',
        filename: 'rapat.wav',
        durationSec: 90,
        segments: [{ id: 1, time: '00:00', seconds: 0, speaker: 'Dina', text: 'Asli' }],
      },
    ],
    drafts: {
      'legacy-rec-1': [{ id: 1, time: '00:00', seconds: 0, speaker: 'Dina', text: 'Tersunting dari draft' }],
    },
    speakerNames: {
      'legacy-rec-1': { Dina: 'Dina Mardiana' },
    },
    audioFiles: {
      'legacy-rec-1': legacyAudio,
    },
    activeId: 'legacy-rec-1',
    selectedModel: 'base',
  };

  await createLegacyV1Database(legacyWorkspace);

  const summaries = await listProjectSummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, DEFAULT_PROJECT_ID);
  assert.equal(summaries[0].title, 'Rekaman saya');
  assert.equal(summaries[0].recordingCount, 1);
  assert.equal(summaries[0].totalDurationSec, 90);

  const stats = await getWorkspaceStats();
  assert.equal(stats.projectCount, 1);
  assert.equal(stats.recordingCount, 1);
  assert.equal(stats.totalDurationSec, 90);

  const recents = await listRecentRecordings();
  assert.equal(recents.length, 1);
  assert.equal(recents[0].id, 'legacy-rec-1');
  assert.equal(recents[0].title, 'Legacy Title');
  assert.equal(recents[0].projectTitle, 'Rekaman saya');
});
