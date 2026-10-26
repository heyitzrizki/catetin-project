import { t } from '@/lib/i18n';
import { AlignLeft, List, SlidersHorizontal, Download, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ExportActions } from '@/components/ui/export-menu';
import type { DialogSegment } from '@/lib/transcript';
import type { TranscriptionUiSnapshot } from '@/features/transcription/job-controller';

interface Props extends ExportActions {
  viewMode: 'naskah' | 'waktu';
  onChangeViewMode: (value: 'naskah' | 'waktu') => void;
  segments: DialogSegment[];
  speakerNames: Record<string, string>;
  activeSpeakerFilter: string | null;
  onSelectSpeakerFilter: (speaker: string | null) => void;
  onOpenWhisperDrawer: () => void;
  selectedModel: string;
  canTranscribe?: boolean;
  snapshot?: TranscriptionUiSnapshot;
  isBackgroundJob?: boolean;
  jobRecordingTitle?: string;
  resumableChunks?: number;
  onTranscribe?: () => void;
  onResume?: () => void;
  onStartFresh?: () => void;
  onDiscardCheckpoint?: () => void;
  onCancel?: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  validating: 'Memvalidasi berkas…',
  'preparing-model': '1. Menyiapkan model',
  'preparing-audio': '2. Menyiapkan audio',
  transcribing: '3. Mentranskripsi',
  'assembling-result': '4. Menyusun hasil',
  completed: 'Transkripsi selesai',
  cancelled: 'Dibatalkan',
  failed: 'Transkripsi terhenti',
  unsupported: 'Perangkat/format tidak didukung',
};

function getProgressAriaLabel(snapshot?: TranscriptionUiSnapshot): string {
  if (!snapshot) return t("Kemajuan pemuatan model");
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

export function ContextualUtilityPanel({
  viewMode,
  onChangeViewMode,
  segments,
  speakerNames,
  activeSpeakerFilter,
  onSelectSpeakerFilter,
  onOpenWhisperDrawer,
  selectedModel,
  canTranscribe = false,
  snapshot,
  isBackgroundJob = false,
  jobRecordingTitle,
  resumableChunks = 0,
  onTranscribe,
  onResume,
  onStartFresh,
  onDiscardCheckpoint,
  onCancel,
  onExportTxt,
  onExportWord,
  onExportSrt,
  onCopyAll,
}: Props) {
  const speakers = [...new Set(segments.map(s => s.speaker))];
  const status = snapshot?.status ?? 'idle';
  const running = ['validating', 'preparing-model', 'preparing-audio', 'transcribing', 'assembling-result'].includes(status);
  const failed = status === 'failed' || status === 'unsupported';
  const hasCheckpoint = canTranscribe && !running && resumableChunks > 0;
  const usedWasmFallback = (snapshot?.jobState?.fallbackCount ?? 0) > 0;
  const showStatusCard = canTranscribe || status !== 'idle' || hasCheckpoint;
  const progressLabel = getProgressAriaLabel(snapshot);

  return <div className="utility-panel">
    <section><h2 className="utility-heading">{t("Tampilan naskah")}</h2><Tabs value={viewMode} onValueChange={value => onChangeViewMode(value as Props['viewMode'])}><TabsList className="view-switch" aria-label={t("Tampilan naskah")}><TabsTrigger value="naskah"><AlignLeft aria-hidden="true" className="size-3.5" />{t("Naskah")}</TabsTrigger><TabsTrigger value="waktu"><List aria-hidden="true" className="size-3.5" />{t("Waktu")}</TabsTrigger></TabsList></Tabs></section>
    <section><div className="utility-heading-row"><h2 className="utility-heading">{t("Pembicara")}</h2><span>{speakers.length}</span></div><div className="speaker-filters"><button aria-pressed={activeSpeakerFilter === null} onClick={() => onSelectSpeakerFilter(null)}><span>{t("Semua pembicara")}</span><span>{segments.length}</span></button>{speakers.map((speaker, index) => <button aria-pressed={activeSpeakerFilter === speaker} key={speaker} onClick={() => onSelectSpeakerFilter(activeSpeakerFilter === speaker ? null : speaker)}><span className="speaker-initial" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="speaker-filter-name">{speakerNames[speaker] || speaker}</span><span>{segments.filter(s => s.speaker === speaker).length}</span></button>)}</div></section>
    <section><h2 className="utility-heading">{t("Bawa naskah Anda")}</h2><div className="export-list"><button disabled={!segments.length} onClick={onExportTxt}><Download aria-hidden="true" /><span>{t("Teks polos")}</span><span>.txt</span></button><button disabled={!segments.length} onClick={onExportWord}><Download aria-hidden="true" /><span>{t("Dokumen Word")}</span><span>.doc</span></button><button disabled={!segments.length} onClick={onExportSrt}><Download aria-hidden="true" /><span>{t("Subtitle")}</span><span>.srt</span></button><button disabled={!segments.length} onClick={onCopyAll}><Copy aria-hidden="true" /><span>{t("Salin naskah")}</span></button></div></section>
    <section className="experimental-settings"><h2 className="utility-heading">{t("Transkripsi lokal")}</h2><Button variant="ghost" className="model-button" onClick={onOpenWhisperDrawer}><SlidersHorizontal aria-hidden="true" /><span>{t("Model & perangkat")}<span>Whisper {selectedModel === 'base' ? 'Base' : selectedModel === 'small' ? 'Small' : 'Tiny'}</span></span></Button>{showStatusCard && <div className={`transcription-status mt-2 ${failed ? 'is-error' : ''}`} role="status" data-status={status}>{isBackgroundJob && <span className="text-xs font-medium text-primary">{t("Transkripsi latar belakang: {title}", { title: jobRecordingTitle ? t(jobRecordingTitle) : (snapshot?.recordingId ?? '') })}</span>}<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{t(PHASE_LABELS[status] ?? 'Siap ditranskripsi')}</span>{status === 'transcribing' && snapshot?.currentChunk != null && snapshot?.totalChunks != null && <span className="font-mono">{snapshot.currentChunk}/{snapshot.totalChunks}</span>}</div>{status !== 'idle' && snapshot ? <strong>{t(snapshot.messageKey, snapshot.messageParams)}</strong> : hasCheckpoint ? <strong>{t("Kemajuan transkripsi tersimpan ({count} bagian selesai).", { count: resumableChunks })}</strong> : <span className="text-xs text-muted-foreground">{t("Rekaman lokal siap ditranskripsikan di perangkat.")}</span>}{usedWasmFallback && <span className="text-xs text-muted-foreground">{t("Berjalan dengan cadangan WebAssembly (WASM).")}</span>}{running && (snapshot?.resumedFromChunks ?? 0) > 0 && <span className="text-xs text-muted-foreground">{t("Melanjutkan dari bagian tersimpan ({count} bagian dilewati).", { count: snapshot?.resumedFromChunks ?? 0 })}</span>}{running && (snapshot?.progress != null ? <progress max="100" value={snapshot.progress} aria-label={progressLabel} /> : <progress aria-label={progressLabel} />)}{(failed || status === 'cancelled') && snapshot?.nextActionKey && <p className="text-xs leading-relaxed">{t(snapshot.nextActionKey)}</p>}<div className="flex flex-wrap gap-1.5 pt-1">{running ? <Button size="sm" variant="outline" onClick={onCancel}>{t("Batalkan")}</Button> : hasCheckpoint ? <><Button size="sm" onClick={onResume ?? onTranscribe}>{t("Lanjutkan transkripsi")}</Button><Button size="sm" variant="outline" onClick={onStartFresh}>{t("Mulai dari awal")}</Button><Button size="sm" variant="ghost" onClick={onDiscardCheckpoint}>{t("Hapus kemajuan")}</Button></> : canTranscribe && <Button size="sm" onClick={onTranscribe}>{status === 'completed' ? t("Transkripsikan lagi") : failed || status === 'cancelled' ? t("Coba lagi") : t("Mulai transkripsi")}</Button>}</div></div>}</section>
    <p className="session-note">{t("Perubahan disimpan otomatis di browser pada perangkat ini.")}</p>
  </div>;
}
