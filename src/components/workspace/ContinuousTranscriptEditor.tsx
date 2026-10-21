import React, { useState } from 'react';
import { Play, Edit3, Check, X, FileText, Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DialogSegment {
  id: number;
  time: string;
  seconds: number;
  speaker: string;
  text: string;
}

interface ContinuousTranscriptEditorProps {
  segments: DialogSegment[];
  speakerNames: { [key: string]: string };
  currentTime: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  onRenameSpeaker: (oldName: string, newName: string) => void;
  onUpdateText: (id: number, newText: string) => void;
  searchQuery?: string;
  onReloadSample: () => void;
  onUploadClick: () => void;
}

export function ContinuousTranscriptEditor({
  segments,
  speakerNames,
  currentTime,
  isPlaying,
  onSeek,
  onRenameSpeaker,
  onUpdateText,
  searchQuery = '',
  onReloadSample,
  onUploadClick
}: ContinuousTranscriptEditorProps) {
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerInputValue, setSpeakerInputValue] = useState('');

  const startRename = (speaker: string, currentDisplayName: string) => {
    setEditingSpeaker(speaker);
    setSpeakerInputValue(currentDisplayName);
  };

  const submitRename = (oldSpeaker: string) => {
    if (speakerInputValue.trim()) {
      onRenameSpeaker(oldSpeaker, speakerInputValue.trim());
    }
    setEditingSpeaker(null);
  };

  // Filter segments by search query if present
  const queryLower = searchQuery.toLowerCase().trim();
  const filteredSegments = queryLower
    ? segments.filter(seg => {
        const displayName = speakerNames[seg.speaker] || seg.speaker;
        return seg.text.toLowerCase().includes(queryLower) ||
               displayName.toLowerCase().includes(queryLower);
      })
    : segments;

  // Empty State (Rule C-4, R-27)
  if (segments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center border border-dashed border-border rounded-xs bg-muted/10 my-6">
        <div className="w-12 h-12 rounded-xs bg-muted flex items-center justify-center mb-4 text-muted-foreground">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-foreground mb-1.5">
          Belum Ada Segmen Transkrip
        </h3>
        <p className="text-xs text-muted-foreground max-w-md mb-6 leading-relaxed">
          Naskah transkrip kosong. Silakan muat salah satu rekaman sampel bawaan atau unggah berkas audio lokal Anda untuk memulai proses transkrip.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onReloadSample}
            className="rounded-xs text-xs font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Muat Sampel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onUploadClick}
            className="rounded-xs text-xs font-semibold bg-primary text-primary-foreground"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Pilih Berkas Audio
          </Button>
        </div>
      </div>
    );
  }

  return (
    <article 
      className="w-full bg-card border border-border/70 rounded-xs shadow-2xs overflow-hidden"
      aria-label="Editor Transkrip Percakapan"
    >
      {/* Editorial Document Header Meta */}
      <div className="px-6 py-4 border-b border-border/70 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold uppercase tracking-wider text-foreground text-[11px]">
            Naskah Risalah Percakapan
          </span>
          <span className="text-muted-foreground font-mono text-[11px]">
            ({filteredSegments.length} dari {segments.length} segmen)
          </span>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground">
          Klik waktu untuk loncat audio, klik teks untuk mengedit langsung
        </div>
      </div>

      {/* Continuous Document Flow (No Enclosing Cards) */}
      <div className="px-6 sm:px-10 py-6 divide-y divide-border/40 space-y-2">
        {filteredSegments.map((item, idx) => {
          const displayName = speakerNames[item.speaker] || item.speaker;
          
          // Determine if this segment is actively being played
          const nextSegment = segments[idx + 1];
          const isCurrent = currentTime >= item.seconds && 
            (nextSegment ? currentTime < nextSegment.seconds : currentTime < item.seconds + 12);

          return (
            <section
              key={item.id}
              id={`segment-${item.id}`}
              className={`py-4 transition-colors duration-150 ${
                isCurrent 
                  ? 'border-l-2 border-primary bg-primary/5 dark:bg-primary/10 pl-4 -ml-4 pr-3 rounded-none' 
                  : 'pl-0 hover:bg-muted/15'
              }`}
            >
              {/* Speaker & Timestamp Line */}
              <div className="flex items-center justify-between gap-4 mb-2 font-mono text-xs">
                
                <div className="flex items-center gap-2.5 flex-wrap">
                  {/* Timestamp Play Jump Button */}
                  <button
                    onClick={() => onSeek(item.seconds)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-none font-bold text-[11px] transition cursor-pointer select-none ${
                      isCurrent
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary'
                    }`}
                    title={`Loncat ke detik ${item.seconds} dan putar`}
                    aria-label={`Loncat audio ke waktu ${item.time}`}
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>{item.time}</span>
                  </button>

                  {/* Speaker Name with Inline Editing */}
                  {editingSpeaker === item.speaker ? (
                    <div className="inline-flex items-center gap-1">
                      <input
                        type="text"
                        value={speakerInputValue}
                        onChange={(e) => setSpeakerInputValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRename(item.speaker);
                          if (e.key === 'Escape') setEditingSpeaker(null);
                        }}
                        onBlur={() => submitRename(item.speaker)}
                        className="px-2 py-0.5 text-xs font-bold border border-primary bg-background text-foreground rounded-none focus:outline-none ring-1 ring-primary"
                        aria-label="Ubah nama pembicara"
                      />
                      <button
                        onClick={() => submitRename(item.speaker)}
                        className="p-1 text-emerald-600 hover:text-emerald-700 cursor-pointer"
                        title="Simpan nama"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingSpeaker(null)}
                        className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Batal"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startRename(item.speaker, displayName)}
                      className="font-bold text-foreground hover:text-primary transition flex items-center gap-1.5 cursor-pointer text-left group"
                      title="Klik untuk mengubah nama pembicara di semua segmen"
                    >
                      <span className="font-semibold text-xs tracking-tight text-foreground group-hover:text-primary">
                        {displayName}
                      </span>
                      <Edit3 className="w-3 h-3 text-muted-foreground opacity-50 group-hover:opacity-100 transition" />
                    </button>
                  )}
                </div>

                {/* Line Index */}
                <span className="text-[10px] font-mono text-muted-foreground select-none shrink-0">
                  Baris {String(idx + 1).padStart(2, '0')}
                </span>

              </div>

              {/* Editable Dialogue Text (Document Measure) */}
              <div className="text-sm text-foreground/90 leading-relaxed font-sans focus-within:ring-1 focus-within:ring-primary/40 rounded-none p-1 -m-1">
                <p
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => onUpdateText(item.id, e.currentTarget.textContent || '')}
                  className="focus:outline-none min-h-[1.5em]"
                  tabIndex={0}
                  role="textbox"
                  aria-multiline="true"
                  aria-label={`Teks perkataan ${displayName}`}
                >
                  {item.text}
                </p>
              </div>

            </section>
          );
        })}

        {/* Empty filter message */}
        {filteredSegments.length === 0 && queryLower && (
          <div className="py-12 text-center text-xs text-muted-foreground font-mono">
            Tidak ada segmen transkrip yang cocok dengan kata kunci &quot;{searchQuery}&quot;.
          </div>
        )}

      </div>
    </article>
  );
}
