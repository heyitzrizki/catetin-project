import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  DEFAULT_PROJECT_ID,
  WORKSPACE_DATABASE,
  WORKSPACE_DB_VERSION,
  loadWorkspace,
  migrateLegacyWorkspace,
  openWorkspaceDatabase,
  saveWorkspace,
  type ProjectRecord,
  type RecordingRecord,
  type SavedWorkspace,
  type TranscriptRecord,
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

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

test('fresh workspace save and load works seamlessly', async () => {
  const initial = await loadWorkspace();
  assert.equal(initial, null);

  const sampleAudio = new Blob(['sample-audio-data'], { type: 'audio/mp3' });
  const toSave: SavedWorkspace = {
    recordings: [
      {
        id: 'rec-1',
        title: 'Interview 1',
        category: 'Wawancara',
        filename: 'int1.mp3',
        durationSec: 120,
        segments: [{ id: 1, time: '00:01', seconds: 1, speaker: 'Host', text: 'Halo selamat datang' }],
      },
      {
        id: 'rec-2',
        title: 'Lecture 2',
        category: 'Belajar',
        filename: 'lec2.mp3',
        durationSec: 300,
        segments: [{ id: 1, time: '00:05', seconds: 5, speaker: 'Prof', text: 'Materi hari ini' }],
      },
    ],
    drafts: {
      'rec-1': [{ id: 1, time: '00:01', seconds: 1, speaker: 'Host', text: 'Halo selamat datang (draft edit)' }],
    },
    speakerNames: {
      'rec-1': { Host: 'Budi' },
    },
    audioFiles: {
      'rec-1': sampleAudio,
    },
    activeId: 'rec-1',
    selectedModel: 'tiny',
  };

  await saveWorkspace(toSave);

  const loaded = await loadWorkspace();
  assert.ok(loaded);
  assert.equal(loaded.recordings.length, 2);
  assert.equal(loaded.activeId, 'rec-1');
  assert.equal(loaded.selectedModel, 'tiny');

  const loadedRec1 = loaded.recordings.find(r => r.id === 'rec-1')!;
  assert.ok(loadedRec1);
  assert.equal(loadedRec1.title, 'Interview 1');
  assert.equal(loadedRec1.projectId, DEFAULT_PROJECT_ID);
  assert.equal(loadedRec1.folderId, null);
  assert.deepEqual(loadedRec1.tags, []);
  assert.ok((loadedRec1.createdAt ?? 0) > 0);
  assert.ok((loadedRec1.updatedAt ?? 0) > 0);
  assert.equal(loadedRec1.segments[0].text, 'Halo selamat datang (draft edit)');

  assert.equal(loaded.drafts['rec-1'][0].text, 'Halo selamat datang (draft edit)');
  assert.deepEqual(loaded.speakerNames['rec-1'], { Host: 'Budi' });

  assert.ok(loaded.audioFiles['rec-1']);
  const loadedAudioText = await loaded.audioFiles['rec-1'].text();
  assert.equal(loadedAudioText, 'sample-audio-data');
});

test('migrates legacy v1 database to normalized v2 stores without data loss', async () => {
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

  // Calling loadWorkspace() triggers migration
  const migrated = await loadWorkspace();
  assert.ok(migrated);
  assert.equal(migrated.activeId, 'legacy-rec-1');
  assert.equal(migrated.selectedModel, 'base');
  assert.equal(migrated.recordings.length, 1);
  assert.equal(migrated.recordings[0].id, 'legacy-rec-1');
  assert.equal(migrated.recordings[0].projectId, DEFAULT_PROJECT_ID);
  assert.equal(migrated.recordings[0].title, 'Legacy Title');
  assert.equal(migrated.recordings[0].segments[0].text, 'Tersunting dari draft');
  assert.deepEqual(migrated.speakerNames['legacy-rec-1'], { Dina: 'Dina Mardiana' });

  const restoredAudioText = await migrated.audioFiles['legacy-rec-1'].text();
  assert.equal(restoredAudioText, 'legacy-audio-bytes');

  // Verify internal normalized store contents directly
  const db = await openWorkspaceDatabase();
  try {
    const tx = db.transaction(['workspace', 'projects', 'recordings', 'transcripts', 'audio', 'meta'], 'readonly');
    const legacyEntry = await req(tx.objectStore('workspace').get('current'));
    assert.equal(legacyEntry, undefined, 'legacy key current must be removed');

    const defaultProject = await req(tx.objectStore('projects').get(DEFAULT_PROJECT_ID)) as ProjectRecord;
    assert.ok(defaultProject, 'default project must exist');
    assert.equal(defaultProject.id, DEFAULT_PROJECT_ID);

    const recordingRecords = await req(tx.objectStore('recordings').getAll()) as RecordingRecord[];
    assert.equal(recordingRecords.length, 1);
    assert.equal(recordingRecords[0].id, 'legacy-rec-1');
    assert.equal(recordingRecords[0].projectId, DEFAULT_PROJECT_ID);

    const transcriptRecords = await req(tx.objectStore('transcripts').getAll()) as TranscriptRecord[];
    assert.equal(transcriptRecords.length, 1);
    assert.equal(transcriptRecords[0].recordingId, 'legacy-rec-1');
    assert.equal(transcriptRecords[0].segments[0].text, 'Tersunting dari draft');
    assert.deepEqual(transcriptRecords[0].speakerNames, { Dina: 'Dina Mardiana' });

    const schemaMeta = await req(tx.objectStore('meta').get('schema')) as { version: number; migratedFromLegacy: boolean };
    assert.ok(schemaMeta);
    assert.equal(schemaMeta.version, WORKSPACE_DB_VERSION);
    assert.equal(schemaMeta.migratedFromLegacy, true);
  } finally {
    db.close();
  }
});

test('migration is idempotent and does not overwrite or duplicate on subsequent runs', async () => {
  const legacyWorkspace: SavedWorkspace = {
    recordings: [
      {
        id: 'rec-idem',
        title: 'Idempotency Test',
        category: 'Catatan',
        filename: 'idem.m4a',
        durationSec: 45,
        segments: [{ id: 1, time: '00:00', seconds: 0, speaker: 'S1', text: 'Halo' }],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  };

  await createLegacyV1Database(legacyWorkspace);

  const db = await openWorkspaceDatabase();
  try {
    await migrateLegacyWorkspace(db);

    const tx1 = db.transaction(['recordings', 'meta'], 'readonly');
    const initialRecordings = await req(tx1.objectStore('recordings').getAll()) as RecordingRecord[];
    const initialSchema = await req(tx1.objectStore('meta').get('schema'));

    assert.equal(initialRecordings.length, 1);

    // Run migration second time on same database
    await migrateLegacyWorkspace(db);

    const tx2 = db.transaction(['recordings', 'meta'], 'readonly');
    const secondRecordings = await req(tx2.objectStore('recordings').getAll()) as RecordingRecord[];
    const secondSchema = await req(tx2.objectStore('meta').get('schema'));

    assert.deepEqual(initialRecordings, secondRecordings);
    assert.deepEqual(initialSchema, secondSchema);
  } finally {
    db.close();
  }
});

test('transaction rolls back cleanly if migration is interrupted before commit', async () => {
  const legacyWorkspace: SavedWorkspace = {
    recordings: [
      {
        id: 'rec-rollback',
        title: 'Rollback Test',
        category: 'Test',
        filename: 'rollback.mp3',
        durationSec: 60,
        segments: [{ id: 1, time: '00:00', seconds: 0, speaker: 'S1', text: 'Asli' }],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
    activeId: 'rec-rollback',
  };

  await createLegacyV1Database(legacyWorkspace);

  const db = await openWorkspaceDatabase();
  try {
    // Interrupted migration throws on onBeforeCommit
    await assert.rejects(
      async () => {
        await migrateLegacyWorkspace(db, {
          onBeforeCommit: () => {
            throw new Error('Simulated crash during migration');
          },
        });
      },
      /Simulated crash during migration/,
    );

    // Verify rollback: legacy record untouched, meta.schema not written
    const tx = db.transaction(['workspace', 'recordings', 'meta'], 'readonly');
    const legacyAfterCrash = await req(tx.objectStore('workspace').get('current')) as SavedWorkspace;
    assert.ok(legacyAfterCrash, 'legacy record must still exist after abort');
    assert.equal(legacyAfterCrash.recordings[0].id, 'rec-rollback');

    const schemaAfterCrash = await req(tx.objectStore('meta').get('schema'));
    assert.equal(schemaAfterCrash, undefined, 'schema marker must not exist after abort');

    const recordingsAfterCrash = await req(tx.objectStore('recordings').getAll());
    assert.equal(recordingsAfterCrash.length, 0, 'recordings store must be empty after abort');

    // Subsequent normal migration succeeds
    await migrateLegacyWorkspace(db);

    const txClean = db.transaction(['workspace', 'recordings', 'meta'], 'readonly');
    const legacyAfterClean = await req(txClean.objectStore('workspace').get('current'));
    assert.equal(legacyAfterClean, undefined, 'legacy key deleted after clean migration');

    const schemaAfterClean = await req(txClean.objectStore('meta').get('schema'));
    assert.ok(schemaAfterClean, 'schema marker exists after clean migration');
  } finally {
    db.close();
  }
});
