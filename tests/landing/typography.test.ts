import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('landing typography exposes readable semantic roles', () => {
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /--lp-body:\s*17px/);
  assert.match(css, /--lp-body-mobile:\s*16px/);
  assert.match(css, /--lp-compact:\s*14px/);
  assert.match(css, /--lp-meta:\s*12px/);
  assert.match(css, /--lp-muted:\s*#455969/);
});
