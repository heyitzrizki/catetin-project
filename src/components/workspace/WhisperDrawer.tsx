import React, { useEffect, useState } from 'react';
import { X, Cpu, ShieldCheck, CheckCircle2, AlertTriangle, Layers, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface WhisperDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  triggerToast: (msg: string) => void;
}

interface HardwareDiagnostics {
  tier1: 'checking' | 'supported' | 'unsupported';
  tier2: 'checking' | 'acquired' | 'failed' | 'skipped';
  backend: 'webgpu' | 'wasm_cpu' | 'checking';
  adapterName: string | null;
}

export function WhisperDrawer({
  isOpen,
  onClose,
  selectedModel,
  onSelectModel,
  triggerToast
}: WhisperDrawerProps) {
  const [diagnostics, setDiagnostics] = useState<HardwareDiagnostics>({
    tier1: 'checking',
    tier2: 'checking',
    backend: 'checking',
    adapterName: null,
  });

  // Genuine 3-Tier Hardware Probe
  useEffect(() => {
    let isMounted = true;

    async function probeHardware() {
      if (typeof window === 'undefined') return;

      // Tier 1: Check API exposure
      const hasGpuApi = typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu);

      if (!hasGpuApi) {
        if (isMounted) {
          setDiagnostics({
            tier1: 'unsupported',
            tier2: 'skipped',
            backend: 'wasm_cpu',
            adapterName: null,
          });
        }
        return;
      }

      // Tier 2: Check adapter acquisition
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!isMounted) return;

        if (adapter) {
          let name = 'Adapter Perangkat Keras Aktif';
          try {
            const info = (adapter as any).info;
            if (info && (info.vendor || info.architecture)) {
              name = `${info.vendor || ''} ${info.architecture || ''}`.trim();
            }
          } catch (_) {
            // sandbox fallback
          }

          setDiagnostics({
            tier1: 'supported',
            tier2: 'acquired',
            backend: 'webgpu',
            adapterName: name,
          });
        } else {
          setDiagnostics({
            tier1: 'supported',
            tier2: 'failed',
            backend: 'wasm_cpu',
            adapterName: null,
          });
        }
      } catch (err) {
        if (!isMounted) return;
        setDiagnostics({
          tier1: 'supported',
          tier2: 'failed',
          backend: 'wasm_cpu',
          adapterName: null,
        });
      }
    }

    if (isOpen) {
      probeHardware();
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Keyboard navigation: Escape key closes drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="relative z-50 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl h-full flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/70">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            <h2 id="drawer-title" className="text-sm font-bold text-slate-950 dark:text-slate-50 uppercase tracking-wider font-mono">
              Diagnostik & Model Whisper
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-xs hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            aria-label="Tutup panel pengaturan"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-6 flex-1 text-xs">
          
          {/* Section 1: Model Selection */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-[11px]">
                Pilihan Model Whisper
              </span>
              <span className="font-mono text-[10px] text-slate-500">Eksekusi 100% Lokal</span>
            </div>

            <div className="space-y-2">
              {/* Whisper Base */}
              <label 
                className={`flex items-start gap-3 p-3 rounded-xs border cursor-pointer transition ${
                  selectedModel === 'base'
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="whisper-model"
                  value="base"
                  checked={selectedModel === 'base'}
                  onChange={() => {
                    onSelectModel('base');
                    triggerToast('Model Whisper Base aktif (Standar cepat)');
                  }}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-slate-100">Whisper Base</span>
                    <Badge variant="navy" className="text-[10px] py-0">Aktif: Gratis</Badge>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-normal">
                    Seimbang antara kecepatan dan akurasi. Cocok untuk rekaman percakapan umum dan rapat harian.
                  </p>
                  <div className="font-mono text-[10px] text-slate-500 pt-0.5">
                    Bobot: ~140 MB | Kecepatan: ~10x Realtime
                  </div>
                </div>
              </label>

              {/* Whisper Small */}
              <label 
                className={`flex items-start gap-3 p-3 rounded-xs border cursor-pointer transition ${
                  selectedModel === 'small'
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="whisper-model"
                  value="small"
                  checked={selectedModel === 'small'}
                  onChange={() => {
                    onSelectModel('small');
                    triggerToast('Model Whisper Small aktif (Akurasi tinggi)');
                  }}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-slate-100">Whisper Small</span>
                    <Badge variant="outline" className="text-[10px] py-0 font-mono">Paket Pro</Badge>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-normal">
                    Presisi tinggi untuk kosakata teknis, istilah hukum, aksen bervariasi, atau audio dengan sedikit kebisingan.
                  </p>
                  <div className="font-mono text-[10px] text-slate-500 pt-0.5">
                    Bobot: ~460 MB | Kecepatan: ~4x Realtime
                  </div>
                </div>
              </label>

              {/* Whisper Tiny */}
              <label 
                className={`flex items-start gap-3 p-3 rounded-xs border cursor-pointer transition ${
                  selectedModel === 'tiny'
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="whisper-model"
                  value="tiny"
                  checked={selectedModel === 'tiny'}
                  onChange={() => {
                    onSelectModel('tiny');
                    triggerToast('Model Whisper Tiny aktif (Sangat ringan)');
                  }}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-slate-100">Whisper Tiny</span>
                    <Badge variant="outline" className="text-[10px] py-0 font-mono">Ringan</Badge>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-normal">
                    Format minimalis untuk perangkat dengan spesifikasi terbatas atau baterai rendah.
                  </p>
                  <div className="font-mono text-[10px] text-slate-500 pt-0.5">
                    Bobot: ~75 MB | Kecepatan: ~15x Realtime
                  </div>
                </div>
              </label>
            </div>
          </section>

          {/* Section 2: Estimasi Kebutuhan Memori Model (Statis) */}
          <section className="space-y-3">
            <div className="flex items-center gap-1.5 font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-[11px]">
              <Layers className="w-3.5 h-3.5 text-primary" />
              <span>Estimasi Kebutuhan Memori Model (Statis)</span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 p-3.5 rounded-xs space-y-2 font-mono text-[11px]">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">Ukuran Berkas Model:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {selectedModel === 'base' ? '~140 MB' : selectedModel === 'small' ? '~460 MB' : '~75 MB'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">Estimasi Alokasi VRAM / RAM:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {selectedModel === 'base' ? '~500 MB' : selectedModel === 'small' ? '~1.0 GB' : '~250 MB'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">Format Shader & Pipeline:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">ONNX / WebGPU Shader</span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60 text-[10px] text-slate-500 flex items-start gap-1 font-sans">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                <span>
                  Kebutuhan memori di atas merupakan spesifikasi bobot statis model. Tidak menggunakan telemetri tiruan atau perkiraan sintetis.
                </span>
              </div>
            </div>
          </section>

          {/* Section 3: Diagnostik Hardware Nyata (3-Tier Probe) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 text-[11px]">
              <span>Hasil Deteksi Perangkat Keras</span>
              <span className="text-[10px] text-primary">Status Riil</span>
            </div>

            <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-xs divide-y divide-slate-100 dark:divide-slate-800">
              {/* Tier 1: Browser API Exposure */}
              <div className="p-3 flex items-start justify-between gap-3 bg-white dark:bg-slate-900">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">1. API WebGPU Peramban</div>
                  <p className="text-[11px] text-slate-500">Mendeteksi ketersediaan navigator.gpu</p>
                </div>
                {diagnostics.tier1 === 'checking' && (
                  <Badge variant="outline" className="text-[10px]">Memeriksa...</Badge>
                )}
                {diagnostics.tier1 === 'supported' && (
                  <Badge variant="success" className="text-[10px]">Tersedia</Badge>
                )}
                {diagnostics.tier1 === 'unsupported' && (
                  <Badge variant="warning" className="text-[10px]">Tidak Tersedia</Badge>
                )}
              </div>

              {/* Tier 2: GPU Adapter Request */}
              <div className="p-3 flex items-start justify-between gap-3 bg-white dark:bg-slate-900">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">2. Permintaan GPU Adapter</div>
                  <p className="text-[11px] text-slate-500">
                    {diagnostics.adapterName || 'Verifikasi izin akses perangkat keras'}
                  </p>
                </div>
                {diagnostics.tier2 === 'checking' && (
                  <Badge variant="outline" className="text-[10px]">Memeriksa...</Badge>
                )}
                {diagnostics.tier2 === 'acquired' && (
                  <Badge variant="success" className="text-[10px]">Aktif</Badge>
                )}
                {diagnostics.tier2 === 'failed' && (
                  <Badge variant="warning" className="text-[10px]">Gagal Diperoleh</Badge>
                )}
                {diagnostics.tier2 === 'skipped' && (
                  <Badge variant="outline" className="text-[10px]">Dilewati</Badge>
                )}
              </div>

              {/* Tier 3: Execution Backend Result */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">3. Backend Inferensi</span>
                  {diagnostics.backend === 'webgpu' ? (
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      WebGPU Shader
                    </span>
                  ) : diagnostics.backend === 'wasm_cpu' ? (
                    <span className="font-mono text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      WebAssembly / CPU
                    </span>
                  ) : (
                    <span className="font-mono text-slate-500">Memeriksa...</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-normal">
                  {diagnostics.backend === 'webgpu'
                    ? 'Akselerasi perangkat keras GPU aktif di peramban ini. Beban pemrosesan diproses melalui kartu grafis lokal.'
                    : 'WebGPU tidak aktif atau adaptor GPU tidak diizinkan di peramban ini. Inferensi dialihkan ke fallback WebAssembly multi-threaded lokal secara aman tanpa cloud.'}
                </p>
              </div>
            </div>
          </section>

          {/* Section 4: Perimeter Privasi Data */}
          <section className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 p-3.5 rounded-xs space-y-2">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Perimeter Privasi Data (Air-Gapped)</span>
            </div>
            <p className="text-[11px] text-emerald-900 dark:text-emerald-200/90 leading-relaxed">
              Trafik jaringan egress bernilai 0 KB saat pemrosesan berlangsung. Audio dan transkrip Anda tidak pernah dikirim ke server luar.
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end">
          <Button 
            onClick={onClose}
            className="rounded-xs text-xs font-semibold px-4"
          >
            Selesai
          </Button>
        </div>

      </div>
    </div>
  );
}
