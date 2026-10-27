import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  DEFAULT_PROJECT_ID,
  WORKSPACE_DATABASE,
  cleanTags,
  createFolder,
  createProject,
  deleteFolder,
  deleteTag,
  listAllTags,
  listFolders,
  loadWorkspace,
  normalizeTag,
  renameFolder,
  renameTag,
  saveWorkspace,
  searchLocalWorkspace,
  setRecordingFolder,
  setRecordingTags,
  type SavedWorkspace,
} from '../../src/features/workspace/workspace-store';

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

test('folder CRUD: membuat, mengganti nama, dan menghapus folder memindahkan rekaman ke tanpa folder', async () => {
  const proj = await createProject('Project Utama');
  const folder = await createFolder(proj.id, 'Wawancara Lapangan');

  assert.equal(folder.name, 'Wawancara Lapangan');
  assert.equal(folder.projectId, proj.id);

  const foldersInitial = await listFolders(proj.id);
  assert.equal(foldersInitial.length, 1);
  assert.equal(foldersInitial[0].id, folder.id);

  // Rename folder
  const renamed = await renameFolder(folder.id, 'Sesi Lapangan');
  assert.equal(renamed.name, 'Sesi Lapangan');

  // Associate recordings with this folder
  await saveWorkspace({
    recordings: [
      {
        id: 'rec-1',
        title: 'Narasumber A',
        category: 'Wawancara',
        filename: 'narasumber_a.mp3',
        durationSec: 60,
        projectId: proj.id,
        folderId: folder.id,
        tags: [],
        segments: [],
      },
      {
        id: 'rec-2',
        title: 'Narasumber B',
        category: 'Wawancara',
        filename: 'narasumber_b.mp3',
        durationSec: 90,
        projectId: proj.id,
        folderId: null,
        tags: [],
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  let loaded = await loadWorkspace();
  assert.ok(loaded);
  const rec1 = loaded.recordings.find(r => r.id === 'rec-1')!;
  assert.equal(rec1.folderId, folder.id);

  // Test setRecordingFolder helper
  await setRecordingFolder('rec-2', folder.id);
  loaded = await loadWorkspace();
  assert.ok(loaded);
  assert.equal(loaded.recordings.find(r => r.id === 'rec-2')?.folderId, folder.id);

  // Delete folder: must NOT delete recordings, but reset folderId to null
  await deleteFolder(folder.id);

  const foldersAfter = await listFolders(proj.id);
  assert.equal(foldersAfter.length, 0);

  loaded = await loadWorkspace();
  assert.ok(loaded);
  assert.equal(loaded.recordings.length, 2);
  assert.equal(loaded.recordings.find(r => r.id === 'rec-1')?.folderId, null);
  assert.equal(loaded.recordings.find(r => r.id === 'rec-2')?.folderId, null);
});

test('tag normalisasi, deduplikasi case-insensitive, dan operasi hapus/rename', async () => {
  // Unit test tag cleaning and normalization
  assert.equal(normalizeTag('  riset   lapangan  '), 'riset lapangan');
  assert.deepEqual(cleanTags(['Riset', ' riset ', 'LAPANGAN', 'Lapangan']), ['Riset', 'LAPANGAN']);

  const proj = await createProject('Project Tag');
  await saveWorkspace({
    recordings: [
      {
        id: 'rec-tag-1',
        title: 'Diskusi Metodologi',
        category: 'Rapat',
        filename: 'metodologi.mp3',
        durationSec: 100,
        projectId: proj.id,
        folderId: null,
        tags: ['Riset', 'Metode'],
        segments: [],
      },
      {
        id: 'rec-tag-2',
        title: 'Uji Coba Lapangan',
        category: 'Rapat',
        filename: 'uji_coba.mp3',
        durationSec: 120,
        projectId: proj.id,
        folderId: null,
        tags: ['riset', 'Validasi'],
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  let allTags = await listAllTags();
  assert.deepEqual(allTags.sort(), ['Metode', 'Riset', 'Validasi'].sort());

  // Set tags on rec-tag-1 with case-insensitive duplicates
  await setRecordingTags('rec-tag-1', ['Metode', ' metode ', 'Kualitatif']);
  let loaded = await loadWorkspace();
  assert.ok(loaded);
  const rec1 = loaded.recordings.find(r => r.id === 'rec-tag-1')!;
  assert.deepEqual(rec1.tags, ['Metode', 'Kualitatif']);

  // Rename tag: 'riset' -> 'Penelitian'
  await renameTag('riset', 'Penelitian');
  loaded = await loadWorkspace();
  assert.ok(loaded);
  const rec2 = loaded.recordings.find(r => r.id === 'rec-tag-2')!;
  assert.ok(rec2.tags && rec2.tags.includes('Penelitian'));
  assert.ok(!rec2.tags || !rec2.tags.includes('riset'));

  // Delete tag: 'Penelitian'
  await deleteTag('penelitian');
  loaded = await loadWorkspace();
  assert.ok(loaded);
  const rec2After = loaded.recordings.find(r => r.id === 'rec-tag-2')!;
  assert.ok(!rec2After.tags || !rec2After.tags.includes('Penelitian'));
  assert.deepEqual(rec2After.tags, ['Validasi']);
  // Recording itself and duration are intact
  assert.equal(rec2After.durationSec, 120);
});

test('pencarian lintas judul, file, project, folder, tag, pembicara, dan isi transkrip', async () => {
  const proj = await createProject('Riset Kesehatan Mental');
  const folder = await createFolder(proj.id, 'Fokus Group');

  await saveWorkspace({
    recordings: [
      {
        id: 'rec-search-1',
        title: 'Wawancara Psikolog',
        category: 'Wawancara',
        filename: 'psikolog_klinis.mp3',
        durationSec: 200,
        projectId: proj.id,
        folderId: folder.id,
        tags: ['Klinis', 'Dewasa'],
        segments: [
          {
            id: 1,
            time: '00:15',
            seconds: 15,
            speaker: 'Spk1',
            text: 'Tantangan terbesar pasien adalah membangun rutinitas istirahat yang teratur.',
          },
        ],
      },
    ],
    drafts: {
      'rec-search-1': [
        {
          id: 1,
          time: '00:15',
          seconds: 15,
          speaker: 'Spk1',
          text: 'Tantangan terbesar pasien adalah membangun rutinitas istirahat yang teratur.',
        },
      ],
    },
    speakerNames: {
      'rec-search-1': {
        Spk1: 'Dr. Handoko',
      },
    },
    audioFiles: {},
  });

  // Search by title (case-insensitive, whitespace normalized)
  let results = await searchLocalWorkspace('  wawancara   psikolog  ');
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedFields.includes('title'));

  // Search by filename
  results = await searchLocalWorkspace('psikolog_klinis');
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedFields.includes('filename'));

  // Search by project name
  results = await searchLocalWorkspace('kesehatan mental');
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedFields.includes('project'));
  assert.equal(results[0].projectTitle, 'Riset Kesehatan Mental');

  // Search by folder name
  results = await searchLocalWorkspace('fokus group');
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedFields.includes('folder'));
  assert.equal(results[0].folderName, 'Fokus Group');

  // Search by tag
  results = await searchLocalWorkspace('klinis');
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedFields.includes('tag'));

  // Search by speaker name
  results = await searchLocalWorkspace('handoko');
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedFields.includes('speaker'));

  // Search by transcript body with snippet verification
  results = await searchLocalWorkspace('rutinitas istirahat');
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedFields.includes('transcript'));
  assert.ok(results[0].snippet);
  assert.ok(results[0].snippet.includes('rutinitas istirahat'));
  assert.equal(results[0].segmentTime, '00:15');

  // Negative test: non-matching search returns empty
  results = await searchLocalWorkspace('astronomi galaksi');
  assert.equal(results.length, 0);

  // Empty query returns empty
  results = await searchLocalWorkspace('   ');
  assert.equal(results.length, 0);
});

test('persistensi folder dan tag setelah save dan reload', async () => {
  const proj = await createProject('Project Persistensi');
  const folder = await createFolder(proj.id, 'Arsip 2026');

  await saveWorkspace({
    recordings: [
      {
        id: 'rec-p1',
        title: 'Rekaman Bertag',
        category: 'Catatan',
        filename: 'p1.m4a',
        durationSec: 80,
        projectId: proj.id,
        folderId: folder.id,
        tags: ['Penting', 'Audit'],
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  // Reload workspace
  const reloaded = await loadWorkspace();
  assert.ok(reloaded);
  assert.equal(reloaded.recordings.length, 1);
  const r = reloaded.recordings[0];
  assert.equal(r.folderId, folder.id);
  assert.deepEqual(r.tags, ['Penting', 'Audit']);
  assert.equal(reloaded.folders?.length, 1);
  assert.equal(reloaded.folders?.[0].name, 'Arsip 2026');
});

test('perlindungan data lama hasil migrasi tetap utuh dengan folder dan tag default', async () => {
  const legacyAudio = new Blob(['audio-sample'], { type: 'audio/wav' });
  const legacyWorkspace: SavedWorkspace = {
    recordings: [
      {
        id: 'legacy-rec-data',
        title: 'Legacy Wawancara',
        category: 'Wawancara',
        filename: 'legacy.wav',
        durationSec: 150,
        segments: [{ id: 1, time: '00:01', seconds: 1, speaker: 'Host', text: 'Halo selamat datang' }],
      },
    ],
    drafts: {
      'legacy-rec-data': [{ id: 1, time: '00:01', seconds: 1, speaker: 'Host', text: 'Halo selamat datang' }],
    },
    speakerNames: {
      'legacy-rec-data': { Host: 'Bambang' },
    },
    audioFiles: {
      'legacy-rec-data': legacyAudio,
    },
    activeId: 'legacy-rec-data',
    selectedModel: 'tiny',
  };

  await createLegacyV1Database(legacyWorkspace);

  const reloaded = await loadWorkspace();
  assert.ok(reloaded);
  assert.equal(reloaded.recordings.length, 1);
  const rec = reloaded.recordings[0];
  assert.equal(rec.id, 'legacy-rec-data');
  assert.equal(rec.projectId, DEFAULT_PROJECT_ID);
  assert.equal(rec.folderId, null);
  assert.deepEqual(rec.tags, []);
  assert.equal(rec.durationSec, 150);

  // Search finding legacy record by text
  const search = await searchLocalWorkspace('selamat datang');
  assert.equal(search.length, 1);
  assert.equal(search[0].recordingId, 'legacy-rec-data');
});
