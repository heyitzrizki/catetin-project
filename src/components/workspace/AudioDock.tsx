import React, { useState } from 'react';
import { Play, Pause, RotateCcw, Volume2, FastForward } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AudioDockProps {
  currentTime: number;
  duration: string;
  durationSec: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onReset: () => void;
  onChangeSpeed: (speed: number) => void;
  waveformPeaks: number[];
  formatSeconds: (sec: number) => string;
}

export function AudioDock({
  currentTime,
  duration,
  durationSec,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onSeek,
  onReset,
  onChangeSpeed,
  waveformPeaks,
  formatSeconds
}: AudioDockProps) {
  const [hoveredSec, setHoveredSec] = useState<number | null>(null);

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSec = Math.round(ratio * durationSec);
    onSeek(targetSec);
  };

  const handleWaveformMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoveredSec(Math.round(ratio * durationSec));
  };

  const speeds = [1, 1.25, 1.5];

  return (
    <footer 
      className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border shadow-xl select-none"
      role="region"
      aria-label="Pusat Kontrol Pemutar Audio"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
          
          {/* Main Play & Replay Controls */}
          <div className="flex items-center justify-between md:justify-start gap-3 shrink-0">
            {/* Play/Pause Button (min 44px touch target) */}
            <Button
              variant="default"
              onClick={onTogglePlay}
              className="h-11 min-w-[120px] rounded-xs font-bold text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer flex items-center justify-center gap-2"
              aria-label={isPlaying ? 'Jeda audio' : 'Putar audio'}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>Jeda Audio</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Putar Audio</span>
                </>
              )}
            </Button>

            {/* Reset to 00:00 Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              className="h-11 px-3 rounded-xs text-xs font-mono text-muted-foreground hover:text-foreground border-border"
              title="Kembalikan pemutaran ke awal (00:00)"
              aria-label="Ulang dari awal"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              <span className="hidden sm:inline">Ulang 00:00</span>
              <span className="sm:hidden">00:00</span>
            </Button>

            {/* Mobile Time readout */}
            <div className="md:hidden font-mono text-xs font-bold text-primary">
              {formatSeconds(currentTime)} / {duration}
            </div>
          </div>

          {/* Center: Waveform Scrubber & Desktop Time Readout */}
          <div className="flex-1 flex flex-col justify-center space-y-1 min-w-0">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-muted-foreground">
                Garis Waktu Gelombang Suara (Klik untuk loncat)
              </span>
              <div className="hidden md:flex items-center gap-2 font-bold">
                {hoveredSec !== null && (
                  <span className="text-muted-foreground font-normal">
                    Loncat ke: {formatSeconds(hoveredSec)}
                  </span>
                )}
                <span className="text-primary font-mono">
                  {formatSeconds(currentTime)} / {duration}
                </span>
              </div>
            </div>

            {/* Interactive Waveform Bar */}
            <div
              onClick={handleWaveformClick}
              onMouseMove={handleWaveformMouseMove}
              onMouseLeave={() => setHoveredSec(null)}
              className="h-8 bg-muted/40 hover:bg-muted/70 border border-border/80 rounded-xs px-2 flex items-center gap-1 cursor-pointer transition-colors"
              title="Klik pada visualisator untuk memajukan atau memundurkan audio"
              role="slider"
              aria-label="Penggeser posisi waktu audio"
              aria-valuemin={0}
              aria-valuemax={durationSec}
              aria-valuenow={currentTime}
            >
              {waveformPeaks.map((p, idx) => {
                const barSec = Math.round((idx / (waveformPeaks.length - 1)) * durationSec);
                const isPast = currentTime >= barSec;
                const dynamicHeight = isPlaying && isPast
                  ? Math.min(100, Math.max(25, p * 0.7 + Math.sin(currentTime * 3 + idx) * 12))
                  : Math.max(20, p * 0.65);

                return (
                  <div
                    key={idx}
                    className={`flex-1 rounded-none transition-all duration-100 ${
                      isPast 
                        ? 'bg-primary dark:bg-primary' 
                        : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                    }`}
                    style={{ height: `${dynamicHeight}%` }}
                  />
                );
              })}
            </div>
          </div>

          {/* Right: Playback Speed Switcher */}
          <div className="flex items-center justify-between md:justify-end gap-2 shrink-0 pt-1 md:pt-0">
            <span className="text-[11px] font-mono text-muted-foreground md:hidden">
              Kecepatan:
            </span>
            <div 
              className="inline-flex items-center bg-muted/60 border border-border/80 rounded-xs p-0.5 font-mono text-xs"
              role="group"
              aria-label="Pilihan kecepatan pemutaran"
            >
              {speeds.map(spd => (
                <button
                  key={spd}
                  onClick={() => onChangeSpeed(spd)}
                  className={`px-2 py-1 rounded-none text-xs transition cursor-pointer select-none ${
                    playbackSpeed === spd
                      ? 'bg-card text-primary font-bold shadow-2xs border border-border/40'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  aria-pressed={playbackSpeed === spd}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
    </footer>
  );
}
