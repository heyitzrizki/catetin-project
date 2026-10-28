import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('8. Brand responsive memakai lockup/mark pada breakpoint yang benar', () => {
  const brandComponentPath = path.join(ROOT, 'src/components/brand/CatetinBrand.tsx');
  const brandCode = fs.readFileSync(brandComponentPath, 'utf-8');

  // Breakpoint 400px check: primary lockup for >=400px, standalone mark for <400px
  assert.ok(
    brandCode.includes('min-[400px]:block') && brandCode.includes('hidden min-[400px]:block'),
    'Lockup horizontal harus aktif pada viewport >= 400px'
  );
  assert.ok(
    brandCode.includes('min-[400px]:hidden') && brandCode.includes('block min-[400px]:hidden'),
    'Mark-only harus aktif pada viewport < 400px'
  );

  // SVG ratio & height check: 727/230 ≈ 3.16; desktop visual height ~32-36px (default 34px)
  assert.ok(brandCode.includes('defaultHeight = 34'), 'Default visual height lockup harus di rentang 32-36px (34px)');
  assert.ok(brandCode.includes('3.16'), 'Rasio lockup harus mempertahankan proporsi SVG 727x230');

  // Mark minimum visual presence is 28px
  assert.ok(brandCode.includes('markSize = height ?') && brandCode.includes('28'), 'Ukuran mark visual tidak boleh lebih kecil dari 28px saat default');

  // CSS rules check
  const cssPath = path.join(ROOT, 'src/index.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  // Brand button touch target min 44x44px
  assert.ok(
    css.includes('.brand {') &&
    css.includes('min-height: 44px;') &&
    css.includes('min-width: 44px;'),
    'Target sentuh tombol brand harus minimal 44x44px'
  );

  // Responsive desktop height 34px (~32-36px) and tablet/mobile height 30px (~28-32px)
  assert.ok(
    css.includes('.brand .brand-lockup-img { height: 34px;') ||
    css.includes('.brand .brand-lockup-img { height: 32px;'),
    'Desktop lockup height harus di rentang 32-36px'
  );
  assert.ok(
    css.includes('.brand .brand-lockup-img { height: 30px;'),
    'Mobile/tablet lockup height harus di rentang 28-32px'
  );

  // Footer brand remains proportional
  assert.ok(
    css.includes('.footer-brand .brand-lockup-img { height: 24px;'),
    'Footer brand lockup harus proporsional (24px)'
  );
});

test('9. CTA tidak memakai framing yang sengaja menyembunyikan panel export penting', () => {
  const cssPath = path.join(ROOT, 'src/index.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  // Verify that closing-illustration no longer uses negative horizontal overflow margins
  assert.ok(
    !css.includes('margin: -20px -86px -42px -24px'),
    'CTA illustration tidak boleh memakai margin negatif kanan yang mendorong panel export keluar layar'
  );
  assert.ok(
    !css.includes('margin: -12px -34px -38px'),
    'CTA mobile illustration tidak boleh memakai margin negatif samping'
  );

  // Verify image is contained without oversized percentage blowout
  const closingBlockMatch = css.match(/\.closing-illustration img\s*\{[\s\S]*?\}/);
  assert.ok(closingBlockMatch, 'Blok .closing-illustration img harus ditemukan di CSS');
  const closingBlock = closingBlockMatch[0];

  assert.ok(closingBlock.includes('width: 100%'), 'Gambar CTA harus memakai width: 100%');
  assert.ok(closingBlock.includes('max-width: 100%'), 'Gambar CTA harus memakai max-width: 100%');
  assert.ok(closingBlock.includes('object-fit: contain'), 'Gambar CTA harus memakai object-fit: contain untuk menjaga seluruh visual utuh');
  assert.ok(!closingBlock.includes('width: 118%'), 'Gambar CTA tidak boleh memakai width: 118% yang memotong panel export');

  // Verify on mobile breakpoints that illustration is fully centered under copy without crop
  assert.ok(
    css.includes('.closing-illustration { width: 100%; max-width: 620px; margin: 0 auto; justify-self: center; }') ||
    css.includes('.closing-illustration { width: 100%; margin: 0 auto; }'),
    'Pada mobile breakpoint, ilustrasi harus berada di bawah copy dan berposisi utuh di tengah'
  );
});
