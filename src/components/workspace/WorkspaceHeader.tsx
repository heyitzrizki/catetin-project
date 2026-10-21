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
  SlidersHorizontal 
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
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const sampleMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sampleMenuRef.current && !sampleMenuRef.current.contains(event.target as Node)) {
        setIsSampleMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sampleOptions = [
    { key: 'wawancara', label: 'Wawancara Investigasi', duration: '03:42', category: 'Riset & Investigasi' },
    { key: 'hukum', label: 'Konsultasi Hukum NDA', duration: '03:10', category: 'Hukum & Sidang' },
    { key: 'rapat', label: 'Notulen Rapat Sprint Q3', duration: '02:15', category: 'Manajemen Produk' }
  ];

  return (
    <header className="border-b border-border bg-card/60 backdrop-blur-xs sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 space-y-3">
        
        {/* Top Row: Navigation, Title & Primary Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          {/* Left: Back & Document Metadata */}
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onBackToLanding}
              className="rounded-xs shrink-0 text-xs font-mono text-foreground hover:bg-accent"
              aria-label="Kembali ke beranda"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              <span>Beranda</span>
            </Button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-primary shrink-0" />
                <h1 className="text-sm sm:text-base font-bold text-foreground truncate">
                  {activeSample.filename}
                </h1>
                <Badge variant="outline" className="hidden md:inline-flex text-[10px] font-mono py-0">
                  {activeSample.category}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                <span>Durasi: {activeSample.duration}</span>
                <span>•</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">100% Memori RAM Lokal</span>
              </div>
            </div>
          </div>

          {/* Right: Whisper Model Badge & Action Controls */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            
            {/* Sample Selector Dropdown (Requirement 1: Separated near file info) */}
            <div className="relative" ref={sampleMenuRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsSampleMenuOpen(!isSampleMenuOpen)}
                className="rounded-xs text-xs font-medium border-border flex items-center gap-1.5"
                aria-expanded={isSampleMenuOpen}
                aria-haspopup="true"
              >
                <span>Pilih Sampel</span>
                <ChevronDown className="w-3 h-3 opacity-70" />
              </Button>

              {isSampleMenuOpen && (
                <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1 w-64 bg-popover text-popover-foreground border border-border rounded-xs shadow-lg py-1 z-40 animate-in fade-in-50 zoom-in-95 duration-100">
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
                        <div className="truncate">{opt.label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{opt.category}</div>
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

            {/* Audio Upload Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={onUploadClick}
              className="rounded-xs text-xs font-medium border-border flex items-center gap-1.5"
              title="Pilih berkas audio lokal dari komputer Anda"
            >
              <Upload className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">Unggah Audio</span>
              <span className="sm:hidden">Unggah</span>
            </Button>

            {/* Whisper Hardware / Diagnostics Drawer Trigger */}
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenWhisperDrawer}
              className="rounded-xs text-xs font-mono font-medium flex items-center gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/50"
              title="Buka pengaturan dan diagnostik perangkat keras Whisper"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="capitalize">Whisper {selectedModel}</span>
              <SlidersHorizontal className="w-3 h-3 opacity-60 ml-0.5" />
            </Button>

            {/* Export Menu Dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <Button
                variant="navy"
                size="sm"
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className="rounded-xs text-xs font-bold flex items-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                aria-expanded={isExportMenuOpen}
                aria-haspopup="true"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Ekspor</span>
                <ChevronDown className="w-3 h-3" />
              </Button>

              {isExportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-popover text-popover-foreground border border-border rounded-xs shadow-lg py-1 z-40 animate-in fade-in-50 zoom-in-95 duration-100">
                  <div className="px-3 py-1.5 text-[10px] font-mono uppercase font-bold text-muted-foreground border-b border-border/50">
                    Opsi Unduh & Ekspor
                  </div>
                  <button
                    onClick={() => {
                      onExportWord();
                      setIsExportMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent text-foreground transition cursor-pointer font-medium"
                  >
                    <span>Format Word (.DOCX)</span>
                    <Badge variant="navy" className="text-[9px] py-0">Formal</Badge>
                  </button>
                  <button
                    onClick={() => {
                      onExportTxt();
                      setIsExportMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent text-foreground transition cursor-pointer"
                  >
                    <span>Teks Polos (.TXT)</span>
                    <span className="font-mono text-[10px] text-muted-foreground">Ringan</span>
                  </button>
                  <button
                    onClick={() => {
                      onExportSrt();
                      setIsExportMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-accent text-foreground transition cursor-pointer"
                  >
                    <span>Subtitle Video (.SRT)</span>
                    <span className="font-mono text-[10px] text-muted-foreground">Waktu</span>
                  </button>
                  <div className="border-t border-border/50 my-1"></div>
                  <button
                    onClick={() => {
                      onCopyAll();
                      setIsExportMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-accent text-foreground transition cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Salin ke Papan Klip</span>
                  </button>
                </div>
              )}
            </div>

            {/* Search Trigger Button */}
            <Button
              variant={isSearching ? "secondary" : "ghost"}
              size="icon"
              onClick={onToggleSearch}
              className="h-8 w-8 rounded-xs text-muted-foreground hover:text-foreground"
              title={isSearching ? "Tutup pencarian" : "Cari kata dalam transkrip"}
              aria-label="Cari kata dalam transkrip"
            >
              {isSearching ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </Button>

          </div>

        </div>

        {/* Search Bar Row (Collapsible) */}
        {isSearching && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/50 animate-in fade-in duration-150">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Cari kata atau nama pembicara dalam naskah transkrip..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none py-1 font-sans"
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
