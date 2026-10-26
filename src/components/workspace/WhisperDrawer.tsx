import { t } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Cpu, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TranscriptionUiSnapshot } from '@/features/transcription/job-controller';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  canTranscribe: boolean;
  snapshot: TranscriptionUiSnapshot;
  onTranscribe: () => void;
  onCancel: () => void;
}

const PHASE_STEPS = [
  ['preparing-model', '1. Menyiapkan model'],
  ['preparing-audio', '2. Menyiapkan audio'],
  ['transcribing', '3. Mentranskripsi'],
  ['assembling-result', '4. Menyusun hasil'],
] as const;

export function WhisperDrawer({ isOpen, onClose, canTranscribe, snapshot, onTranscribe, onCancel }: Props) {
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
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{t("Transkripsi lokal")}</DialogTitle><DialogDescription>{t("Whisper berjalan di perangkat Anda. Audio tidak dikirim ke layanan transkripsi.")}</DialogDescription></DialogHeader><div className="info-notice"><Info aria-hidden="true" /><p>{t("Model diunduh sekali saat pertama digunakan, lalu disimpan di cache browser untuk penggunaan berikutnya.")}</p></div><div className="hardware-note"><Cpu aria-hidden="true" /><div><h3>{t("Dukungan perangkat")}</h3><p>{t(gpu)}</p><p>{t("Model default private alpha: Whisper Tiny (onnx-community/whisper-tiny). WebGPU digunakan bila tersedia; perangkat lain memakai WebAssembly.")}</p><p>{t("Batas pengaman private alpha (bukan jaminan durasi): WAV PCM 16-bit maks. 20 menit / 40 MB; MP3, M4A, atau WebM maks. 5 menit / 10 MB.")}</p></div></div>{snapshot.status !== 'idle' && <div className={`transcription-status ${failed ? 'is-error' : ''}`} role="status" data-status={snapshot.status}>{running && <div className="flex flex-wrap gap-2 text-xs text-muted-foreground pb-1">{PHASE_STEPS.map(([key, label]) => <span key={key} className={snapshot.status === key ? 'font-semibold text-primary' : ''}>{t(label)}</span>)}</div>}<strong>{t(snapshot.messageKey, snapshot.messageParams)}</strong>{running && (snapshot.progress != null ? <progress max="100" value={snapshot.progress} aria-label={t("Kemajuan unduhan model")} /> : <progress aria-label={t("Kemajuan unduhan model")} />)}{(failed || snapshot.status === 'cancelled') && snapshot.nextActionKey && <p className="text-xs leading-relaxed mt-1">{t(snapshot.nextActionKey)}</p>}</div>}<div className="transcription-actions">{running ? <Button variant="outline" onClick={onCancel}>{t("Batalkan")}</Button> : <Button disabled={!canTranscribe} onClick={onTranscribe}>{snapshot.status === 'completed' ? t("Transkripsikan lagi") : failed || snapshot.status === 'cancelled' ? t("Coba lagi") : t("Mulai transkripsi")}</Button>}</div>{!canTranscribe && <p className="form-hint">{t("Buka rekaman lokal terlebih dahulu untuk menjalankan transkripsi.")}</p>}</DialogContent></Dialog>;
}
