import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import { zipSync, strToU8, Zip, ZipPassThrough } from 'fflate';
import {
  saveWorkspace,
  loadWorkspace,
  createProject,
  createFolder,
  WORKSPACE_DATABASE,
  type SavedWorkspace,
} from '../../src/features/workspace/workspace-store';
import {
  exportArchive,
  validateArchive,
  importArchive,
  computeSha256,
  CATETIN_ARCHIVE_FORMAT,
  CURRENT_ARCHIVE_VERSION,
} from '../../src/features/workspace/catetin-archive';

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

test('round-trip export dan import satu project tanpa audio', async () => {
  const proj = await createProject('Project Wawancara');
  const folder = await createFolder(proj.id, 'Narasumber A');

  const initialWorkspace: SavedWorkspace = {
    projects: [proj],
    folders: [folder],
    recordings: [
      {
        id: 'rec-test-1',
        projectId: proj.id,
        folderId: folder.id,
        tags: ['Kualitatif'],
        title: 'Sesi Wawancara 1',
        category: 'audio',
        filename: 'wawancara-1.wav',
        durationSec: 150,
        segments: [
          {
            id: 1,
            time: '00:00',
            seconds: 0,
            speaker: 'spk-1',
            text: 'Selamat pagi, apa kabar?',
          },
        ],
      },
    ],
    drafts: {
      'rec-test-1': [
        {
          id: 1,
          time: '00:00',
          seconds: 0,
          speaker: 'spk-1',
          text: 'Selamat pagi, apa kabar?',
        },
      ],
    },
    speakerNames: {
      'rec-test-1': { 'spk-1': 'Budi' },
    },
    audioFiles: {},
  };

  await saveWorkspace(initialWorkspace);

  // Export single project without audio
  const exported = await exportArchive({
    scope: 'project',
    projectId: proj.id,
    includeAudio: false,
  });

  assert.equal(exported.manifest.scope, 'project');
  assert.equal(exported.manifest.projectId, proj.id);
  assert.equal(exported.manifest.includeAudio, false);
  assert.equal(exported.manifest.counts.projects, 1);
  assert.equal(exported.manifest.counts.folders, 1);
  assert.equal(exported.manifest.counts.recordings, 1);
  assert.equal(exported.manifest.counts.audio, 0);
  assert.ok(exported.manifest.checksum.length === 64);
  assert.ok(exported.filename.startsWith('catetin-proyek-project-wawancara-'));
  assert.ok(exported.filename.endsWith('.catetin'));

  // Reset database to simulate clean recovery
  await deleteDatabase(WORKSPACE_DATABASE);

  const arrayBuffer = await exported.blob.arrayBuffer();
  const validation = await validateArchive(arrayBuffer);
  assert.equal(validation.valid, true);

  const importResult = await importArchive(arrayBuffer);
  assert.equal(importResult.success, true);
  assert.equal(importResult.counts.projects, 1);
  assert.equal(importResult.counts.folders, 1);
  assert.equal(importResult.counts.recordings, 1);
  assert.equal(importResult.counts.transcripts, 1);
  assert.equal(importResult.counts.audio, 0);

  // Verify imported data in workspace
  const restoredWorkspace = await loadWorkspace();
  assert.ok(restoredWorkspace);
  assert.equal(restoredWorkspace.projects?.length, 1);
  assert.equal(restoredWorkspace.projects[0].title, 'Project Wawancara');
  assert.equal(restoredWorkspace.folders?.length, 1);
  assert.equal(restoredWorkspace.folders[0].name, 'Narasumber A');
  assert.equal(restoredWorkspace.recordings.length, 1);
  assert.equal(restoredWorkspace.recordings[0].title, 'Sesi Wawancara 1');
  assert.deepEqual(restoredWorkspace.drafts[restoredWorkspace.recordings[0].id], [
    { id: 1, time: '00:00', seconds: 0, speaker: 'spk-1', text: 'Selamat pagi, apa kabar?' },
  ]);
  assert.equal(restoredWorkspace.speakerNames[restoredWorkspace.recordings[0].id]['spk-1'], 'Budi');
});

test('round-trip export dan import seluruh workspace dengan audio dan verifikasi sha256', async () => {
  const p1 = await createProject('Proyek Alfa');
  const p2 = await createProject('Proyek Beta');

  const fakeAudioContent = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const audioBlob = new Blob([fakeAudioContent], { type: 'audio/wav' });

  const initialWorkspace: SavedWorkspace = {
    projects: [p1, p2],
    recordings: [
      {
        id: 'rec-audio-1',
        projectId: p1.id,
        folderId: null,
        tags: ['AudioTest'],
        title: 'Rekaman Audio 1',
        category: 'audio',
        filename: 'alfa.wav',
        durationSec: 10,
        segments: [],
      },
      {
        id: 'rec-audio-2',
        projectId: p2.id,
        folderId: null,
        tags: ['AudioTest2'],
        title: 'Rekaman Audio 2',
        category: 'audio',
        filename: 'beta.wav',
        durationSec: 20,
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {
      'rec-audio-1': audioBlob,
    },
  };

  await saveWorkspace(initialWorkspace);

  // Export full workspace with audio
  const exported = await exportArchive({
    scope: 'workspace',
    includeAudio: true,
  });

  assert.equal(exported.manifest.scope, 'workspace');
  assert.equal(exported.manifest.includeAudio, true);
  assert.equal(exported.manifest.counts.recordings, 2);
  assert.equal(exported.manifest.counts.audio, 1);
  assert.equal(exported.manifest.missingAudioCount, 1);
  assert.ok(exported.warnings.length > 0);

  // Clear database
  await deleteDatabase(WORKSPACE_DATABASE);

  const arrayBuffer = await exported.blob.arrayBuffer();
  const importResult = await importArchive(arrayBuffer);
  assert.equal(importResult.success, true);
  assert.equal(importResult.counts.recordings, 2);
  assert.equal(importResult.counts.audio, 1);

  const restored = await loadWorkspace();
  assert.ok(restored);
  assert.equal(restored.recordings.length, 2);
  const recWithAudio = restored.recordings.find(r => r.title === 'Rekaman Audio 1');
  assert.ok(recWithAudio);
  const restoredBlob = restored.audioFiles[recWithAudio.id];
  assert.ok(restoredBlob);
  assert.equal(restoredBlob.size, 8);
});

test('collision ID diremap tanpa overwrite saat import ke workspace yang sudah berisi', async () => {
  const originalProj = await createProject('Proyek Asli');
  const originalRec = {
    id: 'common-id-rec',
    projectId: originalProj.id,
    folderId: null,
    tags: ['Existing'],
    title: 'Rekaman Asli yang Ada di DB',
    category: 'audio',
    filename: 'asli.wav',
    durationSec: 60,
    segments: [],
  };

  await saveWorkspace({
    projects: [originalProj],
    recordings: [originalRec],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  const archiveData = {
    projects: [{ id: originalProj.id, title: 'Proyek Bertabrakan ID', folderId: null, tags: [], createdAt: 1, updatedAt: 1 }],
    folders: [],
    recordings: [
      {
        id: 'common-id-rec',
        projectId: originalProj.id,
        folderId: null,
        tags: ['ImporBaru'],
        title: 'Rekaman Impor Ber-ID Sama',
        category: 'audio',
        filename: 'impor.wav',
        durationSec: 120,
        sortIndex: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    transcripts: [
      {
        recordingId: 'common-id-rec',
        segments: [{ id: 1, time: '00:00', seconds: 0, speaker: 'spk-x', text: 'Teks impor baru' }],
        speakerNames: { 'spk-x': 'Pembicara Impor' },
        updatedAt: 1,
      },
    ],
  };

  const dataJsonStr = JSON.stringify(archiveData);
  const checksum = await computeSha256(dataJsonStr);

  const archiveToImport = {
    manifest: {
      format: CATETIN_ARCHIVE_FORMAT,
      version: CURRENT_ARCHIVE_VERSION,
      appVersion: '1.0.0',
      exportedAt: Date.now(),
      scope: 'project' as const,
      includeAudio: false,
      counts: { projects: 1, folders: 0, recordings: 1, transcripts: 1, audio: 0 },
      checksum,
    },
    data: archiveData,
  };

  const zipEntries = {
    'manifest.json': strToU8(JSON.stringify(archiveToImport.manifest)),
    'data.json': strToU8(dataJsonStr),
  };
  const binary = zipSync(zipEntries);

  const importResult = await importArchive(binary);
  assert.equal(importResult.success, true);
  assert.equal(importResult.counts.recordings, 1);

  // Verify that BOTH records exist and original was NOT overwritten
  const loaded = await loadWorkspace();
  assert.ok(loaded);
  assert.equal(loaded.recordings.length, 2);

  const existingInDb = loaded.recordings.find(r => r.title === 'Rekaman Asli yang Ada di DB');
  const importedInDb = loaded.recordings.find(r => r.title === 'Rekaman Impor Ber-ID Sama');
  assert.ok(existingInDb);
  assert.ok(importedInDb);
  assert.notEqual(existingInDb.id, importedInDb.id);
  assert.equal(existingInDb.durationSec, 60);
  assert.equal(importedInDb.durationSec, 120);
});

test('checksum mismatch pada data.json atau berkas audio ditolak', async () => {
  const validData = JSON.stringify({ recordings: [] });
  const validChecksum = await computeSha256(validData);

  // 1. data.json checksum mismatch
  const tamperedDataZip = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: CATETIN_ARCHIVE_FORMAT,
        version: CURRENT_ARCHIVE_VERSION,
        checksum: validChecksum,
      })
    ),
    'data.json': strToU8(JSON.stringify({ recordings: [{ id: 'tampered' }] })),
  });
  const resTampered = await validateArchive(tamperedDataZip);
  assert.equal(resTampered.valid, false);
  assert.ok(resTampered.error?.includes('checksum SHA-256 tidak cocok'));

  // 2. Audio checksum mismatch
  const originalAudio = new Uint8Array([1, 2, 3, 4]);
  const audioChecksum = await computeSha256(originalAudio);
  const audioData = {
    recordings: [{ id: 'rec-1', title: 'Rec 1' }],
    audioMeta: [
      {
        recordingId: 'rec-1',
        filename: 'rec-1.wav',
        mimeType: 'audio/wav',
        sizeBytes: 4,
        checksum: audioChecksum,
        pathInZip: 'audio/rec-1.bin',
      },
    ],
  };
  const audioDataStr = JSON.stringify(audioData);
  const audioDataChecksum = await computeSha256(audioDataStr);

  const tamperedAudioPayload = new Uint8Array([9, 9, 9, 9]); // Changed audio bytes!
  const tamperedAudioZip = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: CATETIN_ARCHIVE_FORMAT,
        version: CURRENT_ARCHIVE_VERSION,
        includeAudio: true,
        checksum: audioDataChecksum,
      })
    ),
    'data.json': strToU8(audioDataStr),
    'audio/rec-1.bin': tamperedAudioPayload,
  });

  const resTamperedAudio = await validateArchive(tamperedAudioZip);
  assert.equal(resTamperedAudio.valid, false);
  assert.ok(resTamperedAudio.error?.includes('checksum SHA-256 tidak cocok'));
});

test('path traversal, entry asing, dan duplikasi entry dalam zip ditolak', async () => {
  // 1. Path traversal: ../outside.txt
  const traversalZip1 = zipSync({
    'manifest.json': strToU8('{}'),
    '../outside.txt': strToU8('evil'),
  });
  const resTrav1 = await validateArchive(traversalZip1);
  assert.equal(resTrav1.valid, false);
  assert.ok(resTrav1.error?.includes('path traversal'));

  // 2. Path traversal: backslash Windows style
  const traversalZip2 = zipSync({
    'manifest.json': strToU8('{}'),
    'audio\\rec.bin': strToU8('evil'),
  });
  const resTrav2 = await validateArchive(traversalZip2);
  assert.equal(resTrav2.valid, false);
  assert.ok(resTrav2.error?.includes('path traversal'));

  // 3. Absolute path: /manifest.json
  const traversalZip3 = zipSync({
    '/manifest.json': strToU8('{}'),
  });
  const resTrav3 = await validateArchive(traversalZip3);
  assert.equal(resTrav3.valid, false);
  assert.ok(resTrav3.error?.includes('path traversal'));

  // 4. Foreign entry: not in whitelist (e.g. evil.exe)
  const foreignZip = zipSync({
    'manifest.json': strToU8('{}'),
    'data.json': strToU8('{}'),
    'malware.exe': strToU8('binary'),
  });
  const resForeign = await validateArchive(foreignZip);
  assert.equal(resForeign.valid, false);
  assert.ok(resForeign.error?.includes('Entry tidak dikenal'));

  // 5. Duplicate entry in zip
  const dupChunks: Uint8Array[] = [];
  const zip = new Zip((err, dat, fin) => {
    if (dat) dupChunks.push(dat);
  });
  const f1 = new ZipPassThrough('manifest.json');
  zip.add(f1);
  f1.push(strToU8('{}'), true);
  const f2 = new ZipPassThrough('manifest.json');
  zip.add(f2);
  f2.push(strToU8('{}'), true);
  zip.end();

  const totalLen = dupChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const dupZip = new Uint8Array(totalLen);
  let off = 0;
  for (const c of dupChunks) {
    dupZip.set(c, off);
    off += c.byteLength;
  }

  const resDup = await validateArchive(dupZip);
  assert.equal(resDup.valid, false);
  assert.ok(resDup.error?.includes('Duplikasi entry'));
});

test('archive atau payload melebihi guardrail ditolak sebelum ekstraksi berlebih', async () => {
  const dummyZip = zipSync({
    'manifest.json': strToU8('{}'),
    'data.json': strToU8('{}'),
  });

  // 1. Compressed size guardrail
  const resArchiveSize = await validateArchive(dummyZip, {
    maxArchiveBytes: 50, // limit to 50 bytes (dummyZip is ~250B)
  });
  assert.equal(resArchiveSize.valid, false);
  assert.ok(resArchiveSize.error?.includes('melebihi batas maksimum'));

  // 2. Max entries count guardrail
  const resEntries = await validateArchive(dummyZip, {
    maxEntries: 1, // only allow 1 entry, but zip has 2
  });
  assert.equal(resEntries.valid, false);
  assert.ok(resEntries.error?.includes('melebihi batas aman'));

  // 3. Max single file size guardrail
  const bigFileZip = zipSync({
    'manifest.json': strToU8('{}'),
    'data.json': strToU8('A'.repeat(500)),
  });
  const resSingle = await validateArchive(bigFileZip, {
    maxSingleFileBytes: 200,
  });
  assert.equal(resSingle.valid, false);
  assert.ok(resSingle.error?.includes('melebihi batas aman per berkas'));

  // 4. Max total extracted size guardrail
  const resTotal = await validateArchive(bigFileZip, {
    maxTotalExtractedBytes: 300,
  });
  assert.equal(resTotal.valid, false);
  assert.ok(resTotal.error?.includes('Total ukuran hasil ekstraksi melebihi batas aman'));
});

test('metadata audio yang tidak cocok dengan isi arsip ditolak', async () => {
  // 1. Audio size mismatch (declared 100 bytes, actual 10 bytes)
  const audioBytes = new Uint8Array(10);
  const checksum = await computeSha256(audioBytes);
  const audioData1 = {
    recordings: [{ id: 'rec-1', title: 'Rec 1' }],
    audioMeta: [
      {
        recordingId: 'rec-1',
        filename: 'rec-1.wav',
        mimeType: 'audio/wav',
        sizeBytes: 100, // Mismatch!
        checksum,
        pathInZip: 'audio/rec-1.bin',
      },
    ],
  };
  const jsonStr1 = JSON.stringify(audioData1);
  const chk1 = await computeSha256(jsonStr1);

  const zip1 = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: CATETIN_ARCHIVE_FORMAT,
        version: CURRENT_ARCHIVE_VERSION,
        includeAudio: true,
        checksum: chk1,
      })
    ),
    'data.json': strToU8(jsonStr1),
    'audio/rec-1.bin': audioBytes,
  });

  const res1 = await validateArchive(zip1);
  assert.equal(res1.valid, false);
  assert.ok(res1.error?.includes('tidak cocok dengan metadata'));

  // 2. Audio recordingId not found in recordings
  const audioData2 = {
    recordings: [{ id: 'rec-real', title: 'Rec' }],
    audioMeta: [
      {
        recordingId: 'rec-phantom', // Not in recordings!
        filename: 'phantom.wav',
        mimeType: 'audio/wav',
        sizeBytes: 10,
        checksum,
        pathInZip: 'audio/rec-phantom.bin',
      },
    ],
  };
  const jsonStr2 = JSON.stringify(audioData2);
  const chk2 = await computeSha256(jsonStr2);

  const zip2 = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: CATETIN_ARCHIVE_FORMAT,
        version: CURRENT_ARCHIVE_VERSION,
        includeAudio: true,
        checksum: chk2,
      })
    ),
    'data.json': strToU8(jsonStr2),
    'audio/rec-phantom.bin': audioBytes,
  });

  const res2 = await validateArchive(zip2);
  assert.equal(res2.valid, false);
  assert.ok(res2.error?.includes('tidak ada dalam daftar'));

  // 3. Audio present in zip but manifest declared no audio
  const noAudioManifestData = {
    recordings: [{ id: 'rec-1', title: 'Rec' }],
  };
  const jsonStr3 = JSON.stringify(noAudioManifestData);
  const chk3 = await computeSha256(jsonStr3);
  const zip3 = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: CATETIN_ARCHIVE_FORMAT,
        version: CURRENT_ARCHIVE_VERSION,
        includeAudio: false, // Declared NO audio!
        checksum: chk3,
      })
    ),
    'data.json': strToU8(jsonStr3),
    'audio/rec-1.bin': audioBytes,
  });

  const res3 = await validateArchive(zip3);
  assert.equal(res3.valid, false);
  assert.ok(res3.error?.includes('padahal manifest menyatakan cadangan tanpa audio'));
});

test('workspace existing tetap utuh setelah arsip ditolak karena validasi gagal', async () => {
  const proj = await createProject('Proyek Tetap Utuh');
  await saveWorkspace({
    projects: [proj],
    recordings: [
      {
        id: 'rec-secure',
        projectId: proj.id,
        folderId: null,
        tags: ['Penting'],
        title: 'Rekaman Tidak Boleh Terpengaruh',
        category: 'audio',
        filename: 'aman.wav',
        durationSec: 300,
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  // Try importing malicious traversal archive
  const maliciousZip = zipSync({
    'manifest.json': strToU8('{}'),
    '../hacked.txt': strToU8('bad'),
  });
  const resMalicious = await importArchive(maliciousZip);
  assert.equal(resMalicious.success, false);

  // Try importing checksum mismatch archive
  const corruptZip = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: CATETIN_ARCHIVE_FORMAT,
        version: CURRENT_ARCHIVE_VERSION,
        checksum: 'salah-total',
      })
    ),
    'data.json': strToU8(JSON.stringify({ recordings: [] })),
  });
  const resCorrupt = await importArchive(corruptZip);
  assert.equal(resCorrupt.success, false);

  // Verify workspace is 100% unchanged
  const currentWorkspace = await loadWorkspace();
  assert.ok(currentWorkspace);
  assert.equal(currentWorkspace.projects?.length, 1);
  assert.equal(currentWorkspace.projects[0].title, 'Proyek Tetap Utuh');
  assert.equal(currentWorkspace.recordings.length, 1);
  assert.equal(currentWorkspace.recordings[0].id, 'rec-secure');
  assert.equal(currentWorkspace.recordings[0].durationSec, 300);
});

test('kegagalan saat transaksi import membatalkan seluruh operasi tanpa data parsial', async () => {
  const proj = await createProject('Data Awal Aman');
  await saveWorkspace({
    projects: [proj],
    recordings: [
      {
        id: 'rec-existing',
        projectId: proj.id,
        folderId: null,
        tags: [],
        title: 'Tetap Utuh',
        category: 'audio',
        filename: 'utuh.wav',
        durationSec: 10,
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {},
  });

  const validData = {
    projects: [{ id: 'p-new', title: 'Proyek yang Gagal', folderId: null, tags: [], createdAt: 1, updatedAt: 1 }],
    folders: [],
    recordings: [
      {
        id: 'r-new',
        projectId: 'p-new',
        folderId: null,
        tags: [],
        title: 'Rekaman yang Gagal Masuk',
        category: 'audio',
        filename: 'gagal.wav',
        durationSec: 50,
        sortIndex: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    transcripts: [],
  };

  const validDataStr = JSON.stringify(validData);
  const checksum = await computeSha256(validDataStr);

  const validZipEntries = {
    'manifest.json': strToU8(
      JSON.stringify({
        format: CATETIN_ARCHIVE_FORMAT,
        version: CURRENT_ARCHIVE_VERSION,
        scope: 'workspace',
        includeAudio: false,
        counts: { projects: 1, folders: 0, recordings: 1, transcripts: 0, audio: 0 },
        checksum,
      })
    ),
    'data.json': strToU8(validDataStr),
  };
  const binary = zipSync(validZipEntries);

  // Trigger simulated error during import transaction
  const result = await importArchive(binary, {
    onBeforeCommit: () => {
      throw new Error('Simulasi kegagalan di tengah transaksi IndexedDB');
    },
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes('Simulasi kegagalan'));

  // Verify that the workspace is identical to before the import
  const currentWorkspace = await loadWorkspace();
  assert.ok(currentWorkspace);
  assert.equal(currentWorkspace.recordings.length, 1);
  assert.equal(currentWorkspace.recordings[0].title, 'Tetap Utuh');
  assert.equal(currentWorkspace.projects?.length, 1);
  assert.equal(currentWorkspace.projects[0].title, 'Data Awal Aman');
});

test('exporter menolak arsip yang melampaui guardrail sehingga tidak menghasilkan arsip yang tak dapat di-import', async () => {
  const proj = await createProject('Proyek Raksasa');
  const oversizedAudio = new Uint8Array(500); // 500 bytes
  const audioBlob = new Blob([oversizedAudio], { type: 'audio/wav' });

  await saveWorkspace({
    projects: [proj],
    recordings: [
      {
        id: 'rec-big',
        projectId: proj.id,
        folderId: null,
        tags: [],
        title: 'Audio Terlalu Besar',
        category: 'audio',
        filename: 'big.wav',
        durationSec: 10,
        segments: [],
      },
    ],
    drafts: {},
    speakerNames: {},
    audioFiles: {
      'rec-big': audioBlob,
    },
  });

  // 1. Single audio size guardrail rejection
  await assert.rejects(
    async () => {
      await exportArchive({
        scope: 'workspace',
        includeAudio: true,
        limits: {
          maxSingleFileBytes: 100, // audio blob is 500 bytes -> exceeds!
        },
      });
    },
    (err: any) => {
      assert.ok(err.message.includes('melampaui batas aman per berkas'));
      assert.ok(err.message.includes('cadangan ringan tanpa audio'));
      return true;
    }
  );

  // 2. Entries count guardrail rejection
  await assert.rejects(
    async () => {
      await exportArchive({
        scope: 'workspace',
        includeAudio: true,
        limits: {
          maxEntries: 2, // 2 base (manifest+data) + 1 audio = 3 -> exceeds!
        },
      });
    },
    (err: any) => {
      assert.ok(err.message.includes('melampaui batas aman cadangan'));
      assert.ok(err.message.includes('Ekspor per-project secara terpisah'));
      return true;
    }
  );

  // 3. Total uncompressed size guardrail rejection
  await assert.rejects(
    async () => {
      await exportArchive({
        scope: 'workspace',
        includeAudio: true,
        limits: {
          maxTotalExtractedBytes: 200, // total bytes exceeds 200B
        },
      });
    },
    (err: any) => {
      assert.ok(err.message.includes('melampaui batas aman'));
      return true;
    }
  );
});
