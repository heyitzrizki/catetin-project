import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_SAFETY_LIMITS,
  getUtf8ByteLength,
  isTranscriptPayloadWithinLimit,
  normalizeTagName,
  type WorkspaceRole,
  type WorkspaceType,
  type AudioRetentionTier,
  type DeletionJobStatus,
  type DeletionObjectStatus,
  type SyncOperation,
  type SyncEntityType,
  type FolderDTO,
  type TranscriptDTO,
  type RecordingDTO,
  type AudioAssetDTO,
  type TranscriptRevisionDTO,
  type WorkspaceDTO,
  type TagDTO,
  type TagRow,
  type WorkspaceRow,
  type SyncDeltaResponse,
  type FullResyncRequiredResponse,
} from '../../worker/types/cloud-model.js';

test('PRODUCT_SAFETY_LIMITS menetapkan safety limit dan masa retensi yang tepat', () => {
  assert.equal(PRODUCT_SAFETY_LIMITS.MAX_TRANSCRIPT_PAYLOAD_BYTES, 1024 * 1024);
  assert.equal(PRODUCT_SAFETY_LIMITS.MUTATION_IDEMPOTENCY_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(PRODUCT_SAFETY_LIMITS.TOMBSTONE_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
});

test('getUtf8ByteLength menghitung ukuran byte UTF-8 sebenarnya, bukan panjang karakter JS', () => {
  const ascii = 'Catetin Cloud';
  assert.equal(getUtf8ByteLength(ascii), ascii.length);

  const multibyte = 'Catetin 🎙️ Transkripsi 日本語';
  assert.ok(getUtf8ByteLength(multibyte) > multibyte.length);
  assert.equal(getUtf8ByteLength(multibyte), new TextEncoder().encode(multibyte).length);
});

test('isTranscriptPayloadWithinLimit memvalidasi ambang batas 1 MB', () => {
  const safePayload = JSON.stringify({ text: 'a'.repeat(500000) });
  assert.equal(isTranscriptPayloadWithinLimit(safePayload), true);

  const exactOneMb = 'x'.repeat(1024 * 1024);
  assert.equal(isTranscriptPayloadWithinLimit(exactOneMb), true);

  const overOneMb = 'x'.repeat(1024 * 1024 + 1);
  assert.equal(isTranscriptPayloadWithinLimit(overOneMb), false);
});

test('normalizeTagName melakukan trim, collapse internal whitespace, dan lowercase', () => {
  assert.equal(normalizeTagName('   Riset   Produk   '), 'riset produk');
  assert.equal(normalizeTagName('Catetin STUDIO'), 'catetin studio');
  assert.equal(normalizeTagName('  SingleWord  '), 'singleword');
  assert.equal(normalizeTagName('Tab\t\nLineBreak\tSpasi'), 'tab linebreak spasi');
});

test('TagRow memiliki normalized_name sedangkan TagDTO tidak mengeksposnya ke public client', () => {
  const tagRow: TagRow = {
    id: 'tag_1',
    workspace_id: 'ws_1',
    name: 'Riset Desain',
    normalized_name: 'riset desain',
    version: 1,
    last_mutation_id: null,
    created_at: 1730790000000,
    updated_at: 1730790000000,
    deleted_at: null,
  };

  const tagDto: TagDTO = {
    id: 'tag_1',
    workspaceId: 'ws_1',
    name: 'Riset Desain',
    version: 1,
    createdAt: 1730790000000,
    updatedAt: 1730790000000,
  };

  assert.equal(tagRow.normalized_name, 'riset desain');
  assert.equal('normalized_name' in tagDto, false);
  assert.equal('normalizedName' in tagDto, false);
});

test('WorkspaceDTO memakai type personal atau team dan tidak memiliki is_personal', () => {
  const ws: WorkspaceDTO = {
    id: 'ws_1',
    type: 'personal',
    name: 'Ruang Pribadi',
    slug: 'ruang-pribadi',
    role: 'owner',
    createdAt: 1730790000000,
    updatedAt: 1730790000000,
  };

  assert.equal(ws.type, 'personal');
  assert.equal('is_personal' in ws, false);
  assert.equal('isPersonal' in ws, false);
});

test('FolderDTO wajib memiliki projectId dan tidak memiliki properti parent_id', () => {
  const folder: FolderDTO = {
    id: 'fld_1',
    workspaceId: 'ws_1',
    projectId: 'prj_1',
    name: 'Rapat Mingguan',
    color: '#003366',
    version: 1,
    createdAt: 1730790000000,
    updatedAt: 1730790000000,
  };

  assert.equal(folder.projectId, 'prj_1');
  assert.equal('parentId' in folder, false);
  assert.equal('parent_id' in folder, false);
  assert.equal('parentFolderId' in folder, false);
});

test('RecordingDTO tidak mengekspos local_v2_id', () => {
  const recording: RecordingDTO = {
    id: 'rec_1',
    workspaceId: 'ws_1',
    projectId: 'prj_1',
    folderId: 'fld_1',
    title: 'Wawancara Riset',
    category: 'interview',
    durationSec: 120.5,
    version: 1,
    hasAudio: true,
    audioRetentionTier: '30_days',
    audioPurgeAt: 1733382000000,
    createdAt: 1730790000000,
    updatedAt: 1730790000000,
    tags: ['riset', 'produk'],
  };

  assert.equal('local_v2_id' in recording, false);
  assert.equal(recording.folderId, 'fld_1');
});

test('Privacy Boundary: Public DTOs tidak mengekspos raw R2 object key', () => {
  const audioDto: AudioAssetDTO = {
    id: 'aud_1',
    recordingId: 'rec_1',
    workspaceId: 'ws_1',
    filename: 'audio.m4a',
    mimeType: 'audio/mp4',
    sizeBytes: 15000000,
    durationSec: 600,
    retentionTier: '30_days',
    purgeAt: 1733382000000,
    version: 1,
    createdAt: 1730790000000,
    updatedAt: 1730790000000,
  };

  const revDto: TranscriptRevisionDTO = {
    id: 'rev_1',
    transcriptId: 'txn_1',
    recordingId: 'rec_1',
    workspaceId: 'ws_1',
    revisionNumber: 1,
    sizeBytes: 45000,
    checksum: 'sha256-mock',
    changeSummary: 'Autosave',
    createdAt: 1730790000000,
  };

  assert.equal('r2_key' in audioDto, false, 'AudioAssetDTO tidak boleh mengekspos r2_key');
  assert.equal('r2Key' in audioDto, false, 'AudioAssetDTO tidak boleh mengekspos r2Key');
  assert.equal('r2_key' in revDto, false, 'TranscriptRevisionDTO tidak boleh mengekspos r2_key');
  assert.equal('r2Key' in revDto, false, 'TranscriptRevisionDTO tidak boleh mengekspos r2Key');
});

test('Union types mencakup literal yang sah dan tidak memuat indefinite', () => {
  const roles: WorkspaceRole[] = ['owner', 'admin', 'member'];
  const wsTypes: WorkspaceType[] = ['personal', 'team'];
  const retentions: AudioRetentionTier[] = ['7_days', '30_days', 'until_deleted'];
  const deletionStatuses: DeletionJobStatus[] = ['pending', 'deleting_objects', 'purging_d1', 'completed', 'failed'];
  const deletionObjStatuses: DeletionObjectStatus[] = ['pending', 'deleted', 'failed'];
  const operations: SyncOperation[] = ['upsert', 'delete'];
  const entityTypes: SyncEntityType[] = [
    'project',
    'folder',
    'recording',
    'transcript',
    'tag',
    'audio_asset',
    'speaker',
    'recording_tag',
  ];

  assert.equal(roles.length, 3);
  assert.equal(wsTypes.length, 2);
  assert.equal(retentions.length, 3);
  assert.equal(retentions.includes('until_deleted'), true);
  // @ts-expect-error - memastikan indefinite bukan anggota AudioRetentionTier yang sah
  assert.equal(retentions.includes('indefinite'), false);
  assert.equal(deletionStatuses.length, 5);
  assert.equal(deletionObjStatuses.length, 3);
  assert.equal(operations.length, 2);
  assert.equal(entityTypes.length, 8);
});

test('WorkspaceRow memiliki cursor sync sedangkan WorkspaceDTO tidak mengeksposnya', () => {
  const row: WorkspaceRow = {
    id: 'ws_1',
    type: 'team',
    name: 'Workspace Utama',
    slug: 'ws-utama',
    personal_owner_user_id: null,
    latest_change_seq: 120,
    min_valid_sync_seq: 50,
    created_at: 1730790000000,
    updated_at: 1730790000000,
    deleted_at: null,
  };

  assert.equal(row.latest_change_seq, 120);
  assert.equal(row.min_valid_sync_seq, 50);

  const dto: WorkspaceDTO = {
    id: 'ws_1',
    type: 'team',
    name: 'Workspace Utama',
    slug: 'ws-utama',
    role: 'owner',
    createdAt: 1730790000000,
    updatedAt: 1730790000000,
  };

  assert.equal('latest_change_seq' in dto, false);
  assert.equal('min_valid_sync_seq' in dto, false);
  assert.equal('latestChangeSeq' in dto, false);
  assert.equal('minValidSyncSeq' in dto, false);
});

test('SyncDeltaResponse dan FullResyncRequiredResponse menggunakan nama kursor yang konsisten', () => {
  const deltaResp: SyncDeltaResponse = {
    workspaceId: 'ws_1',
    latestSeq: 100,
    minValidSeq: 40,
    hasMore: false,
    changes: [],
  };

  assert.equal(deltaResp.latestSeq, 100);
  assert.equal(deltaResp.minValidSeq, 40);

  const resyncResp: FullResyncRequiredResponse = {
    error: 'FULL_RESYNC_REQUIRED',
    minValidSeq: 40,
    currentSeq: 100,
  };

  assert.equal(resyncResp.error, 'FULL_RESYNC_REQUIRED');
  assert.equal(resyncResp.minValidSeq, 40);
  assert.equal(resyncResp.currentSeq, 100);
  assert.equal('minRetainedSeq' in resyncResp, false);
});
