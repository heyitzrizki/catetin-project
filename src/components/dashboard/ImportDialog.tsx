import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  FileBox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  validateArchive,
  importArchive,
  type ArchiveValidationResult,
  type ImportResult,
} from '@/features/workspace/catetin-archive';

export interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

export const ImportDialog: React.FC<ImportDialogProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [validation, setValidation] = useState<ArchiveValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setValidating(true);
    setError(null);
    setValidation(null);
    setImportResult(null);

    try {
      const buffer = await file.arrayBuffer();
      setFileData(buffer);
      const res = await validateArchive(buffer);
      setValidation(res);
      if (!res.valid) {
        setError(res.error || 'Berkas arsip tidak valid.');
      }
    } catch {
      setError('Gagal membaca berkas arsip yang dipilih.');
    } finally {
      setValidating(false);
    }
  };

  const handleStartImport = async () => {
    if (!fileData) return;
    setImporting(true);
    setError(null);

    try {
      const res = await importArchive(fileData);
      setImportResult(res);
      if (!res.success) {
        setError(res.message);
      } else {
        onImportSuccess();
      }
    } catch (err: any) {
      setError(err?.message || 'Terjadi kesalahan saat memulihkan arsip.');
    } finally {
      setImporting(false);
    }
  };

  const resetAndClose = () => {
    setFileData(null);
    setFileName('');
    setValidation(null);
    setImportResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const formatDate = (ms?: number) => {
    if (!ms) return '-';
    return new Date(ms).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
    >
      <div className="bg-white rounded-xl shadow-xl border border-zinc-200 w-full max-w-lg p-6 space-y-5 animate-in fade-in-50 zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-zinc-700" />
            <h3 id="import-dialog-title" className="text-base font-semibold text-zinc-900">
              Import Backup .catetin
            </h3>
          </div>
          <button
            onClick={resetAndClose}
            disabled={importing || validating}
            className="text-zinc-400 hover:text-zinc-600 p-1 rounded-md"
            aria-label="Tutup dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {importResult?.success ? (
          <div className="space-y-4 py-2">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-emerald-900">
                  Data berhasil dipulihkan ke ruang kerja lokal!
                </p>
                <div className="text-xs text-emerald-800 space-y-0.5">
                  <p>• {importResult.counts.projects} proyek baru</p>
                  <p>• {importResult.counts.folders} folder</p>
                  <p>• {importResult.counts.recordings} rekaman</p>
                  <p>• {importResult.counts.transcripts} naskah & draf</p>
                  {importResult.counts.audio > 0 && (
                    <p>• {importResult.counts.audio} berkas audio lokal</p>
                  )}
                </div>
              </div>
            </div>

            {importResult.warnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-xs text-amber-900">
                <p className="font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  Catatan pemulihan:
                </p>
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  {importResult.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={resetAndClose} className="h-9 px-4 text-xs font-medium">
                Selesai
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="file"
              ref={fileInputRef}
              accept=".catetin,application/octet-stream,application/zip"
              onChange={handleFileChange}
              className="hidden"
            />

            {!validation?.valid ? (
              <div
                onClick={() => !validating && fileInputRef.current?.click()}
                className="border-2 border-dashed border-zinc-200 hover:border-zinc-300 rounded-xl p-6 text-center cursor-pointer transition-colors bg-zinc-50/50 hover:bg-zinc-50 space-y-2"
              >
                <FileBox className="w-8 h-8 mx-auto text-zinc-400" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-zinc-800">
                    Klik untuk memilih berkas arsip .catetin
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Format resmi cadangan Catetin (.catetin)
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-700 flex items-center gap-1.5">
                      <FileCheck2 className="w-4 h-4 text-emerald-600" />
                      {fileName}
                    </span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-zinc-500 hover:text-zinc-800 underline text-[11px]"
                    >
                      Ganti berkas
                    </button>
                  </div>

                  {validation.manifest && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 pt-2 border-t border-zinc-200/60">
                      <div>
                        <span className="text-zinc-400 text-[11px]">Cakupan:</span>{' '}
                        <span className="font-medium text-zinc-800">
                          {validation.manifest.scope === 'project'
                            ? `Proyek (${validation.manifest.projectTitle || 'Tunggal'})`
                            : 'Seluruh Workspace'}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 text-[11px]">Waktu ekspor:</span>{' '}
                        <span className="font-medium text-zinc-800">
                          {formatDate(validation.manifest.exportedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 text-[11px]">Rekaman:</span>{' '}
                        <span className="font-medium text-zinc-800">
                          {validation.manifest.counts.recordings} rekaman
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 text-[11px]">Audio:</span>{' '}
                        <span className="font-medium text-zinc-800">
                          {validation.manifest.includeAudio
                            ? `${validation.manifest.counts.audio} berkas`
                            : 'Tidak disertakan'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-blue-50/70 border border-blue-200/70 rounded-lg text-xs text-blue-900 leading-relaxed">
                  <strong>Pemulihan aman:</strong> Berkas akan diimpor sebagai rekaman dan proyek baru. Data lama Anda yang sudah tersimpan di browser tidak akan ditimpa atau dihapus.
                </div>
              </div>
            )}

            {validating && (
              <div className="flex items-center justify-center gap-2 p-3 text-xs text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Memeriksa integritas arsip...</span>
              </div>
            )}

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
                disabled={importing || validating}
                className="h-9 px-4 text-xs font-medium text-zinc-700 border-zinc-200"
              >
                Batal
              </Button>
              <Button
                size="sm"
                onClick={handleStartImport}
                disabled={!validation?.valid || importing || validating}
                className="h-9 px-4 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Menyimpan data lokal...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
                    Pulihkan data
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

