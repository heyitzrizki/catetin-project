import { t } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Cpu, Info, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TranscriptionUiSnapshot } from '@/features/transcription/job-controller';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  canTranscribe: boolean;
  snapshot: TranscriptionUiSnapshot;
  isBackgroundJob?: boolean;
  jobRecordingTitle?: string;
  resumableChunks?: number;
  onTranscribe: () => void;
  onResume?: () => void;
  onStartFresh?: () => void;
  onDiscardCheckpoint?: () => void;
  onCancel: () => void;
}

const PHASE_STEPS = [
  ['preparing-model', '1. Menyiapkan model'],
  ['preparing-audio', '2. Menyiapkan audio'],
  ['transcribing', '3. Mentranskripsi'],
  ['assembling-result', '4. Menyusun hasil'],
] as const;

function getProgressAriaLabel(snapshot: TranscriptionUiSnapshot): string {
  if (snapshot.status === 'preparing-audio') return t("Kemajuan persiapan audio");
  if (snapshot.status === 'transcribing') {
    return t("Kemajuan transkripsi bagian {current} dari {total}", {
      current: snapshot.currentChunk ?? 1,
      total: snapshot.totalChunks ?? 1,
    });
  }
  if (snapshot.status === 'assembling-result') return t("Kemajuan penyusunan hasil");
  return t("Kemajuan pemuatan model");
}

export function WhisperDrawer({
  isOpen,
  onClose,
  canTranscribe,
  snapshot,
  isBackgroundJob = false,
  jobRecordingTitle,
  resumableChunks = 0,
  onTranscribe,
  onResume,
  onStartFresh,
  onDiscardCheckpoint,
  onCancel,
}: Props) {
  const [gpu, setGpu] = useState(t("Memeriksa dukungan peramban…"));
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setGpu(t("Memeriksa dukungan peramban…"));
    (async () => {
      try {
        const api = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
        const adapter = await api?.requestAdapter();
        if (!cancelled) setGpu(adapter ? t("Adapter WebGPU tersedia di peramban ini.") : t("Adapter WebGPU tidak tersedia."));
      } catch { if (!cancelled) setGpu(t("Peramban tidak mengizinkan akses adapter WebGPU.")); }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const running = ['validating', 'preparing-model', 'preparing-audio', 'transcribing', 'assembling-result'].includes(snapshot.status);
  const failed = snapshot.status === 'failed' || snapshot.status === 'unsupported';
  const hasCheckpoint = canTranscribe && !running && resumableChunks > 0;
  const usedWasmFallback = (snapshot.jobState?.fallbackCount ?? 0) > 0;
  const progressLabel = getProgressAriaLabel(snapshot);

  return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{t("Transkripsi lokal")}</DialogTitle><DialogDescription>{t("Whisper berjalan di perangkat Anda. Audio tidak dikirim ke layanan transkripsi.")}</DialogDescription></DialogHeader><div className="info-notice"><Info aria-hidden="true" /><p>{t("Model diunduh sekali saat pertama digunakan, lalu disimpan di cache browser untuk penggunaan berikutnya.")}</p></div><div className="hardware-note"><Cpu aria-hidden="true" /><div><h3>{t("Dukungan perangkat")}</h3><p>{t(gpu)}</p><p>{t("Model default private alpha: Whisper Tiny (onnx-community/whisper-tiny). WebGPU digunakan bila tersedia; perangkat lain memakai WebAssembly.")}</p><p>{t("Batas pengaman private alpha (bukan jaminan durasi): WAV PCM 16-bit maks. 20 menit / 40 MB; MP3, M4A, atau WebM maks. 5 menit / 10 MB.")}</p></div></div>{(snapshot.status !== 'idle' || hasCheckpoint) && <div className={`transcription-status ${failed ? 'is-error' : ''}`} role="status" data-status={snapshot.status}>{isBackgroundJob && <span className="text-xs font-medium text-primary">{t("Transkripsi latar belakang: {title}", { title: jobRecordingTitle ? t(jobRecordingTitle) : (snapshot.recordingId ?? '') })}</span>}{running && <div className="flex flex-wrap gap-2 text-xs text-muted-foreground pb-1">{PHASE_STEPS.map(([key, label]) => <span key={key} className={snapshot.status === key ? 'font-semibold text-primary' : ''}>{t(label)}</span>)}</div>}{snapshot.status !== 'idle' ? <strong>{t(snapshot.messageKey, snapshot.messageParams)}</strong> : <strong>{t("Kemajuan transkripsi tersimpan ({count} bagian selesai).", { count: resumableChunks })}</strong>}{usedWasmFallback && <span className="text-xs text-muted-foreground">{t("Berjalan dengan cadangan WebAssembly (WASM).")}</span>}{running && (snapshot.resumedFromChunks ?? 0) > 0 && <span className="text-xs text-muted-foreground">{t("Melanjutkan dari bagian tersimpan ({count} bagian dilewati).", { count: snapshot.resumedFromChunks ?? 0 })}</span>}{running && (snapshot.progress != null ? <progress max="100" value={snapshot.progress} aria-label={progressLabel} /> : <progress aria-label={progressLabel} />)}{(failed || snapshot.status === 'cancelled') && snapshot.nextActionKey && <p className="text-xs leading-relaxed mt-1">{t(snapshot.nextActionKey)}</p>}{hasCheckpoint && snapshot.status !== 'idle' && <p className="text-xs text-muted-foreground mt-1">{t("Kemajuan transkripsi tersimpan ({count} bagian selesai).", { count: resumableChunks })}</p>}</div>}<div className="transcription-actions flex-wrap gap-2">{running ? <Button variant="outline" onClick={onCancel}>{t("Batalkan")}</Button> : hasCheckpoint ? <><Button variant="ghost" onClick={onDiscardCheckpoint}><Trash2 aria-hidden="true" className="size-3.5" />{t("Hapus kemajuan")}</Button><Button variant="outline" onClick={onStartFresh}><RotateCcw aria-hidden="true" className="size-3.5" />{t("Mulai dari awal")}</Button><Button onClick={onResume ?? onTranscribe}>{t("Lanjutkan transkripsi")}</Button></> : <Button disabled={!canTranscribe} onClick={onTranscribe}>{snapshot.status === 'completed' ? t("Transkripsikan lagi") : failed || snapshot.status === 'cancelled' ? t("Coba lagi") : t("Mulai transkripsi")}</Button>}</div>{!canTranscribe && !running && <p className="form-hint">{t("Buka rekaman lokal terlebih dahulu untuk menjalankan transkripsi.")}</p>}</DialogContent></Dialog>;
}
