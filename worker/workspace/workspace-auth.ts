/**
 * Helper otorisasi dan kontrol akses ruang kerja cloud Catetin.
 * Memastikan setiap operasi diverifikasi secara autoritatif ke database D1
 * tanpa mempercayai data klaim dari sisi klien.
 */

import type { WorkspaceRole, WorkspaceType, SyncEntityType } from '../types/cloud-model.ts';
import type { D1DatabaseLike } from './db-types.ts';
import { WorkspaceDomainError } from './workspace-errors.ts';

export interface WorkspaceAccess {
  workspaceId: string;
  userId: string;
  workspaceType: WorkspaceType;
  role: WorkspaceRole;
  workspaceName: string;
  latestChangeSeq: number;
  minValidSyncSeq: number;
}

export type RequiredPermission = 'read' | 'mutate' | 'manage_members' | 'owner';

/**
 * Memeriksa apakah role tertentu diizinkan membaca data ruang kerja.
 * Semua role (member, admin, owner) berhak membaca.
 */
export function canRead(role: WorkspaceRole): boolean {
  return role === 'member' || role === 'admin' || role === 'owner';
}

/**
 * Memeriksa apakah role tertentu diizinkan memutasi entitas konten normal
 * (rekaman, folder, tag, transkrip, pembicara, aset audio).
 * Semua role (member, admin, owner) berhak melakukan mutasi data biasa.
 */
export function canMutateData(role: WorkspaceRole): boolean {
  return role === 'member' || role === 'admin' || role === 'owner';
}

/**
 * Memeriksa apakah role tertentu diizinkan mengelola anggota tim
 * (mengundang anggota baru, mengubah role member/admin, mengeluarkan member biasa).
 * Hanya admin dan owner yang berhak mengelola keanggotaan.
 */
export function canManageMembers(role: WorkspaceRole): boolean {
  return role === 'admin' || role === 'owner';
}

/**
 * Memeriksa apakah role tertentu memiliki hak khusus pemilik
 * (mentransfer kepemilikan, menghapus ruang kerja, mengelola status owner).
 * Hanya owner yang berhak melakukan tindakan khusus pemilik.
 */
export function canPerformOwnerAction(role: WorkspaceRole): boolean {
  return role === 'owner';
}

/**
 * Memverifikasi level izin akses ruang kerja dan melempar FORBIDDEN jika tidak mencukupi.
 */
export function requireWorkspacePermission(access: WorkspaceAccess, action: RequiredPermission): void {
  let allowed = false;
  switch (action) {
    case 'read':
      allowed = canRead(access.role);
      break;
    case 'mutate':
      allowed = canMutateData(access.role);
      break;
    case 'manage_members':
      allowed = canManageMembers(access.role);
      break;
    case 'owner':
      allowed = canPerformOwnerAction(access.role);
      break;
  }

  if (!allowed) {
    throw new WorkspaceDomainError(
      'FORBIDDEN',
      403,
      'Anda tidak memiliki izin yang cukup untuk melakukan tindakan ini'
    );
  }
}

/**
 * Mengambil status akses pengguna ke ruang kerja secara autoritatif dari D1.
 * Kueri ke ruang kerja pribadi pengguna lain atau ke ruang kerja tim yang bukan haknya
 * diperlakukan sebagai 404 WORKSPACE_NOT_FOUND untuk mencegah resource enumeration.
 */
export async function getWorkspaceAccess(
  db: D1DatabaseLike,
  userId: string,
  workspaceId: string
): Promise<WorkspaceAccess> {
  if (!userId || typeof userId !== 'string') {
    throw new WorkspaceDomainError('UNAUTHORIZED', 401, 'Sesi pengguna tidak valid');
  }

  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  // 1. Ambil data ruang kerja
  const wsRow = await db
    .prepare(
      `SELECT id, type, name, slug, personal_owner_user_id, latest_change_seq, min_valid_sync_seq, deleted_at
       FROM workspace
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(workspaceId)
    .first<any>();

  if (!wsRow) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  // 2. Otorisasi Ruang Kerja Pribadi (Personal)
  if (wsRow.type === 'personal') {
    if (wsRow.personal_owner_user_id !== userId) {
      // Tolak sebagai 404 agar penyerang tidak dapat mendeteksi ID ruang kerja pribadi milik user lain
      throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
    }

    return {
      workspaceId: wsRow.id,
      userId,
      workspaceType: 'personal',
      role: 'owner',
      workspaceName: wsRow.name,
      latestChangeSeq: wsRow.latest_change_seq ?? 0,
      minValidSyncSeq: wsRow.min_valid_sync_seq ?? 0,
    };
  }

  // 3. Otorisasi Ruang Kerja Tim (Team)
  const membership = await db
    .prepare(
      `SELECT role
       FROM workspace_membership
       WHERE workspace_id = ? AND user_id = ?`
    )
    .bind(workspaceId, userId)
    .first<any>();

  if (!membership) {
    // Keanggotaan tidak ditemukan atau sudah dicabut (revoked): respons 404 mencegah pembocoran keberadaan tim
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  return {
    workspaceId: wsRow.id,
    userId,
    workspaceType: 'team',
    role: membership.role as WorkspaceRole,
    workspaceName: wsRow.name,
    latestChangeSeq: wsRow.latest_change_seq ?? 0,
    minValidSyncSeq: wsRow.min_valid_sync_seq ?? 0,
  };
}

/**
 * Perlindungan Pemilik Terakhir Tim (Last Team Owner Protection):
 * Menolak penghapusan atau penurunan peran (demotion) anggota jika ia merupakan satu-satunya
 * pemilik yang tersisa pada ruang kerja tim bersangkutan.
 */
export async function assertCanRemoveOrDemoteMember(
  db: D1DatabaseLike,
  workspaceId: string,
  targetUserId: string,
  nextRole?: WorkspaceRole | null
): Promise<void> {
  const currentMember = await db
    .prepare(
      `SELECT role
       FROM workspace_membership
       WHERE workspace_id = ? AND user_id = ?`
    )
    .bind(workspaceId, targetUserId)
    .first<any>();

  if (!currentMember) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Anggota ruang kerja tidak ditemukan');
  }

  // Jika target bukan owner, atau jika role baru tetap owner, tidak ada risiko hilangnya owner terakhir
  if (currentMember.role !== 'owner' || nextRole === 'owner') {
    return;
  }

  // Hitung jumlah pemilik aktif saat ini
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM workspace_membership
       WHERE workspace_id = ? AND role = 'owner'`
    )
    .bind(workspaceId)
    .first<any>();

  const ownerCount = Number(countRow?.count ?? 0);
  if (ownerCount <= 1) {
    throw new WorkspaceDomainError(
      'LAST_OWNER_REQUIRED',
      409,
      'Pemilik terakhir pada ruang kerja tim tidak dapat dihapus atau diturunkan perannya',
      { workspaceId, targetUserId }
    );
  }
}

/**
 * Diagnosa read-only setelah conditional write menghasilkan 0 affected rows.
 * Memetakan kegagalan secara tepat ke WORKSPACE_NOT_FOUND, FORBIDDEN, atau LAST_OWNER_REQUIRED
 * tanpa membocorkan raw D1/SQLite error ke caller.
 */
async function diagnoseMembershipFailure(
  db: D1DatabaseLike,
  actorUserId: string,
  workspaceId: string,
  targetUserId: string,
  newRole?: WorkspaceRole
): Promise<never> {
  const ws = await db
    .prepare('SELECT id, type, deleted_at FROM workspace WHERE id = ?')
    .bind(workspaceId)
    .first<any>();

  if (!ws || ws.deleted_at !== null) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Ruang kerja tidak ditemukan');
  }

  const actor = await db
    .prepare('SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, actorUserId)
    .first<any>();

  if (!actor || !['owner', 'admin'].includes(actor.role)) {
    throw new WorkspaceDomainError(
      'FORBIDDEN',
      403,
      'Pengguna tidak memiliki izin untuk mengelola anggota ruang kerja'
    );
  }

  const target = await db
    .prepare('SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, targetUserId)
    .first<any>();

  if (!target) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Anggota ruang kerja tidak ditemukan');
  }

  if (actor.role === 'admin') {
    if (target.role === 'owner') {
      throw new WorkspaceDomainError(
        'FORBIDDEN',
        403,
        'Admin tidak memiliki hak untuk mengelola pemilik'
      );
    }
    if (newRole === 'owner') {
      throw new WorkspaceDomainError(
        'FORBIDDEN',
        403,
        'Hanya pemilik yang dapat mengangkat pemilik baru'
      );
    }
  }

  throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Anggota ruang kerja tidak ditemukan');
}

/**
 * Menghapus keanggotaan pengguna dari ruang kerja tim secara atomik.
 * Menggunakan conditional write tunggal yang memeriksa izin actor, target, dan workspace
 * dalam statement DELETE yang sama pada level database.
 */
export async function removeWorkspaceMember(
  db: D1DatabaseLike,
  actorUserId: string,
  workspaceId: string,
  targetUserId: string
): Promise<void> {
  const deleteSql = `
    DELETE FROM workspace_membership
    WHERE workspace_id = ? AND user_id = ?
      AND EXISTS (
        SELECT 1 FROM workspace_membership a
        JOIN workspace w ON w.id = a.workspace_id
        WHERE a.workspace_id = ? AND a.user_id = ?
          AND w.deleted_at IS NULL
          AND a.role IN ('owner', 'admin')
          AND (
            a.role = 'owner'
            OR (a.role = 'admin' AND workspace_membership.role != 'owner')
          )
      )
  `;

  try {
    const res = await db
      .prepare(deleteSql)
      .bind(workspaceId, targetUserId, workspaceId, actorUserId)
      .run();

    const changes = Number((res?.meta as any)?.changes ?? 0);
    if (changes === 0) {
      await diagnoseMembershipFailure(db, actorUserId, workspaceId, targetUserId);
    }
  } catch (err: any) {
    if (err instanceof WorkspaceDomainError) throw err;
    const msg = String(err?.message ?? err);
    if (msg.includes('LAST_OWNER_REQUIRED')) {
      throw new WorkspaceDomainError(
        'LAST_OWNER_REQUIRED',
        409,
        'Pemilik terakhir pada ruang kerja tim tidak dapat dihapus atau diturunkan perannya',
        { workspaceId, targetUserId }
      );
    }
    throw new WorkspaceDomainError(
      'INTERNAL_OPERATION_FAILED',
      500,
      'Terjadi kesalahan internal saat memproses keanggotaan ruang kerja'
    );
  }
}

/**
 * Mengubah peran keanggotaan pengguna dalam ruang kerja tim secara atomik.
 * Menggunakan conditional write tunggal yang menegakkan hierarki izin actor pada level database.
 */
export async function updateWorkspaceMemberRole(
  db: D1DatabaseLike,
  actorUserId: string,
  workspaceId: string,
  targetUserId: string,
  newRole: WorkspaceRole
): Promise<void> {
  const now = Date.now();
  const updateSql = `
    UPDATE workspace_membership
    SET role = ?, updated_at = ?
    WHERE workspace_id = ? AND user_id = ?
      AND EXISTS (
        SELECT 1 FROM workspace_membership a
        JOIN workspace w ON w.id = a.workspace_id
        WHERE a.workspace_id = ? AND a.user_id = ?
          AND w.deleted_at IS NULL
          AND a.role IN ('owner', 'admin')
          AND (
            a.role = 'owner'
            OR (a.role = 'admin' AND workspace_membership.role != 'owner' AND ? != 'owner')
          )
      )
  `;

  try {
    const res = await db
      .prepare(updateSql)
      .bind(newRole, now, workspaceId, targetUserId, workspaceId, actorUserId, newRole)
      .run();

    const changes = Number((res?.meta as any)?.changes ?? 0);
    if (changes === 0) {
      await diagnoseMembershipFailure(db, actorUserId, workspaceId, targetUserId, newRole);
    }
  } catch (err: any) {
    if (err instanceof WorkspaceDomainError) throw err;
    const msg = String(err?.message ?? err);
    if (msg.includes('LAST_OWNER_REQUIRED')) {
      throw new WorkspaceDomainError(
        'LAST_OWNER_REQUIRED',
        409,
        'Pemilik terakhir pada ruang kerja tim tidak dapat dihapus atau diturunkan perannya',
        { workspaceId, targetUserId }
      );
    }
    throw new WorkspaceDomainError(
      'INTERNAL_OPERATION_FAILED',
      500,
      'Terjadi kesalahan internal saat memproses keanggotaan ruang kerja'
    );
  }
}

/**
 * Memastikan bahwa suatu entitas sinkronisasi bernaung di bawah ruang kerja yang tepat.
 * Resource lintas ruang kerja ditolak dengan status 404.
 */
export async function assertEntityBelongsToWorkspace(
  db: D1DatabaseLike,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string
): Promise<void> {
  const tableMap: Record<SyncEntityType, string> = {
    project: 'project',
    folder: 'folder',
    recording: 'recording',
    transcript: 'transcript',
    tag: 'tag',
    audio_asset: 'audio_asset',
    speaker: 'speaker',
    recording_tag: 'recording_tag',
  };

  const tableName = tableMap[entityType];
  if (!tableName) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Tipe entitas tidak dikenal');
  }

  const row = await db
    .prepare(`SELECT id, workspace_id, deleted_at FROM ${tableName} WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, entityId)
    .first<any>();

  if (!row || row.deleted_at !== null) {
    throw new WorkspaceDomainError('WORKSPACE_NOT_FOUND', 404, 'Resource tidak ditemukan');
  }
}
