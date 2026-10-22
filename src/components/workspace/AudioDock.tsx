import { t } from '@/lib/i18n';
import { Play, Pause, RotateCcw, Headphones } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSeconds } from '@/lib/transcript';

interface Props {
  currentTime: number;
  durationSec: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onReset: () => void;
  onChangeSpeed: (speed: number) => void;
  isDemo: boolean;
  isLoading: boolean;
}

export function AudioDock({ currentTime, durationSec, isPlaying, playbackSpeed, onTogglePlay, onSeek, onReset, onChangeSpeed, isDemo, isLoading }: Props) {
  return <section className="audio-dock" aria-label={isDemo ? t("Simulasi waktu contoh") : t("Pemutar rekaman")}>
    <div className="audio-dock-inner"><div className="transport-main"><Button size="icon" onClick={onTogglePlay} disabled={isLoading || !durationSec} aria-label={isPlaying ? t("Jeda") : isDemo ? t("Jalankan simulasi waktu") : t("Putar rekaman")}>{isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button><div className="transport-time"><span>{formatSeconds(currentTime)}</span><span> / {formatSeconds(durationSec)}</span></div></div>
      <div className="transport-timeline"><label htmlFor="audio-position" className="sr-only">{t("Posisi waktu rekaman")}</label><input id="audio-position" type="range" min={0} max={durationSec || 1} step={1} value={Math.min(currentTime, durationSec)} disabled={isLoading || !durationSec} onChange={event => onSeek(Number(event.target.value))} aria-valuetext={formatSeconds(currentTime)} style={{ '--progress': `${durationSec ? currentTime / durationSec * 100 : 0}%` } as React.CSSProperties} /></div>
      <div className="transport-options"><Button size="icon" variant="ghost" aria-label={t("Kembali ke awal")} onClick={onReset} disabled={isLoading}><RotateCcw aria-hidden="true" /></Button><label className="speed-select"><span className="sr-only">{t("Kecepatan pemutaran")}</span><select value={playbackSpeed} onChange={event => onChangeSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label><span className="transport-caption"><Headphones className="size-3.5" aria-hidden="true" />{isLoading ? t("Membuka audio…") : isDemo ? t("Simulasi, tanpa audio") : t("Rekaman lokal")}</span></div>
    </div>
  </section>;
}
