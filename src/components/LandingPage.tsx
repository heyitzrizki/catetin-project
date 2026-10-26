import { t, useLanguage } from '@/lib/i18n';
import { useState } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import { ArrowRight, FileAudio, FileText, Headphones, Download, Play, PencilLine, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { recordings } from '@/lib/transcript';
import { ComparisonSection } from '@/components/landing/ComparisonSection';
import { ClosingCTA } from '@/components/landing/ClosingCTA';

interface LandingPageProps { onOpenStudio: (sampleId?: string) => void; onOpenRecording: () => void; }
export const questions = [
 ['Apakah Catetin sudah bisa mentranskrip otomatis?', 'Ya. Catetin menjalankan Whisper langsung di perangkatmu. Model perlu diunduh saat pertama kali digunakan, tetapi audio tidak dikirim ke layanan transkripsi.'],
 ['Apakah rekaman saya dikirim ke server?', 'Tidak. Audio diputar dan diproses langsung di browser. Koneksi internet hanya diperlukan untuk membuka aplikasi dan mengunduh model pertama kali.'],
 ['Apakah naskah saya akan tersimpan?', 'Ya. Rekaman, naskah, dan nama pembicara disimpan di penyimpanan browser pada perangkatmu. Data dapat hilang jika penyimpanan situs dibersihkan, jadi tetap ekspor hasil penting.'],
 ['Format apa yang bisa saya ekspor?', 'Teks polos (.txt), subtitle bertimestamp (.srt), dan dokumen kompatibel Word (.doc). Format .doc ini bukan berkas .docx.'],
 ['Apa yang terjadi saat saya membuka rekaman sendiri?', 'Rekaman dibuka di pemutar lokal. Kamu dapat menjalankan transkripsi Whisper dari menu Model & perangkat, atau menulis naskah secara manual.'],
];
const stages = [
 {title:'Dengarkan rekaman',body:'Buka audio milikmu, cari posisi percakapan, dan sesuaikan kecepatan pemutaran. Berkas tetap dibuka lokal di browser.',label:'01 / DENGARKAN',headline:'Tetap dengar konteksnya.'},
 {title:'Sunting naskah',body:'Tulis atau rapikan kalimat langsung di editor. Ganti nama pembicara dan gunakan pencarian untuk menemukan kata dalam naskah.',label:'02 / SUNTING',headline:'Beri setiap suara tempatnya.'},
 {title:'Ekspor hasilnya',body:'Salin seluruh naskah, atau unduh sebagai TXT, SRT, dan dokumen kompatibel Word. Kamu yang menentukan kapan hasilnya dibagikan.',label:'03 / EKSPOR',headline:'Siap untuk pekerjaan berikutnya.'},
];
function Waveform() { return <div className="lp-wave" aria-hidden="true">{Array.from({length:70},(_,i)=><i key={i} style={{height:`${8+((i*17+i*i*3)%29)}px`}} />)}</div>; }
export function LandingPage({onOpenStudio,onOpenRecording}:LandingPageProps) {
 useLanguage();
 const reduceMotion=useReducedMotion();
 const entrance={initial:{opacity:reduceMotion?1:0,y:reduceMotion?0:14},animate:{opacity:1,y:0},transition:{duration:reduceMotion?0:0.4}};
 const [stage,setStage]=useState(0);
 const [sample,setSample]=useState(recordings[0].id);
 const example=recordings.find(r=>r.id===sample)!;
 return <LazyMotion features={domAnimation}><main id="main-content" className="lp" tabIndex={-1}>
  <section className="lp-hero lp-hero-fullbleed" aria-labelledby="hero-title">
   <div className="lp-hero-inner">
    <div className="lp-hero-copy">
     <h1 id="hero-title">{t("Dengarkan rekamannya.")}<br/>{t("Rapikan naskahnya.")}</h1>
     <p className="lp-fine">{t("Audio tetap di perangkatmu. Transkripsi Whisper berjalan langsung di browser.")}</p>
     <div className="lp-actions"><Button size="lg" onClick={()=>onOpenStudio(recordings[0].id)}>{t("Coba contoh")}</Button><Button size="lg" variant="outline" onClick={onOpenRecording}>{t("Buka rekaman")}</Button></div>
    </div>
    <figure className="hero-notebook-image">
     <button type="button" onClick={()=>onOpenStudio(recordings[0].id)} aria-label={t("Buka contoh naskah di Studio Catetin")}>
      <img src="/illustrations/hero-centered-niche-transparent.png" alt={t("Mockup ilustratif Catetin di laptop, menampilkan contoh naskah percakapan")} width="1812" height="868" fetchPriority="high" decoding="async"/>
     </button>
     <figcaption className="sr-only">{t("Pratinjau ilustratif editor Catetin. Coba fitur yang tersedia di Studio.")}</figcaption>
    </figure>
   </div>
  </section>
  <section className="lp-workflow" id="cara-kerja"><div className="page-container lp-split">
   <m.div key={stage} {...entrance} className="lp-stage-visual" aria-live="polite"><span className="lp-ui-heading">{t(stages[stage].label)}</span>{stage===0?<><div className="lp-file-art"><FileAudio size={30}/><div><b>{t("Rekaman pilihanmu")}</b><p>{t("Dibuka dari perangkat")}</p></div></div><Waveform/><div className="lp-art-caption"><Headphones size={18}/>{t("Dengar ulang, dengan kecepatanmu.")}</div></>:stage===1?<><div lang="id" className="lp-art-time">00:24 <b>Raka</b></div><p lang="id" className="lp-art-quote">Mulainya sederhana. Kami bertemu tiap Sabtu, <mark>berbagi cerita</mark>, lalu menyusun kegiatan bersama.</p><div className="lp-art-caption"><PencilLine size={18}/>{t("Sunting langsung di naskah.")}</div></>:<><h3>{t("Naskah siap dibawa.")}</h3><div className="lp-export-art">{['.txt','.srt','.doc'].map(f=><span key={f}><FileText size={24}/>{f}</span>)}</div><div className="lp-art-caption"><Download size={18}/>{t("Pilih format saat mengekspor di Studio.")}</div></>}</m.div>
   <div className="lp-stage-copy"><p className="eyebrow">{t("DARI REKAMAN KE NASKAH")}</p><h2>{t(stages[stage].headline)}</h2><div className="lp-stage-list">{stages.map((s,i)=><div key={t(s.title)}><button aria-expanded={stage===i} aria-controls={`stage-${i}`} onClick={()=>setStage(i)}><span>0{i+1}</span>{t(s.title)}<ChevronRight size={17}/></button><p id={`stage-${i}`} hidden={stage!==i}>{t(s.body)}</p></div>)}</div><button className="lp-light-link" onClick={()=>onOpenStudio()}>{t("Coba di Studio")} <ArrowRight size={16}/></button></div>
  </div></section>
  <section className="lp-trust" id="privasi"><div className="page-container"><div className="lp-trust-heading"><div><p className="eyebrow">{t("LOKAL, DENGAN BATAS YANG JELAS")}</p><h2>{t("Rekamanmu tetap")}<br/>{t("di perangkatmu.")}</h2><p className="lp-section-intro">{t("Kepercayaan dimulai dari tahu ke mana berkasmu pergi.")}<br/>{t("Ini cara editor Catetin bekerja saat ini.")}</p></div><figure className="lp-privacy-illustration" aria-hidden="true"><img src="/illustrations/trust-shield.svg" alt="" width="720" height="520" loading="lazy" decoding="async"/></figure></div><div className="lp-trust-grid">
   <article><span className="lp-trust-index">01</span><h3>{t("Audio tanpa upload")}</h3><p>{t("Berkas pilihanmu dibuka melalui pemutar lokal. Aplikasi tidak mengunggah audio itu ke server.")}</p></article>
   <article><span className="lp-trust-index">02</span><h3>{t("Kamu memilih yang dibagikan")}</h3><p>{t("Sunting dan ekspor naskah sesuai kebutuhan. Editor tidak memiliki fitur berbagi atau sinkronisasi cloud.")}</p></article>
   <article><span className="lp-trust-index">03</span><h3>{t("Draf tersimpan di perangkat")}</h3><p>{t("Rekaman dan naskah disimpan di penyimpanan browser, tanpa akun atau sinkronisasi cloud.")}</p></article>
  </div><p className="lp-trust-note">{t("Aplikasi dan font dapat digunakan kembali dari cache. Unduhan awal aplikasi dan model Whisper tetap memerlukan koneksi internet.")}</p></div></section>
  <ComparisonSection />

<section className="lp-examples page-container" id="contoh"><div className="lp-section-head"><div><p className="eyebrow">{t("COBA DENGAN CONTOH")}</p><h2>{t("Satu Studio.")}<br/>{t("Beragam percakapan.")}</h2></div><div className="example-choices" role="group" aria-label={t("Jenis contoh")}>{recordings.map(r=><button key={r.id} aria-pressed={sample===r.id} onClick={()=>setSample(r.id)}>{t(r.category)}</button>)}</div></div><p className="sample-language-note">{t("Sample language note")}</p><m.div key={sample} {...entrance} className="lp-example-paper" aria-live="polite"><header><span className="sample-label">{t("Contoh")}</span><h3>{t(example.title)}</h3><Button variant="outline" onClick={()=>onOpenStudio(sample)}>{t("Buka contoh di Studio")}</Button></header>{example.segments.slice(0,3).map(s=><div lang="id" className="lp-example-line" key={s.id}><time>{s.time}</time><b>{s.speaker}</b><p>{s.text}</p></div>)}</m.div></section>
  <section className="faq-section page-container" id="pertanyaan"><div className="section-heading"><p className="eyebrow">{t("PERTANYAAN UMUM")}</p><h2>{t("Sebelum mulai.")}</h2><p>{t("Yang sudah bisa dicoba, dan yang masih kami kerjakan.")}</p></div><Accordion type="single" collapsible className="faq-list">{questions.map(([q,a],i)=><AccordionItem key={t(q)} value={`q-${i}`}><AccordionTrigger>{t(q)}</AccordionTrigger><AccordionContent>{t(a)}</AccordionContent></AccordionItem>)}</Accordion></section>
  <ClosingCTA recording={example} onOpenStudio={onOpenStudio} />
 </main></LazyMotion>;
}
