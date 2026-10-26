import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClosingCTA } from '../../src/components/landing/ClosingCTA';
import { recordings } from '../../src/lib/transcript';

test('closing CTA uses the approved copy and editorial illustration', () => {
  const recording = recordings[0];
  const html = renderToStaticMarkup(<ClosingCTA recording={recording} onOpenStudio={() => {}} />);
  assert.match(html, /COBA EDITOR CATETIN/);
  assert.match(html, /Lihat cara Catetin/);
  assert.match(html, /merapikan transkrip/);
  assert.match(html, /Mulai dari contoh, kenali alurnya/);
  assert.match(html, /Buka contoh di Studio/);
  assert.match(html, /src="\/illustrations\/closing-cta-editorial-transparent\.png"/);
  assert.match(html, /alt="Pratinjau transkrip Catetin yang sedang disunting"/);
  assert.equal((html.match(/data-primary-cta="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /closing-product-bar|closing-segment-card|closing-export/);
});

test('closing CTA binds the represented recording id to its action', () => {
  const recording = recordings[1];
  let opened = '';
  const tree = ClosingCTA({ recording, onOpenStudio: id => { opened = id; } });
  const copy = tree.props.children[0];
  const button = copy.props.children.find((child: { props?: { 'data-primary-cta'?: boolean } }) => child?.props?.['data-primary-cta']);
  button.props.onClick();
  assert.equal(opened, recording.id);
});
