import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from '../../src/components/LandingPage';

test('landing page uses direct and natural Indonesian copy', () => {
  const html = renderToStaticMarkup(<LandingPage onOpenStudio={() => {}} onOpenRecording={() => {}} />);

  for (const copy of [
    'Dengarkan tanpa kehilangan konteks.',
    'Audio tidak diunggah',
    'LOKAL ATAU CLOUD',
    'DI SERVER PENYEDIA',
    'Coba dengan berbagai',
    'jenis percakapan.',
    'Jawaban singkat tentang fitur, privasi, dan penyimpanan.',
  ]) assert.match(html, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(html, /Audio tanpa upload|DI INFRASTRUKTUR PENYEDIA|Beri setiap suara tempatnya/);
});
