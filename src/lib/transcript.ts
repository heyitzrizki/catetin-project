export interface DialogSegment {
  id: number;
  time: string;
  seconds: number;
  speaker: string;
  text: string;
}

export interface Recording {
  id: string;
  title: string;
  category: string;
  filename: string;
  durationSec: number;
  segments: DialogSegment[];
  projectId?: string;
  folderId?: string | null;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

// Written examples, not transcripts or testimonials from real people.
export const recordings: Recording[] = [
  {
    id: 'wawancara', title: 'Wawancara komunitas', category: 'Wawancara',
    filename: 'Wawancara_komunitas.mp3', durationSec: 222,
    segments: [
      { id: 1, time: '00:12', seconds: 12, speaker: 'Nadia', text: 'Apa yang paling membantu warga saling mengenal?' },
      { id: 2, time: '00:24', seconds: 24, speaker: 'Raka', text: 'Mulainya sederhana. Kami bertemu tiap Sabtu, berbagi cerita, lalu menyusun kegiatan bersama.' },
      { id: 3, time: '00:36', seconds: 36, speaker: 'Nadia', text: 'Jadi, kebiasaan kecil yang membuat hubungan itu tumbuh?' },
      { id: 4, time: '00:58', seconds: 58, speaker: 'Raka', text: 'Betul. Tidak harus acara besar. Kadang cukup duduk bersama dan mendengarkan kabar satu sama lain.' },
      { id: 5, time: '01:22', seconds: 82, speaker: 'Nadia', text: 'Menarik. Dari percakapan itu, kegiatan apa yang akhirnya kalian mulai?' },
    ],
  },
  {
    id: 'rapat', title: 'Rapat redaksi', category: 'Rapat',
    filename: 'Rapat_redaksi.m4a', durationSec: 135,
    segments: [
      { id: 1, time: '00:02', seconds: 2, speaker: 'Dina', text: 'Untuk liputan minggu ini, kita mulai dari cerita warga tentang ruang terbuka di lingkungan mereka.' },
      { id: 2, time: '00:14', seconds: 14, speaker: 'Arif', text: 'Saya akan menghubungi pengelola taman dan menyiapkan daftar pertanyaan. Kita juga perlu mendengar pengalaman pengunjung.' },
      { id: 3, time: '00:35', seconds: 35, speaker: 'Dina', text: 'Baik. Kita kumpulkan catatan awal sebelum menentukan sudut pandang tulisannya.' },
    ],
  },
  {
    id: 'kuliah', title: 'Catatan kelas', category: 'Belajar',
    filename: 'Kelas_metode_riset.wav', durationSec: 190,
    segments: [
      { id: 1, time: '00:04', seconds: 4, speaker: 'Pengajar', text: 'Wawancara yang baik dimulai dengan rasa ingin tahu. Pertanyaan terbuka memberi ruang bagi narasumber untuk bercerita.' },
      { id: 2, time: '00:22', seconds: 22, speaker: 'Mahasiswa', text: 'Bagaimana jika jawaban narasumber berbeda dari dugaan awal kita?' },
      { id: 3, time: '00:41', seconds: 41, speaker: 'Pengajar', text: 'Itulah bagian penting dari riset. Catat konteksnya, dengarkan sampai selesai, lalu ajukan pertanyaan lanjutan.' },
    ],
  },
];

export function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function transcriptText(segments: DialogSegment[], names: Record<string, string>) {
  return segments.map(s => `[${s.time}] ${names[s.speaker] || s.speaker}\n${s.text}`).join('\n\n');
}

function srtTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')},000`;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function downloadTranscript(format: 'txt' | 'srt' | 'doc', recording: Recording, segments: DialogSegment[], names: Record<string, string>) {
  let content = transcriptText(segments, names);
  let type = 'text/plain;charset=utf-8';
  if (format === 'srt') {
    content = segments.map((s, index) => {
      const end = segments[index + 1]?.seconds ?? Math.max(s.seconds + 1, recording.durationSec);
      return `${index + 1}\n${srtTime(s.seconds)} --> ${srtTime(end)}\n${names[s.speaker] || s.speaker}: ${s.text}\n`;
    }).join('\n');
  }
  if (format === 'doc') {
    // Word-compatible HTML is exported as .doc, never mislabeled as OOXML .docx.
    type = 'application/msword;charset=utf-8';
    content = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(recording.title)}</title></head><body><h1>${escapeHtml(recording.title)}</h1>${segments.map(s => `<p><strong>${escapeHtml(names[s.speaker] || s.speaker)}</strong> <small>${s.time}</small></p><p>${escapeHtml(s.text).replace(/\n/g, '<br>')}</p>`).join('')}</body></html>`;
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${recording.filename.replace(/\.[^.]+$/, '')}_catetin.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
