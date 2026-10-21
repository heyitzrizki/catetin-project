import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  FileText,
  Check,
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  Copy,
  Download,
  X,
  Upload,
  Mic,
  Search,
  Laptop,
  ChevronDown,
  Volume2,
  FileAudio,
  Folder,
  GraduationCap,
  Sparkles,
  BookOpen,
  Video,
  Radio,
  Sliders,
  CheckCircle2
} from 'lucide-react';
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader';
import { ContinuousTranscriptEditor } from '@/components/workspace/ContinuousTranscriptEditor';
import { ContextualUtilityPanel } from '@/components/workspace/ContextualUtilityPanel';
import { AudioDock } from '@/components/workspace/AudioDock';
import { WhisperDrawer } from '@/components/workspace/WhisperDrawer';

interface DialogSegment {
  id: number;
  time: string;
  seconds: number;
  speaker: string;
  text: string;
}

interface SampleRecording {
  id: string;
  category: string;
  filename: string;
  duration: string;
  durationSec: number;
  segments: DialogSegment[];
}

const SAMPLES_DATA: { [key: string]: SampleRecording } = {
  wawancara: {
    id: 'wawancara',
    category: 'Riset & Investigasi',
    filename: "Wawancara_Investigasi_Q3.mp3",
    duration: "03:42",
    durationSec: 222,
    segments: [
      { id: 1, time: "00:03", seconds: 3, speaker: "Speaker 1 (Pewawancara)", text: "Boleh diceritakan alasan utama tim Anda melarang keras penggunaan software transkrip online yang biasa?" },
      { id: 2, time: "00:15", seconds: 15, speaker: "Speaker 2 (Narasumber)", text: "Semua berkas investigasi terikat perjanjian kerahasiaan ketat. Begitu audio diunggah ke server cloud pihak ketiga, risiko hukum dan kebocoran datanya jadi tanggung jawab kami." },
      { id: 3, time: "00:36", seconds: 36, speaker: "Speaker 1 (Pewawancara)", text: "Itu sebabnya di catetin, kalkulasi AI Whisper dieksekusi 100% di perambanmu sendiri melalui WebGPU tanpa ada 1 byte pun data suara yang dikirim keluar." },
      { id: 4, time: "00:58", seconds: 58, speaker: "Speaker 2 (Narasumber)", text: "Bahkan hasilnya bisa langsung kami ekspor jadi format Word rapi lengkap dengan pemisahan nama dan penomoran baris." },
      { id: 5, time: "01:22", seconds: 82, speaker: "Speaker 1 (Pewawancara)", text: "Dan yang paling penting, tidak ada kuota menit bulanan. Anda bebas memproses rekaman berapa jam pun." }
    ]
  },
  hukum: {
    id: 'hukum',
    category: 'Hukum & Sidang',
    filename: "Konsultasi_Klien_NDA.wav",
    duration: "03:10",
    durationSec: 190,
    segments: [
      { id: 1, time: "00:04", seconds: 4, speaker: "Kuasa Hukum", text: "Berdasarkan klausul kerahasiaan pasal 7, seluruh rekaman keterangan saksi tidak boleh disimpan pada server pihak ketiga." },
      { id: 2, time: "00:22", seconds: 22, speaker: "Saksi Ahli", text: "Apakah ada risiko data rekaman suara ini bocor saat diproses oleh aplikasi transkripsi?" },
      { id: 3, time: "00:41", seconds: 41, speaker: "Kuasa Hukum", text: "Sama sekali tidak. catetin bekerja secara lokal di perangkat ini, memproses audio secara offline." }
    ]
  },
  rapat: {
    id: 'rapat',
    category: 'Manajemen Produk',
    filename: "Notulen_Rapat_Sprint_Q3.m4a",
    duration: "02:15",
    durationSec: 135,
    segments: [
      { id: 1, time: "00:02", seconds: 2, speaker: "Product Lead", text: "Selamat pagi tim. Hari ini kita review milestone integrasi model AI offline dan performa WebGPU." },
      { id: 2, time: "00:14", seconds: 14, speaker: "Tech Lead", text: "Semua pengujian berjalan lancar. Rekaman audio 15 menit selesai ditranskrip hanya dalam 40 detik langsung di laptop." }
    ]
  }
};

const WAVEFORM_PEAKS = [
  25, 48, 75, 38, 88, 62, 92, 42, 28, 60, 85, 90, 48, 70, 35, 82, 95, 62, 30, 46, 76, 88, 52, 32, 72, 85, 50, 72, 40, 80, 65, 90
];

export default function App() {
  const [currentTab, setCurrentTab] = useState<'landing' | 'workspace' | 'pricing' | 'faq'>('landing');
  const [activeKey, setActiveKey] = useState<string>('wawancara');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isLifetime, setIsLifetime] = useState(true);
  const [hoveredWaveSec, setHoveredWaveSec] = useState<number | null>(null);

  // Transcript state
  const [transcriptData, setTranscriptData] = useState<DialogSegment[]>(SAMPLES_DATA.wawancara.segments);
  const [speakerNames, setSpeakerNames] = useState<{ [key: string]: string }>({});
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<'script' | 'segments'>('script');

  // Auth Modal State
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [userProfileEmail, setUserProfileEmail] = useState<string | null>(null);
  const [authInputEmail, setAuthInputEmail] = useState('');

  // Workspace Redesign States
  const [selectedModel, setSelectedModel] = useState<'base' | 'small' | 'tiny'>('base');
  const [isWhisperDrawerOpen, setIsWhisperDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [workspaceViewMode, setWorkspaceViewMode] = useState<'naskah' | 'waktu'>('naskah');
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState<string | null>(null);

  // Segment text update handler
  const handleUpdateSegmentText = (id: number, newText: string) => {
    setTranscriptData(prev => prev.map(seg => seg.id === id ? { ...seg, text: newText } : seg));
  };

  // Toast
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // Upload ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const activeSample = SAMPLES_DATA[activeKey] || SAMPLES_DATA.wawancara;

  // Playback timer loop
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= activeSample.durationSec) {
            setIsPlaying(false);
            return activeSample.durationSec;
          }
          return prev + 1;
        });
      }, 1000 / playbackSpeed);
    }
    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, activeSample]);

  // Keyboard shortcut: close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAuthModalOpen) {
        setIsAuthModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthModalOpen]);

  const loadSample = (key: string) => {
    setActiveKey(key);
    const data = SAMPLES_DATA[key];
    setTranscriptData(data.segments);
    setCurrentTime(0);
    setIsPlaying(false);
    triggerToast(`Memuat ${data.filename}`);
  };

  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Format validation (Rule C-4 Resilience & Error state)
    const validExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.mp4', '.aac', '.flac'];
    const lowerName = file.name.toLowerCase();
    const isAudioType = file.type.startsWith('audio/') || file.type.startsWith('video/');
    const hasValidExt = validExtensions.some(ext => lowerName.endsWith(ext));

    if (!isAudioType && !hasValidExt) {
      triggerToast('Format berkas tidak didukung. Harap gunakan berkas audio standar (MP3, WAV, atau M4A).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Instant on-device audio reading
    const customKey = 'uploaded_' + Date.now();
    const durationEstimate = "04:12";
    const newSegments: DialogSegment[] = [
      { id: 1, time: "00:02", seconds: 2, speaker: "Speaker 1", text: `Berkas audio lokal "${file.name}" berhasil dianalisis di memori peramban Anda via WebGPU.` },
      { id: 2, time: "00:18", seconds: 18, speaker: "Speaker 2", text: "Seluruh inferensi diproses tanpa transfer jaringan. Anda dapat mengedit teks ini langsung atau mengekspornya." }
    ];

    SAMPLES_DATA[customKey] = {
      id: customKey,
      category: 'Audio Kustom',
      filename: file.name,
      duration: durationEstimate,
      durationSec: 252,
      segments: newSegments
    };

    setActiveKey(customKey);
    setTranscriptData(newSegments);
    setCurrentTime(0);
    setIsPlaying(false);
    triggerToast(`Berkas "${file.name}" siap diproses lokal!`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRenameSpeaker = (oldName: string, newName: string) => {
    if (!newName.trim()) return;
    setSpeakerNames(prev => ({ ...prev, [oldName]: newName.trim() }));
    setEditingSpeaker(null);
    triggerToast(`Nama diubah menjadi "${newName}"`);
  };

  const copyFullTranscript = () => {
    const full = transcriptData
      .map(d => `[${d.time}] ${speakerNames[d.speaker] || d.speaker}:\n${d.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(full);
    triggerToast('Seluruh teks berhasil disalin ke clipboard!');
  };

  const exportWordDoc = () => {
    const full = `RISALAH TRANSKRIPSI CATETIN\n` +
      `Berkas: ${activeSample.filename}\n` +
      `Durasi: ${activeSample.duration}\n` +
      `Status: 100% On-Device / Zero-Cloud Data Perimeter\n\n` +
      `--------------------------------------------------\n\n` +
      transcriptData
        .map(d => `[${d.time}] ${speakerNames[d.speaker] || d.speaker}:\n${d.text}\n`)
        .join('\n');
    const blob = new Blob([full], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSample.filename.split('.')[0]}_transkrip.docx`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast('Berkas .DOCX (Word) berhasil diunduh!');
  };

  const exportSrt = () => {
    const srtContent = transcriptData
      .map((s, idx) => {
        const startM = Math.floor(s.seconds / 60);
        const startS = s.seconds % 60;
        const endSec = s.seconds + 8;
        const endM = Math.floor(endSec / 60);
        const endS = endSec % 60;
        const startStr = `00:${String(startM).padStart(2, '0')}:${String(startS).padStart(2, '0')},000`;
        const endStr = `00:${String(endM).padStart(2, '0')}:${String(endS).padStart(2, '0')},000`;
        return `${idx + 1}\n${startStr} --> ${endStr}\n${speakerNames[s.speaker] || s.speaker}: ${s.text}\n`;
      })
      .join('\n');
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSample.filename.split('.')[0]}.srt`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast('Berkas .SRT berhasil diunduh!');
  };

  const exportTxt = () => {
    const txtContent = transcriptData
      .map(d => `[${d.time}] ${speakerNames[d.speaker] || d.speaker}: ${d.text}`)
      .join('\n\n');
    const blob = new Blob([txtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSample.filename.split('.')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast('Berkas .TXT berhasil diunduh!');
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authInputEmail.trim()) {
      alert('Silakan masukkan email Anda');
      return;
    }
    setUserProfileEmail(authInputEmail.trim());
    setIsAuthModalOpen(false);
    triggerToast(`Masuk sebagai ${authInputEmail.trim()}. Riwayat lokal tersinkron!`);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-blue-900 selection:text-white flex flex-col justify-between">
      
      {/* FLOATING TOAST: Strict Sharp Border, No Slop */}
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-950 text-white px-4 py-3 rounded-xs shadow-xl text-xs font-medium border border-slate-800 animate-in fade-in duration-150">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ========================================================= */}
      {/* NAVBAR: STRICT MONOCHROME, NON-REDUNDANT                  */}
      {/* ========================================================= */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { setCurrentTab('landing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
              className="text-xl font-black tracking-tight text-slate-950 hover:opacity-80 transition cursor-pointer flex items-center gap-1.5"
            >
              <span className="w-6 h-6 rounded-xs bg-slate-950 text-white flex items-center justify-center text-xs font-mono font-bold">c.</span>
              <span>catetin</span>
            </button>
            <span className="hidden sm:inline-block text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-600 bg-slate-100 px-2 py-0.5 rounded-xs border border-slate-200">
              on-device ai
            </span>
          </div>

          {/* Center Links */}
          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-slate-600">
            <button 
              onClick={() => { setCurrentTab('landing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`hover:text-slate-950 transition cursor-pointer ${currentTab === 'landing' ? 'text-slate-950 font-bold' : ''}`}
            >
              Beranda
            </button>
            <button 
              onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`hover:text-slate-950 transition cursor-pointer ${currentTab === 'workspace' ? 'text-slate-950 font-bold' : ''}`}
            >
              Studio Editor
            </button>
            <button 
              onClick={() => { setCurrentTab('pricing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`hover:text-slate-950 transition cursor-pointer ${currentTab === 'pricing' ? 'text-slate-950 font-bold' : ''}`}
            >
              Harga & Lisensi
            </button>
            <button 
              onClick={() => { setCurrentTab('faq'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`hover:text-slate-950 transition cursor-pointer ${currentTab === 'faq' ? 'text-slate-950 font-bold' : ''}`}
            >
              FAQ
            </button>
          </nav>

          {/* Right Actions: Sign In + Main CTA Button */}
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsAuthModalOpen(true)} 
              className="text-xs font-semibold text-slate-700 hover:text-slate-950 transition cursor-pointer"
            >
              {userProfileEmail ? userProfileEmail.split('@')[0] : 'Masuk'}
            </button>
            <button 
              onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-4 py-2 rounded-xs bg-slate-950 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <span>Buka Studio</span>
              <span className="font-normal opacity-60">Gratis</span>
              <span>→</span>
            </button>
          </div>

        </div>
      </header>

      {/* ========================================================= */}
      {/* TAB 1: LANDING PAGE (MACWHISPER HARDWARE SHOWCASE HERO)   */}
      {/* ========================================================= */}
      {currentTab === 'landing' && (
        <main className="flex-1">
          
          {/* HERO SECTION: MACWHISPER STYLE BOLD HEADLINE & HARDWARE */}
          <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 text-center relative overflow-hidden">
            
            {/* Top Telemetry Pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xs bg-slate-100 border border-slate-200 text-xs font-medium text-slate-800 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="font-mono text-[11px]">0 KB Egress</span>
              <span className="text-slate-300">|</span>
              <span>Akselerasi WebGPU Lokal</span>
              <span className="text-slate-300">|</span>
              <span className="text-blue-900 font-semibold">Bebas Kuota Menit</span>
            </div>

            {/* Main Headline with Navy Badge Highlight (ala MacWhisper) */}
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black text-slate-950 tracking-tight leading-[1.08] max-w-4xl mx-auto mb-4">
              Satu aplikasi web untuk <br className="hidden sm:inline" />
              <span className="inline-block relative text-blue-900 px-3 py-0.5 rounded-md bg-blue-100/90 border border-blue-200">
                mentranskrip
              </span> semua rekaman.
            </h1>

            <p className="text-lg sm:text-2xl font-bold text-slate-600 tracking-tight mb-6">
              Wawancara riset, sidang hukum, rapat direksi, hingga rekaman kuliah.
            </p>

            <p className="text-sm sm:text-base text-slate-600 max-w-2xl mx-auto leading-relaxed mb-8">
              Tanpa bot meeting, tanpa mengirim file audio ke cloud, dan tanpa kuota langganan per menit. Berjalan 100% menggunakan tenaga chip prosesor di perangkatmu sendiri.
            </p>

            {/* CTA Row (No dropzone in hero, explicit buttons only) */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
              <button 
                onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="w-full sm:w-auto px-7 py-3 rounded-xs bg-slate-950 hover:bg-blue-900 text-white font-bold text-sm transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Buka Studio Transkrip Gratis</span>
                <span>→</span>
              </button>
              <button 
                onClick={() => setIsAuthModalOpen(true)}
                className="w-full sm:w-auto px-6 py-3 rounded-xs border border-slate-300 hover:border-slate-900 hover:bg-slate-50 text-slate-900 font-semibold text-sm transition cursor-pointer"
              >
                Buat Akun Profil
              </button>
            </div>

            <div className="flex items-center justify-center gap-5 text-xs text-slate-500 font-mono mb-16">
              <span>✓ Windows, macOS, Linux</span>
              <span>·</span>
              <span>✓ Format MP3, M4A, WAV, MP4</span>
              <span>·</span>
              <span>✓ 100% Offline Ready</span>
            </div>

            {/* ======================================================= */}
            {/* HARDWARE LAPTOP CHASSIS & SURROUNDING FLOATING BADGES   */}
            {/* Exactly reflecting MacWhisper promo composition         */}
            {/* ======================================================= */}
            <div className="max-w-5xl mx-auto relative select-none">
              
              {/* Surrounding format badges ala MacWhisper reference (desktop/tablet) */}
              <div className="hidden lg:block absolute -left-12 top-6 z-10 space-y-8 pointer-events-none">
                <div className="w-24 p-3 bg-white/95 rounded-xs border border-slate-200 shadow-sm text-center transform -rotate-6">
                  <GraduationCap className="w-5 h-5 mx-auto text-slate-700 mb-1" />
                  <span className="font-mono text-[9px] font-bold text-slate-600 block">KULIAH</span>
                </div>
                <div className="w-24 p-3 bg-white/95 rounded-xs border border-slate-200 shadow-sm text-center transform rotate-3">
                  <FileText className="w-5 h-5 mx-auto text-slate-700 mb-1" />
                  <span className="font-mono text-[9px] font-bold text-slate-600 block">NOTULEN</span>
                </div>
                <div className="w-28 p-3 bg-blue-50/95 rounded-xs border border-blue-200 shadow-sm text-center transform -rotate-3">
                  <Mic className="w-5 h-5 mx-auto text-blue-900 mb-1" />
                  <span className="font-mono text-[9px] font-bold text-blue-950 block">VOICE MEMOS</span>
                </div>
              </div>

              <div className="hidden lg:block absolute -right-12 top-6 z-10 space-y-8 pointer-events-none">
                <div className="w-28 p-3 bg-blue-50/95 rounded-xs border border-blue-200 shadow-sm text-center transform rotate-6">
                  <Folder className="w-5 h-5 mx-auto text-blue-900 mb-1" />
                  <span className="font-mono text-[9px] font-bold text-blue-950 block">RISALAH</span>
                </div>
                <div className="w-24 p-3 bg-white/95 rounded-xs border border-slate-200 shadow-sm text-center transform -rotate-3">
                  <Radio className="w-5 h-5 mx-auto text-slate-700 mb-1" />
                  <span className="font-mono text-[9px] font-bold text-slate-600 block">PODCAST</span>
                </div>
                <div className="w-24 p-3 bg-white/95 rounded-xs border border-slate-200 shadow-sm text-center transform rotate-3">
                  <Video className="w-5 h-5 mx-auto text-slate-700 mb-1" />
                  <span className="font-mono text-[9px] font-bold text-slate-600 block">YOUTUBE</span>
                </div>
              </div>

              {/* Laptop Top Display Frame */}
              <div className="macbook-chassis rounded-t-md p-3 pb-0 relative text-left">
                
                {/* Top Screen Notch & Camera */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-4 macbook-notch flex items-center justify-center gap-2 z-20">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-800"></span>
                  <span className="w-1 h-1 rounded-full bg-emerald-500/80"></span>
                </div>

                {/* Screen Window */}
                <div className="macbook-screen rounded-t-xs overflow-hidden border border-slate-800 bg-white">
                  
                  {/* macOS Menu Bar ala MacWhisper */}
                  <div className="bg-slate-900 text-slate-300 text-[10px] font-medium px-4 py-1 flex items-center justify-between border-b border-slate-800 select-none">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-bold">catetin</span>
                      <span className="hidden sm:inline hover:text-white cursor-default">File</span>
                      <span className="hidden sm:inline hover:text-white cursor-default">Edit</span>
                      <span className="hidden sm:inline hover:text-white cursor-default">View</span>
                      <span className="hidden sm:inline hover:text-white cursor-default">Transcript</span>
                      <span className="hidden sm:inline hover:text-white cursor-default">Whisper</span>
                      <span className="hidden sm:inline hover:text-white cursor-default">Window</span>
                      <span className="hidden sm:inline hover:text-white cursor-default">Help</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[10px] text-slate-400">
                      <span>100% Offline</span>
                      <span>Sen 10:42 AM</span>
                    </div>
                  </div>

                  {/* Window Control Header */}
                  <div className="bg-slate-100 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      <span className="ml-2 font-mono text-[11px] font-semibold text-slate-700 truncate max-w-[180px] sm:max-w-none">
                        Wawancara_Investigasi_Q3.mp3
                      </span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <span className="hidden sm:inline-block text-[10px] font-mono px-2 py-0.5 rounded-xs bg-emerald-50 text-emerald-800 border border-emerald-300 font-semibold">
                        LOCAL RAM BUFFER
                      </span>
                      <button 
                        onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-xs bg-slate-950 text-white hover:bg-blue-900 transition cursor-pointer"
                      >
                        Buka di Editor →
                      </button>
                    </div>
                  </div>

                  {/* Inside Mockup Screen: Two Column Split View (MacWhisper layout) */}
                  <div className="grid grid-cols-12 divide-x divide-slate-200 bg-white text-slate-900 h-84 sm:h-96">
                    
                    {/* Left Column: Synchronized Dialogue Transcript */}
                    <div className="col-span-8 p-5 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm">
                      
                      <div className="space-y-1">
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-bold text-emerald-700">Speaker 1 (Pewawancara)</span>
                          <span className="text-slate-400">00:03</span>
                        </div>
                        <p className="text-slate-800 leading-relaxed">
                          "Boleh diceritakan alasan utama tim Anda melarang keras penggunaan software transkrip online yang biasa?"
                        </p>
                      </div>

                      <div className="space-y-1 bg-blue-50/60 p-3 rounded-xs border-l-2 border-blue-700">
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-bold text-blue-900">Speaker 2 (Narasumber)</span>
                          <span className="text-slate-400">00:15</span>
                        </div>
                        <p className="text-slate-900 leading-relaxed font-medium">
                          "Semua berkas investigasi terikat perjanjian kerahasiaan ketat. Begitu audio diunggah ke server cloud pihak ketiga, risiko hukum dan kebocoran datanya jadi tanggung jawab kami."
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-bold text-emerald-700">Speaker 1 (Pewawancara)</span>
                          <span className="text-slate-400">00:36</span>
                        </div>
                        <p className="text-slate-800 leading-relaxed">
                          "Itu sebabnya di catetin, kalkulasi AI Whisper dieksekusi 100% di perambanmu sendiri melalui WebGPU tanpa ada 1 byte pun data suara yang dikirim keluar."
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-bold text-blue-900">Speaker 2 (Narasumber)</span>
                          <span className="text-slate-400">00:58</span>
                        </div>
                        <p className="text-slate-800 leading-relaxed">
                          "Bahkan hasilnya bisa langsung kami ekspor jadi format Word rapi lengkap dengan pemisahan nama dan penomoran baris."
                        </p>
                      </div>

                    </div>

                    {/* Right Column: Settings, Model & Export Panel (MacWhisper Style Inspector) */}
                    <div className="col-span-4 p-4 sm:p-5 bg-slate-50 space-y-4 text-xs font-sans">
                      
                      <div className="space-y-1.5">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Mode Tampilan</span>
                        <div className="grid grid-cols-2 gap-1 bg-slate-200/80 p-0.5 rounded-xs text-[11px] font-semibold text-center">
                          <span className="bg-white text-slate-900 py-1 rounded-xs shadow-2xs">Naskah</span>
                          <span className="text-slate-600 py-1">Segmen Waktu</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-slate-200">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Model Aktif</span>
                        <div className="p-2 bg-white rounded-xs border border-slate-200">
                          <div className="font-bold text-slate-900 text-xs">Whisper Base (Fast)</div>
                          <div className="font-mono text-[10px] text-slate-500">140 MB VRAM · 10x Realtime</div>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-slate-200">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Daftar Pembicara</span>
                        <div className="space-y-1">
                          <div className="px-2 py-1 bg-emerald-50 text-emerald-900 rounded-xs border border-emerald-200 text-[11px] flex items-center justify-between">
                            <span>Speaker 1</span>
                            <span className="font-mono text-[10px]">3 segmen</span>
                          </div>
                          <div className="px-2 py-1 bg-blue-50 text-blue-900 rounded-xs border border-blue-200 text-[11px] flex items-center justify-between">
                            <span>Speaker 2</span>
                            <span className="font-mono text-[10px]">2 segmen</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-slate-200">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Ekspor Cepat</span>
                        <div className="space-y-1">
                          <button 
                            onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            className="w-full text-left px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xs font-medium text-slate-800 transition flex items-center justify-between text-[11px] cursor-pointer"
                          >
                            <span>Dokumen Word (.docx)</span>
                            <span className="font-mono text-slate-400">DOCX</span>
                          </button>
                          <button 
                            onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            className="w-full text-left px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xs font-medium text-slate-800 transition flex items-center justify-between text-[11px] cursor-pointer"
                          >
                            <span>Subtitle SubRip (.srt)</span>
                            <span className="font-mono text-slate-400">SRT</span>
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200">
                        <div className="flex justify-between text-[10px] font-mono text-slate-500">
                          <span>Durasi Terproses:</span>
                          <span className="font-bold text-blue-900">03:42 / 03:42</span>
                        </div>
                      </div>

                    </div>

                  </div>

                  {/* Bottom Audio Player Scrubber in Laptop Window */}
                  <div className="bg-slate-100 border-t border-slate-200 px-4 py-2.5 flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="w-7 h-7 rounded-xs bg-slate-950 text-white flex items-center justify-center text-[10px] hover:bg-blue-900 transition cursor-pointer"
                      >
                        ▶
                      </button>
                      <span className="text-slate-600">00:15 / 03:42</span>
                    </div>
                    <div className="flex-1 mx-4 bg-slate-300 h-1 rounded-full overflow-hidden">
                      <div className="bg-blue-700 h-full rounded-full" style={{ width: '28%' }}></div>
                    </div>
                    <span className="text-emerald-700 font-semibold text-[11px]">● On-Device Inference</span>
                  </div>

                </div>

              </div>

              {/* Laptop Bottom Metal Base */}
              <div className="macbook-base h-3.5 rounded-b-xs relative mx-auto -mt-0.5 max-w-[98%]">
                <div className="macbook-base-notch absolute top-0 left-1/2 -translate-x-1/2 w-20 h-1.5"></div>
              </div>

            </div>

          </section>

          {/* LOGO STRIP: TRUSTED REPUTATION */}
          <section className="border-y border-slate-200 bg-slate-50 py-10 px-6">
            <div className="max-w-5xl mx-auto text-center space-y-4">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                Dirancang untuk mereka yang mengutamakan kerahasiaan mutlak
              </span>
              <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 text-slate-700 font-bold text-xs sm:text-sm tracking-wide">
                <span>FIRMA HUKUM & ADVOKAT</span>
                <span>·</span>
                <span>TIM RISET UX & PRODUK</span>
                <span>·</span>
                <span>JURNALIS INVESTIGASI</span>
                <span>·</span>
                <span>KLINIK KESEHATAN</span>
                <span>·</span>
                <span>DOSEN & AKADEMISI</span>
              </div>
            </div>
          </section>

          {/* SECTION: CARA KERJA LENGKAP (3 LANGKAH TEGAS) */}
          <section className="max-w-5xl mx-auto px-6 py-24 space-y-16">
            
            <div className="max-w-xl">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-blue-900 block mb-2">Alur Kerja Praktis</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-950 tracking-tight leading-tight">
                Transkrip selesai dalam 3 langkah tanpa setup rumit.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="card-frame card-frame-hover p-6 rounded-xs space-y-3">
                <div className="w-8 h-8 rounded-xs bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                  01
                </div>
                <h3 className="text-lg font-bold text-slate-950">
                  Pilih Berkas Audio / Video
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Mendukung rekaman Voice Memos dari iPhone/Android, file rapat Zoom/Google Meet, hingga format MP3, WAV, M4A, dan video MP4.
                </p>
              </div>

              <div className="card-frame card-frame-hover p-6 rounded-xs space-y-3">
                <div className="w-8 h-8 rounded-xs bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                  02
                </div>
                <h3 className="text-lg font-bold text-slate-950">
                  Model Whisper Berjalan Lokal
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Chip grafis laptop Anda memproses suara langsung di browser via WebGPU. Tanpa antrean server cloud, tanpa risiko data keluar.
                </p>
              </div>

              <div className="card-frame card-frame-hover p-6 rounded-xs space-y-3">
                <div className="w-8 h-8 rounded-xs bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                  03
                </div>
                <h3 className="text-lg font-bold text-slate-950">
                  Ekspor Risalah Rapi
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Nama narasumber terpisah rapi dengan nomor baris formal. Sekali klik langsung siap diunduh ke naskah Word (.docx) atau subtitle (.srt).
                </p>
              </div>

            </div>

          </section>

          {/* SECTION: TABEL MODEL TRANSPARAN ALA MACWHISPER */}
          <section className="max-w-5xl mx-auto px-6 pb-24">
            
            <div className="max-w-xl mb-10">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-blue-900 block mb-2">Transparansi Perangkat Keras</span>
              <h2 className="text-3xl font-extrabold text-slate-950 tracking-tight">
                Pilihan Model Whisper & Kebutuhan RAM
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-2">
                Kami tidak menyembunyikan spesifikasi di balik kata marketing. Anda punya kendali penuh atas model AI yang dipakai di browser.
              </p>
            </div>

            <div className="card-frame rounded-xs overflow-hidden">
              <div className="grid grid-cols-12 bg-slate-100 border-b border-slate-200 px-5 py-3 text-xs font-mono font-bold text-slate-700">
                <div className="col-span-3">MODEL AI</div>
                <div className="col-span-3">UKURAN MEMORI (RAM)</div>
                <div className="col-span-3">KECEPATAN RELATIF</div>
                <div className="col-span-3">PERUNTUKAN IDEAL</div>
              </div>
              <div className="divide-y divide-slate-200 text-xs sm:text-sm">
                <div className="grid grid-cols-12 px-5 py-3.5 items-center hover:bg-slate-50 transition">
                  <div className="col-span-3 font-bold text-slate-950">Whisper Tiny</div>
                  <div className="col-span-3 font-mono text-slate-600">~75 MB</div>
                  <div className="col-span-3 font-mono text-emerald-700 font-semibold">20x Realtime</div>
                  <div className="col-span-3 text-slate-600 text-xs">Cek cepat, HP & Tablet spek standar</div>
                </div>
                <div className="grid grid-cols-12 px-5 py-3.5 items-center bg-blue-50/40 hover:bg-blue-50/70 transition">
                  <div className="col-span-3 font-bold text-blue-900 flex items-center gap-1.5">
                    <span>Whisper Base</span>
                    <span className="text-[9px] font-mono bg-blue-200 text-blue-900 px-1 rounded-none font-bold">GRATIS</span>
                  </div>
                  <div className="col-span-3 font-mono text-slate-600">~140 MB</div>
                  <div className="col-span-3 font-mono text-emerald-700 font-semibold">10x Realtime</div>
                  <div className="col-span-3 text-slate-700 text-xs font-medium">Standar rapat umum & wawancara jernih</div>
                </div>
                <div className="grid grid-cols-12 px-5 py-3.5 items-center hover:bg-slate-50 transition">
                  <div className="col-span-3 font-bold text-slate-950 flex items-center gap-1.5">
                    <span>Whisper Small</span>
                    <span className="text-[9px] font-mono bg-slate-900 text-white px-1 rounded-none font-bold">PRO</span>
                  </div>
                  <div className="col-span-3 font-mono text-slate-600">~460 MB</div>
                  <div className="col-span-3 font-mono text-slate-700">4x Realtime</div>
                  <div className="col-span-3 text-slate-600 text-xs">Akurasi tinggi, audio bising, aksen daerah</div>
                </div>
                <div className="grid grid-cols-12 px-5 py-3.5 items-center hover:bg-slate-50 transition">
                  <div className="col-span-3 font-bold text-slate-950 flex items-center gap-1.5">
                    <span>Whisper Medium</span>
                    <span className="text-[9px] font-mono bg-slate-900 text-white px-1 rounded-none font-bold">PRO</span>
                  </div>
                  <div className="col-span-3 font-mono text-slate-600">~1.5 GB</div>
                  <div className="col-span-3 font-mono text-slate-700">1.5x Realtime</div>
                  <div className="col-span-3 text-slate-600 text-xs">Istilah hukum rumit, medis, multi-bahasa</div>
                </div>
              </div>
            </div>

          </section>

          {/* SECTION: BUKTI AIR-GAPPED (AUDIT MANDIRI) */}
          <section className="max-w-5xl mx-auto px-6 pb-24">
            <div className="card-frame p-8 sm:p-10 rounded-xs bg-slate-950 text-white space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="max-w-xl space-y-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">Verifikasi Arsitektur</span>
                  <h3 className="text-2xl sm:text-3xl font-black">
                    Matikan koneksi internet, transkrip tetap berjalan.
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    Buka menu <code className="font-mono text-xs bg-slate-800 text-emerald-400 px-1 py-0.5 rounded-none">Inspect Element &gt; Network</code> di peramban Anda, aktifkan Mode Pesawat di perangkat, lalu jalankan audio. Hasil transkripsi tuntas dengan 0 panggilan API ke luar.
                  </p>
                </div>
                <button 
                  onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="px-6 py-3 rounded-xs bg-white hover:bg-slate-200 text-slate-950 font-bold text-xs transition shrink-0 cursor-pointer"
                >
                  Buka Studio Transkrip →
                </button>
              </div>
            </div>
          </section>

        </main>
      )}

      {/* ========================================================= */}
      {/* TAB 2: WORKSPACE STUDIO (TRANSCRIPT-FIRST WORKSTATION)     */}
      {/* ========================================================= */}
      {currentTab === 'workspace' && (
        <main className="flex-1 w-full pb-32 pt-4 px-2 sm:px-6">
          {/* Workstation Application Shell Frame matching Mockup */}
          <div className="max-w-7xl mx-auto bg-card border border-border/80 rounded-sm shadow-sm overflow-hidden flex flex-col">
            
            {/* Window Chrome Header Bar with orange/green dots & LOCAL RAM BUFFER */}
            <WorkspaceHeader
              activeSample={activeSample}
              activeKey={activeKey}
              onSelectSample={loadSample}
              onUploadClick={() => fileInputRef.current?.click()}
              onBackToLanding={() => {
                setCurrentTab('landing');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenWhisperDrawer={() => setIsWhisperDrawerOpen(true)}
              selectedModel={selectedModel}
              onCopyAll={copyFullTranscript}
              onExportWord={exportWordDoc}
              onExportTxt={exportTxt}
              onExportSrt={exportSrt}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              isSearching={isSearching}
              onToggleSearch={() => {
                setIsSearching(!isSearching);
                if (isSearching) setSearchQuery('');
              }}
            />

            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleCustomFileUpload}
              accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.ogg,.aac,.flac"
              className="hidden"
            />

            {/* Workstation 2-Column Core: Dominant Editor on Left, Contextual Panel on Right */}
            <div className="flex flex-col lg:flex-row flex-1 divide-y lg:divide-y-0 lg:divide-x divide-border/80 min-h-[580px]">
              
              {/* Dominant Transcript Editing Pane */}
              <div className="flex-1 min-w-0 bg-background overflow-y-auto">
                <ContinuousTranscriptEditor
                  segments={transcriptData}
                  speakerNames={speakerNames}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  onSeek={(sec) => {
                    setCurrentTime(sec);
                    setIsPlaying(true);
                  }}
                  onRenameSpeaker={handleRenameSpeaker}
                  onUpdateText={handleUpdateSegmentText}
                  searchQuery={searchQuery}
                  activeSpeakerFilter={activeSpeakerFilter}
                  viewMode={workspaceViewMode}
                  onReloadSample={() => loadSample('wawancara')}
                  onUploadClick={() => fileInputRef.current?.click()}
                />
              </div>

              {/* Narrow Contextual Utility Panel on the Right */}
              <ContextualUtilityPanel
                viewMode={workspaceViewMode}
                onChangeViewMode={setWorkspaceViewMode}
                selectedModel={selectedModel}
                onOpenWhisperDrawer={() => setIsWhisperDrawerOpen(true)}
                segments={transcriptData}
                speakerNames={speakerNames}
                activeSpeakerFilter={activeSpeakerFilter}
                onSelectSpeakerFilter={setActiveSpeakerFilter}
                onExportWord={exportWordDoc}
                onExportSrt={exportSrt}
                onExportTxt={exportTxt}
                onCopyAll={copyFullTranscript}
                currentTime={currentTime}
                duration={activeSample.duration}
                formatSeconds={formatSeconds}
              />

            </div>

          </div>

          {/* Persistent Bottom Audio Workstation Transport Dock */}
          <AudioDock
            currentTime={currentTime}
            duration={activeSample.duration}
            durationSec={activeSample.durationSec}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            onSeek={(sec) => {
              setCurrentTime(sec);
              setIsPlaying(true);
            }}
            onReset={() => {
              setCurrentTime(0);
              setIsPlaying(false);
            }}
            onChangeSpeed={(spd) => setPlaybackSpeed(spd)}
            waveformPeaks={WAVEFORM_PEAKS}
            formatSeconds={formatSeconds}
          />

          {/* Whisper Hardware Diagnostics Drawer */}
          <WhisperDrawer
            isOpen={isWhisperDrawerOpen}
            onClose={() => setIsWhisperDrawerOpen(false)}
            selectedModel={selectedModel}
            onSelectModel={(m) => setSelectedModel(m as any)}
            triggerToast={triggerToast}
          />
        </main>
      )}

      {/* ========================================================= */}
      {/* TAB 3: PRICING (STRATEGI MACWHISPER: LIFETIME & NO-SUB)   */}
      {/* ========================================================= */}
      {currentTab === 'pricing' && (
        <main className="flex-1 max-w-5xl mx-auto px-6 py-14 w-full">
          
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-blue-900 block">Harga Adil & Transparan</span>
            <h1 className="text-4xl font-black text-slate-950 tracking-tight">
              Satu harga, tanpa biaya langganan bulanan.
            </h1>
            <p className="text-sm text-slate-600">
              Kami tidak mengenakan biaya per menit audio karena Anda menggunakan daya komputasi perangkat Anda sendiri.
            </p>

            {/* Billing Toggle (Monthly vs Lifetime Deal) */}
            <div className="pt-4 flex items-center justify-center gap-3">
              <span className="text-xs font-semibold text-slate-600">Bulanan</span>
              <button 
                onClick={() => setIsLifetime(!isLifetime)}
                className={`w-11 h-6 rounded-full bg-slate-950 p-1 flex items-center transition cursor-pointer ${isLifetime ? 'justify-end' : 'justify-start'}`}
              >
                <span className="w-4 h-4 rounded-full bg-white"></span>
              </button>
              <span className="text-xs font-bold text-blue-950 bg-blue-100 px-2 py-0.5 rounded-xs border border-blue-200">
                Sekali Bayar (Lifetime) ✨ Paling Populer
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch mb-12">
            
            {/* Tier 1: Gratis */}
            <div className="card-frame p-7 rounded-xs flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs font-bold text-slate-500 uppercase">Personal & Mahasiswa</span>
                <div className="text-3xl font-black text-slate-950 mt-3 mb-1">Rp0</div>
                <p className="text-xs text-slate-500 mb-6">Gratis selamanya di peramban</p>
                <ul className="space-y-3 text-xs sm:text-sm text-slate-700">
                  <li>✓ Model Whisper Base Standar</li>
                  <li>✓ Durasi rekaman tanpa batas</li>
                  <li>✓ Ekspor teks polos (.txt) & subtitle (.srt)</li>
                  <li>✓ 100% Offline tanpa sambungan internet</li>
                </ul>
              </div>
              <button 
                onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="mt-8 w-full py-2.5 rounded-xs border border-slate-300 hover:border-slate-900 text-xs font-bold text-slate-950 transition cursor-pointer"
              >
                Mulai Gratis
              </button>
            </div>

            {/* Tier 2: Pro (Featured Card) */}
            <div className="card-frame p-7 rounded-xs border-2 border-slate-950 flex flex-col justify-between relative shadow-sm">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-xs bg-slate-950 text-white text-[10px] font-mono uppercase tracking-wider font-bold">
                Pilihan Utama
              </div>
              <div>
                <span className="font-mono text-xs font-bold text-blue-900 uppercase">Profesional & Jurnalis</span>
                <div className="text-3xl font-black text-slate-950 mt-3 mb-1">
                  {isLifetime ? 'Rp299.000' : 'Rp49.000 / bln'}
                </div>
                <p className="text-xs text-slate-500 mb-6">
                  {isLifetime ? 'Sekali bayar seumur hidup (Lifetime access)' : 'Ditagih bulanan, batalkan kapan saja'}
                </p>
                <ul className="space-y-3 text-xs sm:text-sm text-slate-900 font-medium">
                  <li>✓ Semua fitur paket Gratis</li>
                  <li>✓ <strong>Akses Model Presisi (Whisper Small & Medium)</strong></li>
                  <li>✓ Pemisahan pembicara otomatis (Diarization)</li>
                  <li>✓ <strong>Ekspor Risalah Word (.DOCX) Formal</strong></li>
                  <li>✓ Riwayat lokal tersimpan di akun peramban</li>
                </ul>
              </div>
              <button 
                onClick={() => triggerToast('Sistem pembayaran QRIS / Virtual Account siap diaktifkan!')}
                className="mt-8 w-full py-2.5 rounded-xs bg-slate-950 hover:bg-blue-900 text-white text-xs font-bold transition cursor-pointer"
              >
                Beli Lisensi Pro
              </button>
            </div>

            {/* Tier 3: Kantor & Instansi */}
            <div className="card-frame p-7 rounded-xs flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs font-bold text-slate-500 uppercase">Firma Hukum & Korporasi</span>
                <div className="text-3xl font-black text-slate-950 mt-3 mb-1">Rp2.500.000</div>
                <p className="text-xs text-slate-500 mb-6">Per tahun untuk seluruh domain kantor</p>
                <ul className="space-y-3 text-xs sm:text-sm text-slate-700">
                  <li>✓ Lisensi tak terbatas seluruh karyawan</li>
                  <li>✓ Paket intranet tertutup (Air-Gapped Intranet)</li>
                  <li>✓ Faktur Pajak resmi (PPN) & SPK pengadaan</li>
                  <li>✓ Perjanjian kerahasiaan bermaterai (NDA)</li>
                </ul>
              </div>
              <button 
                onClick={() => setIsAuthModalOpen(true)}
                className="mt-8 w-full py-2.5 rounded-xs border border-slate-300 hover:border-slate-900 text-xs font-bold text-slate-950 transition cursor-pointer"
              >
                Minta Penawaran Kantor
              </button>
            </div>

          </div>

          {/* Payment Trust & Guarantee */}
          <div className="text-center text-xs text-slate-500 space-y-1">
            <p>Mendukung pembayaran via QRIS, GoPay, OVO, Virtual Account BCA/Mandiri, dan Kartu Kredit.</p>
            <p className="font-mono">Garansi 14 Hari Uang Kembali Tanpa Syarat Berbelit.</p>
          </div>

        </main>
      )}

      {/* ========================================================= */}
      {/* TAB 4: FAQ (4 KATEGORI LENGKAP & DETAIL)                  */}
      {/* ========================================================= */}
      {currentTab === 'faq' && (
        <main className="flex-1 max-w-4xl mx-auto px-6 py-14 w-full space-y-10">
          
          <div>
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-blue-900 block mb-1">Dokumentasi & Jawaban</span>
            <h1 className="text-3xl sm:text-4xl font-black text-slate-950 tracking-tight">
              Pertanyaan yang Sering Diajukan
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Penjelasan transparan seputar arsitektur on-device, akun lokal, dan lisensi instansi.
            </p>
          </div>

          <div className="space-y-4">
            
            <div className="card-frame p-6 rounded-xs space-y-2">
              <h3 className="text-sm font-bold text-slate-950">
                01 / Bagaimana cara saya memverifikasi tidak ada audio yang keluar ke internet?
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Buka menu <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded-none">Inspect Element &gt; Network</code> di peramban Anda, lalu aktifkan Mode Pesawat atau matikan Wi-Fi laptop. Jalankan transkripsi berkas audio Anda. Proses tetap berlangsung sampai tuntas tanpa ada satu pun panggilan HTTP atau transfer data ke luar.
              </p>
            </div>

            <div className="card-frame p-6 rounded-xs space-y-2">
              <h3 className="text-sm font-bold text-slate-950">
                02 / Kenapa tidak ada batasan menit rekaman seperti layanan transkripsi cloud?
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Layanan cloud membebankan tarif langganan per menit karena mereka harus menyewa server GPU pusat data yang mahal. Di catetin, mesin Whisper berjalan langsung di atas chip prosesor dan grafis laptop Anda sendiri melalui WebGPU. Tidak ada server eksternal yang kami sewa, sehingga Anda bebas mentranskrip tanpa batas kuota durasi.
              </p>
            </div>

            <div className="card-frame p-6 rounded-xs space-y-2">
              <h3 className="text-sm font-bold text-slate-950">
                03 / Jika saya Sign In / membuat akun profil, apakah melanggar prinsip Zero-Cloud?
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Sama sekali tidak. Akun profil hanya digunakan untuk mencatat kepemilikan lisensi Pro Anda. Seluruh riwayat naskah transkripsi dan rekaman audio Anda tetap disimpan di database lokal browser (<code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded-none">IndexedDB</code>) di dalam memori perangkat Anda sendiri.
              </p>
            </div>

            <div className="card-frame p-6 rounded-xs space-y-2">
              <h3 className="text-sm font-bold text-slate-950">
                04 / Apakah instansi atau kantor kami bisa meminta Faktur Pajak resmi (PPN)?
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Ya. Untuk paket Lisensi Kantor & Korporasi, kami menerbitkan e-Faktur Pajak resmi (PPN), surat penawaran harga (SPH), dan perjanjian kepatuhan kerahasiaan bermaterai (NDA korporasi) sesuai nama instansi Anda.
              </p>
            </div>

          </div>

        </main>
      )}

      {/* ========================================================= */}
      {/* MODAL: SIGN IN / SIGN UP (LOCAL-FIRST TRANSPARENCY)       */}
      {/* ========================================================= */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay">
          <div className="card-frame rounded-xs max-w-sm w-full p-6 shadow-2xl space-y-4 bg-white animate-in fade-in duration-150">
            
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-blue-900">Profil Pengguna</span>
              <button 
                onClick={() => setIsAuthModalOpen(false)}
                className="text-slate-400 hover:text-slate-900 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-950">Masuk ke Profil</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Akses lisensi Pro dan kelola riwayat naskah transkrip lokal perangkat Anda.
              </p>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Email Anda</label>
                <input 
                  type="email" 
                  value={authInputEmail}
                  onChange={(e) => setAuthInputEmail(e.target.value)}
                  placeholder="nama@perusahaan.com" 
                  required
                  className="w-full px-3 py-2 rounded-none border border-slate-300 text-xs focus:outline-none focus:border-slate-900" 
                />
              </div>
              <button 
                type="submit"
                className="w-full py-2.5 rounded-none bg-slate-950 hover:bg-blue-900 text-white text-xs font-bold transition cursor-pointer"
              >
                Lanjutkan dengan Email
              </button>
            </form>

            <div className="p-2.5 rounded-none bg-slate-100 text-[11px] text-slate-600 leading-relaxed font-mono">
              🔒 <strong>Privasi:</strong> Akun ini tidak pernah menyalin rekaman suara Anda ke server luar. Riwayat tetap berada di memori browser ini.
            </div>

          </div>
        </div>
      )}

      {/* FOOTER */}
      {currentTab !== 'workspace' && (
        <footer className="border-t border-slate-200 bg-white py-10 px-6 mt-16 text-xs text-slate-500">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-950">catetin</span>
              <span>•</span>
              <span>On-Device Audio Transcription</span>
            </div>
            <div className="flex items-center gap-6 font-medium text-slate-600">
              <button onClick={() => { setCurrentTab('landing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-slate-950 transition cursor-pointer">Beranda</button>
              <button onClick={() => { setCurrentTab('workspace'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-slate-950 transition cursor-pointer">Studio</button>
              <button onClick={() => { setCurrentTab('pricing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-slate-950 transition cursor-pointer">Harga</button>
              <button onClick={() => { setCurrentTab('faq'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-slate-950 transition cursor-pointer">FAQ</button>
            </div>
            <div className="font-mono text-[11px]">
              © {new Date().getFullYear()} catetin · Zero-Cloud Architecture
            </div>
          </div>
        </footer>
      )}

    </div>
  );
}