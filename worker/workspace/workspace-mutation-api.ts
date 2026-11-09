import type { Env } from '../env.ts';
import { normalizeOrigin, isOriginAllowed } from '../http.ts';
import type { D1DatabaseLike } from './db-types.ts';
import { WorkspaceDomainError } from './workspace-errors.ts';
import { PRODUCT_SAFETY_LIMITS } from '../types/cloud-model.ts';
import {
  readBoundedRequestBody,
  isValidJsonContentType,
  CONTENT_LENGTH_REGEX,
} from './workspace-api.ts';
import {
  checkObjectDepth,
  validateTopLevelMutationRequest,
  mapProjectPayload,
  mapFolderPayload,
  mapTagPayload,
  mapRecordingPayload,
  mapSpeakerPayload,
  mapRecordingTagPayload,
  mapTranscriptPayload,
  type ValidatedMutationPlan,
} from './workspace-mutation-schema.ts';
import { appendWorkspaceChange } from './sync-engine.ts';

// Batas konservatif payload non-transkrip: 64 KB
const MAX_NON_TRANSCRIPT_PAYLOAD_BYTES = 64 * 1024;

// Batas maksimum outer request body mutasi transkrip: 1 MB naskah kanonikal + 64 KB overhead envelope/metadata
const MAX_TRANSCRIPT_PAYLOAD_BYTES =
  PRODUCT_SAFETY_LIMITS.MAX_TRANSCRIPT_PAYLOAD_BYTES + 64 * 1024;

/**
 * Handler utama untuk POST /api/workspaces/:workspaceId/mutations.
 * Menerima satu mutasi per request dan menerjemahkan payload publik ke domain plan server.
 */
export async function handleWorkspaceMutationRequest(
  request: Request,
  env: Env,
  db: D1DatabaseLike,
  userId: string,
  workspaceId: string,
  jsonResp: (data: unknown, status?: number, extraHeaders?: HeadersInit) => Response
): Promise<Response> {
  // 1. Validasi CSRF dan Origin terpercaya untuk operasi mutasi
  const origin = request.headers.get('Origin');
  const appOrigin = env.APP_ORIGIN ?? '';
  const canonical = normalizeOrigin(appOrigin);

  if (!origin || !isOriginAllowed(origin, canonical)) {
    return jsonResp(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Origin tidak terpercaya',
        },
      },
      403
    );
  }

  // 2. Validasi ketat Content-Type (harus exact application/json sebelum parameter)
  const contentType = request.headers.get('content-type');
  if (!isValidJsonContentType(contentType)) {
    return jsonResp(
      {
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Content-Type harus application/json',
        },
      },
      400
    );
  }

  // 3. Validasi ketat Content-Length jika tersedia
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null && contentLengthHeader !== undefined) {
    const trimmed = contentLengthHeader.trim();
    if (!CONTENT_LENGTH_REGEX.test(trimmed)) {
      return jsonResp(
        {
          error: {
            code: 'INVALID_REQUEST_BODY',
            message: 'Header Content-Length tidak valid',
          },
        },
        400
      );
    }
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num) || num < 0) {
      return jsonResp(
        {
          error: {
            code: 'INVALID_REQUEST_BODY',
            message: 'Header Content-Length melampaui batas integer yang aman',
          },
        },
        400
      );
    }
    if (num > MAX_TRANSCRIPT_PAYLOAD_BYTES) {
      return jsonResp(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Ukuran payload melebihi batas maksimum yang diizinkan',
          },
        },
        413
      );
    }
  }

  // 4. Pembacaan incremental ReadableStream dengan global hard cap
  const readResult = await readBoundedRequestBody(request, MAX_TRANSCRIPT_PAYLOAD_BYTES);
  if (!readResult.ok) {
    return jsonResp(
      {
        error: {
          code: readResult.error,
          message: readResult.message,
        },
      },
      readResult.status
    );
  }

  // 5. Parsing JSON terstruktur
  let parsed: unknown;
  try {
    parsed = JSON.parse(readResult.text);
  } catch {
    return jsonResp(
      {
        error: {
          code: 'INVALID_REQUEST_BODY',
          message: 'Format JSON pada request body tidak valid',
        },
      },
      400
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonResp(
      {
        error: {
          code: 'INVALID_REQUEST_BODY',
          message: 'Request body harus berupa JSON object',
        },
      },
      400
    );
  }

  // Periksa kedalaman struktur JSON untuk mencegah stack exhaustion
  if (!checkObjectDepth(parsed, 10)) {
    return jsonResp(
      {
        error: {
          code: 'INVALID_REQUEST_BODY',
          message: 'Struktur JSON terlalu dalam atau bersarang berlebihan',
        },
      },
      400
    );
  }

  // 6. Validasi envelope mutasi publik tingkat teratas
  const mutationReq = validateTopLevelMutationRequest(parsed);

  // Batasi ukuran payload non-transkrip ke 64 KB
  const rawBytes = new TextEncoder().encode(readResult.text).byteLength;
  if (mutationReq.entityType !== 'transcript' && rawBytes > MAX_NON_TRANSCRIPT_PAYLOAD_BYTES) {
    return jsonResp(
      {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Ukuran payload melebihi batas 64 KB untuk entitas non-transkrip',
        },
      },
      413
    );
  }

  // 7. Pemeriksaan otorisasi awal pada ruang kerja
  const wsRow = await db
    .prepare(
      `SELECT
         w.id,
         w.type,
         w.deleted_at,
         w.personal_owner_user_id,
         m.role AS membership_role
       FROM workspace w
       LEFT JOIN workspace_membership m
         ON m.workspace_id = w.id AND m.user_id = ?
       WHERE w.id = ?`
    )
    .bind(userId, workspaceId)
    .first<{
      id: string;
      type: string;
      deleted_at: number | null;
      personal_owner_user_id: string | null;
      membership_role: string | null;
    }>();

  if (!wsRow || wsRow.deleted_at !== null) {
    throw new WorkspaceDomainError(
      'WORKSPACE_NOT_FOUND',
      404,
      'Ruang kerja tidak ditemukan'
    );
  }

  const isPersonalOwner = wsRow.type === 'personal' && wsRow.personal_owner_user_id === userId;
  const isTeamMember =
    wsRow.type === 'team' &&
    ['owner', 'admin', 'member'].includes(wsRow.membership_role ?? '');

  if (!isPersonalOwner && !isTeamMember) {
    // Pengguna tidak terdaftar menerima respons 404 generik untuk mencegah enumerasi
    throw new WorkspaceDomainError(
      'WORKSPACE_NOT_FOUND',
      404,
      'Ruang kerja tidak ditemukan'
    );
  }

  // 8. Pemetaan payload ke domain plan server (validasi struktur sebelum pemeriksaan status DB)
  const rawPayload = mutationReq.payload ?? {};
  let mappedPlan: ValidatedMutationPlan;

  switch (mutationReq.entityType) {
    case 'project':
      mappedPlan = mapProjectPayload(mutationReq.action, mutationReq.entityId, rawPayload);
      break;
    case 'folder':
      mappedPlan = mapFolderPayload(mutationReq.action, mutationReq.entityId, rawPayload);
      break;
    case 'tag':
      mappedPlan = mapTagPayload(mutationReq.action, mutationReq.entityId, rawPayload);
      break;
    case 'recording':
      mappedPlan = mapRecordingPayload(mutationReq.action, mutationReq.entityId, rawPayload);
      break;
    case 'speaker':
      mappedPlan = mapSpeakerPayload(mutationReq.action, mutationReq.entityId, rawPayload);
      break;
    case 'recording_tag':
      mappedPlan = mapRecordingTagPayload(mutationReq.action, mutationReq.entityId, rawPayload);
      break;
    case 'transcript':
      mappedPlan = await mapTranscriptPayload(mutationReq.action, mutationReq.entityId, rawPayload);
      break;
    default:
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Tipe entitas tidak didukung: ${String(mutationReq.entityType)}`
      );
  }

  // 8b. Jika idempotency key sudah pernah dicommit untuk (workspace_id, user_id, client_mutation_id),
  // lewati preflight state check agar appendWorkspaceChange dapat melakukan replay atau deteksi divergensi.
  const existingIdem = await db
    .prepare(
      'SELECT 1 FROM mutation_idempotency WHERE workspace_id = ? AND user_id = ? AND client_mutation_id = ?'
    )
    .bind(workspaceId, userId, mutationReq.clientMutationId)
    .first<{ 1: number }>();

  // 8c. Validasi relasional preflight dalam ruang kerja (hanya jika bukan replay idempoten)
  if (!existingIdem) {
    switch (mutationReq.entityType) {
      case 'project': {
        if (mutationReq.action === 'update' || mutationReq.action === 'delete') {
          const row = await db
            .prepare('SELECT id, version, deleted_at FROM project WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; version: number; deleted_at: number | null }>();

          if (!row) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Project tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (row.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }
        }
        break;
      }

      case 'folder': {
        if (mutationReq.action === 'insert') {
          const projectId = (mappedPlan.attributes as { project_id: string }).project_id;
          const proj = await db
            .prepare('SELECT 1 FROM project WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
            .bind(workspaceId, projectId)
            .first<{ 1: number }>();

          if (!proj) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Project referensi tidak ditemukan dalam ruang kerja ini'
            );
          }
        } else {
          const row = await db
            .prepare('SELECT id, project_id, version, deleted_at FROM folder WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; project_id: string; version: number; deleted_at: number | null }>();

          if (!row) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Folder tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (row.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }
        }
        break;
      }

      case 'tag': {
        if (mutationReq.action === 'insert') {
          const normName = (mappedPlan.attributes as { normalized_name: string }).normalized_name;
          const existing = await db
            .prepare('SELECT id FROM tag WHERE workspace_id = ? AND normalized_name = ?')
            .bind(workspaceId, normName)
            .first<{ id: string }>();

          if (existing && existing.id !== mutationReq.entityId) {
            throw new WorkspaceDomainError(
              'IDEMPOTENCY_CONFLICT',
              409,
              'Tag dengan nama tersebut sudah ada dalam ruang kerja ini'
            );
          }
        } else if (mutationReq.action === 'update') {
          const row = await db
            .prepare('SELECT id, version, deleted_at, normalized_name FROM tag WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; version: number; deleted_at: number | null; normalized_name: string }>();

          if (!row) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Tag tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (row.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }

          const normName = (mappedPlan.attributes as { normalized_name: string }).normalized_name;
          if (normName !== row.normalized_name) {
            const conflict = await db
              .prepare('SELECT id FROM tag WHERE workspace_id = ? AND normalized_name = ? AND id != ?')
              .bind(workspaceId, normName, mutationReq.entityId)
              .first<{ id: string }>();

            if (conflict) {
              throw new WorkspaceDomainError(
                'IDEMPOTENCY_CONFLICT',
                409,
                'Tag dengan nama tersebut sudah ada dalam ruang kerja ini'
              );
            }
          }
        } else {
          const row = await db
            .prepare('SELECT id, version, deleted_at FROM tag WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; version: number; deleted_at: number | null }>();

          if (!row) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Tag tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (row.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }
        }
        break;
      }

      case 'recording': {
        if (mutationReq.action === 'insert') {
          const attrs = mappedPlan.attributes as {
            project_id: string | null;
            folder_id: string | null;
          };

          let folderProjId: string | null = null;
          if (attrs.folder_id) {
            const folder = await db
              .prepare('SELECT id, project_id FROM folder WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
              .bind(workspaceId, attrs.folder_id)
              .first<{ id: string; project_id: string }>();

            if (!folder) {
              throw new WorkspaceDomainError(
                'WORKSPACE_NOT_FOUND',
                404,
                'Folder referensi tidak ditemukan dalam ruang kerja ini'
              );
            }
            folderProjId = folder.project_id;
          }

          if (attrs.project_id) {
            const proj = await db
              .prepare('SELECT 1 FROM project WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
              .bind(workspaceId, attrs.project_id)
              .first<{ 1: number }>();

            if (!proj) {
              throw new WorkspaceDomainError(
                'WORKSPACE_NOT_FOUND',
                404,
                'Project referensi tidak ditemukan dalam ruang kerja ini'
              );
            }

            if (folderProjId && folderProjId !== attrs.project_id) {
              throw new WorkspaceDomainError(
                'INVALID_MUTATION_PLAN',
                400,
                'Folder tidak termasuk dalam project yang ditentukan'
              );
            }
          } else if (folderProjId) {
            // Tetapkan project_id secara otomatis dari folder jika tidak disertakan
            attrs.project_id = folderProjId;
            if (mappedPlan.sanitizedResponseData) {
              mappedPlan.sanitizedResponseData.projectId = folderProjId;
            }
          }
        } else if (mutationReq.action === 'update') {
          const rec = await db
            .prepare('SELECT id, project_id, folder_id, version, deleted_at FROM recording WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; project_id: string | null; folder_id: string | null; version: number; deleted_at: number | null }>();

          if (!rec) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Recording tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (rec.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }

          const attrs = mappedPlan.attributes as { folder_id?: string | null };
          if (attrs.folder_id !== undefined && attrs.folder_id !== null) {
            const folder = await db
              .prepare('SELECT id, project_id FROM folder WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
              .bind(workspaceId, attrs.folder_id)
              .first<{ id: string; project_id: string }>();

            if (!folder) {
              throw new WorkspaceDomainError(
                'WORKSPACE_NOT_FOUND',
                404,
                'Folder referensi tidak ditemukan dalam ruang kerja ini'
              );
            }

            if (rec.project_id && folder.project_id !== rec.project_id) {
              throw new WorkspaceDomainError(
                'INVALID_MUTATION_PLAN',
                400,
                'Folder tidak termasuk dalam project yang ditentukan pada recording ini'
              );
            }
          }
        } else {
          const rec = await db
            .prepare('SELECT id, version, deleted_at FROM recording WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; version: number; deleted_at: number | null }>();

          if (!rec) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Recording tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (rec.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }
        }
        break;
      }

      case 'speaker': {
        if (mutationReq.action === 'insert') {
          const recordingId = (mappedPlan.attributes as { recording_id: string }).recording_id;
          const rec = await db
            .prepare('SELECT 1 FROM recording WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
            .bind(workspaceId, recordingId)
            .first<{ 1: number }>();

          if (!rec) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Recording referensi tidak ditemukan dalam ruang kerja ini'
            );
          }
        } else {
          const row = await db
            .prepare('SELECT id, recording_id, version, deleted_at FROM speaker WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; recording_id: string; version: number; deleted_at: number | null }>();

          if (!row) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Speaker tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (row.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }
        }
        break;
      }

      case 'recording_tag': {
        if (mutationReq.action === 'insert') {
          const { recording_id, tag_id } = mappedPlan.attributes as {
            recording_id: string;
            tag_id: string;
          };

          const rec = await db
            .prepare('SELECT 1 FROM recording WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
            .bind(workspaceId, recording_id)
            .first<{ 1: number }>();

          if (!rec) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Recording referensi tidak ditemukan dalam ruang kerja ini'
            );
          }

          const tag = await db
            .prepare('SELECT 1 FROM tag WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
            .bind(workspaceId, tag_id)
            .first<{ 1: number }>();

          if (!tag) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Tag referensi tidak ditemukan dalam ruang kerja ini'
            );
          }

          const existing = await db
            .prepare('SELECT id FROM recording_tag WHERE workspace_id = ? AND recording_id = ? AND tag_id = ?')
            .bind(workspaceId, recording_id, tag_id)
            .first<{ id: string }>();

          if (existing) {
            throw new WorkspaceDomainError(
              'IDEMPOTENCY_CONFLICT',
              409,
              'Relasi tag dan rekaman sudah ada'
            );
          }
        } else {
          const row = await db
            .prepare('SELECT id, version, deleted_at FROM recording_tag WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; version: number; deleted_at: number | null }>();

          if (!row) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Relasi tag dan rekaman tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (row.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }
        }
        break;
      }

      case 'transcript': {
        if (mutationReq.action === 'insert') {
          const recordingId = (mappedPlan.attributes as { recording_id: string }).recording_id;
          const rec = await db
            .prepare('SELECT 1 FROM recording WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
            .bind(workspaceId, recordingId)
            .first<{ 1: number }>();

          if (!rec) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Recording referensi tidak ditemukan dalam ruang kerja ini'
            );
          }
        } else {
          const row = await db
            .prepare('SELECT id, recording_id, version, deleted_at FROM transcript WHERE workspace_id = ? AND id = ?')
            .bind(workspaceId, mutationReq.entityId)
            .first<{ id: string; recording_id: string; version: number; deleted_at: number | null }>();

          if (!row) {
            throw new WorkspaceDomainError(
              'WORKSPACE_NOT_FOUND',
              404,
              'Transcript tidak ditemukan dalam ruang kerja ini'
            );
          }
          if (row.deleted_at !== null) {
            throw new WorkspaceDomainError(
              'VERSION_CONFLICT',
              409,
              'Entitas telah dihapus dan tidak dapat dimutasi kembali'
            );
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // 9. Eksekusi mutasi atomik via sync engine (dengan idempotensi, CAS, dan otorisasi commit-time)
  const result = await appendWorkspaceChange(db, {
    workspaceId,
    userId,
    entityType: mutationReq.entityType,
    entityId: mutationReq.entityId,
    operation: mutationReq.action === 'delete' ? 'delete' : 'upsert',
    expectedVersion: mutationReq.expectedVersion,
    data: mappedPlan.sanitizedResponseData,
    mutation: {
      clientMutationId: mutationReq.clientMutationId,
      payload: mappedPlan.canonicalPublicPayload,
    },
    domainPlan: {
      action: mappedPlan.action,
      attributes: mappedPlan.attributes,
    },
  });

  // 10. Bangun respons mutasi publik yang tersanitasi
  return jsonResp({
    mutation: {
      changeSeq: result.changeSeq,
      workspaceId: result.workspaceId,
      entityType: result.entityType,
      entityId: result.entityId,
      operation: result.operation,
      version: result.version,
      changedAt: result.changedAt,
      data: result.data ?? null,
    },
  });
}
