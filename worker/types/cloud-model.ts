/**
 * Kontrak tipe domain dan DTO cloud Catetin (rename-ready).
 * Mendefinisikan tipe baris database D1 dan objek transfer data (DTO)
 * untuk sinkronisasi delta multi-perangkat, integritas referensial multi-tenant,
 * konkurensi optimistik, dan outbox penghapusan akun berdaya tahan tinggi.
 */

export type ID = string;
export type UnixMs = number;

export type WorkspaceType = 'personal' | 'team';
export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type AudioRetentionTier = '7_days' | '30_days' | 'until_deleted';

export type SyncEntityType =
  | 'project'
  | 'folder'
  | 'recording'
  | 'transcript'
  | 'tag'
  | 'audio_asset'
  | 'speaker'
  | 'recording_tag';

export type SyncOperation = 'upsert' | 'delete';
export type ImportEntityType = 'project' | 'folder' | 'recording';

export type DeletionJobStatus =
  | 'pending'
  | 'deleting_objects'
  | 'purging_d1'
  | 'completed'
  | 'failed';

export type DeletionObjectKind = 'audio_raw' | 'transcript_revision';
export type DeletionObjectStatus = 'pending' | 'deleted' | 'failed';

/**
 * Batas keamanan produk dan periode retensi operasional.
 */
export const PRODUCT_SAFETY_LIMITS = {
  /** Batas keamanan naskah transkrip terserialisasi (1 MB dalam byte UTF-8) */
  MAX_TRANSCRIPT_PAYLOAD_BYTES: 1024 * 1024,
  /** Masa retensi catatan idempotensi mutasi (7 hari) */
  MUTATION_IDEMPOTENCY_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,
  /** Masa retensi catatan tombstone sinkronisasi (30 hari) */
  TOMBSTONE_RETENTION_MS: 30 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Menghitung ukuran byte UTF-8 sebenarnya dari string teks.
 */
export function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Memvalidasi apakah muatan naskah transkrip berada dalam batas keamanan produk (<= 1 MB).
 */
export function isTranscriptPayloadWithinLimit(payloadJson: string): boolean {
  return getUtf8ByteLength(payloadJson) <= PRODUCT_SAFETY_LIMITS.MAX_TRANSCRIPT_PAYLOAD_BYTES;
}

/**
 * Menghasilkan representasi nama tag yang dinormalisasi untuk deduplikasi unik:
 * - trim whitespace luar
 * - collapse whitespace berulang di dalam
 * - lowercase stabil locale
 */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ==========================================
// 1. Tipe Baris Database D1 (Row Representations)
// ==========================================

export interface WorkspaceRow {
  id: ID;
  type: WorkspaceType;
  name: string;
  slug: string;
  personal_owner_user_id: ID | null;
  latest_change_seq: number;
  min_valid_sync_seq: number;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface WorkspaceMembershipRow {
  id: ID;
  workspace_id: ID;
  user_id: ID;
  role: WorkspaceRole;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface ProjectRow {
  id: ID;
  workspace_id: ID;
  name: string;
  description: string | null;
  created_by_user_id: ID;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface FolderRow {
  id: ID;
  workspace_id: ID;
  project_id: ID;
  name: string;
  color: string | null;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface TagRow {
  id: ID;
  workspace_id: ID;
  name: string;
  normalized_name: string;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface RecordingRow {
  id: ID;
  workspace_id: ID;
  project_id: ID | null;
  folder_id: ID | null;
  title: string;
  category: string;
  duration_sec: number;
  created_by_user_id: ID;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface AudioAssetRow {
  id: ID;
  recording_id: ID;
  workspace_id: ID;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  duration_sec: number;
  sha256: string;
  retention_tier: AudioRetentionTier;
  purge_at: UnixMs | null;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface RecordingTagRow {
  id: ID;
  workspace_id: ID;
  recording_id: ID;
  tag_id: ID;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface SpeakerRow {
  id: ID;
  recording_id: ID;
  workspace_id: ID;
  label: string;
  display_name: string;
  color: string | null;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface TranscriptRow {
  id: ID;
  recording_id: ID;
  workspace_id: ID;
  summary_text: string | null;
  segment_count: number;
  word_count: number;
  raw_document_json: string;
  checksum: string;
  version: number;
  last_mutation_id: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  deleted_at: UnixMs | null;
}

export interface TranscriptRevisionRow {
  id: ID;
  transcript_id: ID;
  recording_id: ID;
  workspace_id: ID;
  revision_number: number;
  r2_key: string;
  size_bytes: number;
  checksum: string;
  change_summary: string | null;
  created_by_user_id: ID;
  created_at: UnixMs;
}

export interface WorkspaceChangeLogRow {
  change_seq: number;
  mutation_id: string;
  workspace_id: ID;
  entity_type: SyncEntityType;
  entity_id: ID;
  operation: SyncOperation;
  version: number;
  changed_at: UnixMs;
  client_mutation_id: string;
}

export interface MutationIdempotencyRow {
  id: ID;
  workspace_id: ID;
  user_id: ID;
  client_mutation_id: string;
  payload_hash: string;
  mutation_id: string;
  response_data_json: string | null;
  created_at: UnixMs;
  expires_at: UnixMs;
}

export interface ImportLedgerRow {
  id: ID;
  user_id: ID;
  device_id: string;
  import_batch_id: string;
  entity_type: ImportEntityType;
  local_source_id: string;
  cloud_entity_id: ID;
  created_at: UnixMs;
}

export interface AccountDeletionJobRow {
  id: ID;
  subject_user_id: ID | null;
  status: DeletionJobStatus;
  attempt_count: number;
  last_error: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
  completed_at: UnixMs | null;
}

export interface AccountDeletionObjectRow {
  id: ID;
  deletion_job_id: ID;
  object_kind: DeletionObjectKind;
  object_key: string;
  status: DeletionObjectStatus;
  attempt_count: number;
  last_error: string | null;
  deleted_at: UnixMs | null;
  created_at: UnixMs;
}

// ==========================================
// 2. Data Transfer Objects (DTO) untuk Klien & API
// Privasi: Objek internal R2 key tidak diekspos di DTO publik
// ==========================================

export interface WorkspaceDTO {
  id: ID;
  type: WorkspaceType;
  name: string;
  slug: string;
  role: WorkspaceRole;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface WorkspaceMembershipDTO {
  id: ID;
  workspaceId: ID;
  userId: ID;
  role: WorkspaceRole;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface ProjectDTO {
  id: ID;
  workspaceId: ID;
  name: string;
  description?: string | null;
  version: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface FolderDTO {
  id: ID;
  workspaceId: ID;
  projectId: ID;
  name: string;
  color?: string | null;
  version: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface TagDTO {
  id: ID;
  workspaceId: ID;
  name: string;
  version: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface RecordingDTO {
  id: ID;
  workspaceId: ID;
  projectId: ID | null;
  folderId: ID | null;
  title: string;
  category: string;
  durationSec: number;
  version: number;
  hasAudio: boolean;
  audioRetentionTier?: AudioRetentionTier;
  audioPurgeAt?: UnixMs | null;
  createdAt: UnixMs;
  updatedAt: UnixMs;
  tags: string[];
}

export interface AudioAssetDTO {
  id: ID;
  recordingId: ID;
  workspaceId: ID;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  retentionTier: AudioRetentionTier;
  purgeAt?: UnixMs | null;
  version: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface SpeakerDTO {
  id: ID;
  recordingId: ID;
  workspaceId: ID;
  label: string;
  displayName: string;
  color?: string | null;
  version: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface RecordingTagDTO {
  id: ID;
  workspaceId: ID;
  recordingId: ID;
  tagId: ID;
  version: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface DialogSegmentDTO {
  id: ID;
  speaker: string;
  seconds: number;
  time: string;
  text: string;
}

export interface TranscriptDTO {
  id: ID;
  recordingId: ID;
  workspaceId: ID;
  version: number;
  summaryText?: string | null;
  segmentCount: number;
  wordCount: number;
  checksum: string;
  segments: DialogSegmentDTO[];
  updatedAt: UnixMs;
}

export interface TranscriptRevisionDTO {
  id: ID;
  transcriptId: ID;
  recordingId: ID;
  workspaceId: ID;
  revisionNumber: number;
  sizeBytes: number;
  checksum: string;
  changeSummary?: string | null;
  createdAt: UnixMs;
}

export interface SyncChangeItem {
  changeSeq: number;
  entityType: SyncEntityType;
  entityId: ID;
  operation: SyncOperation;
  version: number;
  changedAt: UnixMs;
  data?: unknown | null;
}

export interface SyncDeltaRequest {
  workspaceId: ID;
  sinceSeq: number;
  limit?: number;
}

export interface SyncDeltaResponse {
  workspaceId: ID;
  latestSeq: number;
  minValidSeq: number;
  hasMore: boolean;
  changes: SyncChangeItem[];
}

export interface FullResyncRequiredResponse {
  error: 'FULL_RESYNC_REQUIRED';
  minValidSeq: number;
  currentSeq: number;
}

export interface AccountDeletionJobDTO {
  id: ID;
  status: DeletionJobStatus;
  attemptCount: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
  completedAt?: UnixMs | null;
}
