import { t } from '@/lib/i18n';
import type { RecordingErrorCode } from './recording-types';

export function getRecordingErrorMessage(code: RecordingErrorCode | string): string {
  switch (code) {
    case 'insecure-context':
      return t('Konteks tidak aman. Perekaman mikrofon hanya dapat berjalan di HTTPS atau localhost.');
    case 'unsupported-browser':
      return t('Perekaman lokal belum didukung di peramban ini pada tahap awal. Gunakan Chrome, Edge, atau peramban berbasis Chromium desktop.');
    case 'permission-denied':
      return t('Akses mikrofon belum diberikan. Izinkan mikrofon dari ikon di bilah alamat, lalu coba lagi.');
    case 'microphone-not-found':
      return t('Mikrofon tidak ditemukan pada perangkat Anda. Hubungkan mikrofon lalu coba lagi.');
    case 'microphone-unreadable':
      return t('Mikrofon tidak dapat dibaca oleh sistem. Periksa izin perangkat atau coba mikrofon lain.');
    case 'device-ended':
      return t('Mikrofon berhenti terhubung. Catetin mempertahankan audio yang sudah tersimpan.');
    case 'storage-quota':
      return t('Ruang penyimpanan browser tidak cukup. Bagian rekaman yang sudah tersimpan tetap dipertahankan.');
    case 'storage-write-failed':
      return t('Penyimpanan lokal mengalami gangguan. Audio yang sudah tersimpan tetap dipertahankan.');
    case 'archive-finalization-failed':
      return t('Gagal merakit arsip rekaman akhir. Data sementara tetap aman untuk dicoba kembali.');
    case 'checkpoint-read-failed':
      return t('Catetin belum dapat membaca hasil sementara. Rekaman tetap aman dan dapat dicoba lagi.');
    case 'workspace-save-failed':
      return t('Gagal menyimpan rekaman ke workspace. Data sementara tetap tersimpan aman.');
    case 'transcription-failed':
      return t('Transkripsi sementara mengalami gangguan. Audio rekaman tetap aman.');
    default:
      return t('Penyimpanan lokal mengalami gangguan. Audio yang sudah tersimpan tetap dipertahankan.');
  }
}
