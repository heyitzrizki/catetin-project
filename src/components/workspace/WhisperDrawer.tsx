import { t } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Cpu, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props { isOpen: boolean; onClose: () => void; selectedModel: string; onSelectModel: (model: 'base' | 'small' | 'tiny') => void; }

export function WhisperDrawer({ isOpen, onClose, selectedModel, onSelectModel }: Props) {
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
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{t("Model & perangkat")}</DialogTitle><DialogDescription>{t("Pratinjau pengaturan untuk transkripsi yang sedang dikembangkan.")}</DialogDescription></DialogHeader><div className="info-notice"><Info aria-hidden="true" /><p>{t("Pilihan ini belum menjalankan atau mengunduh model. Anda tetap bisa menyunting naskah dan memutar rekaman sendiri.")}</p></div><fieldset className="model-options"><legend>{t("Preferensi model")}</legend>{([['tiny', 'Whisper Tiny', t("Model ringan")], ['base', 'Whisper Base', t("Pilihan awal")], ['small', 'Whisper Small', t("Model lebih besar")]] as const).map(([id, name, description]) => <label key={id} className={selectedModel === id ? 'model-selected' : ''}><input type="radio" name="model" checked={selectedModel === id} onChange={() => onSelectModel(id)} /><span><strong>{name}</strong><span>{t(description)}</span></span></label>)}</fieldset><div className="hardware-note"><Cpu aria-hidden="true" /><div><h3>{t("Dukungan perangkat")}</h3><p role="status">{t(gpu)}</p><p>{t("Ketersediaan adapter belum membuktikan model transkripsi dapat dijalankan.")}</p></div></div></DialogContent></Dialog>;
}
