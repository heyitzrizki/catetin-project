import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparisonSection } from '../../src/components/landing/ComparisonSection';

test('comparison renders six criteria with explicit local and cloud columns', () => {
  const html = renderToStaticMarkup(<ComparisonSection />);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 6);
  assert.equal((html.match(/scope="col"/g) ?? []).length, 3);
  assert.match(html, />Catetin</);
  assert.match(html, />Layanan cloud</);
  assert.doesNotMatch(html, /architecture-(local|cloud)\.svg/);
});

test('comparison keeps criterion, local, then cloud in document order', () => {
  const html = renderToStaticMarkup(<ComparisonSection />);
  const criterion = html.indexOf('Berkas audio');
  const local = html.indexOf('Dibuka di browser Anda');
  const cloud = html.indexOf('Dikirim ke server');
  assert.ok(criterion >= 0 && criterion < local && local < cloud);
});

test('every comparison value carries an explicit accessible column label', () => {
  const html = renderToStaticMarkup(<ComparisonSection />);
  assert.equal((html.match(/aria-label="Catetin:/g) ?? []).length, 6);
  assert.equal((html.match(/aria-label="Layanan cloud:/g) ?? []).length, 6);
});
