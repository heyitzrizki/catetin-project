import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, 
  Upload, 
  Copy, 
  Download, 
  FileAudio, 
  Cpu, 
  Search, 
  X, 
  ChevronDown, 
  Check, 
  SlidersHorizontal,
  ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SampleRecording {
  id: string;
  category: string;
  filename: string;
  duration: string;
  durationSec: number;
}

interface WorkspaceHeaderProps {
  activeSample: SampleRecording;
  activeKey: string;
  onSelectSample: (key: string) => void;
  onUploadClick: () => void;
  onBackToLanding: () => void;
  onOpenWhisperDrawer: () => void;
  selectedModel: string;
  onCopyAll: () => void;
  onExportWord: () => void;
  onExportTxt: () => void;
  onExportSrt: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isSearching: boolean;
  onToggleSearch: () => void;
}

export function WorkspaceHeader({
  activeSample,
  activeKey,
  onSelectSample,
  onUploadClick,
  onBackToLanding,
  onOpenWhisperDrawer,
  selectedModel,
  onCopyAll,
  onExportWord,
  onExportTxt,
  onExportSrt,
  searchQuery,
  onSearchChange,
  isSearching,
  onToggleSearch
}: WorkspaceHeaderProps) {
  const [isSampleMenuOpen, setIsSampleMenuOpen] = useState(false);
  const sampleMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sampleMenuRef.current && !sampleMenuRef.current.contains(event.target as Node)) {
        setIsSampleMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sampleOptions = [
    { key: 'wawancara', label: 'Wawancara Investigasi', filename: 'Wawancara_Investigasi_Q3.mp3', duration: '03:42', category: 'Riset & Investigasi' },
    { key: 'hukum', label: 'Konsultasi Hukum NDA', filename: 'Konsultasi_Klien_NDA.wav', duration: '03:10', category: 'Hukum & Sidang' },
    { key: 'rapat', label: 'Notulen Rapat Sprint Q3', filename: 'Notulen_Rapat_Sprint_Q3.m4a', duration: '02:15', category: 'Manajemen Produk' }
  ];

  return (
    <header className="border-b border-border/80 bg-card select-none">
      <div className="w-full px-4 sm:px-6 py-2.5">
        
        {/* Window Chrome Header Bar matching Mockup */}
        <div className="flex items-center justify-between gap-3">
          
          {/* Left: Window Dots & File Title */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Window control dots: Orange and Green as in mockup */}
            <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-500/30 inline-block"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-600/30 inline-block"></span>
            </div>

            {/* Current Filename Title */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono font-medium text-xs sm:text-sm text-foreground truncate">
                {activeSample.filename}
              </span>

              {/* Sample Switcher Popover */}
              <div className="relative shrink-0" ref={sampleMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsSampleMenuOpen(!isSampleMenuOpen)}
                  className="px-2 py-0.5 rounded-xs text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60 flex items-center gap-1 transition cursor-pointer"
                  title="Ganti sampel rekaman"
                  aria-expanded={isSampleMenuOpen}
                >
                  <span className="hidden sm:inline">Pilih Sampel</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>

                {isSampleMenuOpen && (
                  <div className="absolute left-0 top-full mt-1.5 w-64 bg-popover text-popover-foreground border border-border rounded-xs shadow-lg py-1 z-50">
                    <div className="px-3 py-1.5 text-[10px] font-mono uppercase font-bold text-muted-foreground border-b border-border/50">
                      Pilihan Rekaman Sampel
                    </div>
                    {sampleOptions.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => {
                          onSelectSample(opt.key);
                          setIsSampleMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent transition cursor-pointer ${
                          activeKey === opt.key ? 'bg-primary/5 font-bold text-primary' : 'text-foreground'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <div className="truncate font-mono">{opt.filename}</div>
                          <div className="text-[10px] text-muted-foreground">{opt.category}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] text-muted-foreground">
                          <span>{opt.duration}</span>
                          {activeKey === opt.key && <Check className="w-3 h-3 text-primary" />}
                        </div>
                      </button>
                    ))}
                    {activeKey.startsWith('uploaded_') && (
                      <div className="px-3 py-2 text-xs border-t border-border/50 bg-accent/20 flex items-center justify-between font-bold text-foreground">
                        <span className="truncate">Berkas Kustom Lokal</span>
                        <Check className="w-3 h-3 text-primary" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Upload audio trigger */}
              <button
                type="button"
                onClick={onUploadClick}
                className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60 transition cursor-pointer"
                title="Unggah berkas audio lokal dari perangkat"
              >
                <Upload className="w-3 h-3 text-muted-foreground" />
                <span>Unggah Audio</span>
              </button>

              {/* Search Toggle */}
              <button
                type="button"
                onClick={onToggleSearch}
                className="px-1.5 py-0.5 rounded-xs text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60 transition cursor-pointer flex items-center gap-1"
                title="Cari kata di transkrip"
              >
                <Search className="w-3 h-3" />
                <span className="hidden sm:inline">Cari</span>
              </button>
            </div>
          </div>

          {/* Right: LOCAL RAM BUFFER Tag & Action Button */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Green LOCAL RAM BUFFER badge matching mockup */}
            <div className="border border-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-mono text-[11px] font-bold px-2.5 py-1 rounded-xs tracking-wider uppercase shrink-0">
              LOCAL RAM BUFFER
            </div>

            {/* Back to Landing / Main Action Button */}
            <Button
              variant="default"
              size="sm"
              onClick={onBackToLanding}
              className="bg-slate-950 dark:bg-primary text-white dark:text-primary-foreground hover:bg-slate-800 dark:hover:bg-primary/90 rounded-xs text-xs font-medium px-3.5 py-1.5 h-auto flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <span>Beranda</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

        </div>

        {/* Collapsible Search Input Row */}
        {isSearching && (
          <div className="mt-2 pt-2 border-t border-border/60 flex items-center gap-2 animate-in fade-in duration-100">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Cari kata atau nama pembicara dalam naskah transkrip..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none py-0.5 font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer px-1 font-mono"
              >
                Hapus
              </button>
            )}
          </div>
        )}

      </div>
    </header>
  );
}
