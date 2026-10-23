import { t } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Cpu, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TranscriptionState } from '@/lib/transcription';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onSelectModel: (model: 'base' | 'small' | 'tiny') => void;
  canTranscribe: boolean;
  state: TranscriptionState;
  onTranscribe: () => void;
  onCancel: () => void;
}

export function WhisperDrawer({ isOpen, onClose, selectedModel, onSelectModel, canTranscribe, state, onTranscribe, onCancel }: Props) {
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
  const running = ['decoding', 'model', 'transcription'].includes(state.phase);
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{t("Transkripsi lokal")}</DialogTitle><DialogDescription>{t("Whisper berjalan di perangkat Anda. Audio tidak dikirim ke layanan transkripsi.")}</DialogDescription></DialogHeader><div className="info-notice"><Info aria-hidden="true" /><p>{t("Model diunduh sekali saat pertama digunakan, lalu disimpan di cache browser untuk penggunaan berikutnya.")}</p></div><fieldset className="model-options" disabled={running}><legend>{t("Pilih model")}</legend>{([['tiny', 'Whisper Tiny', t("Paling ringan dan cepat")], ['base', 'Whisper Base', t("Seimbang untuk penggunaan awal")], ['small', 'Whisper Small', t("Lebih akurat, memerlukan memori lebih besar")]] as const).map(([id, name, description]) => <label key={id} className={selectedModel === id ? 'model-selected' : ''}><input type="radio" name="model" checked={selectedModel === id} onChange={() => onSelectModel(id)} /><span><strong>{name}</strong><span>{t(description)}</span></span></label>)}</fieldset><div className="hardware-note"><Cpu aria-hidden="true" /><div><h3>{t("Dukungan perangkat")}</h3><p>{t(gpu)}</p><p>{t("WebGPU digunakan bila tersedia; perangkat lain akan memakai WebAssembly yang lebih lambat.")}</p></div></div>{state.phase !== 'idle' && <div className={`transcription-status ${state.phase === 'error' ? 'is-error' : ''}`} role="status"><strong>{t(state.message)}</strong>{state.progress != null && <progress max="100" value={state.progress} aria-label={t("Kemajuan unduhan model")} />}</div>}<div className="transcription-actions">{running ? <Button variant="outline" onClick={onCancel}>{t("Batalkan")}</Button> : <Button disabled={!canTranscribe} onClick={onTranscribe}>{state.phase === 'complete' ? t("Transkripsikan lagi") : t("Mulai transkripsi")}</Button>}</div>{!canTranscribe && <p className="form-hint">{t("Buka rekaman lokal terlebih dahulu untuk menjalankan transkripsi.")}</p>}</DialogContent></Dialog>;
}
