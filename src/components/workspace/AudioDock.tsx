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
  waveformPeaks?: number[];
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
  waveformPeaks = [],
  formatSeconds
}: AudioDockProps) {
  const [hoveredSec, setHoveredSec] = useState<number | null>(null);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSec = Math.round(ratio * durationSec);
    onSeek(targetSec);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoveredSec(Math.round(ratio * durationSec));
  };

  const speeds = [1, 1.25, 1.5];
  const progressRatio = durationSec > 0 ? Math.min(100, Math.max(0, (currentTime / durationSec) * 100)) : 0;

  return (
    <footer 
      className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border shadow-lg select-none"
      role="region"
      aria-label="Pusat Kontrol Pemutar Audio"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          
          {/* Left: Square Play/Pause + Time Readout */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Solid Dark Square Button (min 44px hit-box) */}
            <button
              type="button"
              onClick={onTogglePlay}
              className="w-11 h-11 sm:w-10 sm:h-10 bg-slate-950 dark:bg-primary text-white dark:text-primary-foreground hover:bg-slate-800 dark:hover:bg-primary/90 rounded-xs flex items-center justify-center cursor-pointer shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label={isPlaying ? 'Jeda audio' : 'Putar audio'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            {/* Time Readout: 00:15 / 03:42 */}
            <div className="font-mono text-xs font-semibold text-foreground shrink-0 min-w-[90px]">
              <span>{formatSeconds(currentTime)}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-muted-foreground">{duration}</span>
            </div>
          </div>

          {/* Center: Linear Scrubber Timeline */}
          <div className="flex-1 flex flex-col justify-center py-1">
            <div
              className="relative w-full h-4 flex items-center cursor-pointer group"
              onClick={handleTimelineClick}
              onMouseMove={handleTimelineMouseMove}
              onMouseLeave={() => setHoveredSec(null)}
              role="slider"
              aria-label="Garis penelusuran waktu rekaman"
              aria-valuemin={0}
              aria-valuemax={durationSec}
              aria-valuenow={currentTime}
            >
              {/* Background Track */}
              <div className="w-full h-1.5 bg-slate-200 dark:bg-muted rounded-full overflow-hidden">
                {/* Active Played Track */}
                <div 
                  className="h-full bg-blue-600 transition-[width] duration-75"
                  style={{ width: `${progressRatio}%` }}
                />
              </div>

              {/* Scrubber Thumb */}
              <div 
                className="absolute w-3 h-3 bg-blue-600 border border-white dark:border-slate-900 rounded-full shadow-xs -ml-1.5 transition-[left] duration-75 group-hover:scale-125"
                style={{ left: `${progressRatio}%` }}
              />

              {/* Hover Tooltip */}
              {hoveredSec !== null && (
                <div 
                  className="absolute bottom-5 -translate-x-1/2 px-1.5 py-0.5 bg-popover text-popover-foreground border border-border rounded-xs text-[10px] font-mono shadow-xs pointer-events-none"
                  style={{ left: `${(hoveredSec / durationSec) * 100}%` }}
                >
                  {formatSeconds(hoveredSec)}
                </div>
              )}
            </div>
          </div>

          {/* Right: Reset, Speed Controls, Inference Tag */}
          <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
            {/* Reset to 00:00 */}
            <button
              type="button"
              onClick={onReset}
              className="h-9 px-2.5 rounded-xs text-xs font-mono text-muted-foreground hover:text-foreground border border-border/60 hover:bg-muted transition cursor-pointer flex items-center gap-1"
              title="Kembalikan ke 00:00"
              aria-label="Kembalikan pemutaran ke awal"
            >
              <RotateCcw className="w-3 h-3" />
              <span>00:00</span>
            </button>

            {/* Playback Speeds */}
            <div className="flex items-center border border-border/60 rounded-xs overflow-hidden bg-background">
              {speeds.map(spd => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => onChangeSpeed(spd)}
                  className={`px-2 py-1 text-xs font-mono transition cursor-pointer ${
                    playbackSpeed === spd
                      ? 'bg-primary text-primary-foreground font-bold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  aria-label={`Kecepatan ${spd}x`}
                >
                  {spd}x
                </button>
              ))}
            </div>

            {/* Micro Inference Tag */}
            <div className="hidden lg:flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold pl-2 border-l border-border/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>100% On-Device</span>
            </div>
          </div>

        </div>
      </div>
    </footer>
  );
}
