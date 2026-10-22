import { useState } from 'react';
import { ArrowDown, ArrowRight, FileText, Headphones, PencilLine, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { recordings } from '@/lib/transcript';

interface LandingPageProps {
  onOpenStudio: (sampleId?: string) => void;
}

export const questions = [
  ['Apakah Catetin sudah bisa mentranskrip audio otomatis?', 'Belum. Versi ini adalah demo editor. Anda dapat menyunting contoh transkrip, memutar berkas audio pilihan Anda, dan menulis naskah secara manual. Integrasi transkripsi otomatis masih dikembangkan.'],
  ['Apakah saya perlu membuat akun?', 'Tidak. Anda bisa langsung membuka Studio. Perubahan naskah hanya disimpan selama tab ini terbuka. Ekspor naskah sebelum memuat ulang atau meninggalkan halaman.'],
  ['Format apa yang bisa saya ekspor?', 'Teks polos (.txt), subtitle (.srt), dan dokumen kompatibel Word (.doc). Untuk berkas milik sendiri, Anda dapat menambahkan segmen dan penanda waktu secara manual.'],
  ['Apa yang terjadi saat saya memilih rekaman sendiri?', 'Berkas dibuka melalui pemutar lokal di peramban ini dan tidak dikirim ke server oleh aplikasi. Naskah dimulai dari halaman kosong. Dukungan format pemutaran mengikuti kemampuan peramban Anda.'],
];

export function LandingPage({ onOpenStudio }: LandingPageProps) {
  const [selectedExample, setSelectedExample] = useState(recordings[0].id);
  const example = recordings.find(item => item.id === selectedExample)!;

  return (
    <main id="main-content" className="landing-main" tabIndex={-1}>
      <section className="editorial-hero page-container" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Ruang kerja transkrip</p>
          <h1 id="hero-title">Dari rekaman,<br className="hidden sm:block" /> jadi naskah<br className="hidden xl:block" /> yang rapi.</h1>
          <p className="hero-description">Baca dan rapikan percakapan, temukan bagian penting, lalu siapkan naskah untuk dibagikan.</p>
          <div className="hero-actions">
            <Button size="lg" onClick={() => onOpenStudio()}>Buka Studio <ArrowRight aria-hidden="true" /></Button>
            <a className="text-action" href="#contoh">Lihat contoh <ArrowDown className="size-4" aria-hidden="true" /></a>
          </div>
          <p className="hero-note"><span className="note-rule" />Demo editor dengan contoh transkrip.<br />Transkripsi otomatis masih dikembangkan.</p>
        </div>

        <figure className="hero-document-wrap">
          <div className="hero-document">
            <div className="preview-header">
              <div><span className="document-label">Catatan percakapan</span><h2>Wawancara komunitas</h2></div>
              <span className="sample-label">Contoh</span>
            </div>
            <div className="preview-segments">
              {recordings[0].segments.slice(0, 3).map((segment, index) => (
                <div className={`preview-segment ${index === 1 ? 'preview-segment-active' : ''}`} key={segment.id}>
                  <div className="preview-speaker"><span>{segment.speaker}</span><time>{segment.time}</time></div>
                  <p>{index === 1 ? <>Mulainya sederhana. Kami bertemu tiap Sabtu, <mark>berbagi cerita</mark>, lalu menyusun kegiatan bersama.</> : segment.text}</p>
                </div>
              ))}
            </div>
            <div className="preview-bottom">
              <span className="flex items-center gap-2"><PencilLine className="size-4" aria-hidden="true" /> Setiap cerita punya catatan.</span>
              <button className="preview-open" onClick={() => onOpenStudio()}>Sunting contoh <ArrowRight className="size-4" aria-hidden="true" /></button>
            </div>
          </div>
          <figcaption><span className="font-mono">01 /</span> Percakapannya tetap utuh. Catatannya lebih jelas.</figcaption>
        </figure>
      </section>

      <section className="workflow-section page-container" id="cara-kerja" aria-labelledby="workflow-title">
        <div className="section-heading">
          <p className="eyebrow">01 / Baca dan rapikan</p>
          <h2 id="workflow-title">Ikuti percakapannya.<br />Temukan bagian<br className="hidden lg:block" /> pentingnya.</h2>
          <p>Naskah yang baik dimulai dari mendengarkan. Beri ruang pada cerita, tanpa kehilangan konteksnya.</p>
        </div>
        <div className="workflow-list">
          {[
            { icon: Headphones, title: 'Temukan konteksnya', text: 'Nama pembicara dan penanda waktu membantu Anda mengikuti alur percakapan.' },
            { icon: PencilLine, title: 'Rapikan dengan cara Anda', text: 'Sunting kalimat langsung di naskah. Ubah nama pembicara agar setiap suara mudah dikenali.' },
            { icon: Download, title: 'Bawa ceritanya lebih jauh', text: 'Salin naskah atau ekspor sebagai teks, subtitle, dan dokumen untuk pekerjaan berikutnya.' },
          ].map(({ icon: Icon, title, text }, index) => (
            <div className="workflow-item" key={title}>
              <span className="workflow-number">0{index + 1}</span>
              <div><h3><Icon className="size-4" aria-hidden="true" />{title}</h3><p>{text}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="example-section" id="contoh" aria-labelledby="example-title">
        <div className="page-container example-layout">
          <div className="section-heading">
            <p className="eyebrow">02 / Coba sebuah percakapan</p>
            <h2 id="example-title">Beda cerita.<br />Satu ruang kerja.</h2>
            <p>Dari wawancara hingga catatan kelas. Pilih contoh untuk mengenal cara kerja editornya.</p>
            <div className="example-choices" role="group" aria-label="Jenis contoh transkrip">
              {recordings.map(item => <button key={item.id} aria-pressed={selectedExample === item.id} onClick={() => setSelectedExample(item.id)}>{item.category}</button>)}
            </div>
          </div>
          <div className="example-quote" aria-live="polite">
            <div className="quote-meta"><FileText className="size-4" aria-hidden="true" /><span>{example.title}</span><span className="sample-label">Contoh</span></div>
            <blockquote>{example.segments[1].text}</blockquote>
            <div className="quote-attribution"><span>{example.segments[1].speaker}</span><time>{example.segments[1].time}</time></div>
            <button className="text-action" onClick={() => onOpenStudio(example.id)}>Buka contoh di Studio <ArrowRight className="size-4" aria-hidden="true" /></button>
          </div>
        </div>
      </section>

      <section className="faq-section page-container" id="pertanyaan" aria-labelledby="faq-title">
        <div className="section-heading"><p className="eyebrow">03 / Sebelum mulai</p><h2 id="faq-title">Sedikit penjelasan.<br />Supaya lebih jelas.</h2><p>Yang sudah bisa dicoba, dan yang masih kami kerjakan.</p></div>
        <Accordion type="single" collapsible className="faq-list">
          {questions.map(([question, answer], index) => <AccordionItem value={`faq-${index}`} key={question}><AccordionTrigger>{question}</AccordionTrigger><AccordionContent>{answer}</AccordionContent></AccordionItem>)}
        </Accordion>
      </section>

      <section className="closing-section page-container">
        <div><p className="eyebrow">Mulai dari satu percakapan</p><h2>Ceritanya sudah ada.<br />Sekarang, catetin.</h2></div>
        <div><Button size="lg" onClick={() => onOpenStudio()}>Buka Studio <ArrowRight aria-hidden="true" /></Button><p>Tanpa akun. Langsung coba editornya.</p></div>
      </section>
    </main>
  );
}
