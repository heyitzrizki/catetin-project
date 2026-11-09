import type { DialogSegmentDTO, SyncEntityType } from '../types/cloud-model.ts';
import {
  isTranscriptPayloadWithinLimit,
  normalizeTagName,
} from '../types/cloud-model.ts';
import { WorkspaceDomainError } from './workspace-errors.ts';
import { hashCanonicalPayload, type TypedDomainMutationAction } from './sync-engine.ts';

export type PublicMutationAction = 'insert' | 'update' | 'delete';

export const ALLOWED_PUBLIC_ENTITY_TYPES: readonly SyncEntityType[] = [
  'project',
  'folder',
  'recording',
  'transcript',
  'tag',
  'speaker',
  'recording_tag',
] as const;

export interface PublicMutationRequest {
  clientMutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  action: PublicMutationAction;
  expectedVersion?: number;
  payload?: Record<string, unknown> | null;
}

export interface ValidatedMutationPlan {
  action: TypedDomainMutationAction;
  attributes: Record<string, unknown>;
  sanitizedResponseData: Record<string, unknown> | null;
  canonicalPublicPayload: Record<string, unknown>;
}

// Regex identifier aman: alfanumerik, underscore, dash, titik; panjang 1 sampai 128 karakter
const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_\-\.]{1,128}$/;

// Regex format warna heksadesimal (#RGB atau #RRGGBB)
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Daftar nama warna standar yang diizinkan
const ALLOWED_COLOR_PRESETS = new Set([
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'pink', 'rose',
]);

/**
 * Validasi identifier agar terhindar dari path traversal, spasi, atau injeksi karakter khusus.
 */
export function isValidIdentifier(id: unknown): id is string {
  return typeof id === 'string' && SAFE_IDENTIFIER_REGEX.test(id);
}

/**
 * Validasi format warna yang didukung produk.
 */
export function isValidColor(color: unknown): boolean {
  if (color === null || color === undefined) return true;
  if (typeof color !== 'string') return false;
  const trimmed = color.trim().toLowerCase();
  if (!trimmed) return true;
  return HEX_COLOR_REGEX.test(trimmed) || ALLOWED_COLOR_PRESETS.has(trimmed);
}

/**
 * Menghitung jumlah kata secara deterministik dari kumpulan segmen dialog.
 */
export function calculateTranscriptWordCount(segments: { text?: string }[]): number {
  let totalWords = 0;
  for (const seg of segments) {
    if (typeof seg.text === 'string' && seg.text.trim().length > 0) {
      const words = seg.text.trim().split(/\s+/).filter(Boolean);
      totalWords += words.length;
    }
  }
  return totalWords;
}

/**
 * Memeriksa kedalaman rekursi struktur JSON untuk mencegah stack overflow pada payload bersarang.
 */
export function checkObjectDepth(obj: unknown, maxDepth = 10, currentDepth = 0): boolean {
  if (currentDepth > maxDepth) return false;
  if (!obj || typeof obj !== 'object') return true;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === 'object') {
      if (!checkObjectDepth(val, maxDepth, currentDepth + 1)) return false;
    }
  }
  return true;
}

/**
 * Validasi struktur envelope tingkat teratas dari permintaan mutasi publik.
 */
export function validateTopLevelMutationRequest(body: unknown): PublicMutationRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new WorkspaceDomainError(
      'INVALID_REQUEST_BODY',
      400,
      'Request body harus berupa JSON object'
    );
  }

  const raw = body as Record<string, unknown>;

  // Daftar kunci yang diizinkan secara ketat pada root request
  const allowedKeys = new Set([
    'clientMutationId',
    'entityType',
    'entityId',
    'action',
    'expectedVersion',
    'payload',
  ]);

  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      throw new WorkspaceDomainError(
        'INVALID_REQUEST_BODY',
        400,
        `Field '${key}' tidak diizinkan pada payload mutasi`
      );
    }
  }

  // 1. Validasi clientMutationId
  if (!isValidIdentifier(raw.clientMutationId)) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'clientMutationId wajib berupa identifier aman non-kosong'
    );
  }

  // 2. Validasi entityType
  const entityType = raw.entityType as SyncEntityType;
  if (entityType === 'audio_asset') {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Mutasi audio_asset tidak diizinkan melalui public mutation API'
    );
  }

  if (!ALLOWED_PUBLIC_ENTITY_TYPES.includes(entityType)) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      `Tipe entitas tidak didukung: ${String(raw.entityType)}`
    );
  }

  // 3. Validasi entityId
  if (!isValidIdentifier(raw.entityId)) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'entityId wajib berupa identifier aman non-kosong'
    );
  }

  // 4. Validasi action
  const action = raw.action as PublicMutationAction;
  if (action !== 'insert' && action !== 'update' && action !== 'delete') {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      `Aksi mutasi tidak valid: ${String(raw.action)}`
    );
  }

  // 5. Validasi expectedVersion (CAS)
  let expectedVersion: number | undefined;
  if (action === 'insert') {
    if (raw.expectedVersion !== undefined && raw.expectedVersion !== null) {
      if (raw.expectedVersion !== 0) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          'expectedVersion untuk aksi insert harus bernilai 0 atau tidak disertakan'
        );
      }
      expectedVersion = 0;
    } else {
      expectedVersion = 0;
    }
  } else {
    // update atau delete wajib integer positif
    if (
      typeof raw.expectedVersion !== 'number' ||
      !Number.isInteger(raw.expectedVersion) ||
      raw.expectedVersion <= 0 ||
      Number.isNaN(raw.expectedVersion)
    ) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `expectedVersion wajib berupa integer positif untuk aksi ${action}`
      );
    }
    expectedVersion = raw.expectedVersion;
  }

  // 6. Validasi payload object
  let payload: Record<string, unknown> | null = null;
  if (action === 'delete') {
    if (raw.payload !== undefined && raw.payload !== null) {
      if (typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
        throw new WorkspaceDomainError(
          'INVALID_REQUEST_BODY',
          400,
          'Payload untuk aksi delete harus berupa object kosong'
        );
      }
      if (Object.keys(raw.payload).length > 0) {
        throw new WorkspaceDomainError(
          'INVALID_REQUEST_BODY',
          400,
          'Payload untuk aksi delete harus kosong'
        );
      }
    }
    payload = {};
  } else {
    if (!raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
      throw new WorkspaceDomainError(
        'INVALID_REQUEST_BODY',
        400,
        `Payload untuk aksi ${action} wajib berupa JSON object`
      );
    }
    payload = raw.payload as Record<string, unknown>;
  }

  return {
    clientMutationId: raw.clientMutationId,
    entityType,
    entityId: raw.entityId,
    action,
    expectedVersion,
    payload,
  };
}

/**
 * Memastikan tidak ada field asing yang tidak diizinkan dalam payload entitas.
 */
function assertOnlyAllowedFields(
  payload: Record<string, unknown>,
  allowed: string[],
  entityName: string
) {
  const allowedSet = new Set(allowed);
  for (const k of Object.keys(payload)) {
    if (!allowedSet.has(k)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Field '${k}' tidak diizinkan pada payload ${entityName}`
      );
    }
  }
}

/**
 * Validasi dan pemetaan entitas 'project'.
 */
export function mapProjectPayload(
  action: PublicMutationAction,
  entityId: string,
  payload: Record<string, unknown>
): ValidatedMutationPlan {
  if (action === 'delete') {
    return {
      action: 'delete',
      attributes: {},
      sanitizedResponseData: null,
      canonicalPublicPayload: {},
    };
  }

  assertOnlyAllowedFields(payload, ['name', 'description'], 'project');

  if (action === 'insert') {
    if (typeof payload.name !== 'string' || !payload.name.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field name wajib berupa string tidak kosong pada project'
      );
    }
    const name = payload.name.trim().slice(0, 255);
    let description: string | null = null;
    if (payload.description !== undefined && payload.description !== null) {
      if (typeof payload.description !== 'string') {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          'Field description harus berupa string atau null'
        );
      }
      description = payload.description.trim().slice(0, 1000);
    }

    const attrs: Record<string, unknown> = { name, description };
    return {
      action: 'insert',
      attributes: attrs,
      sanitizedResponseData: { id: entityId, name, description },
      canonicalPublicPayload: { name, description },
    };
  }

  // update
  const hasName = 'name' in payload && payload.name !== undefined;
  const hasDesc = 'description' in payload && payload.description !== undefined;

  if (!hasName && !hasDesc) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Minimal satu field (name atau description) wajib diisi untuk update project'
    );
  }

  const attrs: Record<string, unknown> = {};
  const canonicalPayload: Record<string, unknown> = {};

  if (hasName) {
    if (typeof payload.name !== 'string' || !payload.name.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field name wajib berupa string tidak kosong pada project'
      );
    }
    const name = payload.name.trim().slice(0, 255);
    attrs.name = name;
    canonicalPayload.name = name;
  }

  if (hasDesc) {
    if (payload.description === null) {
      attrs.description = null;
      canonicalPayload.description = null;
    } else if (typeof payload.description === 'string') {
      const desc = payload.description.trim().slice(0, 1000);
      attrs.description = desc;
      canonicalPayload.description = desc;
    } else {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field description harus berupa string atau null'
      );
    }
  }

  return {
    action: 'update',
    attributes: attrs,
    sanitizedResponseData: { id: entityId, ...attrs },
    canonicalPublicPayload: canonicalPayload,
  };
}

/**
 * Validasi dan pemetaan entitas 'folder'.
 */
export function mapFolderPayload(
  action: PublicMutationAction,
  entityId: string,
  payload: Record<string, unknown>
): ValidatedMutationPlan {
  if (action === 'delete') {
    return {
      action: 'delete',
      attributes: {},
      sanitizedResponseData: null,
      canonicalPublicPayload: {},
    };
  }

  if (action === 'insert') {
    assertOnlyAllowedFields(payload, ['projectId', 'name', 'color'], 'folder');

    if (!isValidIdentifier(payload.projectId)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field projectId wajib berupa identifier valid pada folder'
      );
    }

    if (typeof payload.name !== 'string' || !payload.name.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field name wajib berupa string tidak kosong pada folder'
      );
    }

    if (!isValidColor(payload.color)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Format color folder tidak valid'
      );
    }

    const projectId = payload.projectId;
    const name = payload.name.trim().slice(0, 255);
    const color = payload.color ? String(payload.color).trim().toLowerCase() : null;

    const attrs = { project_id: projectId, name, color };
    return {
      action: 'insert',
      attributes: attrs,
      sanitizedResponseData: { id: entityId, projectId, name, color },
      canonicalPublicPayload: { projectId, name, color },
    };
  }

  // update
  assertOnlyAllowedFields(payload, ['name', 'color'], 'folder');

  const hasName = 'name' in payload && payload.name !== undefined;
  const hasColor = 'color' in payload && payload.color !== undefined;

  if (!hasName && !hasColor) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Minimal satu field (name atau color) wajib diisi untuk update folder'
    );
  }

  const attrs: Record<string, unknown> = {};
  const canonicalPayload: Record<string, unknown> = {};

  if (hasName) {
    if (typeof payload.name !== 'string' || !payload.name.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field name wajib berupa string tidak kosong pada folder'
      );
    }
    const name = payload.name.trim().slice(0, 255);
    attrs.name = name;
    canonicalPayload.name = name;
  }

  if (hasColor) {
    if (!isValidColor(payload.color)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Format color folder tidak valid'
      );
    }
    const color = payload.color ? String(payload.color).trim().toLowerCase() : null;
    attrs.color = color;
    canonicalPayload.color = color;
  }

  return {
    action: 'update',
    attributes: attrs,
    sanitizedResponseData: { id: entityId, ...attrs },
    canonicalPublicPayload: canonicalPayload,
  };
}

/**
 * Validasi dan pemetaan entitas 'tag'.
 */
export function mapTagPayload(
  action: PublicMutationAction,
  entityId: string,
  payload: Record<string, unknown>
): ValidatedMutationPlan {
  if (action === 'delete') {
    return {
      action: 'delete',
      attributes: {},
      sanitizedResponseData: null,
      canonicalPublicPayload: {},
    };
  }

  assertOnlyAllowedFields(payload, ['name'], 'tag');

  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Field name wajib berupa string tidak kosong pada tag'
    );
  }

  const trimmedName = payload.name.trim().replace(/\s+/g, ' ').slice(0, 64);
  const normalizedName = normalizeTagName(trimmedName);

  if (!normalizedName) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Nama tag tidak boleh kosong setelah dinormalisasi'
    );
  }

  const attrs = {
    name: trimmedName,
    normalized_name: normalizedName,
  };

  return {
    action: action === 'insert' ? 'insert' : 'update',
    attributes: attrs,
    sanitizedResponseData: { id: entityId, name: trimmedName, normalizedName },
    canonicalPublicPayload: { name: trimmedName },
  };
}

/**
 * Validasi dan pemetaan entitas 'recording'.
 */
export function mapRecordingPayload(
  action: PublicMutationAction,
  entityId: string,
  payload: Record<string, unknown>
): ValidatedMutationPlan {
  if (action === 'delete') {
    return {
      action: 'delete',
      attributes: {},
      sanitizedResponseData: null,
      canonicalPublicPayload: {},
    };
  }

  if (action === 'insert') {
    assertOnlyAllowedFields(
      payload,
      ['title', 'category', 'durationSec', 'projectId', 'folderId'],
      'recording'
    );

    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field title wajib berupa string tidak kosong pada recording'
      );
    }
    const title = payload.title.trim().slice(0, 255);

    let category = 'general';
    if (payload.category !== undefined && payload.category !== null) {
      if (typeof payload.category !== 'string' || !payload.category.trim()) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          'Field category harus berupa string tidak kosong'
        );
      }
      category = payload.category.trim().slice(0, 64);
    }

    let durationSec = 0.0;
    if (payload.durationSec !== undefined && payload.durationSec !== null) {
      if (
        typeof payload.durationSec !== 'number' ||
        !Number.isFinite(payload.durationSec) ||
        payload.durationSec < 0
      ) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          'Field durationSec harus berupa angka non-negatif yang finite'
        );
      }
      durationSec = payload.durationSec;
    }

    let projectId: string | null = null;
    if (payload.projectId !== undefined && payload.projectId !== null) {
      if (!isValidIdentifier(payload.projectId)) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          'Field projectId harus berupa identifier valid'
        );
      }
      projectId = payload.projectId;
    }

    let folderId: string | null = null;
    if (payload.folderId !== undefined && payload.folderId !== null) {
      if (!isValidIdentifier(payload.folderId)) {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          'Field folderId harus berupa identifier valid'
        );
      }
      folderId = payload.folderId;
    }

    const attrs = {
      title,
      category,
      duration_sec: durationSec,
      project_id: projectId,
      folder_id: folderId,
    };

    return {
      action: 'insert',
      attributes: attrs,
      sanitizedResponseData: {
        id: entityId,
        title,
        category,
        durationSec,
        projectId,
        folderId,
      },
      canonicalPublicPayload: {
        title,
        category,
        durationSec,
        projectId,
        folderId,
      },
    };
  }

  // update
  assertOnlyAllowedFields(
    payload,
    ['title', 'category', 'durationSec', 'folderId'],
    'recording'
  );

  const hasTitle = 'title' in payload && payload.title !== undefined;
  const hasCategory = 'category' in payload && payload.category !== undefined;
  const hasDuration = 'durationSec' in payload && payload.durationSec !== undefined;
  const hasFolder = 'folderId' in payload && payload.folderId !== undefined;

  if (!hasTitle && !hasCategory && !hasDuration && !hasFolder) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Minimal satu field (title, category, durationSec, atau folderId) wajib diisi untuk update recording'
    );
  }

  const attrs: Record<string, unknown> = {};
  const canonicalPayload: Record<string, unknown> = {};

  if (hasTitle) {
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field title wajib berupa string tidak kosong pada recording'
      );
    }
    const title = payload.title.trim().slice(0, 255);
    attrs.title = title;
    canonicalPayload.title = title;
  }

  if (hasCategory) {
    if (typeof payload.category === 'string' && payload.category.trim()) {
      const cat = payload.category.trim().slice(0, 64);
      attrs.category = cat;
      canonicalPayload.category = cat;
    } else {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field category harus berupa string tidak kosong'
      );
    }
  }

  if (hasDuration) {
    if (
      typeof payload.durationSec === 'number' &&
      Number.isFinite(payload.durationSec) &&
      payload.durationSec >= 0
    ) {
      attrs.duration_sec = payload.durationSec;
      canonicalPayload.durationSec = payload.durationSec;
    } else {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field durationSec harus berupa angka non-negatif yang finite'
      );
    }
  }

  if (hasFolder) {
    if (payload.folderId === null) {
      attrs.folder_id = null;
      canonicalPayload.folderId = null;
    } else if (isValidIdentifier(payload.folderId)) {
      attrs.folder_id = payload.folderId;
      canonicalPayload.folderId = payload.folderId;
    } else {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field folderId harus berupa identifier valid atau null'
      );
    }
  }

  return {
    action: 'update',
    attributes: attrs,
    sanitizedResponseData: { id: entityId, ...attrs },
    canonicalPublicPayload: canonicalPayload,
  };
}

/**
 * Validasi dan pemetaan entitas 'speaker'.
 */
export function mapSpeakerPayload(
  action: PublicMutationAction,
  entityId: string,
  payload: Record<string, unknown>
): ValidatedMutationPlan {
  if (action === 'delete') {
    return {
      action: 'delete',
      attributes: {},
      sanitizedResponseData: null,
      canonicalPublicPayload: {},
    };
  }

  if (action === 'insert') {
    assertOnlyAllowedFields(payload, ['recordingId', 'label', 'displayName', 'color'], 'speaker');

    if (!isValidIdentifier(payload.recordingId)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field recordingId wajib berupa identifier valid pada speaker'
      );
    }

    if (typeof payload.label !== 'string' || !payload.label.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field label wajib berupa string tidak kosong pada speaker'
      );
    }

    if (typeof payload.displayName !== 'string' || !payload.displayName.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field displayName wajib berupa string tidak kosong pada speaker'
      );
    }

    if (!isValidColor(payload.color)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Format color speaker tidak valid'
      );
    }

    const recordingId = payload.recordingId;
    const label = payload.label.trim().slice(0, 128);
    const displayName = payload.displayName.trim().slice(0, 128);
    const color = payload.color ? String(payload.color).trim().toLowerCase() : null;

    const attrs = {
      recording_id: recordingId,
      label,
      display_name: displayName,
      color,
    };

    return {
      action: 'insert',
      attributes: attrs,
      sanitizedResponseData: { id: entityId, recordingId, label, displayName, color },
      canonicalPublicPayload: { recordingId, label, displayName, color },
    };
  }

  // update
  assertOnlyAllowedFields(payload, ['displayName', 'color'], 'speaker');

  const hasName = 'displayName' in payload && payload.displayName !== undefined;
  const hasColor = 'color' in payload && payload.color !== undefined;

  if (!hasName && !hasColor) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Minimal satu field (displayName atau color) wajib diisi untuk update speaker'
    );
  }

  const attrs: Record<string, unknown> = {};
  const canonicalPayload: Record<string, unknown> = {};

  if (hasName) {
    if (typeof payload.displayName !== 'string' || !payload.displayName.trim()) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field displayName wajib berupa string tidak kosong pada speaker'
      );
    }
    const displayName = payload.displayName.trim().slice(0, 128);
    attrs.display_name = displayName;
    canonicalPayload.displayName = displayName;
  }

  if (hasColor) {
    if (!isValidColor(payload.color)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Format color speaker tidak valid'
      );
    }
    const color = payload.color ? String(payload.color).trim().toLowerCase() : null;
    attrs.color = color;
    canonicalPayload.color = color;
  }

  return {
    action: 'update',
    attributes: attrs,
    sanitizedResponseData: { id: entityId, ...attrs },
    canonicalPublicPayload: canonicalPayload,
  };
}

/**
 * Validasi dan pemetaan entitas 'recording_tag'.
 */
export function mapRecordingTagPayload(
  action: PublicMutationAction,
  entityId: string,
  payload: Record<string, unknown>
): ValidatedMutationPlan {
  if (action === 'delete') {
    return {
      action: 'delete',
      attributes: {},
      sanitizedResponseData: null,
      canonicalPublicPayload: {},
    };
  }

  if (action === 'update') {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Operasi update tidak didukung untuk recording_tag'
    );
  }

  // insert
  assertOnlyAllowedFields(payload, ['recordingId', 'tagId'], 'recording_tag');

  if (!isValidIdentifier(payload.recordingId)) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Field recordingId wajib berupa identifier valid pada recording_tag'
    );
  }

  if (!isValidIdentifier(payload.tagId)) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Field tagId wajib berupa identifier valid pada recording_tag'
    );
  }

  const recordingId = payload.recordingId;
  const tagId = payload.tagId;

  const attrs = {
    recording_id: recordingId,
    tag_id: tagId,
  };

  return {
    action: 'insert',
    attributes: attrs,
    sanitizedResponseData: { id: entityId, recordingId, tagId },
    canonicalPublicPayload: { recordingId, tagId },
  };
}

const MAX_TRANSCRIPT_SEGMENTS = 5000;
const MAX_SEGMENT_LABEL_CHARS = 128;
const MAX_SEGMENT_TIME_CHARS = 32;
const MAX_SEGMENT_TEXT_CHARS = 10000;

/**
 * Validator ketat sisi mutasi untuk dokumen transkrip publik.
 * Menolak seluruh mutasi jika ada segmen yang malformed (tanpa silent skip,
 * tanpa silent truncation, dan tanpa mutasi nilai). Field internal/provider asing
 * hanya dibuang setelah seluruh field wajib segmen dinyatakan valid.
 */
export function validateMutationTranscriptDocument(rawDoc: unknown): {
  segments: DialogSegmentDTO[];
  canonicalDocJson: string;
} {
  if (!rawDoc || typeof rawDoc !== 'object' || Array.isArray(rawDoc)) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Field documentJson wajib berupa JSON object dengan properti segments'
    );
  }

  const docObj = rawDoc as Record<string, unknown>;
  assertOnlyAllowedFields(docObj, ['segments'], 'documentJson');

  if (!Array.isArray(docObj.segments)) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Properti segments pada documentJson wajib berupa array'
    );
  }

  if (docObj.segments.length > MAX_TRANSCRIPT_SEGMENTS) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      `Jumlah segmen transkrip melebihi batas maksimum ${MAX_TRANSCRIPT_SEGMENTS} segmen`
    );
  }

  const validatedSegments: DialogSegmentDTO[] = [];

  for (let i = 0; i < docObj.segments.length; i++) {
    const item = docObj.segments[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Segmen transkrip pada indeks ${i} harus berupa JSON object`
      );
    }

    const seg = item as Record<string, unknown>;

    // 1. Validasi ketat id (string non-kosong tanpa leading/trailing whitespace, maks 128 karakter)
    if (
      typeof seg.id !== 'string' ||
      seg.id.trim().length === 0 ||
      seg.id !== seg.id.trim() ||
      seg.id.length > MAX_SEGMENT_LABEL_CHARS
    ) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Field id pada segmen indeks ${i} tidak valid`
      );
    }

    // 2. Validasi ketat speaker (string non-kosong tanpa leading/trailing whitespace, maks 128 karakter)
    if (
      typeof seg.speaker !== 'string' ||
      seg.speaker.trim().length === 0 ||
      seg.speaker !== seg.speaker.trim() ||
      seg.speaker.length > MAX_SEGMENT_LABEL_CHARS
    ) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Field speaker pada segmen indeks ${i} tidak valid`
      );
    }

    // 3. Validasi ketat seconds (angka finite non-negatif)
    if (
      typeof seg.seconds !== 'number' ||
      !Number.isFinite(seg.seconds) ||
      Number.isNaN(seg.seconds) ||
      seg.seconds < 0
    ) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Field seconds pada segmen indeks ${i} harus berupa angka finite non-negatif`
      );
    }

    // 4. Validasi ketat time (string non-kosong tanpa leading/trailing whitespace, maks 32 karakter)
    if (
      typeof seg.time !== 'string' ||
      seg.time.trim().length === 0 ||
      seg.time !== seg.time.trim() ||
      seg.time.length > MAX_SEGMENT_TIME_CHARS
    ) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Field time pada segmen indeks ${i} tidak valid`
      );
    }

    // 5. Validasi ketat text (string non-kosong setelah trim, maks 10000 karakter tanpa pemotongan diam-diam)
    if (
      typeof seg.text !== 'string' ||
      seg.text.trim().length === 0 ||
      seg.text.length > MAX_SEGMENT_TEXT_CHARS
    ) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        `Field text pada segmen indeks ${i} tidak valid`
      );
    }

    // Seluruh field wajib valid: proyeksikan hanya field skema publik dan buang field internal provider
    validatedSegments.push({
      id: seg.id,
      speaker: seg.speaker,
      seconds: seg.seconds,
      time: seg.time,
      text: seg.text,
    });
  }

  const canonicalDocJson = JSON.stringify({ segments: validatedSegments });

  if (!isTranscriptPayloadWithinLimit(canonicalDocJson)) {
    throw new WorkspaceDomainError(
      'PAYLOAD_TOO_LARGE',
      413,
      'Ukuran documentJson melebihi batas keamanan produk 1 MB'
    );
  }

  return {
    segments: validatedSegments,
    canonicalDocJson,
  };
}

/**
 * Validasi dan pemetaan entitas 'transcript'.
 */
export async function mapTranscriptPayload(
  action: PublicMutationAction,
  entityId: string,
  payload: Record<string, unknown>
): Promise<ValidatedMutationPlan> {
  if (action === 'delete') {
    return {
      action: 'delete',
      attributes: {},
      sanitizedResponseData: null,
      canonicalPublicPayload: {},
    };
  }

  if (action === 'insert') {
    assertOnlyAllowedFields(
      payload,
      ['recordingId', 'documentJson', 'summaryText'],
      'transcript'
    );

    if (!isValidIdentifier(payload.recordingId)) {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field recordingId wajib berupa identifier valid pada transcript'
      );
    }

    const { segments: validatedSegments, canonicalDocJson } =
      validateMutationTranscriptDocument(payload.documentJson);

    const checksum = await hashCanonicalPayload(canonicalDocJson);
    const segmentCount = validatedSegments.length;
    const wordCount = calculateTranscriptWordCount(validatedSegments);

    let summaryText: string | null = null;
    if (payload.summaryText !== undefined && payload.summaryText !== null) {
      if (typeof payload.summaryText !== 'string') {
        throw new WorkspaceDomainError(
          'INVALID_MUTATION_PLAN',
          400,
          'Field summaryText harus berupa string atau null'
        );
      }
      summaryText = payload.summaryText.trim().slice(0, 5000);
    }

    const attrs = {
      recording_id: payload.recordingId,
      raw_document_json: canonicalDocJson,
      checksum,
      summary_text: summaryText,
      segment_count: segmentCount,
      word_count: wordCount,
    };

    return {
      action: 'insert',
      attributes: attrs,
      sanitizedResponseData: {
        id: entityId,
        recordingId: payload.recordingId,
        checksum,
        summaryText,
        segmentCount,
        wordCount,
      },
      canonicalPublicPayload: {
        recordingId: payload.recordingId,
        documentJson: { segments: validatedSegments },
        summaryText,
      },
    };
  }

  // update
  assertOnlyAllowedFields(payload, ['documentJson', 'summaryText'], 'transcript');

  const hasDoc = 'documentJson' in payload && payload.documentJson !== undefined;
  const hasSummary = 'summaryText' in payload && payload.summaryText !== undefined;

  if (!hasDoc && !hasSummary) {
    throw new WorkspaceDomainError(
      'INVALID_MUTATION_PLAN',
      400,
      'Minimal satu field (documentJson atau summaryText) wajib diisi untuk update transcript'
    );
  }

  const attrs: Record<string, unknown> = {};
  const canonicalPayload: Record<string, unknown> = {};
  const responseData: Record<string, unknown> = { id: entityId };

  if (hasDoc) {
    const { segments: validatedSegments, canonicalDocJson } =
      validateMutationTranscriptDocument(payload.documentJson);

    const checksum = await hashCanonicalPayload(canonicalDocJson);
    const segmentCount = validatedSegments.length;
    const wordCount = calculateTranscriptWordCount(validatedSegments);

    attrs.raw_document_json = canonicalDocJson;
    attrs.checksum = checksum;
    attrs.segment_count = segmentCount;
    attrs.word_count = wordCount;

    canonicalPayload.documentJson = { segments: validatedSegments };
    responseData.checksum = checksum;
    responseData.segmentCount = segmentCount;
    responseData.wordCount = wordCount;
  }

  if (hasSummary) {
    if (payload.summaryText === null) {
      attrs.summary_text = null;
      canonicalPayload.summaryText = null;
      responseData.summaryText = null;
    } else if (typeof payload.summaryText === 'string') {
      const summary = payload.summaryText.trim().slice(0, 5000);
      attrs.summary_text = summary;
      canonicalPayload.summaryText = summary;
      responseData.summaryText = summary;
    } else {
      throw new WorkspaceDomainError(
        'INVALID_MUTATION_PLAN',
        400,
        'Field summaryText harus berupa string atau null'
      );
    }
  }

  return {
    action: 'update',
    attributes: attrs,
    sanitizedResponseData: responseData,
    canonicalPublicPayload: canonicalPayload,
  };
}
