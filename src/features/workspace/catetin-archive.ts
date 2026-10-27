import { Unzip, UnzipInflate, zipSync, strToU8, strFromU8 } from 'fflate';
import {
  openWorkspaceDatabase,
  cleanTags,
  DEFAULT_PROJECT_ID,
  isDemoRecordingId,
  type ProjectRecord,
  type FolderRecord,
  type RecordingRecord,
  type TranscriptRecord,
} from './workspace-store';
import { formatBytes } from './storage-adapter';

export const CATETIN_ARCHIVE_FORMAT = 'catetin-archive';
export const CURRENT_ARCHIVE_VERSION = 1;

export interface ArchiveGuardrails {
  maxArchiveBytes: number;
  maxEntries: number;
  maxSingleFileBytes: number;
  maxTotalExtractedBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_ARCHIVE_GUARDRAILS: ArchiveGuardrails = {
  maxArchiveBytes: 250 * 1024 * 1024, // 250 MB compressed
  maxEntries: 500, // Maximum total entries in ZIP
  maxSingleFileBytes: 100 * 1024 * 1024, // 100 MB per single file
  maxTotalExtractedBytes: 400 * 1024 * 1024, // 400 MB total uncompressed
  maxCompressionRatio: 100, // Maximum decompression expansion ratio
};

export interface ArchiveCounts {
  projects: number;
  folders: number;
  recordings: number;
  transcripts: number;
  audio: number;
}

export interface CatetinManifest {
  format: 'catetin-archive';
  version: number;
  appVersion: string;
  exportedAt: number;
  scope: 'project' | 'workspace';
  projectId?: string;
  projectTitle?: string;
  includeAudio: boolean;
  counts: ArchiveCounts;
  missingAudioCount?: number;
  missingAudioRecordings?: string[];
  checksum: string;
}

export interface AudioMeta {
  recordingId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  pathInZip: string;
}

export interface CatetinArchiveData {
  projects: ProjectRecord[];
  folders: FolderRecord[];
  recordings: RecordingRecord[];
  transcripts: TranscriptRecord[];
  audioMeta?: AudioMeta[];
}

export interface ArchiveValidationResult {
  valid: boolean;
  error?: string;
  manifest?: CatetinManifest;
  data?: CatetinArchiveData;
  audioBinaries?: Map<string, Uint8Array>;
  warnings: string[];
}

export interface ImportResult {
  success: boolean;
  message: string;
  counts: ArchiveCounts;
  warnings: string[];
}

export interface ExportArchiveResult {
  blob: Blob;
  filename: string;
  manifest: CatetinManifest;
  warnings: string[];
}

const S = {
  projects: 'projects',
  recordings: 'recordings',
  transcripts: 'transcripts',
  audio: 'audio',
  folders: 'folders',
  meta: 'meta',
} as const;

const idbRequest = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function sanitizeFilenameSlug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned.slice(0, 30) || 'proyek');
}

export function generateArchiveFilename(
  scope: 'project' | 'workspace',
  projectTitle?: string,
  now = new Date()
): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  if (scope === 'project' && projectTitle) {
    const slug = sanitizeFilenameSlug(projectTitle);
    return `catetin-proyek-${slug}-${dateStr}.catetin`;
  }
  return `catetin-workspace-${dateStr}.catetin`;
}

/**
 * Computes standard SHA-256 hex digest for string or binary payload.
 */
export async function computeSha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
      return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback
    }
  }

  // Pure-JS FNV-1a 64-bit approximation fallback for environments without WebCrypto
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= bytes[i] + (i % 256);
    h2 = Math.imul(h2, 0x01000193);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).repeat(4).slice(0, 64);
}

function generateUniqueId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 8);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${rand}`;
}

/**
 * Safely unzips an archive while enforcing strict entry whitelist and resource guardrails.
 */
function safeUnzipArchive(
  u8Data: Uint8Array,
  limits: ArchiveGuardrails
): Promise<{ entries: Map<string, Uint8Array>; totalExtractedBytes: number }> {
  return new Promise((resolve, reject) => {
    if (u8Data.byteLength > limits.maxArchiveBytes) {
      return reject(
        new Error(`Ukuran arsip (${formatBytes(u8Data.byteLength)}) melebihi batas maksimum (${formatBytes(limits.maxArchiveBytes)}).`)
      );
    }

    const unzipper = new Unzip();
    unzipper.register(UnzipInflate);

    const seenEntries = new Set<string>();
    const extractedEntries = new Map<string, Uint8Array>();
    let totalExtractedBytes = 0;
    let aborted = false;

    const abort = (msg: string) => {
      if (aborted) return;
      aborted = true;
      reject(new Error(msg));
    };

    unzipper.onfile = file => {
      if (aborted) return;

      const name = file.name;

      // 1. Path traversal & illegal path characters check
      if (
        name.includes('..') ||
        name.includes('\\') ||
        name.startsWith('/') ||
        /^[a-zA-Z]:/.test(name) ||
        name.includes('\0')
      ) {
        return abort(`Entry arsip tidak aman atau mengandung path traversal: "${name}".`);
      }

      // 2. Strict whitelist check: manifest.json, data.json, or audio/<valid-id>.bin
      const isManifest = name === 'manifest.json';
      const isData = name === 'data.json';
      const isAudio = /^audio\/[a-zA-Z0-9_-]+\.bin$/.test(name);
      if (!isManifest && !isData && !isAudio) {
        return abort(`Entry tidak dikenal atau tidak diizinkan dalam arsip Catetin: "${name}".`);
      }

      // 3. Duplicate entry check
      if (seenEntries.has(name)) {
        return abort(`Duplikasi entry dalam arsip terdeteksi: "${name}".`);
      }
      seenEntries.add(name);

      // 4. Max entries count check
      if (seenEntries.size > limits.maxEntries) {
        return abort(`Jumlah entry arsip (${seenEntries.size}) melebihi batas aman (${limits.maxEntries}).`);
      }

      // 5. Pre-extraction header size & ratio check
      if (typeof file.originalSize === 'number' && file.originalSize > 0) {
        if (file.originalSize > limits.maxSingleFileBytes) {
          return abort(
            `Ukuran berkas "${name}" (${formatBytes(file.originalSize)}) melebihi batas aman per berkas (${formatBytes(limits.maxSingleFileBytes)}).`
          );
        }
        if (totalExtractedBytes + file.originalSize > limits.maxTotalExtractedBytes) {
          return abort(
            `Total ukuran hasil ekstraksi melebihi batas aman (${formatBytes(limits.maxTotalExtractedBytes)}).`
          );
        }
        if (typeof file.size === 'number' && file.size > 0) {
          const ratio = file.originalSize / file.size;
          if (file.originalSize > 1024 * 1024 && ratio > limits.maxCompressionRatio) {
            return abort(`Rasio kompresi berkas "${name}" (${Math.round(ratio)}:1) tidak wajar (indikasi zip bomb).`);
          }
        }
      }

      // 6. Decompress entry
      const chunks: Uint8Array[] = [];
      let entrySize = 0;

      file.ondata = (err, chunk, final) => {
        if (aborted) return;
        if (err) {
          return abort(`Gagal mengekstrak entry "${name}": ${err.message || 'data korup'}.`);
        }
        if (chunk) {
          entrySize += chunk.byteLength;
          totalExtractedBytes += chunk.byteLength;

          if (entrySize > limits.maxSingleFileBytes) {
            return abort(`Ukuran hasil ekstraksi berkas "${name}" melebihi batas aman per berkas.`);
          }
          if (totalExtractedBytes > limits.maxTotalExtractedBytes) {
            return abort(`Total ukuran hasil ekstraksi arsip melebihi batas aman.`);
          }
          chunks.push(chunk);
        }
        if (final) {
          const fullU8 = new Uint8Array(entrySize);
          let offset = 0;
          for (const c of chunks) {
            fullU8.set(c, offset);
            offset += c.byteLength;
          }
          extractedEntries.set(name, fullU8);
        }
      };

      file.start();
    };

    try {
      unzipper.push(u8Data, true);
      if (!aborted) {
        resolve({ entries: extractedEntries, totalExtractedBytes });
      }
    } catch (err: any) {
      if (!aborted) {
        reject(new Error(err?.message || 'Berkas bukan arsip ZIP yang valid.'));
      }
    }
  });
}

/**
 * Exports either a single project or the entire workspace as a .catetin archive.
 * Enforces preflight guardrails compatible with validateArchive/importArchive.
 */
export async function exportArchive(options: {
  scope: 'project' | 'workspace';
  projectId?: string;
  includeAudio: boolean;
  limits?: Partial<ArchiveGuardrails>;
}): Promise<ExportArchiveResult> {
  const limits: ArchiveGuardrails = { ...DEFAULT_ARCHIVE_GUARDRAILS, ...options.limits };
  const db = await openWorkspaceDatabase();
  const warnings: string[] = [];

  try {
    const tx = db.transaction(
      [S.projects, S.folders, S.recordings, S.transcripts, S.audio],
      'readonly'
    );

    const [allProjects, allFolders, allRecordings, allTranscripts] = await Promise.all([
      idbRequest(tx.objectStore(S.projects).getAll() as IDBRequest<ProjectRecord[]>),
      idbRequest(tx.objectStore(S.folders).getAll() as IDBRequest<FolderRecord[]>),
      idbRequest(tx.objectStore(S.recordings).getAll() as IDBRequest<RecordingRecord[]>),
      idbRequest(tx.objectStore(S.transcripts).getAll() as IDBRequest<TranscriptRecord[]>),
    ]);

    let targetProjects: ProjectRecord[];
    let targetFolders: FolderRecord[];
    let targetRecordings: RecordingRecord[];
    let targetProjectTitle: string | undefined;

    if (options.scope === 'project' && options.projectId) {
      const proj = allProjects.find(p => p.id === options.projectId);
      if (!proj) {
        throw new Error('Project yang akan diexport tidak ditemukan.');
      }
      targetProjectTitle = proj.title;
      targetProjects = [proj];
      targetFolders = allFolders.filter(f => f.projectId === proj.id);
      targetRecordings = allRecordings.filter(
        r => r.projectId === proj.id && !isDemoRecordingId(r.id)
      );
    } else {
      targetProjects = allProjects.filter(
        p => p.id !== DEFAULT_PROJECT_ID || allRecordings.some(r => r.projectId === p.id)
      );
      targetFolders = allFolders;
      targetRecordings = allRecordings.filter(r => !isDemoRecordingId(r.id));
    }

    // 1. Preflight entry count check
    const estimatedEntries = 2 + (options.includeAudio ? targetRecordings.length : 0);
    if (estimatedEntries > limits.maxEntries) {
      throw new Error(
        `Jumlah berkas yang akan diekspor (${estimatedEntries}) melampaui batas aman cadangan (${limits.maxEntries}). Ekspor per-project secara terpisah atau buat cadangan ringan tanpa audio.`
      );
    }

    const recIds = new Set(targetRecordings.map(r => r.id));
    const targetTranscripts = allTranscripts.filter(t => recIds.has(t.recordingId));

    // Audio collection with individual SHA-256 checksums and preflight size checks
    const audioStore = tx.objectStore(S.audio);
    const audioMetaList: AudioMeta[] = [];
    const missingAudioRecordings: string[] = [];
    const zipEntries: Record<string, Uint8Array> = {};
    let totalUncompressedBytes = 0;

    if (options.includeAudio) {
      for (const rec of targetRecordings) {
        try {
          const blob = await idbRequest(audioStore.get(rec.id) as IDBRequest<Blob | undefined>);
          if (!blob) {
            missingAudioRecordings.push(rec.title || rec.id);
            continue;
          }

          // Preflight single audio size check
          if (blob.size > limits.maxSingleFileBytes) {
            throw new Error(
              `Berkas audio "${rec.title || rec.filename}" berukuran ${formatBytes(blob.size)}, melampaui batas aman per berkas (${formatBytes(limits.maxSingleFileBytes)}). Ekspor per-project atau pilih cadangan ringan tanpa audio.`
            );
          }

          totalUncompressedBytes += blob.size;
          if (totalUncompressedBytes > limits.maxTotalExtractedBytes) {
            throw new Error(
              `Total ukuran cadangan mencapai ${formatBytes(totalUncompressedBytes)}, melampaui batas aman pemulihan (${formatBytes(limits.maxTotalExtractedBytes)}). Ekspor per-project secara terpisah atau pilih cadangan ringan tanpa audio.`
            );
          }

          const buf = await blob.arrayBuffer();
          const u8 = new Uint8Array(buf);
          const audioChecksum = await computeSha256(u8);
          const zipPath = `audio/${rec.id}.bin`;
          zipEntries[zipPath] = u8;
          audioMetaList.push({
            recordingId: rec.id,
            filename: rec.filename || `${rec.id}.bin`,
            mimeType: blob.type || 'audio/wav',
            sizeBytes: blob.size,
            checksum: audioChecksum,
            pathInZip: zipPath,
          });
        } catch (err: any) {
          if (err?.message?.includes('melampaui batas aman')) {
            throw err;
          }
          missingAudioRecordings.push(rec.title || rec.id);
        }
      }

      if (missingAudioRecordings.length > 0) {
        warnings.push(
          `${missingAudioRecordings.length} rekaman tidak memiliki berkas audio lokal dan diexport tanpa audio.`
        );
      }
    }

    const archiveData: CatetinArchiveData = {
      projects: targetProjects,
      folders: targetFolders,
      recordings: targetRecordings,
      transcripts: targetTranscripts,
      audioMeta: audioMetaList.length > 0 ? audioMetaList : undefined,
    };

    const dataJsonStr = JSON.stringify(archiveData);
    const dataJsonBytes = strToU8(dataJsonStr);
    totalUncompressedBytes += dataJsonBytes.byteLength;

    if (dataJsonBytes.byteLength > limits.maxSingleFileBytes) {
      throw new Error(
        `Ukuran data naskah (${formatBytes(dataJsonBytes.byteLength)}) melampaui batas aman per berkas (${formatBytes(limits.maxSingleFileBytes)}). Ekspor per-project secara terpisah.`
      );
    }

    if (totalUncompressedBytes > limits.maxTotalExtractedBytes) {
      throw new Error(
        `Total ukuran cadangan (${formatBytes(totalUncompressedBytes)}) melampaui batas aman pemulihan (${formatBytes(limits.maxTotalExtractedBytes)}). Ekspor per-project secara terpisah atau gunakan cadangan ringan tanpa audio.`
      );
    }

    const checksum = await computeSha256(dataJsonStr);

    const manifest: CatetinManifest = {
      format: CATETIN_ARCHIVE_FORMAT,
      version: CURRENT_ARCHIVE_VERSION,
      appVersion: '1.0.0',
      exportedAt: Date.now(),
      scope: options.scope,
      projectId: options.scope === 'project' ? options.projectId : undefined,
      projectTitle: targetProjectTitle,
      includeAudio: options.includeAudio,
      counts: {
        projects: targetProjects.length,
        folders: targetFolders.length,
        recordings: targetRecordings.length,
        transcripts: targetTranscripts.length,
        audio: audioMetaList.length,
      },
      missingAudioCount: missingAudioRecordings.length,
      missingAudioRecordings: missingAudioRecordings.length > 0 ? missingAudioRecordings : undefined,
      checksum,
    };

    const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
    totalUncompressedBytes += manifestBytes.byteLength;

    zipEntries['manifest.json'] = manifestBytes;
    zipEntries['data.json'] = dataJsonBytes;

    const zippedU8 = zipSync(zipEntries, { level: 6 });

    // Preflight compressed archive size check
    if (zippedU8.byteLength > limits.maxArchiveBytes) {
      throw new Error(
        `Ukuran arsip terkompresi (${formatBytes(zippedU8.byteLength)}) melampaui batas aman (${formatBytes(limits.maxArchiveBytes)}). Ekspor per-project secara terpisah atau gunakan cadangan ringan tanpa audio.`
      );
    }

    const archiveBlob = new Blob([zippedU8], { type: 'application/octet-stream' });
    const filename = generateArchiveFilename(options.scope, targetProjectTitle);

    return {
      blob: archiveBlob,
      filename,
      manifest,
      warnings,
    };
  } finally {
    db.close();
  }
}

/**
 * Validates a .catetin archive binary without writing anything to IndexedDB.
 * Enforces strict entry whitelist, guardrails, manifest verification, JSON checksum,
 * and audio metadata/checksum matching.
 */
export async function validateArchive(
  binary: ArrayBuffer | Uint8Array,
  customLimits?: Partial<ArchiveGuardrails>
): Promise<ArchiveValidationResult> {
  const u8Data = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  const limits: ArchiveGuardrails = { ...DEFAULT_ARCHIVE_GUARDRAILS, ...customLimits };
  const warnings: string[] = [];

  let extracted: { entries: Map<string, Uint8Array>; totalExtractedBytes: number };
  try {
    extracted = await safeUnzipArchive(u8Data, limits);
  } catch (err: any) {
    return {
      valid: false,
      error: err?.message || 'Berkas tidak dapat dibuka. Pastikan berkas adalah arsip .catetin yang valid.',
      warnings,
    };
  }

  const { entries } = extracted;

  // 1. Check manifest.json
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) {
    return {
      valid: false,
      error: 'Arsip tidak memiliki manifest.json yang sah.',
      warnings,
    };
  }

  let manifest: CatetinManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    return {
      valid: false,
      error: 'Manifest arsip rusak atau bukan JSON yang valid.',
      warnings,
    };
  }

  if (manifest.format !== CATETIN_ARCHIVE_FORMAT) {
    return {
      valid: false,
      error: 'Format berkas tidak dikenali sebagai arsip Catetin.',
      warnings,
    };
  }

  if (typeof manifest.version !== 'number' || manifest.version < 1) {
    return {
      valid: false,
      error: 'Nomor versi manifest arsip tidak valid.',
      warnings,
    };
  }

  if (manifest.version > CURRENT_ARCHIVE_VERSION) {
    return {
      valid: false,
      error: `Versi arsip (v${manifest.version}) lebih baru dari versi yang didukung aplikasi ini (v${CURRENT_ARCHIVE_VERSION}). Silakan perbarui aplikasi Catetin.`,
      warnings,
    };
  }

  if (!manifest.checksum || typeof manifest.checksum !== 'string') {
    return {
      valid: false,
      error: 'Manifest arsip tidak memiliki checksum SHA-256 yang sah.',
      warnings,
    };
  }

  // 2. Check data.json and its SHA-256 checksum
  const dataBytes = entries.get('data.json');
  if (!dataBytes) {
    return {
      valid: false,
      error: 'Arsip tidak memiliki data.json utama.',
      warnings,
    };
  }

  const dataStr = strFromU8(dataBytes);
  const computedDataChecksum = await computeSha256(dataStr);
  if (computedDataChecksum !== manifest.checksum) {
    return {
      valid: false,
      error: 'Integritas data.json gagal diperiksa: checksum SHA-256 tidak cocok (data telah dimodifikasi atau rusak).',
      warnings,
    };
  }

  let data: CatetinArchiveData;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return {
      valid: false,
      error: 'Isi data arsip rusak atau bukan format JSON yang sah.',
      warnings,
    };
  }

  // Structural sanity check
  if (!Array.isArray(data.recordings)) {
    return {
      valid: false,
      error: 'Data rekaman dalam arsip tidak valid.',
      warnings,
    };
  }

  const validRecordingIds = new Set(data.recordings.map(r => r.id));

  // 3. Audio verification and strict matching
  const audioBinaries = new Map<string, Uint8Array>();
  const declaredAudioEntries = new Set<string>();

  if (data.audioMeta && Array.isArray(data.audioMeta)) {
    for (const meta of data.audioMeta) {
      if (!meta.recordingId || !validRecordingIds.has(meta.recordingId)) {
        return {
          valid: false,
          error: `Metadata audio mengacu ke ID rekaman yang tidak ada dalam daftar: "${meta.recordingId}".`,
          warnings,
        };
      }

      const expectedPath = `audio/${meta.recordingId}.bin`;
      if (meta.pathInZip !== expectedPath) {
        return {
          valid: false,
          error: `Jalur berkas audio "${meta.pathInZip}" tidak cocok dengan standar "${expectedPath}".`,
          warnings,
        };
      }

      if (meta.mimeType && !meta.mimeType.startsWith('audio/') && !meta.mimeType.startsWith('video/')) {
        return {
          valid: false,
          error: `Tipe konten audio tidak valid: "${meta.mimeType}".`,
          warnings,
        };
      }

      const audioBytes = entries.get(meta.pathInZip);
      if (!audioBytes) {
        return {
          valid: false,
          error: `Berkas audio untuk rekaman "${meta.filename}" (${meta.pathInZip}) tidak ditemukan dalam arsip.`,
          warnings,
        };
      }

      if (audioBytes.byteLength !== meta.sizeBytes) {
        return {
          valid: false,
          error: `Ukuran berkas audio "${meta.filename}" (${audioBytes.byteLength} byte) tidak cocok dengan metadata (${meta.sizeBytes} byte).`,
          warnings,
        };
      }

      if (meta.checksum) {
        const computedAudioChecksum = await computeSha256(audioBytes);
        if (computedAudioChecksum !== meta.checksum) {
          return {
            valid: false,
            error: `Integritas berkas audio "${meta.filename}" gagal diperiksa: checksum SHA-256 tidak cocok.`,
            warnings,
          };
        }
      }

      declaredAudioEntries.add(meta.pathInZip);
      audioBinaries.set(meta.recordingId, audioBytes);
    }
  }

  // Ensure no unlisted audio files exist in the zip
  for (const entryPath of entries.keys()) {
    if (entryPath.startsWith('audio/')) {
      if (!manifest.includeAudio) {
        return {
          valid: false,
          error: `Arsip memuat payload audio (${entryPath}) padahal manifest menyatakan cadangan tanpa audio.`,
          warnings,
        };
      }
      if (!declaredAudioEntries.has(entryPath)) {
        return {
          valid: false,
          error: `Ditemukan berkas audio asing atau tidak terdaftar dalam metadata: "${entryPath}".`,
          warnings,
        };
      }
    }
  }

  return {
    valid: true,
    manifest,
    data,
    audioBinaries,
    warnings,
  };
}

export interface ImportOptions {
  /** Test hook: if provided and throws, forces rollback before commit */
  onBeforeCommit?: () => void;
  limits?: Partial<ArchiveGuardrails>;
}

/**
 * Safely imports a .catetin archive as new copies with remapped IDs.
 * Validation is performed strictly before any IndexedDB transaction starts.
 * Transactional and atomic: rolls back if anything fails midway.
 */
export async function importArchive(
  binary: ArrayBuffer | Uint8Array,
  options?: ImportOptions
): Promise<ImportResult> {
  // 1. Strict pre-validation BEFORE opening DB or starting transaction
  const validation = await validateArchive(binary, options?.limits);
  if (!validation.valid || !validation.data || !validation.manifest) {
    return {
      success: false,
      message: validation.error || 'Gagal memvalidasi arsip.',
      counts: { projects: 0, folders: 0, recordings: 0, transcripts: 0, audio: 0 },
      warnings: validation.warnings,
    };
  }

  const { data, manifest, audioBinaries } = validation;
  const db = await openWorkspaceDatabase();
  let tx: IDBTransaction | null = null;

  try {
    tx = db.transaction(
      [S.projects, S.folders, S.recordings, S.transcripts, S.audio],
      'readwrite'
    );

    const projectStore = tx.objectStore(S.projects);
    const folderStore = tx.objectStore(S.folders);
    const recordingStore = tx.objectStore(S.recordings);
    const transcriptStore = tx.objectStore(S.transcripts);
    const audioStore = tx.objectStore(S.audio);

    const existingRecordings = await idbRequest(recordingStore.getAll() as IDBRequest<RecordingRecord[]>);
    const now = Date.now();

    // Map old IDs to new safe copies
    const projectIdMap = new Map<string, string>();
    const folderIdMap = new Map<string, string>();
    const recordingIdMap = new Map<string, string>();

    // 1. Projects
    const importedProjects: ProjectRecord[] = [];
    const sourceProjects = data.projects && data.projects.length > 0 ? data.projects : [];

    if (sourceProjects.length === 0 && data.recordings.length > 0) {
      const fallbackProjectId = generateUniqueId('proj');
      const fallbackProject: ProjectRecord = {
        id: fallbackProjectId,
        title: manifest.projectTitle || 'Project Impor',
        folderId: null,
        tags: ['Impor'],
        createdAt: now,
        updatedAt: now,
      };
      importedProjects.push(fallbackProject);
      projectIdMap.set(DEFAULT_PROJECT_ID, fallbackProjectId);
    }

    for (const p of sourceProjects) {
      const newId = generateUniqueId('proj');
      projectIdMap.set(p.id, newId);
      importedProjects.push({
        id: newId,
        title: p.title,
        folderId: null,
        tags: cleanTags([...(p.tags || []), 'Impor']),
        createdAt: p.createdAt || now,
        updatedAt: now,
      });
    }

    // 2. Folders
    const importedFolders: FolderRecord[] = [];
    if (data.folders && Array.isArray(data.folders)) {
      for (const f of data.folders) {
        const newFolderId = generateUniqueId('folder');
        folderIdMap.set(f.id, newFolderId);
        const mappedProjectId = projectIdMap.get(f.projectId) || importedProjects[0]?.id || DEFAULT_PROJECT_ID;
        importedFolders.push({
          id: newFolderId,
          projectId: mappedProjectId,
          name: f.name,
          createdAt: f.createdAt || now,
          updatedAt: now,
        });
      }
    }

    // 3. Recordings
    const importedRecordings: RecordingRecord[] = [];
    let nextSortIndex = existingRecordings.length;

    for (const r of data.recordings) {
      const newRecId = generateUniqueId('rec');
      recordingIdMap.set(r.id, newRecId);

      const targetProjectId = projectIdMap.get(r.projectId) || importedProjects[0]?.id || DEFAULT_PROJECT_ID;
      const targetFolderId = r.folderId ? folderIdMap.get(r.folderId) ?? null : null;

      importedRecordings.push({
        id: newRecId,
        projectId: targetProjectId,
        folderId: targetFolderId,
        tags: cleanTags(r.tags || []),
        title: r.title,
        category: r.category || 'audio',
        filename: r.filename,
        durationSec: r.durationSec || 0,
        sortIndex: nextSortIndex++,
        createdAt: r.createdAt || now,
        updatedAt: now,
      });
    }

    // 4. Transcripts
    const importedTranscripts: TranscriptRecord[] = [];
    if (data.transcripts && Array.isArray(data.transcripts)) {
      for (const t of data.transcripts) {
        const newRecId = recordingIdMap.get(t.recordingId);
        if (newRecId) {
          importedTranscripts.push({
            recordingId: newRecId,
            segments: t.segments || [],
            speakerNames: t.speakerNames || {},
            updatedAt: now,
          });
        }
      }
    }

    // 5. Audio blobs
    const audioImportedCount = { val: 0 };
    if (data.audioMeta && audioBinaries) {
      for (const meta of data.audioMeta) {
        const newRecId = recordingIdMap.get(meta.recordingId);
        const u8 = audioBinaries.get(meta.recordingId);
        if (newRecId && u8) {
          const blob = new Blob([u8.buffer as ArrayBuffer], { type: meta.mimeType || 'audio/wav' });
          audioStore.put(blob, newRecId);
          audioImportedCount.val++;
        }
      }
    }

    // Put records into IDB stores
    for (const p of importedProjects) {
      projectStore.put(p);
    }
    for (const f of importedFolders) {
      folderStore.put(f);
    }
    for (const r of importedRecordings) {
      recordingStore.put(r);
    }
    for (const t of importedTranscripts) {
      transcriptStore.put(t);
    }

    // Optional test hook for failure simulation
    if (options?.onBeforeCommit) {
      options.onBeforeCommit();
    }

    const currentTx = tx!;
    await new Promise<void>((resolve, reject) => {
      currentTx.oncomplete = () => resolve();
      currentTx.onerror = () => reject(currentTx.error);
      currentTx.onabort = () => reject(currentTx.error ?? new Error('Import dibatalkan.'));
    });

    return {
      success: true,
      message: 'Pemulihan data arsip berhasil diselesaikan.',
      counts: {
        projects: importedProjects.length,
        folders: importedFolders.length,
        recordings: importedRecordings.length,
        transcripts: importedTranscripts.length,
        audio: audioImportedCount.val,
      },
      warnings: validation.warnings,
    };
  } catch (err: any) {
    if (tx) {
      try {
        tx.abort();
      } catch {
        // already aborted or finished
      }
    }
    return {
      success: false,
      message: err?.message ? `Gagal mengimpor arsip: ${err.message}` : 'Gagal mengimpor arsip.',
      counts: { projects: 0, folders: 0, recordings: 0, transcripts: 0, audio: 0 },
      warnings: validation.warnings,
    };
  } finally {
    db.close();
  }
}
