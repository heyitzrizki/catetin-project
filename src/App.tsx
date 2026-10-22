import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileAudio, Info, Upload, X } from 'lucide-react';
import { LandingPage, questions } from '@/components/LandingPage';
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader';
import { ContinuousTranscriptEditor } from '@/components/workspace/ContinuousTranscriptEditor';
import { ContextualUtilityPanel } from '@/components/workspace/ContextualUtilityPanel';
import { AudioDock } from '@/components/workspace/AudioDock';
import { WhisperDrawer } from '@/components/workspace/WhisperDrawer';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { downloadTranscript, formatSeconds, recordings, transcriptText, type DialogSegment, type Recording } from '@/lib/transcript';

type InfoPage = 'about' | 'faq' | 'pricing' | null;

export default function App() {
  const [page, setPage] = useState<'landing' | 'studio'>(() => location.hash === '#studio' ? 'studio' : 'landing');
  const [availableRecordings, setAvailableRecordings] = useState(recordings);
  const [activeId, setActiveId] = useState(recordings[0].id);
  const [drafts, setDrafts] = useState<Record<string, DialogSegment[]>>({});
  const [speakerNamesByRecording, setSpeakerNames] = useState<Record<string, Record<string, string>>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'naskah' | 'waktu'>('naskah');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [audioSources, setAudioSources] = useState<Record<string, string>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'base' | 'tiny' | 'small'>('base');
  const [infoPage, setInfoPage] = useState<InfoPage>(null);
  const [toast, setToast] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const objectUrls = useRef<string[]>([]);
  const active = availableRecordings.find(item => item.id === activeId)!;
  const segments = drafts[activeId] ?? active.segments;
  const speakerNames = speakerNamesByRecording[activeId] ?? {};
  const audioSrc = audioSources[activeId];
  const isCustom = Boolean(audioSrc);

  useEffect(() => () => {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url));
    clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    const syncPage = () => setPage(location.hash === '#studio' ? 'studio' : 'landing');
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    document.title = page === 'studio' ? `${active.title} · Studio Catetin` : 'Catetin · Dari rekaman, jadi naskah yang rapi';
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }));
  }, [page, active.title]);

  useEffect(() => {
    if (!isPlaying || isCustom || page !== 'studio') return;
    const timer = window.setInterval(() => setCurrentTime(time => {
      if (time + playbackSpeed >= active.durationSec) { setIsPlaying(false); return active.durationSec; }
      return time + playbackSpeed;
    }), 1000);
    return () => clearInterval(timer);
  }, [isPlaying, isCustom, playbackSpeed, active.durationSec, page]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, audioSrc]);

  useEffect(() => {
    if (page === 'landing') { audioRef.current?.pause(); setIsPlaying(false); }
  }, [page]);

  useEffect(() => {
    if (!Object.keys(drafts).length && !Object.keys(speakerNamesByRecording).length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, speakerNamesByRecording]);

  const notify = (message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  };

  const loadRecording = (id: string) => {
    if (id === activeId) return;
    audioRef.current?.pause();
    setActiveId(id); setCurrentTime(0); setIsPlaying(false);
    setSearchQuery(''); setSpeakerFilter(null); setAudioError('');
    setAudioLoading(Boolean(audioSources[id]));
  };

  const openStudio = (sampleId?: string) => {
    if (sampleId) loadRecording(sampleId);
    setPage('studio');
    if (location.hash !== '#studio') location.hash = 'studio';
  };

  const goHome = () => { setPage('landing'); history.pushState(null, '', location.pathname + location.search); };

  const seek = (seconds: number) => {
    const time = Math.max(0, Math.min(seconds, active.durationSec));
    setCurrentTime(time);
    if (audioRef.current && isCustom) audioRef.current.currentTime = time;
  };

  const togglePlay = async () => {
    if (audioLoading || !active.durationSec) return;
    if (currentTime >= active.durationSec) seek(0);
    if (isCustom) {
      if (isPlaying) audioRef.current?.pause();
      else try { await audioRef.current?.play(); } catch { setAudioError('Rekaman tidak dapat diputar. Coba berkas MP3 atau WAV lain.'); }
    } else setIsPlaying(value => !value);
  };

  const updateText = (id: number, text: string) => setDrafts(previous => ({ ...previous, [activeId]: (previous[activeId] ?? active.segments).map(s => s.id === id ? { ...s, text } : s) }));
  const addSegment = () => {
    const lastTime = segments.at(-1)?.seconds ?? -1;
    const seconds = Math.floor(Math.max(currentTime, lastTime + 1));
    if (active.durationSec && seconds >= active.durationSec) { notify('Naskah sudah mencapai akhir rekaman. Sunting segmen yang ada.'); return; }
    const id = Math.max(0, ...segments.map(s => s.id)) + 1;
    setDrafts(previous => ({ ...previous, [activeId]: [...segments, { id, seconds, time: formatSeconds(seconds), speaker: 'Pembicara', text: '' }] }));
    requestAnimationFrame(() => {
      const fields = document.querySelectorAll<HTMLElement>('.segment-text');
      fields[fields.length - 1]?.focus();
    });
  };

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(transcriptText(segments, speakerNames)); notify('Naskah berhasil disalin.'); }
    catch { notify('Peramban tidak mengizinkan akses clipboard. Gunakan Ekspor teks polos untuk menyimpan naskah.'); }
  };

  const exportAs = (format: 'txt' | 'srt' | 'doc') => {
    if (!segments.length) return;
    downloadTranscript(format, active, segments, speakerNames);
    notify(`Naskah .${format} siap diunduh.`);
  };

  const chooseFile = (file?: File) => {
    setUploadError(''); setPendingFile(null);
    if (!file) return;
    if (!/\.(mp3|wav|m4a|mp4|ogg|aac|flac|webm)$/i.test(file.name) && !/^(audio|video)\//.test(file.type)) { setUploadError('Format belum didukung. Pilih audio atau video MP3, WAV, M4A, MP4, OGG, AAC, FLAC, atau WebM.'); return; }
    if (!file.size) { setUploadError('Berkas ini kosong. Pilih rekaman lain.'); return; }
    setPendingFile(file);
  };

  const importAudio = () => {
    if (!pendingFile) return;
    const id = `local-${Date.now()}`;
    const source = URL.createObjectURL(pendingFile);
    objectUrls.current.push(source);
    const recording: Recording = { id, title: pendingFile.name.replace(/\.[^.]+$/, ''), filename: pendingFile.name, category: 'Rekaman lokal', durationSec: 0, segments: [] };
    audioRef.current?.pause();
    setAvailableRecordings(previous => [...previous, recording]);
    setAudioSources(previous => ({ ...previous, [id]: source }));
    setActiveId(id); setCurrentTime(0); setIsPlaying(false); setAudioLoading(true); setAudioError('');
    setSearchQuery(''); setSpeakerFilter(null); setUploadOpen(false); setPendingFile(null);
    openStudio();
  };

  const exportActions = { onExportWord: () => exportAs('doc'), onExportTxt: () => exportAs('txt'), onExportSrt: () => exportAs('srt'), onCopyAll: copyAll };
  const utilityProps = { ...exportActions, viewMode, onChangeViewMode: setViewMode, segments, speakerNames, activeSpeakerFilter: speakerFilter, onSelectSpeakerFilter: setSpeakerFilter, selectedModel, onOpenWhisperDrawer: () => setModelOpen(true) };

  return <div className={`app-shell ${page === 'studio' ? 'studio-shell' : ''}`}>
    <a className="skip-link" href="#main-content">Langsung ke konten</a>
    <header className="site-header"><div className="page-container header-inner"><button className="brand" aria-label="Catetin, beranda" onClick={goHome}><span className="brand-symbol">c.</span><span>catetin</span></button>
      {page === 'landing' ? <nav aria-label="Navigasi utama" className="site-nav"><a href="#cara-kerja" className="nav-how">Cara kerja</a><button onClick={() => setInfoPage('about')}>Tentang</button><Button onClick={() => openStudio()}>Buka Studio <ArrowRight aria-hidden="true" /></Button></nav> : <div className="studio-nav"><span>Studio transkrip</span><Button variant="ghost" onClick={goHome}><ArrowLeft aria-hidden="true" />Beranda</Button></div>}
    </div></header>

    {page === 'landing' ? <LandingPage onOpenStudio={openStudio} /> : <main id="main-content" className="workspace-main" tabIndex={-1}>
      <div className="studio-title-row"><p className="eyebrow">Ruang untuk setiap cerita</p><span>{isCustom ? 'Naskah manual' : 'Demo editor'}</span></div>
      <WorkspaceHeader activeSample={active} availableRecordings={availableRecordings} onSelectSample={loadRecording} onUploadClick={() => { setPendingFile(null); setUploadError(''); setUploadOpen(true); }} searchQuery={searchQuery} onSearchChange={setSearchQuery} onOpenTools={() => setToolsOpen(true)} isCustom={isCustom} canExport={segments.length > 0} {...exportActions} />
      {audioError && <div className="audio-error" role="alert"><Info aria-hidden="true" /><p>{audioError} Anda tetap dapat menulis naskah secara manual.</p><Button variant="ghost" onClick={() => setUploadOpen(true)}>Pilih berkas lain</Button></div>}
      <div className="workspace-body"><ContinuousTranscriptEditor key={active.id} segments={segments} speakerNames={speakerNames} currentTime={currentTime} onSeek={seek} onRenameSpeaker={(oldName, newName) => { setSpeakerNames(previous => ({ ...previous, [activeId]: { ...previous[activeId], [oldName]: newName } })); notify('Nama pembicara diperbarui di seluruh naskah.'); }} onUpdateText={updateText} searchQuery={searchQuery} activeSpeakerFilter={speakerFilter} viewMode={viewMode} onClearFilters={() => { setSearchQuery(''); setSpeakerFilter(null); }} onAddSegment={addSegment} isCustom={isCustom} /><aside className="desktop-utilities" aria-label="Alat naskah"><ContextualUtilityPanel {...utilityProps} /></aside></div>
      <AudioDock currentTime={currentTime} durationSec={active.durationSec} isPlaying={isPlaying} playbackSpeed={playbackSpeed} onTogglePlay={togglePlay} onSeek={seek} onReset={() => { seek(0); audioRef.current?.pause(); setIsPlaying(false); }} onChangeSpeed={setPlaybackSpeed} isDemo={!isCustom} isLoading={audioLoading} />
      <p className="studio-footnote">{isCustom ? 'Rekaman dibuka di peramban Anda. Tulis naskah secara manual sambil mendengarkan.' : 'Naskah contoh ditulis untuk demo. Pemutar hanya menyimulasikan waktu, tanpa suara.'}</p>
    </main>}

    {page === 'landing' && <footer className="site-footer page-container"><div><span className="footer-brand">catetin</span><p>Ruang untuk setiap cerita.</p></div><nav aria-label="Navigasi footer"><button onClick={() => setInfoPage('about')}>Tentang</button><a href="#pertanyaan">Pertanyaan</a><button onClick={() => setInfoPage('pricing')}>Harga & lisensi</button></nav><span>© {new Date().getFullYear()} Catetin</span></footer>}

    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogContent><DialogHeader><DialogTitle>Buka rekaman Anda</DialogTitle><DialogDescription>Dengarkan audio sambil menulis dan merapikan naskah.</DialogDescription></DialogHeader><div className="info-notice"><Info aria-hidden="true" /><p>Transkripsi otomatis belum tersedia. Rekaman akan dibuka dengan naskah kosong untuk disunting manual.</p></div><label className={`file-picker ${pendingFile ? 'file-picked' : ''}`}><FileAudio aria-hidden="true" /><strong>{pendingFile ? pendingFile.name : 'Pilih berkas audio atau video'}</strong><span>{pendingFile ? `${(pendingFile.size / 1024 / 1024).toFixed(1)} MB · Klik untuk mengganti` : 'MP3, WAV, M4A, MP4, dan format audio lainnya'}</span><input type="file" aria-label="Pilih berkas rekaman" accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.ogg,.aac,.flac,.webm" onChange={event => chooseFile(event.target.files?.[0])} /></label>{uploadError && <p className="form-error" role="alert">{uploadError}</p>}<p className="text-sm text-muted-foreground leading-relaxed">Aplikasi tidak mengunggah berkas ini ke server. Ekspor naskah sebelum menutup tab.</p><Button disabled={!pendingFile} onClick={importAudio}><Upload aria-hidden="true" />Buka rekaman</Button></DialogContent></Dialog>

    <Dialog open={toolsOpen} onOpenChange={setToolsOpen}><DialogContent className="tools-dialog"><DialogHeader><DialogTitle>Alat naskah</DialogTitle><DialogDescription>Atur tampilan, pilih pembicara, dan ekspor naskah.</DialogDescription></DialogHeader><ContextualUtilityPanel {...utilityProps} /></DialogContent></Dialog>
    <WhisperDrawer isOpen={modelOpen} onClose={() => setModelOpen(false)} selectedModel={selectedModel} onSelectModel={setSelectedModel} />

    <Dialog open={infoPage !== null} onOpenChange={open => { if (!open) setInfoPage(null); }}><DialogContent><DialogHeader><DialogTitle>{infoPage === 'about' ? 'Setiap cerita layak dicatat.' : infoPage === 'pricing' ? 'Harga & lisensi' : 'Pertanyaan tentang Catetin'}</DialogTitle><DialogDescription>{infoPage === 'about' ? 'Catetin adalah ruang kerja untuk membaca, menyunting, dan menyiapkan naskah percakapan.' : infoPage === 'pricing' ? 'Demo editor ini dapat dicoba tanpa akun atau pembayaran.' : 'Yang perlu diketahui sebelum mulai.'}</DialogDescription></DialogHeader>{infoPage === 'about' ? <div className="about-copy"><p>Kami ingin membuat proses dari rekaman menuju naskah terasa lebih tenang. Mulai dari membaca percakapan, mengenali pembicara, hingga merapikan kalimat.</p><p>Saat ini Anda bisa mencoba editor dengan contoh naskah, membuka audio sendiri untuk dicatat manual, dan mengekspor hasilnya. Transkripsi otomatis masih dikembangkan.</p><Button onClick={() => { setInfoPage(null); openStudio(); }}>Coba Studio <ArrowRight aria-hidden="true" /></Button></div> : infoPage === 'pricing' ? <div className="about-copy"><p>Paket berbayar dan pembelian lisensi belum tersedia. Fitur yang masih dikembangkan tidak dikenakan biaya dalam demo ini.</p><Button onClick={() => { setInfoPage(null); openStudio(); }}>Buka Studio <ArrowRight aria-hidden="true" /></Button></div> : <Accordion type="single" collapsible>{questions.map(([question, answer], index) => <AccordionItem key={question} value={String(index)}><AccordionTrigger>{question}</AccordionTrigger><AccordionContent>{answer}</AccordionContent></AccordionItem>)}</Accordion>}</DialogContent></Dialog>

    <audio ref={audioRef} src={audioSrc} preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) setAvailableRecordings(previous => previous.map(item => item.id === activeId ? { ...item, durationSec: duration } : item)); setAudioLoading(false); }} onCanPlay={() => setAudioLoading(false)} onTimeUpdate={event => { if (audioSrc) setCurrentTime(event.currentTarget.currentTime); }} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onError={() => { if (audioSrc) { setAudioLoading(false); setIsPlaying(false); setAudioError('Format rekaman ini tidak dapat dibaca oleh peramban.'); } }} />
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{toast && <div className="app-toast"><Check className="size-4" aria-hidden="true" /><p>{toast}</p><button onClick={() => setToast('')} aria-label="Tutup pemberitahuan"><X className="size-4" aria-hidden="true" /></button></div>}</div>
  </div>;
}
