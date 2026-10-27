import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('semua aset brand SVG canonical ada dan valid', () => {
  const lockupPath = path.join(ROOT, 'public/brand/catetin-lockup.svg');
  const lockupReversedPath = path.join(ROOT, 'public/brand/catetin-lockup-reversed.svg');
  const markPath = path.join(ROOT, 'public/brand/catetin-mark.svg');

  assert.ok(fs.existsSync(lockupPath), 'catetin-lockup.svg harus ada');
  assert.ok(fs.existsSync(lockupReversedPath), 'catetin-lockup-reversed.svg harus ada');
  assert.ok(fs.existsSync(markPath), 'catetin-mark.svg harus ada');

  const lockupSvg = fs.readFileSync(lockupPath, 'utf-8');
  assert.ok(lockupSvg.includes('viewBox="0 0 727 230"'));
  assert.ok(lockupSvg.includes('#172F49')); // Navy
  assert.ok(lockupSvg.includes('#CFE2F1')); // Powder blue
  assert.ok(lockupSvg.includes('<title id="title">Catetin</title>'));

  const reversedSvg = fs.readFileSync(lockupReversedPath, 'utf-8');
  assert.ok(reversedSvg.includes('viewBox="0 0 727 230"'));
  assert.ok(reversedSvg.includes('#FAF9F6')); // Ivory
  assert.ok(reversedSvg.includes('#CFE2F1')); // Powder blue

  const markSvg = fs.readFileSync(markPath, 'utf-8');
  assert.ok(markSvg.includes('viewBox="0 0 256 256"'));
  assert.ok(markSvg.includes('#172F49'));
  assert.ok(markSvg.includes('#CFE2F1'));
});

test('aset raster favicon, PWA, maskable, dan OG image ada dan non-empty', () => {
  const requiredFiles = [
    'public/icons/favicon-32.png',
    'public/icons/favicon-48.png',
    'public/icons/apple-touch-icon.png',
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
    'public/icons/icon-maskable-512.png',
    'public/brand/catetin-og-1200x630.png',
  ];

  for (const rel of requiredFiles) {
    const filePath = path.join(ROOT, rel);
    assert.ok(fs.existsSync(filePath), `${rel} harus ada`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 0, `${rel} tidak boleh kosong`);
  }
});

test('index.html memuat favicon, Apple touch icon, PWA manifest, dan absolute metadata OG', () => {
  const htmlPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  assert.ok(html.includes('href="/brand/catetin-mark.svg"'));
  assert.ok(html.includes('href="/icons/favicon-32.png"'));
  assert.ok(html.includes('href="/icons/apple-touch-icon.png"'));
  assert.ok(html.includes('href="/manifest.webmanifest"'));

  const expectedOgUrl = 'https://catetin-project.anwars-rizki.workers.dev/';
  const expectedOgImage = 'https://catetin-project.anwars-rizki.workers.dev/brand/catetin-og-1200x630.png';

  assert.ok(html.includes(`property="og:url" content="${expectedOgUrl}"`));
  assert.ok(html.includes(`property="og:image" content="${expectedOgImage}"`));
  assert.ok(html.includes(`name="twitter:image" content="${expectedOgImage}"`));
  assert.ok(html.includes('property="og:image:width" content="1200"'));
  assert.ok(html.includes('property="og:image:height" content="630"'));
});

test('manifest.webmanifest memiliki ikon brand dan maskable yang valid', () => {
  const manifestPath = path.join(ROOT, 'public/manifest.webmanifest');
  const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  assert.equal(content.name, 'Catetin');
  assert.equal(content.short_name, 'Catetin');
  assert.ok(Array.isArray(content.icons));

  const hasSvg = content.icons.some((i: any) => i.src === '/brand/catetin-mark.svg');
  const has192 = content.icons.some((i: any) => i.src === '/icons/icon-192.png');
  const has512 = content.icons.some((i: any) => i.src === '/icons/icon-512.png');
  const hasMaskable = content.icons.some(
    (i: any) => i.src === '/icons/icon-maskable-512.png' && i.purpose === 'maskable'
  );

  assert.ok(hasSvg, 'manifest harus merujuk svg mark');
  assert.ok(has192, 'manifest harus merujuk 192 icon');
  assert.ok(has512, 'manifest harus merujuk 512 icon');
  assert.ok(hasMaskable, 'manifest harus memiliki maskable icon');
});

test('CatetinBrand menggunakan alt kosong dan aria-hidden pada kedua image', () => {
  const brandComponentPath = path.join(ROOT, 'src/components/brand/CatetinBrand.tsx');
  const code = fs.readFileSync(brandComponentPath, 'utf-8');

  // Must have decorative alt and aria-hidden on all images
  assert.ok(code.includes('alt=""'));
  assert.ok(code.includes('aria-hidden="true"'));
  assert.ok(code.includes('hasAccessibleParent'));
  assert.ok(!code.includes('alt="Catetin"'));
});

test('dokumentasi lisensi, README brand, spec, dan plan Stage 3E tersedia', () => {
  const licensePath = path.join(ROOT, 'public/brand/LICENSE-Petrona.txt');
  const readmePath = path.join(ROOT, 'public/brand/README.md');
  const specPath = path.join(ROOT, 'docs/superpowers/specs/2026-10-27-catetin-brand-foundation-design.md');
  const planPath = path.join(ROOT, 'docs/superpowers/plans/2026-10-27-catetin-brand-foundation.md');

  assert.ok(fs.existsSync(licensePath), 'LICENSE-Petrona.txt harus ada');
  assert.ok(fs.existsSync(readmePath), 'README.md harus ada');
  assert.ok(fs.existsSync(specPath), 'spec Stage 3E harus ada');
  assert.ok(fs.existsSync(planPath), 'plan Stage 3E harus ada');

  const licenseContent = fs.readFileSync(licensePath, 'utf-8');
  assert.ok(licenseContent.includes('SIL Open Font License'));
});
