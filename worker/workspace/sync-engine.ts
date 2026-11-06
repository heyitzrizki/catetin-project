/**
 * Mesin sinkronisasi delta monotonik dan penegakan idempotensi mutasi cloud Catetin.
 * Menjamin urutan mutasi total, integritas tombstone tanpa kebangkitan entitas terhapus,
 * pencegahan race condition pada idempotensi konkuren, dan snapshot pembacaan delta yang konsisten.
 */

import {
  PRODUCT_SAFETY_LIMITS,
  normalizeTagName,
  type SyncChangeItem,
  type SyncEntityType,
  type SyncOperation,
} from '../types/cloud-model.ts';
import type { D1DatabaseLike, D1PreparedStatementLike } from './db-types.ts';
import { WorkspaceDomainError } from './workspace-errors.ts';
import { getWorkspaceAccess } from './workspace-auth.ts';

/**
 * Menghasilkan representasi string JSON yang terurut secara deterministik (rekursif)
 * agar payload yang identik menghasilkan hash kanonikal yang sama terlepas dari urutan key objek.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((key) => {
    const val = (value as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalizeJson(val);
  });
  return '{' + entries.join(',') + '}';
}

/**
 * Menghitung hash SHA-256 heksadesimal deterministik dari muatan payload.
 */
export async function hashCanonicalPayload(payload: unknown): Promise<string> {
  const canonical = canonicalizeJson(payload);
  const data = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type TypedDomainMutationAction = 'insert' | 'update' | 'delete';

export interface TypedDomainMutationPlan {
  action: TypedDomainMutationAction;
  attributes?: Record<string, unknown>;
}

export interface AppendWorkspaceChangeParams<T = unknown> {
  workspaceId: string;
  userId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  expectedVersion?: number;
  data?: T | null;
  mutation: {
    clientMutationId: string;
    payload: unknown;
  };
  domainPlan: TypedDomainMutationPlan;
}

export interface AppendWorkspaceChangeResult {
  changeSeq: number;
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  version: number;
  changedAt: number;
  data?: unknown;
}

const SYNCABLE_TABLE_MAP: Record<SyncEntityType, string> = {
  project: 'project',
  folder: 'folder',
  recording: 'recording',
  transcript: 'transcript',
  tag: 'tag',
  audio_asset: 'audio_asset',
  speaker: 'speaker',
  recording_tag: 'recording_tag',
};

interface EntitySchemaRule {
  insertRequired: string[];
  insertAllowed: string[];
  updateAllowed: string[];
  autoUserId?: boolean;
  computeFields?: (attrs: Record<string, unknown>) => Record<string, unknown>;
}

const ENTITY_RULES: Record<SyncEntityType, EntitySchemaRule> = {
  project: {
    insertRequired: ['name'],
    insertAllowed: ['name', 'description'],
    updateAllowed: ['name', 'description'],
    autoUserId: true,
  },
  folder: {
    insertRequired: ['project_id', 'name'],
    insertAllowed: ['project_id', 'name', 'color'],
    updateAllowed: ['name', 'color'],
  },
  tag: {
    insertRequired: ['name'],
    insertAllowed: ['name', 'normalized_name'],
    updateAllowed: ['name', 'normalized_name'],
    computeFields: (attrs) => ({
      normalized_name: normalizeTagName(String(attrs.name ?? attrs.normalized_name ?? '')),
    }),
  },
  recording: {
    insertRequired: ['title'],
    insertAllowed: ['title', 'category', 'duration_sec', 'project_id', 'folder_id'],
    updateAllowed: ['title', 'category', 'duration_sec', 'folder_id'],
    autoUserId: true,
  },
  audio_asset: {
    insertRequired: [
      'recording_id',
      'r2_key',
      'filename',
      'mime_type',
      'size_bytes',
      'duration_sec',
      'sha256',
    ],
    insertAllowed: [
      'recording_id',
      'r2_key',
      'filename',
      'mime_type',
      'size_bytes',
      'duration_sec',
      'sha256',
      'retention_tier',
      'purge_at',
    ],
    updateAllowed: ['retention_tier', 'purge_at'],
  },
  recording_tag: {
    insertRequired: ['recording_id', 'tag_id'],
    insertAllowed: ['recording_id', 'tag_id'],
    updateAllowed: [],
  },
  speaker: {
    insertRequired: ['recording_id', 'label', 'display_name'],
    insertAllowed: ['recording_id', 'label', 'display_name', 'color'],
    updateAllowed: ['display_name', 'color'],
  },
  transcript: {
    insertRequired: ['recording_id', 'raw_document_json', 'checksum'],
    insertAllowed: [
      'recording_id',
      'raw_document_json',
      'checksum',
      'summary_text',
      'segment_count',
      'word_count',
    ],
    updateAllowed: [
      'raw_document_json',
      'checksum',
      'summary_text',
      'segment_count',
      'word_count',
    ],
  },
};

/**
 * Menambahkan perubahan ke log mutasi workspace secara atomik dalam satu batch transaksi.
 * Seluruh penegakan (idempotensi, CAS, tombstone, otorisasi commit-time, dan latest_change_seq)
 * dieksekusi secara transaksional tanpa langkah perbaikan pasca-commit.
 */
export async function appendWorkspaceChange(
  db: D1DatabaseLike,
  params: AppendWorkspaceChangeParams
): Promise<AppendWorkspaceChangeResult> {
  // 1. Validasi keberadaan clientMutationId
  if (!params.mutation?.clientMutationId) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'clientMutationId wajib diisi untuk mutasi ruang kerja cloud'
    );
  }

  // 2. Validasi kewajiban domainPlan
  if (!params.domainPlan) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'domainPlan wajib disertakan untuk mutasi data ruang kerja'
    );
  }

  const { action } = params.domainPlan;
  const rawAttrs = params.domainPlan.attributes ?? {};

  // 3. Validasi pemetaan action ke operation
  if (action === 'insert' || action === 'update') {
    if (params.operation !== 'upsert') {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Operasi tidak valid: aksi ${action} harus dipasangkan dengan operasi upsert`
      );
    }
  } else if (action === 'delete') {
    if (params.operation !== 'delete') {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Operasi tidak valid: aksi delete harus dipasangkan dengan operasi delete'
      );
    }
  } else {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      `Aksi mutasi domain tidak dikenali: ${action}`
    );
  }

  const tableName = SYNCABLE_TABLE_MAP[params.entityType];
  const rule = ENTITY_RULES[params.entityType];
  if (!tableName || !rule) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      `Tipe entitas tidak dikenali: ${params.entityType}`
    );
  }

  // 4. Validasi allowlist atribut per-entity dan action
  if (action === 'insert') {
    for (const req of rule.insertRequired) {
      if (rawAttrs[req] === undefined || rawAttrs[req] === null) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          `Kolom wajib '${req}' belum disertakan untuk entitas '${params.entityType}'`
        );
      }
    }
    for (const key of Object.keys(rawAttrs)) {
      if (!rule.insertAllowed.includes(key)) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          `Kolom '${key}' tidak diizinkan untuk insert pada entitas '${params.entityType}'`
        );
      }
    }
  } else if (action === 'update') {
    for (const key of Object.keys(rawAttrs)) {
      if (!rule.updateAllowed.includes(key)) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          `Kolom '${key}' tidak diizinkan untuk update pada entitas '${params.entityType}'`
        );
      }
    }
  } else if (action === 'delete') {
    if (Object.keys(rawAttrs).length > 0) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Aksi delete tidak menerima atribut tambahan pada entitas '${params.entityType}'`
      );
    }
  }

  // 4b. Validasi aturan ketat CAS expectedVersion (tidak boleh ada last-write-wins)
  if (action === 'update' || action === 'delete') {
    if (
      typeof params.expectedVersion !== 'number' ||
      !Number.isInteger(params.expectedVersion) ||
      params.expectedVersion <= 0 ||
      Number.isNaN(params.expectedVersion)
    ) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `expectedVersion wajib berupa integer positif untuk aksi ${action}`
      );
    }
  } else if (action === 'insert') {
    if (params.expectedVersion !== undefined && params.expectedVersion !== 0) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'expectedVersion untuk aksi insert hanya boleh 0 atau undefined'
      );
    }
  }

  const { clientMutationId, payload } = params.mutation;

  // 5. Bangun canonical mutation envelope di server untuk sidik jari idempotensi autoritatif
  const canonicalEnvelope = {
    workspaceId: params.workspaceId,
    userId: params.userId,
    entityType: params.entityType,
    entityId: params.entityId,
    operation: params.operation,
    expectedVersion: params.expectedVersion ?? null,
    domainPlan: {
      action: params.domainPlan.action,
      attributes: params.domainPlan.attributes ?? {},
    },
    responseData: params.data ?? null,
    clientPayload: payload,
  };
  const payloadHash = await hashCanonicalPayload(canonicalEnvelope);

  // 6. Fast-path lookup idempotensi: JOIN authoritative ke workspace_change_log via mutation_id
  const existingIdem = await db
    .prepare(
      `SELECT
         i.payload_hash,
         i.response_data_json,
         l.change_seq,
         l.workspace_id,
         l.entity_type,
         l.entity_id,
         l.operation,
         l.version,
         l.changed_at
       FROM mutation_idempotency i
       JOIN workspace_change_log l ON l.mutation_id = i.mutation_id
       WHERE i.workspace_id = ? AND i.user_id = ? AND i.client_mutation_id = ?`
    )
    .bind(params.workspaceId, params.userId, clientMutationId)
    .first<any>();

  if (existingIdem) {
    if (existingIdem.payload_hash !== payloadHash) {
      throw new WorkspaceDomainError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'Kunci idempotensi sama digunakan dengan muatan data berbeda'
      );
    }

    let parsedData: unknown = null;
    if (existingIdem.response_data_json) {
      try {
        parsedData = JSON.parse(existingIdem.response_data_json);
      } catch {
        parsedData = null;
      }
    }

    return {
      changeSeq: Number(existingIdem.change_seq),
      workspaceId: String(existingIdem.workspace_id),
      entityType: existingIdem.entity_type as SyncEntityType,
      entityId: String(existingIdem.entity_id),
      operation: existingIdem.operation as SyncOperation,
      version: Number(existingIdem.version),
      changedAt: Number(existingIdem.changed_at),
      data: parsedData,
    };
  }

  // 6. Pre-check otorisasi awal untuk deteksi cepat 404/401
  await getWorkspaceAccess(db, params.userId, params.workspaceId);

  // 7. Pre-check tombstone dan versi untuk respons ramah
  const existing = await db
    .prepare(`SELECT id, version, deleted_at FROM ${tableName} WHERE workspace_id = ? AND id = ?`)
    .bind(params.workspaceId, params.entityId)
    .first<any>();

  if (existing) {
    if (existing.deleted_at !== null && action !== 'delete') {
      throw new WorkspaceDomainError(
        'VERSION_CONFLICT',
        409,
        'Entitas telah dihapus dan tidak dapat dimutasi kembali'
      );
    }
    if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
      throw new WorkspaceDomainError('VERSION_CONFLICT', 409, 'Versi data tidak cocok');
    }
  } else if (params.expectedVersion !== undefined && params.expectedVersion !== 0) {
    throw new WorkspaceDomainError(
      'VERSION_CONFLICT',
      409,
      'Entitas tidak ditemukan untuk versi yang diharapkan'
    );
  }

  const now = Date.now();
  const expiresAt = now + PRODUCT_SAFETY_LIMITS.MUTATION_IDEMPOTENCY_RETENTION_MS;
  const idemId = crypto.randomUUID();
  const mutationId = crypto.randomUUID();

  // 8. Susun atribut final dengan autoUserId dan computeFields
  const computed = rule.computeFields ? rule.computeFields(rawAttrs) : {};
  const finalAttrs: Record<string, unknown> = { ...rawAttrs, ...computed };
  if (action === 'insert' && rule.autoUserId) {
    finalAttrs.created_by_user_id = params.userId;
  }

  // 9. Susun batch SQL transaksional
  const statements: D1PreparedStatementLike[] = [];

  // Statement 0: Mutasi Domain
  if (action === 'insert') {
    const colNames = [
      'id',
      'workspace_id',
      'version',
      'last_mutation_id',
      'created_at',
      'updated_at',
      'deleted_at',
      ...Object.keys(finalAttrs),
    ];
    const placeholders = colNames.map(() => '?').join(', ');
    const colVals = [
      params.entityId,
      params.workspaceId,
      1,
      mutationId,
      now,
      now,
      null,
      ...Object.values(finalAttrs),
    ];

    statements.push(
      db.prepare(`INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${placeholders})`).bind(...colVals)
    );
  } else if (action === 'update') {
    const setClauses: string[] = ['version = version + 1', 'last_mutation_id = ?', 'updated_at = ?'];
    const setVals: unknown[] = [mutationId, now];
    for (const [k, v] of Object.entries(finalAttrs)) {
      setClauses.push(`${k} = ?`);
      setVals.push(v);
    }
    const whereClause = `WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL AND version = ?`;
    const whereVals: unknown[] = [params.workspaceId, params.entityId, params.expectedVersion];

    statements.push(
      db.prepare(`UPDATE ${tableName} SET ${setClauses.join(', ')} ${whereClause}`).bind(...setVals, ...whereVals)
    );
  } else if (action === 'delete') {
    const whereClause = `WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL AND version = ?`;
    const whereVals: unknown[] = [params.workspaceId, params.entityId, params.expectedVersion];

    statements.push(
      db
        .prepare(
          `UPDATE ${tableName} SET deleted_at = ?, version = version + 1, last_mutation_id = ?, updated_at = ? ${whereClause}`
        )
        .bind(now, mutationId, now, ...whereVals)
    );
  }

  // Statement 1: Penyisipan change log dengan korelasi mutation_id dan otorisasi commit-time
  const insertLogStmt = db
    .prepare(
      `INSERT INTO workspace_change_log (
         mutation_id, workspace_id, entity_type, entity_id, operation, version, changed_at, client_mutation_id
       )
       SELECT
         ?, ?, ?, ?, ?,
         (SELECT version FROM ${tableName} WHERE workspace_id = ? AND id = ? AND last_mutation_id = ?),
         ?, ?
       WHERE EXISTS (
         SELECT 1 FROM ${tableName} WHERE workspace_id = ? AND id = ? AND last_mutation_id = ?
       )
       AND EXISTS (
         SELECT 1 FROM workspace w
         LEFT JOIN workspace_membership m ON m.workspace_id = w.id AND m.user_id = ?
         WHERE w.id = ?
           AND w.deleted_at IS NULL
           AND (
             (w.type = 'personal' AND w.personal_owner_user_id = ?)
             OR
             (w.type = 'team' AND m.role IN ('owner', 'admin', 'member'))
           )
       )`
    )
    .bind(
      mutationId,
      params.workspaceId,
      params.entityType,
      params.entityId,
      params.operation,
      params.workspaceId,
      params.entityId,
      mutationId,
      now,
      clientMutationId,
      params.workspaceId,
      params.entityId,
      mutationId,
      params.userId,
      params.workspaceId,
      params.userId
    );
  statements.push(insertLogStmt);

  // Statement 2: Pembaruan latest_change_seq pada workspace
  const updateWorkspaceSeqStmt = db
    .prepare(
      `UPDATE workspace
       SET latest_change_seq = (
         SELECT change_seq FROM workspace_change_log WHERE mutation_id = ?
       ),
       updated_at = ?
       WHERE id = ?
         AND EXISTS (SELECT 1 FROM workspace_change_log WHERE mutation_id = ?)`
    )
    .bind(mutationId, now, params.workspaceId, mutationId);
  statements.push(updateWorkspaceSeqStmt);

  // Statement 3: Penyisipan mutation_idempotency yang mengikat mutation_id via Foreign Key
  const responseDataJson =
    params.data !== undefined && params.data !== null ? JSON.stringify(params.data) : null;

  const insertIdemStmt = db
    .prepare(
      `INSERT INTO mutation_idempotency (
         id, workspace_id, user_id, client_mutation_id, payload_hash, mutation_id, response_data_json, created_at, expires_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`
    )
    .bind(
      idemId,
      params.workspaceId,
      params.userId,
      clientMutationId,
      payloadHash,
      mutationId,
      responseDataJson,
      now,
      expiresAt
    );
  statements.push(insertIdemStmt);

  // Statement 4: Baca baris kanonikal yang berhasil dicommit langsung dari workspace_change_log
  const readCommittedStmt = db
    .prepare(
      `SELECT
         change_seq,
         workspace_id,
         entity_type,
         entity_id,
         operation,
         version,
         changed_at
       FROM workspace_change_log
       WHERE mutation_id = ?`
    )
    .bind(mutationId);
  statements.push(readCommittedStmt);

  // 10. Eksekusi batch atomik
  try {
    const batchResults = await db.batch(statements);

    const readResult = batchResults[batchResults.length - 1];
    const committed = readResult?.results?.[0] as any;
    const assignedSeq = Number(committed?.change_seq ?? 0);
    const committedVersion = Number(committed?.version ?? 0);

    if (assignedSeq <= 0 || committedVersion <= 0) {
      throw new WorkspaceDomainError(
        'VERSION_CONFLICT',
        409,
        'Mutasi gagal dicommit ke log perubahan ruang kerja'
      );
    }

    return {
      changeSeq: assignedSeq,
      workspaceId: String(committed.workspace_id),
      entityType: committed.entity_type as SyncEntityType,
      entityId: String(committed.entity_id),
      operation: committed.operation as SyncOperation,
      version: committedVersion,
      changedAt: Number(committed.changed_at),
      data: params.data ?? null,
    };
  } catch (err: any) {
    const errMsg = String(err?.message ?? err);

    // Penanganan race condition idempotensi: periksa apakah request paralel lain menang dan berhasil commit
    const winningIdem = await db
      .prepare(
        `SELECT
           i.payload_hash,
           i.response_data_json,
           l.change_seq,
           l.workspace_id,
           l.entity_type,
           l.entity_id,
           l.operation,
           l.version,
           l.changed_at
         FROM mutation_idempotency i
         JOIN workspace_change_log l ON l.mutation_id = i.mutation_id
         WHERE i.workspace_id = ? AND i.user_id = ? AND i.client_mutation_id = ?`
      )
      .bind(params.workspaceId, params.userId, clientMutationId)
      .first<any>();

    if (winningIdem) {
      if (winningIdem.payload_hash !== payloadHash) {
        throw new WorkspaceDomainError(
          'IDEMPOTENCY_CONFLICT',
          409,
          'Kunci idempotensi sama digunakan dengan muatan data berbeda'
        );
      }

      let parsedData: unknown = null;
      if (winningIdem.response_data_json) {
        try {
          parsedData = JSON.parse(winningIdem.response_data_json);
        } catch {
          parsedData = null;
        }
      }

      return {
        changeSeq: Number(winningIdem.change_seq),
        workspaceId: String(winningIdem.workspace_id),
        entityType: winningIdem.entity_type as SyncEntityType,
        entityId: String(winningIdem.entity_id),
        operation: winningIdem.operation as SyncOperation,
        version: Number(winningIdem.version),
        changedAt: Number(winningIdem.changed_at),
        data: parsedData,
      };
    }

    // Penanganan pelanggaran NOT NULL / FOREIGN KEY (kegagalan guard otorisasi/CAS/domain row)
    if (
      errMsg.includes('NOT NULL constraint failed') ||
      errMsg.includes('FOREIGN KEY constraint failed') ||
      errMsg.includes('CHECK constraint failed') ||
      errMsg.includes('UNIQUE constraint failed')
    ) {
      // 1. Periksa apakah keanggotaan pengguna baru saja dicabut
      const authStillValid = await db
        .prepare(
          `SELECT 1 FROM workspace w
           LEFT JOIN workspace_membership m ON m.workspace_id = w.id AND m.user_id = ?
           WHERE w.id = ? AND w.deleted_at IS NULL AND (
             (w.type = 'personal' AND w.personal_owner_user_id = ?)
             OR (w.type = 'team' AND m.role IN ('owner', 'admin', 'member'))
           )`
        )
        .bind(params.userId, params.workspaceId, params.userId)
        .first<any>();

      if (!authStillValid) {
        throw new WorkspaceDomainError(
          'FORBIDDEN',
          403,
          'Izin akses pengguna ke ruang kerja telah dicabut'
        );
      }

      // 2. Periksa apakah versi berubah atau entitas telah dihapus
      const row = await db
        .prepare(`SELECT version, deleted_at FROM ${tableName} WHERE workspace_id = ? AND id = ?`)
        .bind(params.workspaceId, params.entityId)
        .first<any>();

      if (row) {
        if (row.deleted_at !== null) {
          throw new WorkspaceDomainError(
            'VERSION_CONFLICT',
            409,
            'Entitas telah dihapus dan tidak dapat dimutasi kembali'
          );
        }
        if (params.expectedVersion !== undefined && row.version !== params.expectedVersion) {
          throw new WorkspaceDomainError('VERSION_CONFLICT', 409, 'Versi data tidak cocok');
        }
      } else if (params.expectedVersion !== undefined && params.expectedVersion !== 0) {
        throw new WorkspaceDomainError(
          'VERSION_CONFLICT',
          409,
          'Entitas tidak ditemukan untuk versi yang diharapkan'
        );
      }

      throw new WorkspaceDomainError(
        'VERSION_CONFLICT',
        409,
        'Konflik konkurensi pada mutasi data ruang kerja'
      );
    }

    if (err instanceof WorkspaceDomainError) {
      throw err;
    }

    throw new WorkspaceDomainError(
      'VERSION_CONFLICT',
      409,
      'Gagal melakukan mutasi data ruang kerja'
    );
  }
}

export type GetWorkspaceDeltaParams = {
  workspaceId: string;
  userId: string;
  sinceSeq: number;
  limit?: number;
};

export type GetWorkspaceDeltaResult =
  | {
      changes: SyncChangeItem[];
      latestSeq: number;
      minValidSeq: number;
      hasMore: boolean;
      nextSeq: number;
      code?: undefined;
    }
  | {
      code: 'FULL_RESYNC_REQUIRED';
      minValidSeq: number;
      currentSeq: number;
    };

/**
 * Mengambil delta perubahan sinkronisasi dengan snapshot transaksional yang konsisten.
 * Menjamin nextSeq <= latestSeq dan mendeteksi kursor kedaluwarsa secara akurat.
 */
export async function getWorkspaceDelta(
  db: D1DatabaseLike,
  params: GetWorkspaceDeltaParams
): Promise<GetWorkspaceDeltaResult> {
  const sinceSeq = params.sinceSeq;
  if (typeof sinceSeq !== 'number' || !Number.isInteger(sinceSeq) || sinceSeq < 0) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'Kursor sinkronisasi tidak valid, wajib integer non-negatif'
    );
  }

  const safeLimit = Math.min(Math.max(params.limit ?? 100, 1), 500);

  // Snapshot pembacaan tunggal atomik: metadata kursor dan log perubahan dibaca dalam satu batch
  const metaStmt = db
    .prepare(
      `SELECT w.id, w.type, w.name, w.personal_owner_user_id, w.latest_change_seq, w.min_valid_sync_seq, m.role
       FROM workspace w
       LEFT JOIN workspace_membership m ON m.workspace_id = w.id AND m.user_id = ?
       WHERE w.id = ? AND w.deleted_at IS NULL`
    )
    .bind(params.userId, params.workspaceId);

  const rowsStmt = db
    .prepare(
      `SELECT change_seq, entity_type, entity_id, operation, version, changed_at
       FROM workspace_change_log
       WHERE workspace_id = ? AND change_seq > ?
       ORDER BY change_seq ASC
       LIMIT ?`
    )
    .bind(params.workspaceId, sinceSeq, safeLimit + 1);

  const [metaRes, rowsRes] = await db.batch([metaStmt, rowsStmt]);

  const wsRow = metaRes?.results?.[0] as any;
  if (!wsRow) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  if (wsRow.type === 'personal') {
    if (wsRow.personal_owner_user_id !== params.userId) {
      throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
    }
  } else if (!wsRow.role) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  const latestSeq = Number(wsRow.latest_change_seq ?? 0);
  const minValidSyncSeq = Number(wsRow.min_valid_sync_seq ?? 0);

  if (sinceSeq < minValidSyncSeq) {
    return {
      code: 'FULL_RESYNC_REQUIRED',
      minValidSeq: minValidSyncSeq,
      currentSeq: latestSeq,
    };
  }

  // Filter baris agar tidak melebihi latestSeq snapshot
  const rawRows = (rowsRes?.results ?? []) as any[];
  const validRows = rawRows.filter((r) => Number(r.change_seq) <= latestSeq);
  const hasMore = validRows.length > safeLimit;
  const items = hasMore ? validRows.slice(0, safeLimit) : validRows;

  const nextSeq = items.length > 0 ? Number(items[items.length - 1].change_seq) : sinceSeq;

  const changes: SyncChangeItem[] = items.map((r) => ({
    changeSeq: Number(r.change_seq),
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    version: Number(r.version),
    changedAt: Number(r.changed_at),
  }));

  return {
    changes,
    latestSeq,
    minValidSeq: minValidSyncSeq,
    hasMore,
    nextSeq,
  };
}

export interface PurgeWorkspaceChangeLogParams {
  workspaceId: string;
  upToSeq: number;
}

export interface PurgeWorkspaceChangeLogResult {
  workspaceId: string;
  purgedUpToSeq: number;
  minValidSyncSeq: number;
  latestSeq: number;
}

/**
 * Layanan internal penghapusan log perubahan yang kedaluwarsa secara atomik dan monotonik.
 * Menjamin min_valid_sync_seq tidak pernah turun dan tidak pernah melebihi latest_change_seq.
 * Mengembalikan actual committed boundary (finalMinValidSyncSeq).
 */
export async function purgeWorkspaceChangeLog(
  db: D1DatabaseLike,
  params: PurgeWorkspaceChangeLogParams
): Promise<PurgeWorkspaceChangeLogResult> {
  const { workspaceId, upToSeq } = params;

  if (typeof upToSeq !== 'number' || !Number.isInteger(upToSeq) || upToSeq < 0) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'upToSeq tidak valid, wajib integer non-negatif'
    );
  }

  const wsRow = await db
    .prepare(
      `SELECT id, latest_change_seq, min_valid_sync_seq
       FROM workspace
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(workspaceId)
    .first<any>();

  if (!wsRow) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  const currentLatest = Number(wsRow.latest_change_seq ?? 0);
  const currentMinValid = Number(wsRow.min_valid_sync_seq ?? 0);

  if (upToSeq > currentLatest) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'upToSeq tidak boleh melebihi latest_change_seq'
    );
  }

  if (upToSeq < currentMinValid) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'min_valid_sync_seq tidak boleh diturunkan'
    );
  }

  const now = Date.now();

  // Eksekusi atomik pembaruan kursor monotonik dan penghapusan log dalam satu batch
  const batchRes = await db.batch([
    db
      .prepare(
        `UPDATE workspace
         SET min_valid_sync_seq = MIN(latest_change_seq, MAX(min_valid_sync_seq, ?)),
             updated_at = ?
         WHERE id = ?
         RETURNING min_valid_sync_seq, latest_change_seq`
      )
      .bind(upToSeq, now, workspaceId),
    db
      .prepare(
        `DELETE FROM workspace_change_log
         WHERE workspace_id = ?
           AND change_seq <= (SELECT min_valid_sync_seq FROM workspace WHERE id = ?)`
      )
      .bind(workspaceId, workspaceId),
  ]);

  const updateResult = batchRes[0];
  const finalMinValid = Number(
    updateResult?.results?.[0]?.min_valid_sync_seq ?? upToSeq
  );
  const finalLatest = Number(
    updateResult?.results?.[0]?.latest_change_seq ?? currentLatest
  );

  return {
    workspaceId,
    purgedUpToSeq: finalMinValid,
    minValidSyncSeq: finalMinValid,
    latestSeq: finalLatest,
  };
}
