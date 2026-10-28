// Centralized feature catalog for Catetin Free and Pro plans
// Catetin Stage 4C1: Feature Catalog & Entitlement Foundation
// Note: UI gating is not a security boundary; server is source of truth.

export const FEATURE_KEYS = [
  'local_workspace',
  'local_transcription',
  'standard_exports',
  'local_backup',
  'transcript_templates',
  'advanced_export_profiles',
  'priority_support',
  'batch_transcription',
  'advanced_speaker_tools',
  'google_drive_import',
  'optional_cloud_assist',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureCategory = 'core' | 'pro';
export type FeatureAvailability = 'available' | 'planned';
export type FeatureTier = 'free' | 'pro';

export interface FeatureDefinition {
  id: FeatureKey;
  name: string;
  description: string;
  category: FeatureCategory;
  availability: FeatureAvailability;
  tier: FeatureTier;
}

export const FEATURE_CATALOG: Record<FeatureKey, FeatureDefinition> = {
  local_workspace: {
    id: 'local_workspace',
    name: 'Ruang Kerja Lokal',
    description: 'Penyimpanan rekaman, naskah, project, folder, dan tag langsung di peramban perangkat.',
    category: 'core',
    availability: 'available',
    tier: 'free',
  },
  local_transcription: {
    id: 'local_transcription',
    name: 'Transkripsi Whisper di Perangkat',
    description: 'Model Whisper berjalan lokal via WebGPU atau WASM tanpa mengirim audio ke server.',
    category: 'core',
    availability: 'available',
    tier: 'free',
  },
  standard_exports: {
    id: 'standard_exports',
    name: 'Ekspor Standar',
    description: 'Ekspor naskah transkrip ke format teks TXT, subtitle SRT, dan dokumen Word.',
    category: 'core',
    availability: 'available',
    tier: 'free',
  },
  local_backup: {
    id: 'local_backup',
    name: 'Cadangan Arsip .catetin',
    description: 'Ekspor dan impor cadangan arsip utuh tanpa ketergantungan cloud.',
    category: 'core',
    availability: 'available',
    tier: 'free',
  },
  transcript_templates: {
    id: 'transcript_templates',
    name: 'Template Naskah',
    description: 'Struktur naskah siap pakai untuk wawancara, rapat, podcast, dan catatan riset.',
    category: 'pro',
    availability: 'planned',
    tier: 'pro',
  },
  advanced_export_profiles: {
    id: 'advanced_export_profiles',
    name: 'Profil Ekspor Lanjutan',
    description: 'Konfigurasi penataan waktu, pemformatan pembicara kustom, dan tata letak dokumen siap cetak.',
    category: 'pro',
    availability: 'planned',
    tier: 'pro',
  },
  priority_support: {
    id: 'priority_support',
    name: 'Dukungan Prioritas',
    description: 'Saluran bantuan langsung untuk kendala teknis dan alur kerja editorial.',
    category: 'pro',
    availability: 'planned',
    tier: 'pro',
  },
  batch_transcription: {
    id: 'batch_transcription',
    name: 'Transkripsi Batch',
    description: 'Antrean proses beberapa berkas audio sekaligus secara berurutan di perangkat.',
    category: 'pro',
    availability: 'planned',
    tier: 'pro',
  },
  advanced_speaker_tools: {
    id: 'advanced_speaker_tools',
    name: 'Alat Pembicara Lanjutan',
    description: 'Penandaan pembicara otomatis dan manajemen profil nama pembicara.',
    category: 'pro',
    availability: 'planned',
    tier: 'pro',
  },
  google_drive_import: {
    id: 'google_drive_import',
    name: 'Impor Google Drive',
    description: 'Koneksi langsung untuk mengambil rekaman suara dari Google Drive Anda.',
    category: 'pro',
    availability: 'planned',
    tier: 'pro',
  },
  optional_cloud_assist: {
    id: 'optional_cloud_assist',
    name: 'Bantuan Cloud Opsional',
    description: 'Ringkasan, terjemahan, dan bantuan penyuntingan melalui cloud hanya ketika pengguna memilih menggunakannya.',
    category: 'pro',
    availability: 'planned',
    tier: 'pro',
  },
};

// Features available on Free tier
export const FREE_AVAILABLE_FEATURE_KEYS: FeatureKey[] = Object.values(FEATURE_CATALOG)
  .filter((f) => f.tier === 'free' && f.availability === 'available')
  .map((f) => f.id);

// Features available on Pro tier when Pro entitlement is active
export const PRO_AVAILABLE_FEATURE_KEYS: FeatureKey[] = Object.values(FEATURE_CATALOG)
  .filter((f) => f.availability === 'available')
  .map((f) => f.id);

// Planned features list for marketing and pricing displays
export const PLANNED_PRO_FEATURE_KEYS: FeatureKey[] = Object.values(FEATURE_CATALOG)
  .filter((f) => f.tier === 'pro' && f.availability === 'planned')
  .map((f) => f.id);

export function getFeaturesByTier(tier: FeatureTier): FeatureDefinition[] {
  return Object.values(FEATURE_CATALOG).filter((f) => f.tier === tier);
}

export function getFeature(key: FeatureKey): FeatureDefinition | undefined {
  return FEATURE_CATALOG[key];
}
