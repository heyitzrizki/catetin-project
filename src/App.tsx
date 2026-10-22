import { LanguageSelect } from '@/components/LanguageSelect';
import { t, useLanguage } from '@/lib/i18n';
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
  const language = useLanguage();
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
    document.title = page === 'studio' ? `${t(active.title)} · Catetin Studio` : t('Page title');
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }));
  }, [page, active.title]);

  useEffect(() => { document.title = page === "studio" ? `${t(active.title)} · Catetin Studio` : t("Page title"); }, [language, page, active.title]);

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
      else try { await audioRef.current?.play(); } catch { setAudioError(t("Rekaman tidak dapat diputar. Coba berkas MP3 atau WAV lain.")); }
    } else setIsPlaying(value => !value);
  };

  const updateText = (id: number, text: string) => setDrafts(previous => ({ ...previous, [activeId]: (previous[activeId] ?? active.segments).map(s => s.id === id ? { ...s, text } : s) }));
  const addSegment = () => {
    const lastTime = segments.at(-1)?.seconds ?? -1;
    const seconds = Math.floor(Math.max(currentTime, lastTime + 1));
    if (active.durationSec && seconds >= active.durationSec) { notify(t("Naskah sudah mencapai akhir rekaman. Sunting segmen yang ada.")); return; }
    const id = Math.max(0, ...segments.map(s => s.id)) + 1;
    setDrafts(previous => ({ ...previous, [activeId]: [...segments, { id, seconds, time: formatSeconds(seconds), speaker: 'Pembicara', text: '' }] }));
    requestAnimationFrame(() => {
      const fields = document.querySelectorAll<HTMLElement>('.segment-text');
      fields[fields.length - 1]?.focus();
    });
  };

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(transcriptText(segments, speakerNames)); notify(t("Naskah berhasil disalin.")); }
    catch { notify(t("Peramban tidak mengizinkan akses clipboard. Gunakan Ekspor teks polos untuk menyimpan naskah.")); }
  };

  const exportAs = (format: 'txt' | 'srt' | 'doc') => {
    if (!segments.length) return;
    downloadTranscript(format, active, segments, speakerNames);
    notify(t('Export ready', {format}));
  };

  const chooseFile = (file?: File) => {
    setUploadError(''); setPendingFile(null);
    if (!file) return;
    if (!/\.(mp3|wav|m4a|mp4|ogg|aac|flac|webm)$/i.test(file.name) && !/^(audio|video)\//.test(file.type)) { setUploadError(t("Format belum didukung. Pilih audio atau video MP3, WAV, M4A, MP4, OGG, AAC, FLAC, atau WebM.")); return; }
    if (!file.size) { setUploadError(t("Berkas ini kosong. Pilih rekaman lain.")); return; }
    setPendingFile(file);
  };

  const importAudio = () => {
    if (!pendingFile) return;
    const id = `local-${Date.now()}`;
    const source = URL.createObjectURL(pendingFile);
    objectUrls.current.push(source);
    const recording: Recording = { id, title: pendingFile.name.replace(/\.[^.]+$/, ''), filename: pendingFile.name, category: t("Rekaman lokal"), durationSec: 0, segments: [] };
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
    <a className="skip-link" href="#main-content">{t("Langsung ke konten")}</a>
    <header className="site-header"><div className="page-container header-inner"><button className="brand" aria-label={t("Catetin, beranda")} onClick={goHome}><span className="brand-symbol">c.</span><span>catetin</span></button>
      {page === 'landing' ? <nav aria-label={t("Navigasi utama")} className="site-nav"><a href="#cara-kerja" className="nav-how">{t("Cara kerja")}</a><a href="#privasi" className="nav-privacy">{t("Privasi")}</a><a href="#contoh" className="nav-examples">{t("Contoh")}</a><button onClick={() => setInfoPage('about')}>{t("Tentang")}</button><Button onClick={() => openStudio()}>{t("Buka Studio")} <ArrowRight aria-hidden="true" /></Button></nav> : <div className="studio-nav"><span>{t("Studio transkrip")}</span><Button variant="ghost" onClick={goHome}><ArrowLeft aria-hidden="true" />{t("Beranda")}</Button></div>}
      <LanguageSelect />
    </div></header>

    {page === 'landing' ? <LandingPage onOpenStudio={openStudio} onOpenRecording={() => { setPendingFile(null); setUploadError(''); setUploadOpen(true); }} /> : <main id="main-content" className="workspace-main" tabIndex={-1}>
      <div className="studio-frame"><aside className="recording-sidebar" aria-label={t("Rekaman dalam sesi")}><div className="sidebar-heading"><span>{t("STUDIO CATETIN")}</span><h2>{t("Ruang rekamanmu.")}</h2></div><Button variant="outline" onClick={() => { setPendingFile(null); setUploadError(''); setUploadOpen(true); }}><Upload aria-hidden="true" />{t("Buka rekaman")}</Button><p className="sidebar-label">{t("NASKAH DALAM SESI")}</p><div className="recording-list">{availableRecordings.map(item => <button key={item.id} aria-current={activeId === item.id ? 'true' : undefined} onClick={() => loadRecording(item.id)}><FileAudio aria-hidden="true" /><span>{t(item.title)}<small>{audioSources[item.id] ? t("Rekaman lokal") : t("Contoh naskah")}</small></span></button>)}</div><div className="sidebar-local"><Info aria-hidden="true" /><p>{t("Audio dibuka lokal.")}<br/>{t("Ekspor naskah sebelum menutup tab.")}</p></div></aside><div className="studio-content"><div className="studio-title-row"><p className="eyebrow">{t("Ruang untuk setiap cerita")}</p><span>{isCustom ? t("Naskah manual") : t("Demo editor")}</span></div>
      <WorkspaceHeader activeSample={active} availableRecordings={availableRecordings} onSelectSample={loadRecording} onUploadClick={() => { setPendingFile(null); setUploadError(''); setUploadOpen(true); }} searchQuery={searchQuery} onSearchChange={setSearchQuery} onOpenTools={() => setToolsOpen(true)} isCustom={isCustom} canExport={segments.length > 0} {...exportActions} />
      {audioError && <div className="audio-error" role="alert"><Info aria-hidden="true" /><p>{t(audioError)}{t(" Anda tetap dapat menulis naskah secara manual.")}</p><Button variant="ghost" onClick={() => setUploadOpen(true)}>{t("Pilih berkas lain")}</Button></div>}
      <div className="workspace-body"><ContinuousTranscriptEditor key={active.id} segments={segments} speakerNames={speakerNames} currentTime={currentTime} onSeek={seek} onRenameSpeaker={(oldName, newName) => { setSpeakerNames(previous => ({ ...previous, [activeId]: { ...previous[activeId], [oldName]: newName } })); notify(t("Nama pembicara diperbarui di seluruh naskah.")); }} onUpdateText={updateText} searchQuery={searchQuery} activeSpeakerFilter={speakerFilter} viewMode={viewMode} onClearFilters={() => { setSearchQuery(''); setSpeakerFilter(null); }} onAddSegment={addSegment} isCustom={isCustom} /><aside className="desktop-utilities" aria-label={t("Alat naskah")}><ContextualUtilityPanel {...utilityProps} /></aside></div>
      <AudioDock currentTime={currentTime} durationSec={active.durationSec} isPlaying={isPlaying} playbackSpeed={playbackSpeed} onTogglePlay={togglePlay} onSeek={seek} onReset={() => { seek(0); audioRef.current?.pause(); setIsPlaying(false); }} onChangeSpeed={setPlaybackSpeed} isDemo={!isCustom} isLoading={audioLoading} />
      <p className="studio-footnote">{isCustom ? t("Rekaman dibuka di peramban Anda. Tulis naskah secara manual sambil mendengarkan.") : t("Naskah contoh ditulis untuk demo. Pemutar hanya menyimulasikan waktu, tanpa suara.")}</p></div></div>
    </main>}

    {page === 'landing' && <footer className="site-footer page-container"><div><span className="footer-brand">catetin</span><p>{t("Ruang untuk setiap cerita.")}</p></div><nav aria-label={t("Navigasi footer")}><button onClick={() => setInfoPage('about')}>{t("Tentang")}</button><a href="#pertanyaan">{t("Pertanyaan")}</a><button onClick={() => setInfoPage('pricing')}>{t("Harga & lisensi")}</button></nav><span>© {new Date().getFullYear()} Catetin</span></footer>}

    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogContent><DialogHeader><DialogTitle>{t("Buka rekaman Anda")}</DialogTitle><DialogDescription>{t("Dengarkan audio sambil menulis dan merapikan naskah.")}</DialogDescription></DialogHeader><div className="info-notice"><Info aria-hidden="true" /><p>{t("Transkripsi otomatis belum tersedia. Rekaman akan dibuka dengan naskah kosong untuk disunting manual.")}</p></div><label className={`file-picker ${pendingFile ? 'file-picked' : ''}`}><FileAudio aria-hidden="true" /><strong>{pendingFile ? pendingFile.name : t("Pilih berkas audio atau video")}</strong><span>{pendingFile ? `${(pendingFile.size / 1024 / 1024).toFixed(1)} MB · ${t('Replace file')}` : t("MP3, WAV, M4A, MP4, dan format audio lainnya")}</span><input type="file" aria-label={t("Pilih berkas rekaman")} accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.ogg,.aac,.flac,.webm" onChange={event => chooseFile(event.target.files?.[0])} /></label>{uploadError && <p className="form-error" role="alert">{t(uploadError)}</p>}<p className="text-sm text-muted-foreground leading-relaxed">{t("Aplikasi tidak mengunggah berkas ini ke server. Ekspor naskah sebelum menutup tab.")}</p><Button disabled={!pendingFile} onClick={importAudio}><Upload aria-hidden="true" />{t("Buka rekaman")}</Button></DialogContent></Dialog>

    <Dialog open={toolsOpen} onOpenChange={setToolsOpen}><DialogContent className="tools-dialog"><DialogHeader><DialogTitle>{t("Alat naskah")}</DialogTitle><DialogDescription>{t("Atur tampilan, pilih pembicara, dan ekspor naskah.")}</DialogDescription></DialogHeader><ContextualUtilityPanel {...utilityProps} /></DialogContent></Dialog>
    <WhisperDrawer isOpen={modelOpen} onClose={() => setModelOpen(false)} selectedModel={selectedModel} onSelectModel={setSelectedModel} />

    <Dialog open={infoPage !== null} onOpenChange={open => { if (!open) setInfoPage(null); }}><DialogContent><DialogHeader><DialogTitle>{infoPage === 'about' ? t("Setiap cerita layak dicatat.") : infoPage === 'pricing' ? t("Harga & lisensi") : t("Pertanyaan tentang Catetin")}</DialogTitle><DialogDescription>{infoPage === 'about' ? t("Catetin adalah ruang kerja untuk membaca, menyunting, dan menyiapkan naskah percakapan.") : infoPage === 'pricing' ? t("Demo editor ini dapat dicoba tanpa akun atau pembayaran.") : t("Yang perlu diketahui sebelum mulai.")}</DialogDescription></DialogHeader>{infoPage === 'about' ? <div className="about-copy"><p>{t("Kami ingin membuat proses dari rekaman menuju naskah terasa lebih tenang. Mulai dari membaca percakapan, mengenali pembicara, hingga merapikan kalimat.")}</p><p>{t("Saat ini Anda bisa mencoba editor dengan contoh naskah, membuka audio sendiri untuk dicatat manual, dan mengekspor hasilnya. Transkripsi otomatis masih dikembangkan.")}</p><Button onClick={() => { setInfoPage(null); openStudio(); }}>{t("Coba Studio")} <ArrowRight aria-hidden="true" /></Button></div> : infoPage === 'pricing' ? <div className="about-copy"><p>{t("Paket berbayar dan pembelian lisensi belum tersedia. Fitur yang masih dikembangkan tidak dikenakan biaya dalam demo ini.")}</p><Button onClick={() => { setInfoPage(null); openStudio(); }}>{t("Buka Studio")} <ArrowRight aria-hidden="true" /></Button></div> : <Accordion type="single" collapsible>{questions.map(([question, answer], index) => <AccordionItem key={t(question)} value={String(index)}><AccordionTrigger>{t(question)}</AccordionTrigger><AccordionContent>{t(answer)}</AccordionContent></AccordionItem>)}</Accordion>}</DialogContent></Dialog>

    <audio ref={audioRef} src={audioSrc} preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) setAvailableRecordings(previous => previous.map(item => item.id === activeId ? { ...item, durationSec: duration } : item)); setAudioLoading(false); }} onCanPlay={() => setAudioLoading(false)} onTimeUpdate={event => { if (audioSrc) setCurrentTime(event.currentTarget.currentTime); }} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onError={() => { if (audioSrc) { setAudioLoading(false); setIsPlaying(false); setAudioError(t("Format rekaman ini tidak dapat dibaca oleh peramban.")); } }} />
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{toast && <div className="app-toast"><Check className="size-4" aria-hidden="true" /><p>{t(toast)}</p><button onClick={() => setToast('')} aria-label={t("Tutup pemberitahuan")}><X className="size-4" aria-hidden="true" /></button></div>}</div>
  </div>;
}
