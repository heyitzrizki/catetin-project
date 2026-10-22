import { t } from '@/lib/i18n';
import { useState, useRef, useEffect } from 'react';
import { Check, PencilLine, Plus, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DialogSegment } from '@/lib/transcript';

interface Props {
  segments: DialogSegment[];
  speakerNames: Record<string, string>;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onRenameSpeaker: (oldName: string, newName: string) => void;
  onUpdateText: (id: number, text: string) => void;
  searchQuery: string;
  activeSpeakerFilter: string | null;
  viewMode: 'naskah' | 'waktu';
  onClearFilters: () => void;
  onAddSegment: () => void;
  isCustom: boolean;
}

function EditableSegment({ segment, name, onUpdate, contentLanguage }: { segment: DialogSegment; name: string; contentLanguage?: string; onUpdate: Props['onUpdateText'] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // Keep the DOM stable while typing, including when a search filter changes.
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.textContent = segment.text;
  }, [segment.id, segment.text]);
  return <p ref={ref} className="segment-text" lang={contentLanguage} contentEditable suppressContentEditableWarning role="textbox" tabIndex={0} aria-label={t("Text for speaker", {name})} aria-multiline="true" data-placeholder={t("Tulis isi percakapan di sini…")} onBlur={event => onUpdate(segment.id, event.currentTarget.textContent || '')} onPaste={event => {
    event.preventDefault();
    // Paste as text to keep external formatting and markup out of the document.
    const text = event.clipboardData.getData('text/plain');
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }} />;
}

export function ContinuousTranscriptEditor({ segments, speakerNames, currentTime, onSeek, onRenameSpeaker, onUpdateText, searchQuery, activeSpeakerFilter, viewMode, onClearFilters, onAddSegment, isCustom }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const query = searchQuery.toLocaleLowerCase('id').trim();
  const visible = segments.filter(s => (!activeSpeakerFilter || activeSpeakerFilter === s.speaker) && (!query || `${s.text} ${speakerNames[s.speaker] || s.speaker}`.toLocaleLowerCase('id').includes(query)));
  const finishRename = (speaker: string, save: boolean) => {
    const segmentId = editing;
    if (save && draftName.trim()) onRenameSpeaker(speaker, draftName.trim());
    setEditing(null);
    requestAnimationFrame(() => document.getElementById(`speaker-edit-${segmentId}`)?.focus());
  };

  return <article className="transcript-document" aria-label={t("Editor transkrip")}>
    <div className="document-intro"><span className="eyebrow">{t("Naskah")}</span><span><PencilLine className="size-3.5" aria-hidden="true" /> {t("Klik teks untuk menyunting")}</span></div>
    {segments.length === 0 ? <div className="document-empty"><PencilLine className="size-7" aria-hidden="true" /><h2>{t("Mulai dari kalimat pertama.")}</h2><p>{t("Dengarkan rekaman Anda, lalu tambahkan bagian percakapan. Transkripsi otomatis belum tersedia.")}</p><Button onClick={onAddSegment}><Plus aria-hidden="true" />{t("Tambah segmen")}</Button></div> : <>
      <div className="transcript-segments">
        {visible.map(segment => {
          const index = segments.findIndex(item => item.id === segment.id);
          const active = currentTime >= segment.seconds && currentTime < (segments[index + 1]?.seconds ?? Infinity);
          const name = speakerNames[segment.speaker] || (segment.speaker === 'Pembicara' ? t('Pembicara') : segment.speaker);
          return <section className={`transcript-segment ${active ? 'segment-active' : ''}`} key={segment.id} aria-label={t("Segment number", {number:index+1})}>
            <div className="segment-heading">
              {editing === segment.id ? <form className="rename-form" onSubmit={event => { event.preventDefault(); finishRename(segment.speaker, true); }}>
                <Input autoFocus aria-label={t("Nama pembicara")} maxLength={80} value={draftName} onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); finishRename(segment.speaker, false); } }} />
                <Button variant="ghost" size="icon" type="submit" aria-label={t("Simpan nama")}><Check /></Button><Button variant="ghost" size="icon" type="button" aria-label={t("Batal ubah nama")} onClick={() => finishRename(segment.speaker, false)}><X /></Button>
              </form> : <button id={`speaker-edit-${segment.id}`} className="speaker-edit" aria-label={t("Rename speaker", {name})} onClick={() => { setEditing(segment.id); setDraftName(name); }}><span>{name}</span><PencilLine aria-hidden="true" className="size-3.5" /></button>}
              <button className="segment-time" onClick={() => onSeek(segment.seconds)} aria-label={t("Go to timestamp", {time:segment.time})}><span className="sr-only">{t("Waktu")} </span>{segment.time}</button>
            </div>
            <EditableSegment segment={segment} name={name} onUpdate={onUpdateText} contentLanguage={isCustom ? undefined : "id"} />
            {viewMode === 'waktu' && <p className="segment-detail">{t("Segment number", {number:String(index+1).padStart(2,"0")})}<span>{t("Starts at", {time:segment.time})}</span></p>}
          </section>;
        })}
      </div>
      {visible.length === 0 && <div className="document-empty" role="status"><Search className="size-6" aria-hidden="true" /><h2>{t("Tidak ada bagian yang cocok.")}</h2><p>{t("Coba kata lain atau tampilkan kembali semua pembicara.")}</p><Button variant="outline" onClick={onClearFilters}><RotateCcw aria-hidden="true" />{t("Hapus filter")}</Button></div>}
      {isCustom && !query && !activeSpeakerFilter && <Button variant="ghost" className="add-segment" onClick={onAddSegment}><Plus aria-hidden="true" />{t("Tambah segmen pada waktu ini")}</Button>}
    </>}
    <div className="document-end"><span />{segments.length ? t("Akhir catatan") : t("Satu cerita dimulai di sini")}<span /></div>
  </article>;
}
