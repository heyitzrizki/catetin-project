import { win } from '../account/dom-setup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import App from '../../src/App.tsx';
import { CatetinBrand } from '../../src/components/brand/CatetinBrand.tsx';
import { AccountControlView } from '../../src/components/account/AccountControl.tsx';

function cleanBody() {
  win.document.body.innerHTML = '';
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

test('1. Landing memakai reversed lockup dan navy header (#172f49)', async () => {
  cleanBody();
  win.location.hash = '';

  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  await act(async () => {
    root.render(<App />);
  });
  await flushAsync();

  // Landing header has site-header-landing class
  const header = win.document.querySelector('header.site-header') as HTMLElement | null;
  assert.ok(header, 'Header harus ada');
  assert.ok(header.classList.contains('site-header-landing'), 'Landing header harus memiliki kelas site-header-landing');

  // Verify CSS defines background #172f49 for .site-header-landing
  const cssPath = path.resolve(process.cwd(), 'src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(
    css.includes('.site-header-landing') && css.includes('background-color: #172f49'),
    'CSS harus mendefinisikan background navy #172f49 untuk .site-header-landing'
  );

  // Check reversed lockup inside brand button
  const brandImg = header.querySelector('.brand-lockup-img') as HTMLImageElement | null;
  assert.ok(brandImg, 'Gambar brand lockup harus ada di landing header');
  assert.ok(
    brandImg.src.includes('catetin-lockup-reversed.svg'),
    'Landing header harus memakai catetin-lockup-reversed.svg untuk kontras di atas navy'
  );

  root.unmount();
});

test('2. Studio dan Account Center tidak memakai reversed landing treatment', async () => {
  cleanBody();

  // Test Studio page
  win.location.hash = '#studio';
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  await act(async () => {
    root.render(<App />);
  });
  await flushAsync();

  const studioHeader = win.document.querySelector('header.site-header') as HTMLElement | null;
  assert.ok(studioHeader, 'Studio header harus ada');
  assert.ok(
    !studioHeader.classList.contains('site-header-landing'),
    'Studio header TIDAK boleh memiliki kelas site-header-landing'
  );

  const studioBrandImg = studioHeader.querySelector('.brand-lockup-img') as HTMLImageElement | null;
  assert.ok(studioBrandImg);
  assert.ok(
    studioBrandImg.src.includes('catetin-lockup.svg') && !studioBrandImg.src.includes('catetin-lockup-reversed.svg'),
    'Studio header harus memakai lockup non-reversed (navy/gelap) di atas latar putih'
  );

  // Test Account page
  win.location.hash = '#account';
  await act(async () => {
    win.dispatchEvent(new (win.Event as any)('hashchange'));
  });
  await flushAsync();

  const accountHeader = win.document.querySelector('header.site-header') as HTMLElement | null;
  assert.ok(accountHeader, 'Account Center header harus ada');
  assert.ok(
    !accountHeader.classList.contains('site-header-landing'),
    'Account Center header TIDAK boleh memiliki kelas site-header-landing'
  );

  const accountBrandImg = accountHeader.querySelector('.brand-lockup-img') as HTMLImageElement | null;
  assert.ok(accountBrandImg);
  assert.ok(
    accountBrandImg.src.includes('catetin-lockup.svg') && !accountBrandImg.src.includes('catetin-lockup-reversed.svg'),
    'Account Center header harus memakai lockup non-reversed di atas latar putih'
  );

  root.unmount();
  win.location.hash = '';
});

test('3. Mark-only reversed aktif di bawah 400px pada reversed treatment', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  await act(async () => {
    root.render(<CatetinBrand reversed={true} hasAccessibleParent={true} />);
  });
  await flushAsync();

  const lockupImg = win.document.querySelector('.brand-lockup-img') as HTMLImageElement | null;
  const markImg = win.document.querySelector('.brand-mark-img') as HTMLImageElement | null;

  assert.ok(lockupImg, 'Lockup image harus ada');
  assert.ok(markImg, 'Mark image harus ada');

  // Both should use reversed asset versions
  assert.ok(lockupImg.src.includes('catetin-lockup-reversed.svg'));
  assert.ok(markImg.src.includes('catetin-mark-reversed.svg'));

  // Responsive breakpoint classes: lockup hidden below 400px, mark visible below 400px
  assert.ok(lockupImg.className.includes('hidden min-[400px]:block'), 'Lockup tersembunyi di bawah 400px');
  assert.ok(markImg.className.includes('block min-[400px]:hidden'), 'Mark-only tampil di bawah 400px');

  root.unmount();
});

test('4. State guest dan authenticated mempertahankan accessible labels dan tidak mengubah fungsi kontrol', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let signInCalled = false;
  let signOutCalled = false;
  let openAccountCalled = false;

  // Render guest
  await act(async () => {
    root.render(
      <AccountControlView
        status="guest"
        user={null}
        error={null}
        onSignIn={() => {
          signInCalled = true;
        }}
        onSignOut={() => {}}
      />
    );
  });
  await flushAsync();

  const signInBtn = win.document.querySelector('.account-btn-signin') as HTMLButtonElement | null;
  assert.ok(signInBtn, 'Tombol Masuk harus ada');
  assert.strictEqual(signInBtn.getAttribute('aria-label'), 'Masuk dengan Google');

  await act(async () => {
    signInBtn.click();
  });
  assert.strictEqual(signInCalled, true, 'Klik tombol Masuk harus memanggil onSignIn');

  // Render authenticated with long name
  await act(async () => {
    root.render(
      <AccountControlView
        status="authenticated"
        user={{
          id: 'u_long',
          name: 'Prof. Dr. Raden Mas Danang Sutowijoyo Hadiningrat',
          email: 'danang.hadiningrat.panembahan@universitas-indonesia.ac.id',
          image: 'https://example.com/avatar.jpg',
        }}
        error={null}
        onSignIn={() => {}}
        onSignOut={() => {
          signOutCalled = true;
        }}
        onOpenAccount={() => {
          openAccountCalled = true;
        }}
      />
    );
  });
  await flushAsync();

  const userBadge = win.document.querySelector('.account-user-badge') as HTMLButtonElement | null;
  assert.ok(userBadge, 'Badge akun pengguna harus ada');
  assert.strictEqual(userBadge.getAttribute('aria-label'), 'Buka Pusat Akun');

  await act(async () => {
    userBadge.click();
  });
  assert.strictEqual(openAccountCalled, true, 'Klik badge profil harus memanggil onOpenAccount');

  const signOutBtn = win.document.querySelector('.account-btn-signout') as HTMLButtonElement | null;
  assert.ok(signOutBtn, 'Tombol Keluar harus ada');
  assert.strictEqual(signOutBtn.getAttribute('aria-label'), 'Keluar');

  // Clicking Keluar opens confirmation dialog
  await act(async () => {
    signOutBtn.click();
  });
  await flushAsync();

  const confirmButtons = Array.from(win.document.querySelectorAll('button')) as any[];
  const confirmBtn = confirmButtons.find((b) => b.textContent?.includes('Keluar dari akun'));
  assert.ok(confirmBtn, 'Tombol konfirmasi Keluar dari akun harus muncul di dialog');

  await act(async () => {
    confirmBtn.click();
  });
  await flushAsync();

  assert.strictEqual(signOutCalled, true, 'Konfirmasi keluar harus memanggil onSignOut');

  root.unmount();
});
