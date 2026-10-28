import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { win } from '../account/dom-setup.ts';
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
  assert.match(html, /width="1734"/);
  assert.match(html, /height="907"/);
  assert.match(html, /alt="Pratinjau transkrip Catetin yang sedang disunting"/);
  assert.equal((html.match(/data-primary-cta="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /closing-product-bar|closing-segment-card|closing-export/);
});

test('closing CTA binds the represented recording id to its action', async () => {
  const recording = recordings[1];
  let opened = '';

  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  await act(async () => {
    root.render(
      <ClosingCTA
        recording={recording}
        onOpenStudio={(id) => {
          opened = id;
        }}
      />
    );
  });

  const button = rootEl.querySelector('[data-primary-cta="true"]') as HTMLButtonElement | null;
  assert.ok(button, 'Primary CTA button harus ada di DOM');

  await act(async () => {
    button.click();
  });

  assert.equal(opened, recording.id);

  root.unmount();
  win.document.body.innerHTML = '';
});
