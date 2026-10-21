import React from 'react';
import { 
  FileText, 
  Clock, 
  Download, 
  Copy, 
  Cpu, 
  Check, 
  SlidersHorizontal,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface DialogSegment {
  id: number;
  time: string;
  seconds: number;
  speaker: string;
  text: string;
}

interface ContextualUtilityPanelProps {
  viewMode: 'naskah' | 'waktu';
  onChangeViewMode: (mode: 'naskah' | 'waktu') => void;
  selectedModel: string;
  onOpenWhisperDrawer: () => void;
  segments: DialogSegment[];
  speakerNames: { [key: string]: string };
  activeSpeakerFilter: string | null;
  onSelectSpeakerFilter: (speaker: string | null) => void;
  onExportWord: () => void;
  onExportSrt: () => void;
  onExportTxt: () => void;
  onCopyAll: () => void;
  currentTime: number;
  duration: string;
  formatSeconds: (sec: number) => string;
}

export function ContextualUtilityPanel({
  viewMode,
  onChangeViewMode,
  selectedModel,
  onOpenWhisperDrawer,
  segments,
  speakerNames,
  activeSpeakerFilter,
  onSelectSpeakerFilter,
  onExportWord,
  onExportSrt,
  onExportTxt,
  onCopyAll,
  currentTime,
  duration,
  formatSeconds
}: ContextualUtilityPanelProps) {
  // Compute speaker statistics
  const speakerStats = segments.reduce((acc, seg) => {
    const rawSpeaker = seg.speaker;
    acc[rawSpeaker] = (acc[rawSpeaker] || 0) + 1;
    return acc;
  }, {} as { [key: string]: number });

  const distinctSpeakers = Object.keys(speakerStats);

  // Model spec lookup (estimated RAM / realtime factor)
  const getModelSpecs = (modelId: string) => {
    switch (modelId.toLowerCase()) {
      case 'tiny':
        return { label: 'Whisper Tiny (Ultra-Fast)', spec: '75 MB VRAM · 15x Realtime' };
      case 'small':
        return { label: 'Whisper Small (High-Accuracy)', spec: '460 MB VRAM · 4x Realtime' };
      case 'base':
      default:
        return { label: 'Whisper Base (Fast)', spec: '140 MB VRAM · 10x Realtime' };
    }
  };

  const modelInfo = getModelSpecs(selectedModel);

  return (
    <aside 
      className="w-full lg:w-80 shrink-0 bg-card border-t lg:border-t-0 lg:border-l border-border/80 p-4 sm:p-5 flex flex-col gap-5 text-card-foreground select-none"
      aria-label="Panel Utilitas Kontekstual"
    >
      {/* 1. MODE TAMPILAN */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-muted-foreground mb-2 flex items-center justify-between">
          <span>Mode Tampilan</span>
          <span className="text-[9px] text-muted-foreground/80 font-normal">Tata Letak</span>
        </div>
        <div className="grid grid-cols-2 p-1 bg-muted/60 border border-border/60 rounded-xs gap-1">
          <button
            type="button"
            onClick={() => onChangeViewMode('naskah')}
            className={`py-1.5 px-3 text-xs font-semibold rounded-xs transition-all cursor-pointer text-center ${
              viewMode === 'naskah'
                ? 'bg-card text-foreground shadow-2xs font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Naskah
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('waktu')}
            className={`py-1.5 px-3 text-xs font-semibold rounded-xs transition-all cursor-pointer text-center ${
              viewMode === 'waktu'
                ? 'bg-card text-foreground shadow-2xs font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Segmen Waktu
          </button>
        </div>
      </div>

      {/* 2. MODEL AKTIF */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-muted-foreground mb-2 flex items-center justify-between">
          <span>Model Aktif</span>
          <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-semibold font-mono">100% On-Device</span>
        </div>
        <button
          type="button"
          onClick={onOpenWhisperDrawer}
          className="w-full text-left p-3 rounded-xs border border-border/80 bg-background hover:bg-accent/40 hover:border-primary/50 transition-colors cursor-pointer group"
          title="Klik untuk membuka diagnostik perangkat keras dan pemilihan model Whisper"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="font-bold text-xs text-foreground group-hover:text-primary transition-colors">
              {modelInfo.label}
            </span>
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
          </div>
          <div className="text-[11px] font-mono text-muted-foreground">
            {modelInfo.spec}
          </div>
        </button>
      </div>

      {/* 3. DAFTAR PEMBICARA */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-muted-foreground mb-2 flex items-center justify-between">
          <span>Daftar Pembicara</span>
          {activeSpeakerFilter && (
            <button
              onClick={() => onSelectSpeakerFilter(null)}
              className="text-[9px] text-primary hover:underline font-mono cursor-pointer"
            >
              Tampilkan Semua
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {distinctSpeakers.length === 0 ? (
            <div className="text-xs text-muted-foreground font-mono italic py-2">
              Belum ada pembicara terdeteksi
            </div>
          ) : (
            distinctSpeakers.map((spkKey, idx) => {
              const displayName = speakerNames[spkKey] || spkKey;
              const count = speakerStats[spkKey];
              const isSelected = activeSpeakerFilter === spkKey;
              
              // Color themes matching the mockup
              const isSpeakerOne = idx === 0 || spkKey.toLowerCase().includes('speaker 1');
              const themeClasses = isSpeakerOne
                ? isSelected
                  ? 'bg-emerald-100 border-emerald-400 text-emerald-950 font-bold dark:bg-emerald-900/60 dark:border-emerald-600 dark:text-emerald-100'
                  : 'bg-emerald-50/70 border-emerald-200 text-emerald-900 hover:bg-emerald-100/70 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300'
                : isSelected
                  ? 'bg-blue-100 border-blue-400 text-blue-950 font-bold dark:bg-blue-900/60 dark:border-blue-600 dark:text-blue-100'
                  : 'bg-blue-50/70 border-blue-200 text-blue-900 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300';

              const badgeTheme = isSpeakerOne
                ? 'bg-emerald-200/60 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200'
                : 'bg-blue-200/60 text-blue-900 dark:bg-blue-900 dark:text-blue-200';

              return (
                <button
                  key={spkKey}
                  type="button"
                  onClick={() => onSelectSpeakerFilter(isSelected ? null : spkKey)}
                  className={`w-full text-left px-3 py-2 rounded-xs border text-xs flex items-center justify-between transition-colors cursor-pointer ${themeClasses}`}
                  title={`Klik untuk memfilter giliran bicara ${displayName}`}
                >
                  <span className="truncate pr-2 font-medium">
                    {displayName}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-xs shrink-0 ${badgeTheme}`}>
                    {count} segmen
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* 4. EKSPOR CEPAT */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-muted-foreground mb-2">
          Ekspor Cepat
        </div>
        <div className="border border-border/80 rounded-xs divide-y divide-border/60 bg-background overflow-hidden">
          <button
            type="button"
            onClick={onExportWord}
            className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent/50 text-foreground transition-colors cursor-pointer group"
          >
            <span className="font-medium group-hover:text-primary transition-colors">
              Dokumen Word (.docx)
            </span>
            <span className="font-mono text-[10px] font-bold text-muted-foreground group-hover:text-primary transition-colors">
              DOCX
            </span>
          </button>
          <button
            type="button"
            onClick={onExportSrt}
            className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent/50 text-foreground transition-colors cursor-pointer group"
          >
            <span className="font-medium group-hover:text-primary transition-colors">
              Subtitle SubRip (.srt)
            </span>
            <span className="font-mono text-[10px] font-bold text-muted-foreground group-hover:text-primary transition-colors">
              SRT
            </span>
          </button>
          <button
            type="button"
            onClick={onExportTxt}
            className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent/50 text-foreground transition-colors cursor-pointer group"
          >
            <span className="font-medium group-hover:text-primary transition-colors">
              Teks Polos (.txt)
            </span>
            <span className="font-mono text-[10px] font-bold text-muted-foreground group-hover:text-primary transition-colors">
              TXT
            </span>
          </button>
          <button
            type="button"
            onClick={onCopyAll}
            className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent/50 text-foreground transition-colors cursor-pointer group"
          >
            <span className="font-medium group-hover:text-primary transition-colors">
              Salin Naskah
            </span>
            <span className="font-mono text-[10px] font-bold text-muted-foreground group-hover:text-primary transition-colors">
              KLIP
            </span>
          </button>
        </div>
      </div>

      {/* 5. FOOTER STATUS */}
      <div className="pt-2 border-t border-border/60 mt-auto space-y-1.5 font-mono text-xs">
        <div className="flex items-center justify-between text-muted-foreground text-[11px]">
          <span>Durasi Terproses:</span>
          <span className="font-bold text-foreground">{formatSeconds(currentTime)} / {duration}</span>
        </div>
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
          <span>On-Device Inference</span>
        </div>
      </div>
    </aside>
  );
}
