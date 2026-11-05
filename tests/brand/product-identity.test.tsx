import 'fake-indexeddb/auto';
import { win } from '../account/dom-setup.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';

if (typeof (globalThis as any).indexedDB !== 'undefined') {
  try {
    Object.defineProperty(win, 'indexedDB', {
      value: (globalThis as any).indexedDB,
      configurable: true,
      writable: true,
    });
  } catch {}
}
import {
  PRODUCT_IDENTITY,
  formatDocumentTitle,
  type ProductIdentity,
} from '../../src/config/product-identity.ts';
import { CatetinBrand, BrandLockup } from '../../src/components/brand/CatetinBrand.tsx';
import {
  createProject,
  createFolder,
  saveWorkspace,
  loadWorkspace,
} from '../../src/features/workspace/workspace-store.ts';

const ROOT = process.cwd();
let activeRoots: Array<{ root: ReactDOM.Root; container: HTMLElement }> = [];

function cleanBody() {
  for (const item of activeRoots) {
    try {
      act(() => {
        item.root.unmount();
      });
    } catch {}
    try {
      item.container.remove();
    } catch {}
  }
  activeRoots = [];
  win.document.body.innerHTML = '';
}

function mount(node: React.ReactElement) {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);
  activeRoots.push({ root, container: container as any });
  act(() => {
    root.render(node);
  });
  return { root, container: container as any };
}

beforeEach(() => {
  cleanBody();
});

afterEach(() => {
  cleanBody();
});

test('1. Konfigurasi identitas memiliki seluruh field wajib yang valid dan typed', () => {
  const id: ProductIdentity = PRODUCT_IDENTITY;

  // Basic brand fields
  assert.equal(typeof id.productName, 'string');
  assert.ok(id.productName.length > 0, 'productName tidak boleh kosong');
  assert.equal(id.productName, 'Catetin', 'Working brand saat ini harus Catetin');

  assert.equal(typeof id.shortName, 'string');
  assert.ok(id.shortName.length > 0, 'shortName tidak boleh kosong');

  assert.equal(typeof id.studioName, 'string');
  assert.ok(id.studioName.length > 0, 'studioName tidak boleh kosong');

  // Localized description
  assert.equal(typeof id.productDescription.id, 'string');
  assert.equal(typeof id.productDescription.en, 'string');
  assert.ok(id.productDescription.id.length > 10, 'Deskripsi ID harus informatif');
  assert.ok(id.productDescription.en.length > 10, 'Deskripsi EN harus informatif');

  // Domain & contacts
  assert.equal(typeof id.workingDomain, 'string');
  assert.ok(id.workingDomain.includes('.'), 'workingDomain harus domain valid');
  assert.equal(typeof id.productionOrigin, 'string');
  assert.ok(id.productionOrigin.startsWith('https://'), 'productionOrigin harus https');

  assert.equal(typeof id.supportEmail, 'string');
  assert.ok(id.supportEmail.includes('@'), 'supportEmail harus format email');

  assert.equal(typeof id.legalName, 'string');
  assert.ok(id.legalName.length > 0, 'legalName harus tersedia');

  // Verify logos
  const logoKeys = [
    'standardLockup',
    'reversedLockup',
    'standardMark',
    'reversedMark',
    'faviconSvg',
    'faviconPng32',
    'faviconPng48',
    'appleTouchIcon',
  ] as const;

  for (const k of logoKeys) {
    const relPath = id.logos[k];
    assert.equal(typeof relPath, 'string');
    assert.ok(relPath.startsWith('/'), `Path ${k} harus absolut peramban`);
    const diskPath = path.join(ROOT, 'public', relPath.replace(/^\//, ''));
    assert.ok(fs.existsSync(diskPath), `File fisik untuk logos.${k} harus ada di ${diskPath}`);
  }

  // Verify social preview
  assert.equal(typeof id.socialPreview.ogImage, 'string');
  const ogDiskPath = path.join(ROOT, 'public', id.socialPreview.ogImage.replace(/^\//, ''));
  assert.ok(fs.existsSync(ogDiskPath), 'File ogImage harus ada di public');
  assert.equal(id.socialPreview.width, 1200);
  assert.equal(id.socialPreview.height, 630);
});

test('2. CatetinBrand & BrandLockup merender nama dan aset dari konfigurasi terpusat', () => {
  // Test default light mode
  mount(<CatetinBrand />);
  const lockupImg = win.document.querySelector('.brand-lockup-img') as HTMLImageElement | null;
  const markImg = win.document.querySelector('.brand-mark-img') as HTMLImageElement | null;
  const srOnly = win.document.querySelector('.sr-only') as HTMLElement | null;

  assert.ok(lockupImg, 'Lockup image harus ada');
  assert.ok(markImg, 'Mark image harus ada');
  assert.equal(lockupImg.getAttribute('src'), PRODUCT_IDENTITY.logos.standardLockup);
  assert.equal(markImg.getAttribute('src'), PRODUCT_IDENTITY.logos.standardMark);
  assert.equal(srOnly?.textContent, PRODUCT_IDENTITY.productName);

  cleanBody();

  // Test reversed dark mode
  mount(<CatetinBrand reversed={true} />);
  const reversedLockup = win.document.querySelector('.brand-lockup-img') as HTMLImageElement | null;
  const reversedMark = win.document.querySelector('.brand-mark-img') as HTMLImageElement | null;
  assert.equal(reversedLockup?.getAttribute('src'), PRODUCT_IDENTITY.logos.reversedLockup);
  assert.equal(reversedMark?.getAttribute('src'), PRODUCT_IDENTITY.logos.reversedMark);

  cleanBody();

  // Test BrandLockup alias
  assert.equal(BrandLockup, CatetinBrand, 'BrandLockup harus merupakan alias untuk CatetinBrand');
  mount(<BrandLockup markOnly={true} />);
  const onlyMark = win.document.querySelector('.brand-mark-img') as HTMLImageElement | null;
  assert.ok(onlyMark, 'Mark-only harus merender mark image');
  assert.equal(win.document.querySelector('.brand-lockup-img'), null);
});

test('3. formatDocumentTitle memformat title halaman dengan nama produk atau studio secara konsisten', () => {
  assert.equal(
    formatDocumentTitle(),
    `${PRODUCT_IDENTITY.productName} · Transkripsi lokal untuk rekaman Anda`
  );
  assert.equal(
    formatDocumentTitle('Pusat Akun'),
    `Pusat Akun · ${PRODUCT_IDENTITY.productName}`
  );
  assert.equal(
    formatDocumentTitle('Pilihan Paket & Harga'),
    `Pilihan Paket & Harga · ${PRODUCT_IDENTITY.productName}`
  );
  assert.equal(
    formatDocumentTitle('Dashboard', { isStudio: true }),
    `Dashboard · ${PRODUCT_IDENTITY.studioName}`
  );
  assert.equal(
    formatDocumentTitle('Rapat Tim', { isStudio: true }),
    `Rapat Tim · ${PRODUCT_IDENTITY.studioName}`
  );
});

test('4. Perubahan nama produk tidak mengganggu logika bisnis atau integritas workspace lokal', async () => {
  // Verifikasi logika workspace lokal tidak bergantung pada string nama brand
  const proj = await createProject('Project Riset Alpha');
  assert.ok(proj.id.startsWith('project-'));
  assert.equal(proj.title, 'Project Riset Alpha');

  const folder = await createFolder(proj.id, 'Folder Wawancara');
  assert.ok(folder.id.startsWith('folder-'));
  assert.equal(folder.name, 'Folder Wawancara');

  const loaded = await loadWorkspace();
  assert.ok(loaded, 'Workspace harus berhasil dimuat');
  assert.ok(loaded.projects?.some(p => p.id === proj.id));
  assert.ok(loaded.folders?.some(f => f.id === folder.id));
});

test('5. Bebas dari karakter em dash pada konfigurasi identitas dan dokumentasi roadmap', () => {
  const roadmapPath = path.join(ROOT, 'docs/product/rename-ready-cloud-renovation-roadmap.md');
  const checklistPath = path.join(ROOT, 'docs/product/rename-checklist.md');
  const configPath = path.join(ROOT, 'src/config/product-identity.ts');

  for (const p of [roadmapPath, checklistPath, configPath]) {
    assert.ok(fs.existsSync(p), `File ${p} harus ada`);
    const content = fs.readFileSync(p, 'utf-8');
    assert.equal(
      content.includes('\u2014'),
      false,
      `File ${p} tidak boleh mengandung em dash`
    );
  }
});
