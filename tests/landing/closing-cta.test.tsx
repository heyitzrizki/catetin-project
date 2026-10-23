import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClosingCTA } from '../../src/components/landing/ClosingCTA';
import { recordings } from '../../src/lib/transcript';

test('closing CTA previews a real recording and supported exports', () => {
  const recording = recordings[0];
  const html = renderToStaticMarkup(<ClosingCTA recording={recording} onOpenStudio={() => {}} />);
  const segment = recording.segments[0];
  assert.match(html, new RegExp(segment.speaker));
  assert.match(html, new RegExp(segment.time.replace(':', '\\:')));
  assert.match(html, new RegExp(segment.text.slice(0, 24)));
  assert.match(html, />TXT</);
  assert.match(html, />SRT</);
  assert.match(html, />DOC</);
  assert.equal((html.match(/data-primary-cta="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<button[^>]+aria-hidden="true"/);
  assert.doesNotMatch(html, /ringkasan otomatis|kolaborasi langsung/i);
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
