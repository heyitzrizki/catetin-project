-- Migration 0004_cloud_workspace_data_model.sql
-- Cloud Workspace Data Model: multi-tenant workspace, projects, project-scoped flat folders,
-- recordings, canonical transcripts, monotonic change logs, mutation idempotency,
-- import ledger, and durable account deletion outbox.

-- 1. Workspace (Multi-tenant container)
CREATE TABLE IF NOT EXISTS workspace (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('personal', 'team')),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    personal_owner_user_id TEXT UNIQUE,
    latest_change_seq INTEGER NOT NULL DEFAULT 0,
    min_valid_sync_seq INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    CHECK ((type = 'personal' AND personal_owner_user_id IS NOT NULL) OR (type = 'team' AND personal_owner_user_id IS NULL)),
    CHECK (min_valid_sync_seq >= 0 AND latest_change_seq >= min_valid_sync_seq),
    FOREIGN KEY (personal_owner_user_id) REFERENCES "user"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_workspace_deleted_at ON workspace(deleted_at);

-- 2. Workspace Membership (Role-Based Access Control)
CREATE TABLE IF NOT EXISTS workspace_membership (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES "user"("id") ON DELETE CASCADE,
    UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_membership_user ON workspace_membership(user_id);

-- Enforce at least one owner remains in team workspace
CREATE TRIGGER IF NOT EXISTS trg_prevent_last_owner_removal
BEFORE DELETE ON workspace_membership
WHEN OLD.role = 'owner'
BEGIN
  SELECT RAISE(ABORT, 'LAST_OWNER_REQUIRED: cannot remove last owner of team workspace')
  WHERE (
    SELECT COUNT(*) FROM workspace_membership
    WHERE workspace_id = OLD.workspace_id AND role = 'owner'
  ) <= 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_last_owner_demotion
BEFORE UPDATE OF role ON workspace_membership
WHEN OLD.role = 'owner' AND NEW.role != 'owner'
BEGIN
  SELECT RAISE(ABORT, 'LAST_OWNER_REQUIRED: cannot demote last owner of team workspace')
  WHERE (
    SELECT COUNT(*) FROM workspace_membership
    WHERE workspace_id = OLD.workspace_id AND role = 'owner'
  ) <= 1;
END;

-- 3. Project
CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_by_user_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES "user"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_project_workspace_updated ON project(workspace_id, updated_at DESC);

-- 4. Folder (Flat single-level hierarchy per project, no nested folders)
CREATE TABLE IF NOT EXISTS folder (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE (workspace_id, project_id, id),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, project_id) REFERENCES project(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_folder_workspace_updated ON folder(workspace_id, updated_at DESC);

-- 5. Tag
CREATE TABLE IF NOT EXISTS tag (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, normalized_name),
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

-- 6. Recording (Metadata induk rekaman)
CREATE TABLE IF NOT EXISTS recording (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT,
    folder_id TEXT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    duration_sec REAL NOT NULL DEFAULT 0.0,
    created_by_user_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    CHECK (folder_id IS NULL OR project_id IS NOT NULL),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, project_id) REFERENCES project(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (folder_id) REFERENCES folder(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES "user"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_recording_workspace_updated ON recording(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recording_workspace_project ON recording(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_recording_workspace_folder ON recording(workspace_id, folder_id);

-- Enforce that recording with a folder must point to a folder from the same workspace and project
CREATE TRIGGER IF NOT EXISTS trg_recording_folder_check_ins
BEFORE INSERT ON recording
WHEN NEW.folder_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: folder does not belong to same workspace and project')
  WHERE NOT EXISTS (
    SELECT 1 FROM folder f
    WHERE f.id = NEW.folder_id
      AND f.workspace_id = NEW.workspace_id
      AND (NEW.project_id IS NOT NULL AND f.project_id = NEW.project_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_recording_folder_check_upd
BEFORE UPDATE OF folder_id, project_id, workspace_id ON recording
WHEN NEW.folder_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: folder does not belong to same workspace and project')
  WHERE NOT EXISTS (
    SELECT 1 FROM folder f
    WHERE f.id = NEW.folder_id
      AND f.workspace_id = NEW.workspace_id
      AND (NEW.project_id IS NOT NULL AND f.project_id = NEW.project_id)
  );
END;

-- 7. Audio Asset (Metadata biner di Cloudflare R2 dengan siklus retensi mandiri)
CREATE TABLE IF NOT EXISTS audio_asset (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_sec REAL NOT NULL,
    sha256 TEXT NOT NULL,
    retention_tier TEXT NOT NULL DEFAULT '30_days' CHECK(retention_tier IN ('7_days', '30_days', 'until_deleted')),
    purge_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    CHECK (
      (retention_tier = 'until_deleted' AND purge_at IS NULL)
      OR
      (retention_tier IN ('7_days', '30_days') AND purge_at IS NOT NULL)
    ),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, recording_id) REFERENCES recording(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audio_purge ON audio_asset(purge_at);

-- 8. Recording Tag (Syncable many-to-many relationship)
CREATE TABLE IF NOT EXISTS recording_tag (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    recording_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE (recording_id, tag_id),
    FOREIGN KEY (workspace_id, recording_id) REFERENCES recording(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, tag_id) REFERENCES tag(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rec_tag_tag ON recording_tag(tag_id);

-- 9. Speaker (Katalog pembicara per rekaman)
CREATE TABLE IF NOT EXISTS speaker (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    label TEXT NOT NULL,
    display_name TEXT NOT NULL,
    color TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE (workspace_id, id),
    UNIQUE (recording_id, label),
    FOREIGN KEY (workspace_id, recording_id) REFERENCES recording(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_speaker_recording ON speaker(recording_id);

-- 10. Transcript (Dokumen kanonikal aktif di D1)
CREATE TABLE IF NOT EXISTS transcript (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    summary_text TEXT,
    segment_count INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    raw_document_json TEXT NOT NULL,
    checksum TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    last_mutation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, recording_id),
    UNIQUE (workspace_id, id, recording_id),
    FOREIGN KEY (workspace_id, recording_id) REFERENCES recording(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transcript_workspace ON transcript(workspace_id);

-- 11. Transcript Revision (Metadata checkpoint / riwayat versi untuk R2)
CREATE TABLE IF NOT EXISTS transcript_revision (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL,
    recording_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    change_summary TEXT,
    created_by_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (transcript_id, revision_number),
    FOREIGN KEY (workspace_id, transcript_id, recording_id) REFERENCES transcript(workspace_id, id, recording_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES "user"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_revision_transcript ON transcript_revision(transcript_id, revision_number DESC);

-- 12. Workspace Change Log (Log urutan mutasi monotonik per workspace)
CREATE TABLE IF NOT EXISTS workspace_change_log (
    change_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'folder', 'recording', 'transcript', 'tag', 'audio_asset', 'speaker', 'recording_tag')),
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
    version INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    client_mutation_id TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_change_log_lookup ON workspace_change_log(workspace_id, change_seq ASC);
CREATE INDEX IF NOT EXISTS idx_change_log_mutation ON workspace_change_log(workspace_id, client_mutation_id);

-- 13. Mutation Idempotency (Pencegah duplikasi mutasi, retensi 7 hari)
CREATE TABLE IF NOT EXISTS mutation_idempotency (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    client_mutation_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    response_data_json TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES "user"("id") ON DELETE CASCADE,
    FOREIGN KEY (mutation_id) REFERENCES workspace_change_log(mutation_id) ON DELETE CASCADE,
    UNIQUE (workspace_id, user_id, client_mutation_id)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON mutation_idempotency(expires_at);

-- 14. Import Ledger (Pelacak deduplikasi impor draf lokal, scoped per device & entity type)
CREATE TABLE IF NOT EXISTS import_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    import_batch_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('project', 'folder', 'recording')),
    local_source_id TEXT NOT NULL,
    cloud_entity_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES "user"("id") ON DELETE CASCADE,
    UNIQUE (user_id, device_id, entity_type, local_source_id)
);

-- 15. Account Deletion Job (Induk pekerjaan penghapusan akun yang dapat bertahan hidup tanpa user)
CREATE TABLE IF NOT EXISTS account_deletion_job (
    id TEXT PRIMARY KEY,
    subject_user_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'deleting_objects', 'purging_d1', 'completed', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deletion_job_status ON account_deletion_job(status);

-- 16. Account Deletion Object (Rincian per objek R2 yang wajib dibersihkan)
CREATE TABLE IF NOT EXISTS account_deletion_object (
    id TEXT PRIMARY KEY,
    deletion_job_id TEXT NOT NULL,
    object_kind TEXT NOT NULL CHECK(object_kind IN ('audio_raw', 'transcript_revision')),
    object_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'deleted', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (deletion_job_id) REFERENCES account_deletion_job(id) ON DELETE CASCADE,
    UNIQUE (deletion_job_id, object_key)
);
CREATE INDEX IF NOT EXISTS idx_deletion_obj_status ON account_deletion_object(deletion_job_id, status);
