import React, { useState } from 'react';
import { Play, Edit3, Check, X, FileText, Upload, RefreshCw, Clock } from 'lucide-react';
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
  activeSpeakerFilter?: string | null;
  viewMode?: 'naskah' | 'waktu';
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
  activeSpeakerFilter = null,
  viewMode = 'naskah',
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

  // Filter segments by search query & active speaker filter
  const queryLower = searchQuery.toLowerCase().trim();
  const filteredSegments = segments.filter(seg => {
    const displayName = speakerNames[seg.speaker] || seg.speaker;
    const matchesSpeaker = activeSpeakerFilter ? seg.speaker === activeSpeakerFilter : true;
    const matchesQuery = queryLower
      ? seg.text.toLowerCase().includes(queryLower) || displayName.toLowerCase().includes(queryLower)
      : true;
    return matchesSpeaker && matchesQuery;
  });

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

  // Speaker Color Resolver to match mockup (Speaker 1 is emerald, Speaker 2 is indigo/blue, etc.)
  const getSpeakerStyle = (speaker: string, idx: number) => {
    const lower = speaker.toLowerCase();
    if (lower.includes('speaker 1') || lower.includes('pewawancara') || idx % 2 === 0) {
      return {
        text: 'text-emerald-700 dark:text-emerald-400',
        activeHeader: 'text-emerald-800 dark:text-emerald-300'
      };
    }
    return {
      text: 'text-indigo-800 dark:text-indigo-300',
      activeHeader: 'text-indigo-900 dark:text-indigo-200'
    };
  };

  return (
    <article 
      className="flex-1 w-full bg-background min-h-[520px] flex flex-col"
      aria-label="Editor Transkrip Percakapan"
    >
      {/* Continuous Document Flow */}
      <div className="p-6 sm:p-8 space-y-6 flex-1">
        {filteredSegments.map((item, idx) => {
          const displayName = speakerNames[item.speaker] || item.speaker;
          const speakerStyle = getSpeakerStyle(item.speaker, idx);
          
          // Determine if this segment is actively being played
          const nextSegment = segments[idx + 1];
          const isCurrent = currentTime >= item.seconds && 
            (nextSegment ? currentTime < nextSegment.seconds : currentTime < item.seconds + 12);

          // If text is not quoted, wrap in quotation marks just like the mockup
          const displayText = item.text.startsWith('"') ? item.text : `"${item.text}"`;

          return (
            <section
              key={item.id}
              id={`segment-${item.id}`}
              className={`transition-colors duration-150 ${
                isCurrent 
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border-l-[3px] border-blue-600 pl-4 py-3 -ml-4 pr-3 rounded-r-xs' 
                  : 'py-2 hover:bg-muted/15 pl-4 -ml-4 pr-3 rounded-r-xs'
              }`}
            >
              {/* Speaker & Timestamp Line */}
              <div className="flex items-center justify-between gap-4 mb-2 font-mono text-xs">
                
                <div className="flex items-center gap-2 flex-wrap">
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
                      className={`font-bold transition flex items-center gap-1.5 cursor-pointer text-left group ${
                        isCurrent ? speakerStyle.activeHeader : speakerStyle.text
                      }`}
                      title="Klik untuk mengubah nama pembicara di semua segmen"
                    >
                      <span className="font-semibold text-sm tracking-tight">
                        {displayName}
                      </span>
                      <Edit3 className="w-3 h-3 text-muted-foreground opacity-30 group-hover:opacity-100 transition" />
                    </button>
                  )}
                </div>

                {/* Right: Timestamp with seek action */}
                <button
                  type="button"
                  onClick={() => onSeek(item.seconds)}
                  className={`font-mono text-xs transition cursor-pointer select-none px-1.5 py-0.5 rounded-xs flex items-center gap-1 ${
                    isCurrent
                      ? 'text-primary font-bold bg-primary/10'
                      : 'text-muted-foreground hover:text-primary hover:bg-muted'
                  }`}
                  title={`Loncat ke waktu ${item.time}`}
                  aria-label={`Loncat audio ke ${item.time}`}
                >
                  <Play className={`w-2.5 h-2.5 ${isCurrent ? 'fill-current' : 'opacity-60'}`} />
                  <span>{item.time}</span>
                </button>

              </div>

              {/* Dialogue Text (Document Measure) */}
              <div className="text-sm text-foreground/90 leading-relaxed font-sans focus-within:ring-1 focus-within:ring-primary/40 rounded-none p-1 -m-1">
                <p
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const cleaned = (e.currentTarget.textContent || '').replace(/^"|"$/g, '');
                    onUpdateText(item.id, cleaned);
                  }}
                  className="focus:outline-none min-h-[1.5em] text-slate-800 dark:text-slate-200"
                  tabIndex={0}
                  role="textbox"
                  aria-multiline="true"
                  aria-label={`Teks percakapan ${displayName}`}
                >
                  {displayText}
                </p>
              </div>

              {/* Optional Segmen Waktu Info Badge */}
              {viewMode === 'waktu' && (
                <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span>Segmen #{String(item.id).padStart(2, '0')}</span>
                  <span>Mulai: {item.time} ({item.seconds} detik)</span>
                </div>
              )}

            </section>
          );
        })}

        {/* Empty filter message */}
        {filteredSegments.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground font-mono">
            Tidak ada segmen transkrip yang cocok dengan kriteria filter saat ini.
          </div>
        )}

      </div>
    </article>
  );
}
