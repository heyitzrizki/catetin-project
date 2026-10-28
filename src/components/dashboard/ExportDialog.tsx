import React, { useState } from 'react';
import { Download, FileAudio, FileText, AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exportArchive, type ExportArchiveResult } from '@/features/workspace/catetin-archive';
import { recordUsageEvent } from '@/features/account/account-api';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  scope: 'project' | 'workspace';
  projectId?: string;
  projectTitle?: string;
  isUserAuthenticated?: boolean;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  scope,
  projectId,
  projectTitle,
  isUserAuthenticated = false,
}) => {
  const [includeAudio, setIncludeAudio] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [completedResult, setCompletedResult] = useState<ExportArchiveResult | null>(null);

  if (!isOpen) return null;

  const handleStartExport = async () => {
    setLoading(true);
    setError(null);
    setWarnings([]);

    try {
      const result = await exportArchive({
        scope,
        projectId,
        includeAudio,
      });

      // Trigger automatic file download
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      void recordUsageEvent('catetin_backup_completed', isUserAuthenticated);

      setCompletedResult(result);
      if (result.warnings.length > 0) {
        setWarnings(result.warnings);
      }
    } catch (err: any) {
      setError(err?.message || 'Terjadi kesalahan saat mengekspor arsip.');
    } finally {
      setLoading(false);
    }
  };

  const resetAndClose = () => {
    setCompletedResult(null);
    setError(null);
    setWarnings([]);
    setIncludeAudio(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <div className="bg-white rounded-xl shadow-xl border border-zinc-200 w-full max-w-lg p-6 space-y-5 animate-in fade-in-50 zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-zinc-700" />
            <h3 id="export-dialog-title" className="text-base font-semibold text-zinc-900">
              {scope === 'project'
                ? `Export Proyek: ${projectTitle || 'Proyek'}`
                : 'Export Seluruh Workspace'}
            </h3>
          </div>
          <button
            onClick={resetAndClose}
            disabled={loading}
            className="text-zinc-400 hover:text-zinc-600 p-1 rounded-md"
            aria-label="Tutup dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {completedResult ? (
          <div className="space-y-4 py-2">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-emerald-900">Arsip berhasil diunduh!</p>
                <p className="text-xs text-emerald-800 font-mono break-all">{completedResult.filename}</p>
                <p className="text-xs text-emerald-700">
                  {completedResult.manifest.counts.recordings} rekaman, {completedResult.manifest.counts.transcripts} naskah
                  {completedResult.manifest.includeAudio
                    ? `, ${completedResult.manifest.counts.audio} berkas audio`
                    : ' (tanpa audio)'}
                </p>
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-xs text-amber-900">
                <p className="font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  Catatan selama proses export:
                </p>
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  {warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={resetAndClose} className="h-9 px-4 text-xs font-medium">
                Tutup
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-zinc-600 leading-relaxed">
              Pilih mode cadangan yang ingin Anda buat dalam format arsip portabel{' '}
              <code className="px-1 py-0.5 bg-zinc-100 rounded text-zinc-800 font-mono text-[11px]">.catetin</code>.
            </p>

            <div className="space-y-3">
              {/* Option 1: Light (default) */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                  !includeAudio
                    ? 'border-zinc-800 bg-zinc-50/80 ring-1 ring-zinc-800'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <input
                  type="radio"
                  name="export-mode"
                  checked={!includeAudio}
                  onChange={() => setIncludeAudio(false)}
                  disabled={loading}
                  className="mt-1"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-zinc-700" />
                    <span className="text-sm font-medium text-zinc-900">
                      Cadangan ringan (Disarankan)
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Menyimpan seluruh naskah, segmen, nama pembicara, label, tag, dan struktur folder. Ukuran berkas sangat kecil dan cepat dibuat.
                  </p>
                </div>
              </label>

              {/* Option 2: Full with audio */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                  includeAudio
                    ? 'border-zinc-800 bg-zinc-50/80 ring-1 ring-zinc-800'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <input
                  type="radio"
                  name="export-mode"
                  checked={includeAudio}
                  onChange={() => setIncludeAudio(true)}
                  disabled={loading}
                  className="mt-1"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FileAudio className="w-4 h-4 text-zinc-700" />
                    <span className="text-sm font-medium text-zinc-900">
                      Cadangan lengkap (Termasuk rekaman audio)
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Menyertakan berkas audio rekaman asli yang tersimpan di browser. Ukuran berkas dapat menjadi sangat besar tergantung durasi audio.
                  </p>
                </div>
              </label>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
              <Button
                variant="outline"
                size="sm"
                onClick={resetAndClose}
                disabled={loading}
                className="h-9 px-4 text-xs font-medium text-zinc-700 border-zinc-200"
              >
                Batal
              </Button>
              <Button
                size="sm"
                onClick={handleStartExport}
                disabled={loading}
                className="h-9 px-4 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Membuat arsip .catetin...
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Unduh arsip .catetin
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

