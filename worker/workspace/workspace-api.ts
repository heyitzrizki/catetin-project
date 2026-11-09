import type { Env } from '../env.ts';
import { createAuth } from '../auth.ts';
import { normalizeOrigin, isOriginAllowed } from '../http.ts';
import type { D1DatabaseLike } from './db-types.ts';
import {
  WorkspaceDomainError,
  formatDomainError,
} from './workspace-errors.ts';
import { getWorkspaceDelta } from './sync-engine.ts';
import { handleWorkspaceMutationRequest } from './workspace-mutation-api.ts';
import type {
  WorkspaceDTO,
  WorkspaceType,
  WorkspaceRole,
  ProjectDTO,
  FolderDTO,
  TagDTO,
  RecordingDTO,
  AudioAssetDTO,
  SpeakerDTO,
  TranscriptDTO,
  DialogSegmentDTO,
  RecordingTagDTO,
  AudioRetentionTier,
} from '../types/cloud-model.ts';

export interface WorkspaceSnapshotEntities {
  projects: ProjectDTO[];
  folders: FolderDTO[];
  tags: TagDTO[];
  recordings: RecordingDTO[];
  audioAssets: AudioAssetDTO[];
  speakers: SpeakerDTO[];
  transcripts: TranscriptDTO[];
  recordingTags: RecordingTagDTO[];
}

export interface WorkspaceSnapshotDTO {
  workspace: WorkspaceDTO;
  latestSeq: number;
  minValidSeq: number;
  entities: WorkspaceSnapshotEntities;
}

const MAX_TRANSCRIPT_SEGMENTS = 5000;
const MAX_SEGMENT_TEXT_CHARS = 10000;
const MAX_SEGMENT_LABEL_CHARS = 128;

/**
 * Melakukan proyeksi dan validasi runtime ketat terhadap segmen transkrip.
 * Membuang field internal/ekstra (misalnya internalSecret, rawProviderPayload, token)
 * dan mengabaikan item yang malformed tanpa memicu galat 500.
 */
export function sanitizeDialogSegments(rawDocumentJson: string): DialogSegmentDTO[] {
  if (typeof rawDocumentJson !== 'string' || !rawDocumentJson.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDocumentJson);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const rawSegments = (parsed as Record<string, unknown>).segments;
  if (!Array.isArray(rawSegments)) {
    return [];
  }

  const result: DialogSegmentDTO[] = [];
  const limit = Math.min(rawSegments.length, MAX_TRANSCRIPT_SEGMENTS);

  for (let i = 0; i < limit; i++) {
    const item = rawSegments[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const obj = item as Record<string, unknown>;

    // 1. Validasi id (wajib string tidak kosong)
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
      continue;
    }
    const id = obj.id.trim().slice(0, MAX_SEGMENT_LABEL_CHARS);

    // 2. Validasi speaker (wajib string)
    if (typeof obj.speaker !== 'string') {
      continue;
    }
    const speaker = obj.speaker.trim().slice(0, MAX_SEGMENT_LABEL_CHARS);

    // 3. Validasi seconds (finite number non-negatif)
    if (
      typeof obj.seconds !== 'number' ||
      !Number.isFinite(obj.seconds) ||
      Number.isNaN(obj.seconds) ||
      obj.seconds < 0
    ) {
      continue;
    }
    const seconds = obj.seconds;

    // 4. Validasi time (string)
    if (typeof obj.time !== 'string') {
      continue;
    }
    const time = obj.time.trim().slice(0, 32);

    // 5. Validasi text (string)
    if (typeof obj.text !== 'string') {
      continue;
    }
    const text = obj.text.slice(0, MAX_SEGMENT_TEXT_CHARS);

    // Proyeksi runtime: hanya 5 properti ini yang dibangun
    result.push({
      id,
      speaker,
      seconds,
      time,
      text,
    });
  }

  return result;
}

/**
 * Mengurai segmen ID ruang kerja dari URL dengan decoding percent-encoding yang aman.
 * Malformed encoding (misal % atau %ZZ) ditolak dengan 404 terstruktur, bukan 500.
 */
export function parseSafeWorkspaceId(rawSegment: string): string {
  try {
    const decoded = decodeURIComponent(rawSegment).trim();
    if (!decoded) {
      throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
    }
    return decoded;
  } catch (err) {
    if (err instanceof WorkspaceDomainError) throw err;
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }
}

/**
 * Membangun respons JSON aman untuk workspace API.
 * Menegakkan header Cache-Control: no-store dan Vary: Cookie, Origin.
 * Tidak pernah menggunakan wildcard CORS (*).
 */
export function workspaceJsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
  originHeader?: string | null,
  appOrigin?: string
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Cookie, Origin',
  };

  if (originHeader && appOrigin) {
    const canonical = normalizeOrigin(appOrigin);
    if (isOriginAllowed(originHeader, canonical)) {
      headers['Access-Control-Allow-Origin'] = originHeader;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  }

  if (extraHeaders) {
    if (extraHeaders instanceof Headers) {
      extraHeaders.forEach((val, key) => {
        headers[key] = val;
      });
    } else if (Array.isArray(extraHeaders)) {
      for (const [k, v] of extraHeaders) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, extraHeaders);
    }
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

/**
 * Handler utama untuk seluruh rute /api/workspaces/*.
 */
export async function handleWorkspaceRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const appOrigin = env.APP_ORIGIN ?? '';

  const jsonResp = (data: unknown, status = 200, extraHeaders?: HeadersInit) =>
    workspaceJsonResponse(data, status, extraHeaders, origin, appOrigin);

  // 1. Verifikasi Autentikasi Pengguna (menggunakan Better Auth session).
  // Handler sengaja memverifikasi autentikasi sebelum dispatch metode HTTP sebagai
  // kebijakan anti-enumeration:
  // - Request tanpa sesi selalu menerima 401 Unauthorized, tanpa membocorkan eksistensi
  //   atau kapabilitas metode endpoint.
  // - Request terautentikasi dengan metode HTTP yang salah menerima 405 Method Not Allowed.
  let auth;
  let sessionResult;
  try {
    auth = createAuth(env);
    sessionResult = await auth.api.getSession({
      headers: request.headers,
    });
  } catch {
    return jsonResp(
      {
        error: {
          code: 'INTERNAL_OPERATION_FAILED',
          message: 'Gagal memverifikasi sesi autentikasi pengguna',
        },
      },
      500
    );
  }

  if (!sessionResult || !sessionResult.user || !sessionResult.user.id) {
    return jsonResp(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Autentikasi diperlukan untuk mengakses ruang kerja',
        },
      },
      401
    );
  }

  const userId = sessionResult.user.id;

  // 2. Dispatch dan Batas Keamanan HTTP Method
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  const segments = normalizedPath.split('/').filter(Boolean);

  const isBootstrap =
    segments.length === 3 &&
    segments[0] === 'api' &&
    segments[1] === 'workspaces' &&
    segments[2] === 'bootstrap';

  const isMutations =
    segments.length === 4 &&
    segments[0] === 'api' &&
    segments[1] === 'workspaces' &&
    segments[3] === 'mutations';

  if (isBootstrap || isMutations) {
    if (request.method !== 'POST') {
      return jsonResp(
        {
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message: isBootstrap
              ? 'Metode HTTP tidak didukung pada endpoint bootstrap'
              : 'Metode HTTP tidak didukung pada endpoint mutations',
          },
        },
        405,
        { 'Allow': 'POST' }
      );
    }
  } else {
    if (request.method !== 'GET') {
      return jsonResp(
        {
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Metode HTTP tidak didukung pada endpoint ini',
          },
        },
        405,
        { 'Allow': 'GET' }
      );
    }
  }

  try {
    const db = env.DB as unknown as D1DatabaseLike;

    // Rute 0: POST /api/workspaces/bootstrap
    if (isBootstrap) {
      return await handleBootstrapWorkspace(request, db, userId, env, jsonResp);
    }

    // Rute 0b: POST /api/workspaces/:workspaceId/mutations
    if (isMutations) {
      const workspaceId = parseSafeWorkspaceId(segments[2]);
      return await handleWorkspaceMutationRequest(request, env, db, userId, workspaceId, jsonResp);
    }

    // Rute 1: GET /api/workspaces
    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'workspaces') {
      return await handleListWorkspaces(db, userId, jsonResp);
    }

    // Rute 2: GET /api/workspaces/:workspaceId
    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'workspaces') {
      const workspaceId = parseSafeWorkspaceId(segments[2]);
      return await handleGetWorkspace(db, userId, workspaceId, jsonResp);
    }

    // Rute 3 & 4: Sub-resource di bawah /api/workspaces/:workspaceId/*
    if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'workspaces') {
      const workspaceId = parseSafeWorkspaceId(segments[2]);
      const action = segments[3];

      // Rute 3: GET /api/workspaces/:workspaceId/snapshot
      if (action === 'snapshot') {
        return await handleGetSnapshot(db, userId, workspaceId, jsonResp);
      }

      // Rute 4: GET /api/workspaces/:workspaceId/sync
      if (action === 'sync') {
        return await handleGetSync(db, userId, workspaceId, url.searchParams, jsonResp);
      }
    }

    // Rute tidak dikenal di bawah /api/workspaces
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Endpoint ruang kerja tidak ditemukan');
  } catch (err: unknown) {
    const { status, body } = formatDomainError(err);
    return jsonResp(body, status);
  }
}

const MAX_BOOTSTRAP_PAYLOAD_BYTES = 512;
const MAX_BOOTSTRAP_INSERT_ATTEMPTS = 3;
export const CONTENT_LENGTH_REGEX = /^(?:0|[1-9]\d*)$/;

export function isValidJsonContentType(contentTypeHeader: string | null): boolean {
  if (!contentTypeHeader) return false;
  // Tolak header gabungan atau multitipe dengan koma
  if (contentTypeHeader.includes(',')) return false;
  // Ambil media type utama sebelum parameter semicolon
  const mediaType = contentTypeHeader.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as Record<string, unknown>).code;
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    msg.includes('UNIQUE constraint failed') ||
    msg.includes('SQLITE_CONSTRAINT_UNIQUE')
  );
}

/**
 * Membaca stream request body secara bertahap dengan batas maksimum ukuran byte.
 * Begitu akumulasi melebihi batas, stream langsung dibatalkan untuk menghemat memori.
 */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; text: string }
  | { ok: false; error: 'PAYLOAD_TOO_LARGE' | 'INVALID_REQUEST_BODY'; status: number; message: string }
> {
  if (!request.body) {
    return { ok: true, text: '' };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch {
        return {
          ok: false,
          error: 'INVALID_REQUEST_BODY',
          status: 400,
          message: 'Gagal membaca stream request body',
        };
      }

      const { done, value } = readResult;
      if (done) {
        break;
      }

      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel('payload_too_large');
          } catch {
            // Abaikan kesalahan pembatalan stream
          }
          return {
            ok: false,
            error: 'PAYLOAD_TOO_LARGE',
            status: 413,
            message: 'Ukuran payload melebihi batas maksimum yang diizinkan',
          };
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Abaikan pelepasan lock jika reader telah dibatalkan
    }
  }

  const accumulated = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    accumulated.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const text = decoder.decode(accumulated);
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      error: 'INVALID_REQUEST_BODY',
      status: 400,
      message: 'Request body bukan representasi teks UTF-8 yang valid',
    };
  }
}

/**
 * Endpoint bootstrap personal cloud workspace idempoten.
 * Memastikan setiap pengguna terautentikasi memiliki tepat satu personal workspace.
 */
async function handleBootstrapWorkspace(
  request: Request,
  db: D1DatabaseLike,
  userId: string,
  env: Env,
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
    if (num > MAX_BOOTSTRAP_PAYLOAD_BYTES) {
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

  // 4. Pembacaan incremental ReadableStream dengan batasan ukuran
  const readResult = await readBoundedRequestBody(request, MAX_BOOTSTRAP_PAYLOAD_BYTES);
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

  // 6. Validasi ketat field request: hanya izinkan field 'locale' opsional
  const bodyObj = parsed as Record<string, unknown>;
  const allowedKeys = ['locale'];
  for (const key of Object.keys(bodyObj)) {
    if (!allowedKeys.includes(key)) {
      return jsonResp(
        {
          error: {
            code: 'INVALID_REQUEST_BODY',
            message: `Field '${key}' tidak diizinkan pada bootstrap ruang kerja`,
          },
        },
        400
      );
    }
  }

  let locale: 'id' | 'en' = 'id';
  if ('locale' in bodyObj && bodyObj.locale !== undefined) {
    if (typeof bodyObj.locale !== 'string' || !['id', 'en'].includes(bodyObj.locale)) {
      return jsonResp(
        {
          error: {
            code: 'INVALID_REQUEST_BODY',
            message: "Field locale harus bernilai 'id' atau 'en'",
          },
        },
        400
      );
    }
    locale = bodyObj.locale as 'id' | 'en';
  }

  // 7. Periksa apakah user telah memiliki personal workspace
  const existing = await db
    .prepare(
      `SELECT id, type, name, slug, created_at, updated_at, deleted_at
       FROM workspace
       WHERE personal_owner_user_id = ?`
    )
    .bind(userId)
    .first<{
      id: string;
      type: string;
      name: string;
      slug: string;
      created_at: number;
      updated_at: number;
      deleted_at: number | null;
    }>();

  if (existing) {
    if (existing.deleted_at !== null) {
      throw new WorkspaceDomainError(
        'WORKSPACE_DELETED',
        409,
        'Ruang kerja personal telah dihapus. Kebijakan pemulihan belum tersedia.'
      );
    }

    return jsonResp({
      workspace: {
        id: existing.id,
        type: 'personal',
        name: existing.name,
        slug: existing.slug,
        role: 'owner',
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      },
      created: false,
    });
  }

  // 8. Buat workspace baru dengan bounded collision recovery (maksimum 3 percobaan)
  const defaultName = locale === 'en' ? 'Personal Workspace' : 'Ruang Kerja Utama';

  for (let attempt = 1; attempt <= MAX_BOOTSTRAP_INSERT_ATTEMPTS; attempt++) {
    const workspaceId = crypto.randomUUID();
    const slug = `personal-${crypto.randomUUID().replace(/-/g, '')}`;
    const now = Date.now();

    try {
      await db
        .prepare(
          `INSERT INTO workspace (
            id, type, name, slug, personal_owner_user_id,
            latest_change_seq, min_valid_sync_seq,
            created_at, updated_at, deleted_at
          ) VALUES (?, 'personal', ?, ?, ?, 0, 0, ?, ?, NULL)`
        )
        .bind(workspaceId, defaultName, slug, userId, now, now)
        .run();

      return jsonResp({
        workspace: {
          id: workspaceId,
          type: 'personal',
          name: defaultName,
          slug,
          role: 'owner',
          createdAt: now,
          updatedAt: now,
        },
        created: true,
      });
    } catch (err: unknown) {
      // Error non-UNIQUE langsung disanitasi tanpa dianggap collision
      if (!isUniqueConstraintError(err)) {
        throw new WorkspaceDomainError(
          'INTERNAL_OPERATION_FAILED',
          500,
          'Terjadi kesalahan internal saat menyiapkan ruang kerja personal'
        );
      }

      // Jika terjadi UNIQUE conflict, periksa apakah karena balapan pembuatan personal owner
      const recovered = await db
        .prepare(
          `SELECT id, type, name, slug, created_at, updated_at, deleted_at
           FROM workspace
           WHERE personal_owner_user_id = ?`
        )
        .bind(userId)
        .first<{
          id: string;
          type: string;
          name: string;
          slug: string;
          created_at: number;
          updated_at: number;
          deleted_at: number | null;
        }>();

      if (recovered) {
        if (recovered.deleted_at !== null) {
          throw new WorkspaceDomainError(
            'WORKSPACE_DELETED',
            409,
            'Ruang kerja personal telah dihapus. Kebijakan pemulihan belum tersedia.'
          );
        }

        return jsonResp({
          workspace: {
            id: recovered.id,
            type: 'personal',
            name: recovered.name,
            slug: recovered.slug,
            role: 'owner',
            createdAt: recovered.created_at,
            updatedAt: recovered.updated_at,
          },
          created: false,
        });
      }

      // Jika tidak ada row untuk user ini, collision terjadi pada workspace.id atau workspace.slug.
      // Jika retry sudah habis, sanitasi menjadi 500.
      if (attempt === MAX_BOOTSTRAP_INSERT_ATTEMPTS) {
        throw new WorkspaceDomainError(
          'INTERNAL_OPERATION_FAILED',
          500,
          'Terjadi kesalahan internal saat menyiapkan ruang kerja personal'
        );
      }
    }
  }

  throw new WorkspaceDomainError(
    'INTERNAL_OPERATION_FAILED',
    500,
    'Terjadi kesalahan internal saat menyiapkan ruang kerja personal'
  );
}

/**
 * Mengambil daftar ruang kerja aktif yang berhak diakses pengguna.
 */
async function handleListWorkspaces(
  db: D1DatabaseLike,
  userId: string,
  jsonResp: (data: unknown, status?: number, extraHeaders?: HeadersInit) => Response
): Promise<Response> {
  const query = `
    SELECT
      w.id,
      w.type,
      w.name,
      w.slug,
      w.created_at,
      w.updated_at,
      CASE
        WHEN w.type = 'personal' THEN 'owner'
        ELSE m.role
      END as role
    FROM workspace w
    LEFT JOIN workspace_membership m ON m.workspace_id = w.id AND m.user_id = ?
    WHERE w.deleted_at IS NULL
      AND (
        (w.type = 'personal' AND w.personal_owner_user_id = ?)
        OR (w.type = 'team' AND m.role IN ('owner', 'admin', 'member'))
      )
    ORDER BY w.created_at ASC, w.id ASC
  `;

  const res = await db.prepare(query).bind(userId, userId).all<any>();
  const rows = res?.results ?? [];

  const workspaces: WorkspaceDTO[] = rows.map((r) => ({
    id: String(r.id),
    type: r.type as WorkspaceType,
    name: String(r.name),
    slug: String(r.slug),
    role: r.role as WorkspaceRole,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  return jsonResp({ workspaces });
}

/**
 * Mengambil data ruang kerja tunggal berdasarkan ID.
 * Menggunakan kueri otorisasi atomik tunggal untuk mengeliminasi celah TOCTOU.
 * Menghasilkan 404 jika pengguna tidak memiliki izin akses atau ruang kerja terhapus.
 */
async function handleGetWorkspace(
  db: D1DatabaseLike,
  userId: string,
  workspaceId: string,
  jsonResp: (data: unknown, status?: number, extraHeaders?: HeadersInit) => Response
): Promise<Response> {
  const query = `
    SELECT
      w.id,
      w.type,
      w.name,
      w.slug,
      w.created_at,
      w.updated_at,
      CASE
        WHEN w.type = 'personal' THEN 'owner'
        ELSE m.role
      END as role
    FROM workspace w
    LEFT JOIN workspace_membership m ON m.workspace_id = w.id AND m.user_id = ?
    WHERE w.id = ? AND w.deleted_at IS NULL
      AND (
        (w.type = 'personal' AND w.personal_owner_user_id = ?)
        OR (w.type = 'team' AND m.role IN ('owner', 'admin', 'member'))
      )
  `;

  const wsRow = await db.prepare(query).bind(userId, workspaceId, userId).first<any>();

  if (!wsRow || !wsRow.role) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  const workspace: WorkspaceDTO = {
    id: String(wsRow.id),
    type: wsRow.type as WorkspaceType,
    name: String(wsRow.name),
    slug: String(wsRow.slug),
    role: wsRow.role as WorkspaceRole,
    createdAt: Number(wsRow.created_at),
    updatedAt: Number(wsRow.updated_at),
  };

  return jsonResp({ workspace });
}

/**
 * Mengambil snapshot initial/full-resync lengkap seluruh entitas aktif ruang kerja.
 * Predikat otorisasi dan pembacaan entitas dieksekusi dalam batch snapshot transaksional
 * yang sama untuk menjamin eliminasi TOCTOU.
 */
async function handleGetSnapshot(
  db: D1DatabaseLike,
  userId: string,
  workspaceId: string,
  jsonResp: (data: unknown, status?: number, extraHeaders?: HeadersInit) => Response
): Promise<Response> {
  // Statement 0: Otorisasi dan pembacaan metadata ruang kerja dalam snapshot atomik
  const authWsStmt = db
    .prepare(
      `SELECT
         w.id,
         w.type,
         w.name,
         w.slug,
         w.latest_change_seq,
         w.min_valid_sync_seq,
         w.created_at,
         w.updated_at,
         CASE
           WHEN w.type = 'personal' THEN 'owner'
           ELSE m.role
         END as role
       FROM workspace w
       LEFT JOIN workspace_membership m ON m.workspace_id = w.id AND m.user_id = ?
       WHERE w.id = ? AND w.deleted_at IS NULL
         AND (
           (w.type = 'personal' AND w.personal_owner_user_id = ?)
           OR (w.type = 'team' AND m.role IN ('owner', 'admin', 'member'))
         )`
    )
    .bind(userId, workspaceId, userId);

  const projectsStmt = db
    .prepare(
      `SELECT id, workspace_id, name, description, version, created_at, updated_at
       FROM project
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const foldersStmt = db
    .prepare(
      `SELECT id, workspace_id, project_id, name, color, version, created_at, updated_at
       FROM folder
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const tagsStmt = db
    .prepare(
      `SELECT id, workspace_id, name, version, created_at, updated_at
       FROM tag
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const recordingsStmt = db
    .prepare(
      `SELECT id, workspace_id, project_id, folder_id, title, category, duration_sec, version, created_at, updated_at
       FROM recording
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const audioAssetsStmt = db
    .prepare(
      `SELECT id, recording_id, workspace_id, filename, mime_type, size_bytes, duration_sec, retention_tier, purge_at, version, created_at, updated_at
       FROM audio_asset
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const recordingTagsStmt = db
    .prepare(
      `SELECT id, workspace_id, recording_id, tag_id, version, created_at, updated_at
       FROM recording_tag
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const speakersStmt = db
    .prepare(
      `SELECT id, recording_id, workspace_id, label, display_name, color, version, created_at, updated_at
       FROM speaker
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const transcriptsStmt = db
    .prepare(
      `SELECT id, recording_id, workspace_id, summary_text, segment_count, word_count, raw_document_json, checksum, version, updated_at
       FROM transcript
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .bind(workspaceId);

  const [
    wsRes,
    prjRes,
    fldRes,
    tagRes,
    recRes,
    audRes,
    recTagRes,
    spkRes,
    txnRes,
  ] = await db.batch([
    authWsStmt,
    projectsStmt,
    foldersStmt,
    tagsStmt,
    recordingsStmt,
    audioAssetsStmt,
    recordingTagsStmt,
    speakersStmt,
    transcriptsStmt,
  ]);

  const wsRow = wsRes?.results?.[0] as any;
  // Jika baris otorisasi ruang kerja tidak ditemukan/tidak valid, jangan serialisasi data entitas
  if (!wsRow || !wsRow.role) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  // 1. Proyek DTO
  const projects: ProjectDTO[] = (prjRes?.results ?? []).map((r: any) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    name: String(r.name),
    description: r.description ?? null,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  // 2. Folder DTO
  const folders: FolderDTO[] = (fldRes?.results ?? []).map((r: any) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    projectId: String(r.project_id),
    name: String(r.name),
    color: r.color ?? null,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  // 3. Tag DTO (tanpa normalized_name)
  const tags: TagDTO[] = (tagRes?.results ?? []).map((r: any) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    name: String(r.name),
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  // 4. Audio Asset DTO (tanpa r2_key atau sha256; konversi nullable epoch eksplisit)
  const audioAssets: AudioAssetDTO[] = (audRes?.results ?? []).map((r: any) => ({
    id: String(r.id),
    recordingId: String(r.recording_id),
    workspaceId: String(r.workspace_id),
    filename: String(r.filename),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes),
    durationSec: Number(r.duration_sec),
    retentionTier: r.retention_tier as AudioRetentionTier,
    purgeAt: r.purge_at !== null && r.purge_at !== undefined ? Number(r.purge_at) : null,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  // 5. Recording Tag DTO
  const recordingTags: RecordingTagDTO[] = (recTagRes?.results ?? []).map((r: any) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    recordingId: String(r.recording_id),
    tagId: String(r.tag_id),
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  // Helper map untuk menyusun metadata relasional pada rekaman
  const audioByRecId = new Map<string, any>();
  for (const a of (audRes?.results ?? []) as any[]) {
    audioByRecId.set(String(a.recording_id), a);
  }

  const tagNameById = new Map<string, string>();
  for (const t of (tagRes?.results ?? []) as any[]) {
    tagNameById.set(String(t.id), String(t.name));
  }

  const tagsByRecId = new Map<string, string[]>();
  for (const rt of (recTagRes?.results ?? []) as any[]) {
    const recId = String(rt.recording_id);
    const tName = tagNameById.get(String(rt.tag_id));
    if (tName) {
      const list = tagsByRecId.get(recId) ?? [];
      list.push(tName);
      tagsByRecId.set(recId, list);
    }
  }

  // 6. Recording DTO (tanpa local_v2_id atau created_by_user_id; konversi nullable epoch eksplisit)
  const recordings: RecordingDTO[] = (recRes?.results ?? []).map((r: any) => {
    const recId = String(r.id);
    const audio = audioByRecId.get(recId);
    return {
      id: recId,
      workspaceId: String(r.workspace_id),
      projectId: r.project_id ? String(r.project_id) : null,
      folderId: r.folder_id ? String(r.folder_id) : null,
      title: String(r.title),
      category: String(r.category),
      durationSec: Number(r.duration_sec),
      version: Number(r.version),
      hasAudio: !!audio,
      audioRetentionTier: audio ? (audio.retention_tier as AudioRetentionTier) : undefined,
      audioPurgeAt: audio?.purge_at !== null && audio?.purge_at !== undefined ? Number(audio.purge_at) : null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      tags: tagsByRecId.get(recId) ?? [],
    };
  });

  // 7. Speaker DTO
  const speakers: SpeakerDTO[] = (spkRes?.results ?? []).map((r: any) => ({
    id: String(r.id),
    recordingId: String(r.recording_id),
    workspaceId: String(r.workspace_id),
    label: String(r.label),
    displayName: String(r.display_name),
    color: r.color ?? null,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  // 8. Transcript DTO (menggunakan proyeksi dan validasi segmen yang aman)
  const transcripts: TranscriptDTO[] = (txnRes?.results ?? []).map((r: any) => {
    const segments = sanitizeDialogSegments(r.raw_document_json);
    return {
      id: String(r.id),
      recordingId: String(r.recording_id),
      workspaceId: String(r.workspace_id),
      version: Number(r.version),
      summaryText: r.summary_text ?? null,
      segmentCount: Number(r.segment_count ?? 0),
      wordCount: Number(r.word_count ?? 0),
      checksum: String(r.checksum),
      segments,
      updatedAt: Number(r.updated_at),
    };
  });

  // Metadata Ruang Kerja Publik
  const workspace: WorkspaceDTO = {
    id: String(wsRow.id),
    type: wsRow.type as WorkspaceType,
    name: String(wsRow.name),
    slug: String(wsRow.slug),
    role: wsRow.role as WorkspaceRole,
    createdAt: Number(wsRow.created_at),
    updatedAt: Number(wsRow.updated_at),
  };

  const snapshot: WorkspaceSnapshotDTO = {
    workspace,
    latestSeq: Number(wsRow.latest_change_seq ?? 0),
    minValidSeq: Number(wsRow.min_valid_sync_seq ?? 0),
    entities: {
      projects,
      folders,
      tags,
      recordings,
      audioAssets,
      speakers,
      transcripts,
      recordingTags,
    },
  };

  return jsonResp(snapshot);
}

/**
 * Mengambil delta perubahan inkremental dengan engine delta sinkronisasi R2B.
 */
async function handleGetSync(
  db: D1DatabaseLike,
  userId: string,
  workspaceId: string,
  searchParams: URLSearchParams,
  jsonResp: (data: unknown, status?: number, extraHeaders?: HeadersInit) => Response
): Promise<Response> {
  // 1. Validasi ketat parameter kursor 'since'
  const allSince = searchParams.getAll('since');
  if (allSince.length === 0) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'Parameter query since wajib disertakan'
    );
  }
  if (allSince.length > 1) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'Parameter query since tidak boleh diduplikasi'
    );
  }

  const rawSince = allSince[0].trim();
  if (!/^(?:0|[1-9]\d*)$/.test(rawSince)) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'Parameter since wajib berupa integer non-negatif'
    );
  }

  const sinceSeq = Number(rawSince);
  if (!Number.isSafeInteger(sinceSeq)) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'Parameter since melebihi batas integer aman'
    );
  }

  // 2. Validasi parameter 'limit' (opsional, bounded [1, 500], default 100)
  const allLimit = searchParams.getAll('limit');
  if (allLimit.length > 1) {
    throw new WorkspaceDomainError(
      'INVALID_SYNC_CURSOR',
      400,
      'Parameter query limit tidak boleh diduplikasi'
    );
  }

  let limit = 100;
  if (allLimit.length === 1) {
    const rawLimit = allLimit[0].trim();
    if (!/^[1-9]\d*$/.test(rawLimit)) {
      throw new WorkspaceDomainError(
        'INVALID_SYNC_CURSOR',
        400,
        'Parameter limit wajib berupa integer positif'
      );
    }
    const parsedLimit = Number(rawLimit);
    limit = Math.min(Math.max(parsedLimit, 1), 500);
  }

  // 3. Eksekusi engine delta sinkronisasi atomik R2B
  const delta = await getWorkspaceDelta(db, {
    workspaceId,
    userId,
    sinceSeq,
    limit,
  });

  // 4. Penanganan kursor kedaluwarsa (since < minValidSeq) -> status 409 Conflict
  if (delta.code === 'FULL_RESYNC_REQUIRED') {
    return jsonResp(
      {
        error: {
          code: 'FULL_RESYNC_REQUIRED',
          message: 'Kursor sinkronisasi telah kedaluwarsa, wajib melakukan sinkronisasi penuh',
          details: {
            minValidSeq: delta.minValidSeq,
            currentSeq: delta.currentSeq,
          },
        },
        code: 'FULL_RESYNC_REQUIRED',
        minValidSeq: delta.minValidSeq,
        currentSeq: delta.currentSeq,
      },
      409
    );
  }

  // 5. Respons delta sukses terurut monotonik
  return jsonResp({
    workspaceId,
    latestSeq: delta.latestSeq,
    minValidSeq: delta.minValidSeq,
    nextSeq: delta.nextSeq,
    hasMore: delta.hasMore,
    changes: delta.changes,
  });
}
