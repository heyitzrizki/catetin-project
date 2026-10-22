import { useEffect, useSyncExternalStore } from 'react';
import messages from './messages.json';
export type Language = 'id' | 'en';
const storageKey = 'catetin-language';
let language: Language = 'id';
try { if (localStorage.getItem(storageKey) === 'en') language = 'en'; } catch { /* Storage can be unavailable. */ }
const listeners = new Set<() => void>();
const aliases = new Map<string, string>();
for (const [key, value] of Object.entries(messages)) { aliases.set(key, key); aliases.set(value.id, key); aliases.set(value.en, key); }
export function t(key: string, values?: Record<string, string | number>): string {
 const canonical = Object.prototype.hasOwnProperty.call(messages, key) ? key : aliases.get(key) ?? key;
 const entry = (messages as Record<string, {id: string; en: string}>)[canonical];
 const text = entry?.[language] ?? key;
 return text.replace(/\{(\w+)\}/g, (match, name) => values?.[name] == null ? match : String(values[name]));
}
export function setLanguage(next: Language) {
 if (next === language) return;
 language = next;
 try { localStorage.setItem(storageKey, next); } catch { /* Keep the session preference. */ }
 listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLanguage() {
 const current = useSyncExternalStore(subscribe, () => language, () => 'id' as Language);
 useEffect(() => {
  document.documentElement.lang = current;
  const description = document.querySelector('meta[name="description"]');
  description?.setAttribute('content', current === 'en' ? 'Review recordings, edit transcripts, and export your work. Audio files open locally in your browser. Try the editor without an account.' : 'Dengarkan rekaman, sunting transkrip, dan ekspor naskah. Berkas audio dibuka secara lokal di browser. Coba editor tanpa akun.');
 }, [current]);
 return current;
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
 if (event.key === storageKey) { language = event.newValue === 'en' ? 'en' : 'id'; listeners.forEach(listener => listener()); }
});