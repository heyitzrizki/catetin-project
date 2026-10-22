import { AlignLeft, List, SlidersHorizontal, Download, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ExportActions } from '@/components/ui/export-menu';
import type { DialogSegment } from '@/lib/transcript';

interface Props extends ExportActions {
  viewMode: 'naskah' | 'waktu';
  onChangeViewMode: (value: 'naskah' | 'waktu') => void;
  segments: DialogSegment[];
  speakerNames: Record<string, string>;
  activeSpeakerFilter: string | null;
  onSelectSpeakerFilter: (speaker: string | null) => void;
  onOpenWhisperDrawer: () => void;
  selectedModel: string;
}

export function ContextualUtilityPanel({ viewMode, onChangeViewMode, segments, speakerNames, activeSpeakerFilter, onSelectSpeakerFilter, onOpenWhisperDrawer, selectedModel, onExportTxt, onExportWord, onExportSrt, onCopyAll }: Props) {
  const speakers = [...new Set(segments.map(s => s.speaker))];
  return <div className="utility-panel">
    <section><h2 className="utility-heading">Tampilan naskah</h2><Tabs value={viewMode} onValueChange={value => onChangeViewMode(value as Props['viewMode'])}><TabsList className="view-switch" aria-label="Tampilan naskah"><TabsTrigger value="naskah"><AlignLeft aria-hidden="true" className="size-3.5" />Naskah</TabsTrigger><TabsTrigger value="waktu"><List aria-hidden="true" className="size-3.5" />Waktu</TabsTrigger></TabsList></Tabs></section>
    <section><div className="utility-heading-row"><h2 className="utility-heading">Pembicara</h2><span>{speakers.length}</span></div><div className="speaker-filters"><button aria-pressed={activeSpeakerFilter === null} onClick={() => onSelectSpeakerFilter(null)}><span>Semua pembicara</span><span>{segments.length}</span></button>{speakers.map((speaker, index) => <button aria-pressed={activeSpeakerFilter === speaker} key={speaker} onClick={() => onSelectSpeakerFilter(activeSpeakerFilter === speaker ? null : speaker)}><span className="speaker-initial" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="speaker-filter-name">{speakerNames[speaker] || speaker}</span><span>{segments.filter(s => s.speaker === speaker).length}</span></button>)}</div></section>
    <section><h2 className="utility-heading">Bawa naskah Anda</h2><div className="export-list"><button disabled={!segments.length} onClick={onExportTxt}><Download aria-hidden="true" /><span>Teks polos</span><span>.txt</span></button><button disabled={!segments.length} onClick={onExportWord}><Download aria-hidden="true" /><span>Dokumen Word</span><span>.doc</span></button><button disabled={!segments.length} onClick={onExportSrt}><Download aria-hidden="true" /><span>Subtitle</span><span>.srt</span></button><button disabled={!segments.length} onClick={onCopyAll}><Copy aria-hidden="true" /><span>Salin naskah</span></button></div></section>
    <section className="experimental-settings"><h2 className="utility-heading">Dalam pengembangan</h2><Button variant="ghost" className="model-button" onClick={onOpenWhisperDrawer}><SlidersHorizontal aria-hidden="true" /><span>Model & perangkat<span>Whisper {selectedModel === 'base' ? 'Base' : selectedModel === 'small' ? 'Small' : 'Tiny'}</span></span></Button></section>
    <p className="session-note">Perubahan tersimpan selama tab terbuka. Ekspor naskah sebelum memuat ulang.</p>
  </div>;
}
