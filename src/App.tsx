import React, { useState, useEffect } from 'react';

// Sample dataset percakapan
const SAMPLES: { [key: string]: { filename: string; duration: string; durationSec: number; segments: Array<{ id: number; time: string; seconds: number; speaker: string; text: string }> } } = {
  wawancara: {
    filename: "Wawancara_Riset_Privasi_01.mp3",
    duration: "03:42",
    durationSec: 222,
    segments: [
      { id: 1, time: "00:03", seconds: 3, speaker: "Pewawancara", text: "Halo Mas Rian, terima kasih banyak ya sudah bersedia ikut sesi validasi user hari ini." },
      { id: 2, time: "00:08", seconds: 8, speaker: "Narasumber", text: "Siap, halo Mas! Senang bisa ngobrol langsung." },
      { id: 3, time: "00:14", seconds: 14, speaker: "Pewawancara", text: "Bisa ceritakan apa masalah terbesar saat tim hukum kamu butuh transkrip rekaman rapat atau wawancara klien?" },
      { id: 4, time: "00:22", seconds: 22, speaker: "Narasumber", text: "Kepatuhan data, Mas. Klien kami terikat NDA ketat. Kebanyakan software transkrip online itu upload file ke server luar, jadi dilarang oleh manajemen kami." },
      { id: 5, time: "00:33", seconds: 33, speaker: "Narasumber", text: "Makanya konsep catetin yang 100% jalan di laptop tanpa kirim suara ke server ini langsung jadi solusi instan buat tim kami." },
      { id: 6, time: "00:44", seconds: 44, speaker: "Pewawancara", text: "Mantap! Selain privasi, fitur ekspor apa yang paling sering tim kamu pakai dalam pekerjaan sehari-hari?" },
      { id: 7, time: "00:51", seconds: 51, speaker: "Narasumber", text: "Format Word DOCX dengan pemisahan nama pembicara otomatis. Itu hemat waktu 2 jam per kasus daripada ngetik manual!" }
    ]
  },
  rapat: {
    filename: "Notulen_Rapat_Sprint_Q3.m4a",
    duration: "02:15",
    durationSec: 135,
    segments: [
      { id: 1, time: "00:01", seconds: 1, speaker: "Product Lead", text: "Selamat pagi tim. Hari ini kita review milestone integrasi model AI offline." },
      { id: 2, time: "00:06", seconds: 6, speaker: "Tech Lead", text: "Semua benchmark lancar. Transkrip audio 15 menit selesai cuma 45 detik di laptop modern tanpa sambungan internet." },
      { id: 3, time: "00:15", seconds: 15, speaker: "Designer", text: "Desain workspace studio baru juga sudah jauh lebih rapi, fungsional, dan nyaman buat notulis." }
    ]
  }
};

// Pola gelombang suara realistis dengan variasi puncak percakapan
const WAVEFORM_PEAKS = [
  30, 48, 72, 36, 88, 60, 95, 42, 22, 58, 86, 92, 48, 70, 34, 82,
  98, 64, 28, 46, 78, 90, 56, 32, 74, 84, 96, 60, 38, 72, 86, 44,
  26, 68, 82, 50
];

// Dataset FAQ lengkap dari template HTML
interface FaqItem {
  id: number;
  category: 'privacy' | 'tech' | 'billing';
  categoryLabel: string;
  question: string;
  answer: React.ReactNode;
}

const FAQ_LIST: FaqItem[] = [
  {
    id: 1,
    category: 'privacy',
    categoryLabel: 'Keamanan & Privasi',
    question: 'Bagaimana saya bisa yakin rekaman suara tidak pernah diunggah ke internet?',
    answer: (
      <div className="space-y-2">
        <p>
          Anda bisa membuktikannya sendiri secara transparan: buka tab <em>Inspect Element &gt; Network</em> di browser Anda, lalu matikan koneksi Wi-Fi laptop Anda (mode pesawat).
        </p>
        <p>
          Transkripsi tetap akan berjalan normal tanpa menghasilkan satu panggilan HTTP/API pun ke luar. Semua beban komputasi AI diproses langsung oleh WebGPU/WebAssembly pada memori RAM dan GPU perangkat lokal Anda.
        </p>
      </div>
    )
  },
  {
    id: 2,
    category: 'tech',
    categoryLabel: 'Performa & Format',
    question: 'Apakah ada batasan kuota menit atau ukuran rekaman audio?',
    answer: (
      <p>
        <strong>Sama sekali tidak ada batasan.</strong> Software cloud lain membebankan biaya per jam karena mereka harus membayar server komputasi. Karena di catetin perangkat laptop Anda yang melakukan kalkulasi, Anda bebas mentranskripsikan wawancara 5 menit maupun rekaman kuliah maraton 3 jam tanpa khawatir kuota terpotong.
      </p>
    )
  },
  {
    id: 3,
    category: 'tech',
    categoryLabel: 'Performa & Format',
    question: 'Format file audio dan video apa saja yang didukung?',
    answer: (
      <div className="space-y-2">
        <p>catetin mendukung hampir seluruh format media yang dapat diurai oleh decoder browser modern:</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {['.MP3', '.WAV', '.M4A', '.AAC', '.OGG', '.FLAC', '.MP4 (Video)', '.WEBM'].map((fmt) => (
            <span key={fmt} className="font-mono px-2 py-0.5 bg-slate-100 rounded text-[11px] text-slate-700">
              {fmt}
            </span>
          ))}
        </div>
      </div>
    )
  },
  {
    id: 4,
    category: 'billing',
    categoryLabel: 'Lisensi & Kantor B2B',
    question: 'Bagaimana legalitas dan penagihan untuk kantor atau instansi pemerintah?',
    answer: (
      <div className="space-y-2">
        <p>
          Untuk institusi dengan kepatuhan audit ketat (seperti Kantor Hukum, Notaris, Kantor Akuntan Publik, dan Rumah Sakit), kami menyediakan:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-700">
          <li>Installer offline mandiri (.EXE / .DMG) tanpa izin akses internet sama sekali (Air-Gapped).</li>
          <li>Perjanjian Jaminan Privasi Data kustom (Non-Disclosure Agreement resmi).</li>
          <li>Faktur Pajak resmi badan usaha (PPN) dan skema pembayaran transfer bank korporat.</li>
        </ul>
      </div>
    )
  },
  {
    id: 5,
    category: 'privacy',
    categoryLabel: 'Keamanan & Privasi',
    question: 'Apakah data teks transkripsi saya dipakai untuk melatih model AI?',
    answer: (
      <p>
        <strong>Pasti tidak.</strong> Karena arsitektur catetin tidak memiliki database cloud untuk menampung teks percakapan Anda, kami secara teknis tidak memiliki akses fisik terhadap teks yang dihasilkan. Teks Anda hanya ada di tab browser Anda dan langsung musnah dari RAM saat tab tersebut ditutup.
      </p>
    )
  }
];

export default function App() {
  const [currentTab, setCurrentTab] = useState<'landing' | 'workspace' | 'pricing' | 'faq'>('landing');
  const [activeFile, setActiveFile] = useState<{ name: string; size: string; duration: string; durationSec: number } | null>(null);
  const [isPreparingModel, setIsPreparingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [transcriptData, setTranscriptData] = useState<Array<{ id: number; time: string; seconds: number; speaker: string; text: string }>>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [speakerNames, setSpeakerNames] = useState<{ [key: string]: string }>({});
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [isProModalOpen, setIsProModalOpen] = useState(false);
  const [activeModel, setActiveModel] = useState<'base' | 'small'>('base');
  const [hoveredWaveSec, setHoveredWaveSec] = useState<number | null>(null);

  // State khusus halaman FAQ interaktif
  const [faqCategory, setFaqCategory] = useState<'all' | 'privacy' | 'tech' | 'billing'>('all');
  const [faqSearch, setFaqSearch] = useState('');
  const [openFaqSet, setOpenFaqSet] = useState<Set<number>>(new Set([1]));

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleStartTranscribe = (fileMeta: { name: string; size: string; duration?: string; durationSec?: number }, sampleKey: string = 'wawancara') => {
    const sample = SAMPLES[sampleKey] || SAMPLES.wawancara;
    setActiveFile({
      name: fileMeta.name,
      size: fileMeta.size,
      duration: fileMeta.duration || sample.duration,
      durationSec: fileMeta.durationSec || sample.durationSec
    });
    setIsPreparingModel(true);
    setModelProgress(15);
    setCurrentTab('workspace');

    const interval = setInterval(() => {
      setModelProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsPreparingModel(false);
          setTranscriptData(sample.segments);
          triggerToast("Transkripsi lokal selesai tanpa upload data!");
          return 100;
        }
        return prev + 25;
      });
    }, 180);
  };

  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentTime((t) => {
          const maxSec = activeFile?.durationSec || 222;
          if (t >= maxSec) {
            setIsPlaying(false);
            return 0;
          }
          return t + 1;
        });
      }, 1000 / playbackSpeed);
    }
    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, activeFile]);

  const handleCopyAll = () => {
    const full = transcriptData
      .map(s => `[${s.time}] ${speakerNames[s.speaker] || s.speaker}: ${s.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(full);
    triggerToast("Seluruh transkrip berhasil disalin!");
  };

  const handleExport = (format: string) => {
    if (format === 'docx' || format === 'pdf') {
      setIsProModalOpen(true);
      return;
    }
    let content = "";
    const filename = `${activeFile?.name || "catetin_transkrip"}.${format}`;

    if (format === 'txt') {
      content = transcriptData
        .map(s => `[${s.time}] ${speakerNames[s.speaker] || s.speaker}:\n${s.text}\n`)
        .join('\n');
    } else if (format === 'srt') {
      content = transcriptData.map((s, idx) => {
        const start = `00:${s.time},000`;
        const end = `00:${String(s.seconds + 4).padStart(2, '0')},000`;
        return `${idx + 1}\n${start} --> ${end}\n${speakerNames[s.speaker] || s.speaker}: ${s.text}\n`;
      }).join('\n');
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast(`Berkas .${format.toUpperCase()} berhasil diunduh!`);
  };

  const handleRenameSpeaker = (oldName: string, newName: string) => {
    if (!newName.trim()) return;
    setSpeakerNames(prev => ({ ...prev, [oldName]: newName.trim() }));
    setEditingSpeaker(null);
    triggerToast(`Nama pembicara diganti jadi "${newName}"`);
  };

  const toggleFaqAccordion = (id: number) => {
    setOpenFaqSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const totalWords = transcriptData.reduce((acc, curr) => acc + curr.text.split(' ').length, 0);

  // Filter list FAQ berdasarkan kategori tab & kata kunci pencarian
  const filteredFaqList = FAQ_LIST.filter((item) => {
    const matchesCategory = faqCategory === 'all' || item.category === faqCategory;
    const qLower = faqSearch.toLowerCase().trim();
    const matchesSearch = !qLower || 
      item.question.toLowerCase().includes(qLower) || 
      (typeof item.answer === 'string' && item.answer.toLowerCase().includes(qLower));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex flex-col min-h-screen bg-[#F8FAFC] text-slate-900 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
      
      {/* TOAST NOTIFIKASI */}
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-semibold border border-slate-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* NAVBAR */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setCurrentTab('landing')}
              className="flex items-center gap-2.5 group text-left"
            >
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-sm shadow-indigo-200 group-hover:scale-105 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
                </svg>
              </div>
              <span className="text-2xl font-black tracking-tight text-slate-900">catetin<span className="text-indigo-600">.</span></span>
            </button>

            <div className="hidden md:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Mode Privat Aktif (100% Lokal)
            </div>
          </div>

          <nav className="flex items-center gap-1 sm:gap-2">
            <button 
              onClick={() => setCurrentTab('landing')}
              className={`px-3.5 py-2 text-sm font-semibold rounded-xl transition ${currentTab === 'landing' ? 'text-indigo-600 bg-indigo-50 font-bold' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Beranda
            </button>
            <button 
              onClick={() => setCurrentTab('pricing')}
              className={`px-3.5 py-2 text-sm font-semibold rounded-xl transition ${currentTab === 'pricing' ? 'text-indigo-600 bg-indigo-50 font-bold' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Harga
            </button>
            <button 
              onClick={() => setCurrentTab('faq')}
              className={`px-3.5 py-2 text-sm font-semibold rounded-xl transition ${currentTab === 'faq' ? 'text-indigo-600 bg-indigo-50 font-bold' : 'text-slate-600 hover:text-slate-900'}`}
            >
              FAQ
            </button>

            <button 
              onClick={() => {
                if (!activeFile) {
                  handleStartTranscribe({ name: "Rekaman_Wawancara_Riset.mp3", size: "4.8 MB" }, 'wawancara');
                } else {
                  setCurrentTab('workspace');
                }
              }}
              className="ml-2 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 rounded-2xl shadow-sm shadow-indigo-200 transition"
            >
              <span>Buka catetin</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
              </svg>
            </button>
          </nav>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1">
        {/* ==================== 1. LANDING PAGE VIEW ==================== */}
        {currentTab === 'landing' && (
          <div className="pb-20">
            {/* HERO SECTION */}
            <section className="pt-12 sm:pt-16 pb-12 max-w-5xl mx-auto px-4 sm:px-6 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50/80 border border-indigo-100 text-indigo-700 text-xs font-semibold mb-6 shadow-xs">
                <span>⚡ Tanpa Server • Nol Kuota Menit • File Tidak Pernah Keluar dari Laptop</span>
              </div>

              <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-slate-900 leading-[1.12] mb-4">
                Ubah rekaman jadi catatan.<br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600">
                  Tanpa file keluar dari laptopmu.
                </span>
              </h1>

              <p className="max-w-2xl mx-auto text-base sm:text-lg text-slate-600 mb-10 leading-relaxed font-normal">
                Transkrip otomatis audio dan video langsung di browser. Bebas antrean server, 100% aman untuk rekaman rahasia, dan tetap jalan meski koneksi internet mati.
              </p>

              {/* MASSIVE DROPZONE CONTAINER */}
              <div className="max-w-3xl mx-auto bg-white rounded-3xl border-2 border-dashed border-slate-300 hover:border-indigo-500 p-8 sm:p-12 shadow-xl shadow-slate-200/60 transition-all text-center group">
                <div className="w-20 h-20 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-6 group-hover:scale-110 group-hover:bg-indigo-100 transition duration-300">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                  </svg>
                </div>

                <h3 className="text-2xl font-extrabold text-slate-900 mb-2">
                  Tarik rekaman ke sini atau pilih berkas
                </h3>
                <p className="text-sm text-slate-500 mb-8 max-w-md mx-auto">
                  Mendukung format MP3, WAV, M4A, AAC, hingga rekaman video MP4
                </p>

                <div className="flex justify-center">
                  <button 
                    onClick={() => handleStartTranscribe({ name: "Wawancara_Riset_Privasi.mp3", size: "3.4 MB" }, 'wawancara')}
                    className="inline-flex items-center gap-3 px-8 py-4 text-base font-extrabold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 rounded-2xl shadow-lg shadow-indigo-200 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path>
                    </svg>
                    <span>Pilih Berkas Audio / Video</span>
                  </button>
                </div>

                {/* Quick Demo Samples */}
                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-400">Atau uji coba langsung:</span>
                  <button 
                    onClick={() => handleStartTranscribe({ name: "Wawancara_Riset_Privasi.mp3", size: "3.4 MB" }, 'wawancara')}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-semibold text-slate-700 border border-slate-200 transition"
                  >
                    🎙️ Sampel: Wawancara Riset
                  </button>
                  <button 
                    onClick={() => handleStartTranscribe({ name: "Notulen_Rapat_Sprint.m4a", size: "2.1 MB" }, 'rapat')}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-semibold text-slate-700 border border-slate-200 transition"
                  >
                    📋 Sampel: Notulen Rapat
                  </button>
                </div>
              </div>
            </section>

            {/* SECTION: WORK YOUR WAY */}
            <section className="max-w-6xl mx-auto px-4 sm:px-6 my-20">
              <div className="text-center mb-12">
                <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                  Bekerja dengan caramu
                </h2>
                <p className="text-slate-500 text-base mt-2">
                  Fleksibel digunakan di browser kerja harian hingga komputer kantor berisolasi penuh.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* CARD 1 */}
                <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md shadow-slate-100 flex flex-col justify-between hover:shadow-xl hover:-translate-y-1 transition duration-300 group">
                  <div>
                    <div className="w-full h-44 rounded-2xl bg-gradient-to-b from-indigo-100/70 to-indigo-50/40 p-4 border border-indigo-200/50 mb-6 flex flex-col justify-end overflow-hidden relative">
                      <div className="bg-white rounded-xl p-3 shadow-md border border-slate-100 text-xs">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                          <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                          <span className="text-[10px] text-slate-400 ml-1 font-mono">catetin-desktop.exe</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-700 font-bold text-[11px]">
                          <span>🔒 Mode Air-Gapped</span>
                          <span className="text-emerald-700 font-medium">Wi-Fi: Terputus</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-400">100% berjalan terisolasi di hardware lokal</div>
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Offline di Aplikasi Desktop</h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-6">
                      Transkripsi tumpukan berkas secara lokal tanpa internet sama sekali. Bebas batas durasi dan terisolasi total.
                    </p>
                  </div>
                  <div className="flex justify-end pt-2">
                    <span className="w-9 h-9 rounded-full bg-slate-100 group-hover:bg-indigo-50 text-slate-700 group-hover:text-indigo-600 flex items-center justify-center font-bold text-lg transition">↗</span>
                  </div>
                </div>

                {/* CARD 2 */}
                <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md shadow-slate-100 flex flex-col justify-between hover:shadow-xl hover:-translate-y-1 transition duration-300 group">
                  <div>
                    <div className="w-full h-44 rounded-2xl bg-gradient-to-b from-violet-100/60 to-violet-50/30 p-4 border border-violet-200/50 mb-6 flex flex-col justify-end overflow-hidden relative">
                      <div className="bg-white rounded-xl p-3 shadow-md border border-slate-100 text-xs">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-slate-800 text-[11px]">Browser Laptop</span>
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">Akselerasi Lokal</span>
                        </div>
                        <div className="mt-2 text-indigo-600 font-bold text-[10px]">Tinggal buka tab, langsung transkrip</div>
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Cepat & Fleksibel di Browser</h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-6">
                      Alat andalan langsung di Chrome, Edge, atau Safari. Buka kapan saja tanpa perlu login, akun, atau instalasi.
                    </p>
                  </div>
                  <div className="flex justify-end pt-2">
                    <span className="w-9 h-9 rounded-full bg-slate-100 group-hover:bg-indigo-50 text-slate-700 group-hover:text-indigo-600 flex items-center justify-center font-bold text-lg transition">↗</span>
                  </div>
                </div>

                {/* CARD 3 */}
                <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-md shadow-slate-100 flex flex-col justify-between hover:shadow-xl hover:-translate-y-1 transition duration-300 group">
                  <div>
                    <div className="w-full h-44 rounded-2xl bg-gradient-to-b from-slate-200/60 to-slate-100/30 p-4 border border-slate-200/60 mb-6 flex flex-col justify-end overflow-hidden relative">
                      <div className="bg-white rounded-xl p-3 shadow-md border border-slate-100 text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-slate-800">Lisensi Institusi & Tim</span>
                        </div>
                        <div className="text-[10px] text-slate-600 font-mono bg-slate-50 p-1 rounded">
                          status: "zero-cloud-guaranteed"
                        </div>
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Dirancang untuk Kantor & Bisnis</h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-6">
                      Dibuat untuk kantor hukum, klinik medis, dan periset. Dilengkapi faktur pajak resmi dan perjanjian jaminan privasi (NDA).
                    </p>
                  </div>
                  <div className="flex justify-end pt-2">
                    <span className="w-9 h-9 rounded-full bg-slate-100 group-hover:bg-indigo-50 text-slate-700 group-hover:text-indigo-600 flex items-center justify-center font-bold text-lg transition">↗</span>
                  </div>
                </div>
              </div>
            </section>

            {/* BANNER GET MORE WITH PRO */}
            <section className="max-w-6xl mx-auto px-4 sm:px-6 my-16">
              <div className="bg-gradient-to-br from-amber-50 via-amber-100/40 to-orange-50 rounded-3xl p-8 sm:p-12 border border-amber-200/80 shadow-md relative overflow-hidden flex flex-col lg:flex-row items-center justify-between gap-10">
                <div className="flex-1 max-w-xl">
                  <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight mb-6">
                    Dapatkan lebih banyak dengan catetin Pro
                  </h2>
                  <ul className="space-y-4 mb-8">
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">✓</div>
                      <span className="text-sm sm:text-base text-slate-800 font-semibold">
                        Model Presisi Tinggi untuk rekaman audio bising & istilah teknis
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">✓</div>
                      <span className="text-sm sm:text-base text-slate-800 font-semibold">
                        Pemisahan Pembicara Otomatis (Speaker Diarization) untuk rapat & wawancara
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">✓</div>
                      <span className="text-sm sm:text-base text-slate-800 font-semibold">
                        Ekspor Dokumen Word (.DOCX) & PDF resmi dengan format heading dan durasi rapi
                      </span>
                    </li>
                  </ul>
                  <button 
                    onClick={() => setIsProModalOpen(true)}
                    className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl font-black text-base text-slate-900 bg-amber-400 hover:bg-amber-300 shadow-lg shadow-amber-300/40 active:scale-95 transition"
                  >
                    <span>👑 Upgrade ke Pro (Rp49.000)</span>
                  </button>
                </div>

                {/* Right Mockup Graphic */}
                <div className="w-full lg:w-96 flex-shrink-0 relative">
                  <div className="bg-white rounded-2xl p-6 shadow-xl border border-amber-200/60 transform rotate-1 hover:rotate-0 transition duration-300">
                    <div className="border-b border-slate-100 pb-3 mb-3 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Format Word DOCX</span>
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 font-extrabold px-2 py-0.5 rounded">Pro Export</span>
                    </div>
                    <h4 className="font-extrabold text-slate-900 text-base mb-2">Notulensi Resmi Kasus #402</h4>
                    <div className="space-y-2 text-xs text-slate-600">
                      <p><strong className="text-slate-900">[00:04] Budi Santoso:</strong> "Kami mengonfirmasi bahwa seluruh rekaman disimpan lokal..."</p>
                      <p><strong className="text-slate-900">[00:18] Notaris:</strong> "Klausul kepatuhan data telah disetujui kedua pihak."</p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>Durasi: 01:14:20</span>
                      <span className="text-emerald-700 font-bold">100% Terverifikasi</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* TRUST BADGES */}
            <section className="max-w-5xl mx-auto px-4 sm:px-6 my-16 text-center">
              <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
                Aplikasi transkripsi privat pilihan profesional
              </h3>
              <p className="text-slate-500 text-sm max-w-2xl mx-auto mb-10 leading-relaxed">
                catetin adalah alat andalan untuk mengubah rekaman menjadi catatan teks tanpa cemas risiko kebocoran data rahasia.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-12 opacity-80 grayscale hover:grayscale-0 transition duration-300">
                <div className="flex items-center gap-2 text-slate-700 font-bold text-xs tracking-wider uppercase">
                  <span className="text-xl">🔒</span> <span>100% Zero-Cloud</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 font-bold text-xs tracking-wider uppercase">
                  <span className="text-xl">🛡️</span> <span>Patuh UU PDP</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 font-bold text-xs tracking-wider uppercase">
                  <span className="text-xl">⚡</span> <span>WebGPU Native</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 font-bold text-xs tracking-wider uppercase">
                  <span className="text-xl">📄</span> <span>Whisper Open Model</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ==================== 2. CORE WORKSPACE VIEW ==================== */}
        {currentTab === 'workspace' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            
            {/* IN-PROGRESS LOADING BANNER */}
            {isPreparingModel && (
              <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center justify-between shadow-sm animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs">
                    AI
                  </div>
                  <div>
                    <p className="text-sm font-bold text-indigo-950">Menyiapkan mesin transkripsi di browsermu... ({modelProgress}%)</p>
                    <p className="text-xs text-indigo-700">Hanya diunduh satu kali ke browser lokal. Selanjutnya berfungsi penuh tanpa kuota data.</p>
                  </div>
                </div>
                <div className="w-36 bg-indigo-200 rounded-full h-2.5 overflow-hidden">
                  <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${modelProgress}%` }}></div>
                </div>
              </div>
            )}

            {/* TOP STUDIO TOOLBAR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white px-5 py-4 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setCurrentTab('landing')}
                  className="w-10 h-10 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm transition"
                  title="Kembali ke Beranda"
                >
                  ←
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-extrabold text-slate-900 truncate max-w-xs sm:max-w-md">
                      {activeFile?.name || "Rekaman_Wawancara_Riset.mp3"}
                    </h2>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {activeFile?.size || "4.8 MB"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                    <span>Durasi: {activeFile?.duration || "03:42"}</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      100% di memori browser lokal
                    </span>
                  </div>
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex items-center gap-2 flex-wrap">
                <button 
                  onClick={handleCopyAll}
                  className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                  </svg>
                  <span>Salin Semua</span>
                </button>

                <button 
                  onClick={() => handleExport('txt')}
                  className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                >
                  .TXT
                </button>

                <button 
                  onClick={() => handleExport('srt')}
                  className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                >
                  .SRT
                </button>

                <button 
                  onClick={() => handleExport('docx')}
                  className="px-4 py-2 text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition flex items-center gap-1.5 shadow-xs"
                >
                  <span>Word .DOCX</span>
                  <span className="bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded font-black tracking-wider uppercase">PRO</span>
                </button>
              </div>
            </div>

            {/* 2-COLUMN SPLIT STUDIO WORKSPACE */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* SISI KIRI: AUDIO STUDIO & MODEL CONTROLLER */}
              <div className="lg:col-span-5 space-y-5">
                
                {/* PEMUTAR AUDIO */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-400">Pemutar Rekaman</span>
                    <span className="text-xs font-bold font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">
                      {formatSeconds(currentTime)} / {activeFile?.duration || "03:42"}
                    </span>
                  </div>

                  {/* WAVEFORM VISUALIZER INTERAKTIF */}
                  <div className="space-y-1.5 mb-5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold px-0.5">
                      <span className="flex items-center gap-1.5 text-slate-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                        Klik puncak gelombang untuk loncat waktu
                      </span>
                      {hoveredWaveSec !== null ? (
                        <span className="font-mono text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 font-bold">
                          Ke: {formatSeconds(hoveredWaveSec)}
                        </span>
                      ) : (
                        <span className="font-mono text-slate-400">
                          {formatSeconds(currentTime)}
                        </span>
                      )}
                    </div>

                    <div 
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        const totalSec = activeFile?.durationSec || 222;
                        const targetSec = Math.round(clickRatio * totalSec);
                        setCurrentTime(targetSec);
                        triggerToast(`Loncat ke ${formatSeconds(targetSec)}`);
                      }}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        const totalSec = activeFile?.durationSec || 222;
                        setHoveredWaveSec(Math.round(ratio * totalSec));
                      }}
                      onMouseLeave={() => setHoveredWaveSec(null)}
                      className="relative bg-slate-50/90 hover:bg-slate-100/70 border border-slate-200/90 rounded-2xl p-4 flex items-center justify-between gap-1.5 h-22 cursor-pointer transition-colors group/wave select-none"
                      title="Klik pada puncak gelombang suara untuk loncat ke detik ini"
                    >
                      {WAVEFORM_PEAKS.map((h, i) => {
                        const totalSec = activeFile?.durationSec || 222;
                        const barTargetSec = Math.round((i / (WAVEFORM_PEAKS.length - 1)) * totalSec);
                        const isPast = barTargetSec <= currentTime;
                        const isCurrentHead = Math.abs(currentTime - barTargetSec) <= Math.ceil(totalSec / WAVEFORM_PEAKS.length);
                        const isHovered = hoveredWaveSec !== null && Math.abs(hoveredWaveSec - barTargetSec) <= Math.ceil(totalSec / WAVEFORM_PEAKS.length);

                        // Height calculation with subtle sound oscillation during play
                        const baseHeight = h;
                        const dynamicHeight = isPlaying && isPast
                          ? Math.min(100, Math.max(16, baseHeight + Math.sin((currentTime * 4) + (i * 0.8)) * 14))
                          : Math.max(14, baseHeight * 0.75);

                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentTime(barTargetSec);
                              triggerToast(`Loncat ke ${formatSeconds(barTargetSec)}`);
                            }}
                            className={`group/bar relative flex-1 rounded-full transition-all duration-150 flex items-center justify-center cursor-pointer ${
                              isCurrentHead
                                ? 'bg-indigo-600 ring-2 ring-indigo-400/50 shadow-xs scale-y-110 z-10'
                                : isPast
                                ? 'bg-indigo-600 hover:bg-indigo-700 hover:scale-y-115'
                                : 'bg-slate-200 hover:bg-indigo-300 hover:scale-y-115'
                            } ${isHovered ? 'ring-1 ring-indigo-400' : ''}`}
                            style={{ height: `${dynamicHeight}%` }}
                            aria-label={`Loncat ke ${formatSeconds(barTargetSec)}`}
                          >
                            {/* Floating tooltip on hover over each peak */}
                            <span className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity bg-slate-900 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap z-30">
                              {formatSeconds(barTargetSec)}
                            </span>
                          </button>
                        );
                      })}

                      {/* Current playback head line */}
                      <div 
                        className="absolute top-1 bottom-1 w-0.5 bg-indigo-600 pointer-events-none transition-all duration-200 z-20 shadow-xs"
                        style={{ left: `${Math.min(99, Math.max(1, (currentTime / (activeFile?.durationSec || 222)) * 100))}%` }}
                      >
                        <div className="w-2 h-2 -ml-[3px] -mt-1 rounded-full bg-indigo-600 ring-2 ring-white"></div>
                      </div>
                    </div>
                  </div>

                  {/* TIMELINE SCRUBBER */}
                  <div className="space-y-1 mb-5">
                    <input 
                      type="range"
                      min={0}
                      max={activeFile?.durationSec || 222}
                      value={currentTime}
                      onChange={(e) => setCurrentTime(Number(e.target.value))}
                      className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  {/* KONTROL PUTAR & KECEPATAN */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600">
                      {[1, 1.25, 1.5, 2].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => setPlaybackSpeed(spd)}
                          className={`px-2 py-1 rounded-lg transition ${playbackSpeed === spd ? 'bg-white text-indigo-700 font-black shadow-xs' : 'hover:text-slate-900'}`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>

                    <button 
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-13 h-13 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-indigo-200 transition"
                      title={isPlaying ? "Jeda (Spasi)" : "Putar (Spasi)"}
                    >
                      {isPlaying ? (
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="4" width="4" height="16" rx="1"></rect>
                          <rect x="14" y="4" width="4" height="16" rx="1"></rect>
                        </svg>
                      ) : (
                        <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M5 3l14 9-14 9V3z"></path>
                        </svg>
                      )}
                    </button>

                    <button 
                      onClick={() => { setCurrentTime(0); setIsPlaying(false); }}
                      className="p-2.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition"
                      title="Mulai Ulang dari Detik 00:00"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* PILIHAN MODEL & METRIK AUDIT */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-400">Pengaturan Mesin AI</span>

                  <div className="space-y-2">
                    <button 
                      onClick={() => setActiveModel('base')}
                      className={`w-full p-3.5 rounded-2xl border text-left transition flex items-center justify-between ${activeModel === 'base' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900">Model Standar (Rekomendasi)</div>
                        <div className="text-[11px] text-slate-500">Whisper Base • Cepat & hemat memori laptop</div>
                      </div>
                      {activeModel === 'base' && <span className="text-xs font-bold text-indigo-700 bg-white px-2 py-0.5 rounded-md border border-indigo-200">Aktif</span>}
                    </button>

                    <button 
                      onClick={() => setIsProModalOpen(true)}
                      className="w-full p-3.5 rounded-2xl border border-slate-200 hover:border-amber-300 bg-slate-50/40 text-left transition flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 group-hover:text-amber-900">Model Presisi Tinggi [Pro]</div>
                        <div className="text-[11px] text-slate-500">Whisper Small • Akurat untuk rekaman bising</div>
                      </div>
                      <span className="text-[10px] font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded">PRO</span>
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 bg-slate-50 rounded-xl">
                      <span className="text-slate-400 block text-[10px] font-bold uppercase">Total Percakapan</span>
                      <span className="font-extrabold text-slate-800 text-sm">{transcriptData.length} Baris</span>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded-xl">
                      <span className="text-slate-400 block text-[10px] font-bold uppercase">Estimasi Kata</span>
                      <span className="font-extrabold text-slate-800 text-sm">~{totalWords} Kata</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* SISI KANAN: INTERACTIVE DIALOGUE STUDIO EDITOR */}
              <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col h-[650px] overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
                  <div className="relative flex-1 max-w-sm">
                    <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                    <input 
                      type="text"
                      placeholder="Cari kata di transkrip..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 transition"
                    />
                  </div>

                  <div className="text-[11px] font-bold text-slate-400">
                    Klik waktu untuk memutar audio
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                  {transcriptData
                    .filter(item => item.text.toLowerCase().includes(searchQuery.toLowerCase()) || item.speaker.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((seg) => {
                      const displayName = speakerNames[seg.speaker] || seg.speaker;
                      const isCurrentlyPlaying = currentTime >= seg.seconds && currentTime < (seg.seconds + 6);

                      return (
                        <div 
                          key={seg.id}
                          className={`p-4 rounded-2xl border transition-all duration-200 ${isCurrentlyPlaying ? 'bg-indigo-50/70 border-indigo-200 shadow-sm ring-1 ring-indigo-200' : 'bg-white border-slate-200/70 hover:border-slate-300'}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  setCurrentTime(seg.seconds);
                                  setIsPlaying(true);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 font-mono text-xs font-bold transition flex items-center gap-1"
                                title="Klik untuk memutar audio dari detik ini"
                              >
                                <span>▶</span>
                                <span>{seg.time}</span>
                              </button>

                              {editingSpeaker === seg.speaker ? (
                                <input 
                                  type="text"
                                  defaultValue={displayName}
                                  autoFocus
                                  onBlur={(e) => handleRenameSpeaker(seg.speaker, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameSpeaker(seg.speaker, (e.target as HTMLInputElement).value);
                                    if (e.key === 'Escape') setEditingSpeaker(null);
                                  }}
                                  className="px-2 py-0.5 text-xs font-bold border border-indigo-600 rounded-md bg-white text-slate-900 focus:outline-none"
                                />
                              ) : (
                                <button 
                                  onClick={() => setEditingSpeaker(seg.speaker)}
                                  className="text-xs font-bold text-slate-800 hover:text-indigo-600 flex items-center gap-1.5 transition"
                                  title="Klik untuk ganti nama pembicara"
                                >
                                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                  <span>{displayName}</span>
                                  <span className="text-[10px] text-slate-400">✏️</span>
                                </button>
                              )}
                            </div>

                            <span className="text-[10px] text-slate-400">Dapat diedit langsung</span>
                          </div>

                          <p 
                            contentEditable
                            suppressContentEditableWarning
                            className="text-sm text-slate-700 leading-relaxed focus:outline-none focus:bg-slate-50 p-1 -m-1 rounded-lg transition"
                          >
                            {seg.text}
                          </p>
                        </div>
                      );
                    })}
                </div>

                <div className="p-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs text-slate-400 font-semibold px-6">
                  <span>Pintasan: Klik spasi untuk jeda/putar</span>
                  <span>Audio & Teks Disimpan di Cache Browser</span>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ==================== 3. PRICING VIEW ==================== */}
        {currentTab === 'pricing' && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                Pilih Cara Pakai yang Pas Untukmu
              </h2>
              <p className="text-slate-500 text-base mt-2">
                Semua paket tetap mengutamakan prinsip privasi mutlak: suara dan teksmu tidak pernah dikirim ke internet.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
              {/* GRATIS */}
              <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="inline-flex px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold mb-4">
                    Gratis Selamanya
                  </div>
                  <h3 className="text-3xl font-black text-slate-900">Rp0</h3>
                  <p className="text-xs text-slate-500 mt-1 mb-6">Untuk mahasiswa, pekerja lepas, dan riset berkala.</p>
                  
                  <ul className="space-y-3 text-sm text-slate-600 mb-8 font-medium">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Model Standar Cepat
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Durasi rekaman tanpa batas
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Ekspor Teks (.TXT) & Subtitle (.SRT)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Tetap berfungsi saat offline
                    </li>
                  </ul>
                </div>

                <button 
                  onClick={() => handleStartTranscribe({ name: "Contoh_Wawancara.mp3", size: "3.5 MB" })}
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-slate-800 bg-slate-100 hover:bg-slate-200 transition"
                >
                  Mulai Pakai Gratis
                </button>
              </div>

              {/* PRO */}
              <div className="bg-white rounded-3xl p-8 border-2 border-indigo-600 shadow-xl shadow-indigo-100 flex flex-col justify-between relative">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-black px-4 py-1 rounded-full uppercase tracking-wider">
                  Paling Populer
                </div>

                <div>
                  <div className="inline-flex px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold mb-4">
                    catetin Pro
                  </div>
                  <div className="flex items-baseline gap-1">
                    <h3 className="text-3xl font-black text-slate-900">Rp49.000</h3>
                    <span className="text-xs font-medium text-slate-500">/ bulan</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 mb-6">Atau Rp299.000 sekali bayar untuk seumur hidup.</p>

                  <ul className="space-y-3 text-sm text-slate-700 mb-8 font-semibold">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Semua fitur paket Gratis
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Model Presisi Tinggi (Whisper Small)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Pemisahan Pembicara Otomatis
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Ekspor Word (.DOCX) & PDF tertata rapi
                    </li>
                  </ul>
                </div>

                <button 
                  onClick={() => setIsProModalOpen(true)}
                  className="w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 transition active:scale-95"
                >
                  Tingkatkan ke Pro
                </button>
              </div>

              {/* KANTOR / B2B */}
              <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="inline-flex px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold mb-4">
                    Lisensi Kantor / B2B
                  </div>
                  <div className="flex items-baseline gap-1">
                    <h3 className="text-3xl font-black text-slate-900">Rp2.500.000</h3>
                    <span className="text-xs font-medium text-slate-500">/ tahun</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 mb-6">Untuk kantor hukum, klinik medis, KAP auditor, & instansi.</p>

                  <ul className="space-y-3 text-sm text-slate-600 mb-8 font-medium">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Aplikasi Desktop Mandiri (.EXE / .DMG)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> 100% Air-Gapped (Komputer tanpa koneksi internet)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Perjanjian Jaminan Privasi (NDA Kepatuhan Data)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Dukungan faktur pajak resmi & onboarding tim
                    </li>
                  </ul>
                </div>

                <a 
                  href="mailto:halo@catetin.id?subject=Permintaan%20Lisensi%20Kantor%20catetin"
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-center text-slate-800 bg-slate-100 hover:bg-slate-200 transition block"
                >
                  Hubungi Tim Kami
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 4. FAQ VIEW (SESUAI TEMPLATE HTML LENGKAP) ==================== */}
        {currentTab === 'faq' && (
          <div className="py-12 px-4 sm:px-6">
            <div className="max-w-5xl mx-auto">
              
              {/* HEADER SECTION */}
              <div className="text-center max-w-2xl mx-auto mb-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold mb-4">
                  <span>Transparansi Komputasi & Keamanan</span>
                </div>
                <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight mb-4">
                  Ada yang bisa kami bantu?
                </h1>
                <p className="text-slate-500 text-sm sm:text-base leading-relaxed">
                  Semua jawaban teknis mengenai cara kerja privasi zero-cloud, spesifikasi perangkat, hingga lisensi instansi kantor.
                </p>

                {/* LIVE SEARCH BAR */}
                <div className="mt-8 relative max-w-xl mx-auto">
                  <input 
                    type="text"
                    value={faqSearch}
                    onChange={(e) => setFaqSearch(e.target.value)}
                    placeholder="Cari pertanyaan... (contoh: offline, kuota, docx, ram)"
                    className="w-full pl-11 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent text-sm transition"
                  />
                  <svg className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                  </svg>
                </div>
              </div>

              {/* KATEGORI FILTER TABS */}
              <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
                <button 
                  onClick={() => setFaqCategory('all')} 
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs ${faqCategory === 'all' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}
                >
                  Semua Pertanyaan
                </button>
                <button 
                  onClick={() => setFaqCategory('privacy')} 
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs ${faqCategory === 'privacy' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}
                >
                  🔒 Keamanan & Privasi
                </button>
                <button 
                  onClick={() => setFaqCategory('tech')} 
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs ${faqCategory === 'tech' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}
                >
                  ⚡ Performa & Format
                </button>
                <button 
                  onClick={() => setFaqCategory('billing')} 
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs ${faqCategory === 'billing' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}
                >
                  💼 Lisensi & Kantor B2B
                </button>
              </div>

              {/* GRID TATA LETAK: ACCORDION KIRI + SIDEBAR BANTUAN KANAN */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* KOLOM DAFTAR PERTANYAAN (8 Kolom) */}
                <div className="lg:col-span-8 space-y-4">
                  {filteredFaqList.map((item) => {
                    const isOpen = openFaqSet.has(item.id);

                    return (
                      <div 
                        key={item.id} 
                        className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs transition hover:border-slate-300"
                      >
                        <button 
                          onClick={() => toggleFaqAccordion(item.id)} 
                          className="w-full flex items-center justify-between text-left gap-4 group"
                        >
                          <div className="flex items-start gap-3">
                            <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md mt-0.5">
                              {String(item.id).padStart(2, '0')}
                            </span>
                            <div>
                              <h3 className="text-sm sm:text-base font-bold text-slate-900 group-hover:text-indigo-600 transition">
                                {item.question}
                              </h3>
                              <span className="text-[10px] font-semibold text-slate-400 mt-0.5 block">
                                Kategori: {item.categoryLabel}
                              </span>
                            </div>
                          </div>
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0 transition-transform ${isOpen ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                            {isOpen ? '−' : '+'}
                          </div>
                        </button>
                        
                        {isOpen && (
                          <div className="mt-4 pt-4 border-t border-slate-100 text-xs sm:text-sm text-slate-600 leading-relaxed">
                            {item.answer}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* NOT FOUND STATE */}
                  {filteredFaqList.length === 0 && (
                    <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
                      <p className="text-sm font-bold text-slate-700">Pertanyaan tidak ditemukan</p>
                      <p className="text-xs text-slate-400 mt-1">Coba gunakan kata kunci lain seperti "offline", "kuota", atau "format".</p>
                    </div>
                  )}
                </div>

                {/* KOLOM KANAN: KARTU BANTUAN & TRUST ASSETS (4 Kolom) */}
                <div className="lg:col-span-4 space-y-5 sticky top-24">
                  {/* KARTU BANTUAN HUMAN SUPPORT */}
                  <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-lg mb-4">
                      💬
                    </div>
                    <h4 className="text-base font-black text-slate-900 mb-1">Punya Pertanyaan Khusus?</h4>
                    <p className="text-xs text-slate-500 leading-relaxed mb-5">
                      Butuh format dokumen kustom, penawaran harga khusus kampus, atau instalasi server lokal internal?
                    </p>
                    <a 
                      href="mailto:halo@catetin.id" 
                      className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition"
                    >
                      <span>Hubungi Tim Langsung</span>
                      <span>→</span>
                    </a>
                  </div>

                  {/* KARTU AUDIT TEKNOLOGI */}
                  <div className="bg-indigo-50/60 border border-indigo-100 rounded-3xl p-6 text-xs text-indigo-950 space-y-3">
                    <span className="font-bold uppercase tracking-wider text-[10px] text-indigo-600 block">
                      Jaminan Keamanan Arsitektur
                    </span>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-600 font-bold">✓</span>
                        <span>Audit Network: 0 KB Egress Audio</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-600 font-bold">✓</span>
                        <span>WebGPU Local Execution Sandbox</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-600 font-bold">✓</span>
                        <span>Kepatuhan Pasal 35 UU PDP Indonesia</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}
      </main>

      {/* PRO UPGRADE MODAL */}
      {isProModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl border border-slate-100 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 font-black text-2xl">
              👑
            </div>
            <h3 className="text-2xl font-black text-slate-900 mb-2">Tingkatkan ke catetin Pro</h3>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              Ekspor dokumen Word (.DOCX) tertata rapi dengan judul dan penanda pembicara otomatis, serta akses model AI berakurasi tinggi.
            </p>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left mb-6 space-y-2">
              <div className="flex justify-between items-center text-sm font-bold text-slate-900">
                <span>Langganan Bulanan</span>
                <span className="text-indigo-600">Rp49.000 / bln</span>
              </div>
              <div className="flex justify-between items-center text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                <span>Akses Seumur Hidup (Lifetime)</span>
                <span className="text-emerald-700">Rp299.000</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsProModalOpen(false)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-100 transition"
              >
                Nanti Dulu
              </button>
              <button 
                onClick={() => {
                  setIsProModalOpen(false);
                  triggerToast("Simulasi pembayaran: Menghubungi payment gateway!");
                }}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-slate-900 bg-amber-400 hover:bg-amber-300 shadow-md shadow-amber-200 transition"
              >
                Beli Lisensi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-10 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-slate-900 text-base">catetin<span className="text-indigo-600">.</span></span>
            <span>• Transkripsi audio & video 100% lokal di browser.</span>
          </div>

          <div className="flex items-center gap-6">
            <button onClick={() => setCurrentTab('landing')} className="hover:text-slate-900">Beranda</button>
            <button onClick={() => setCurrentTab('pricing')} className="hover:text-slate-900">Harga</button>
            <button onClick={() => setCurrentTab('faq')} className="hover:text-slate-900">FAQ</button>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-slate-900">Lisensi Terbuka (MIT)</a>
          </div>

          <div className="text-slate-400">
            © 2026 catetin • Zero-Cloud Privacy
          </div>
        </div>
      </footer>
    </div>
  );
}