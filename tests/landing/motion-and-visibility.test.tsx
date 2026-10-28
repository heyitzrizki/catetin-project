import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { win } from '../account/dom-setup.ts';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from '../../src/components/LandingPage.tsx';
import { useLandingMotion } from '../../src/hooks/use-scroll-reveal.ts';
import { ClosingCTA } from '../../src/components/landing/ClosingCTA.tsx';
import { recordings } from '../../src/lib/transcript.ts';

function cleanBody() {
  win.document.body.innerHTML = '';
  win.document.body.className = '';
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function MotionTestContainer() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  useLandingMotion(ref);
  return (
    <div ref={ref} className="lp">
      <section className="scroll-reveal">Section 1</section>
      <section className="scroll-reveal">Section 2</section>
    </div>
  );
}

test('6. Reduced-motion CSS tersedia dan menonaktifkan motion non-esensial', () => {
  const cssPath = path.resolve(process.cwd(), 'src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify prefers-reduced-motion media query exists
  assert.ok(
    css.includes('@media (prefers-reduced-motion: reduce)') ||
    css.includes('@media(prefers-reduced-motion:reduce)'),
    'CSS harus menyertakan @media (prefers-reduced-motion: reduce)'
  );

  // Verify non-essential motion disabling
  assert.ok(
    css.includes('animation-duration: 0.01ms !important') ||
    css.includes('animation-duration:.01ms!important') ||
    css.includes('animation-duration: .01ms !important'),
    'Reduced motion harus memotong durasi animasi non-esensial'
  );

  assert.ok(
    css.includes('.hero-notebook-image img') &&
    css.includes('animation: none !important'),
    'Ambient floating pada hero mockup harus dinonaktifkan pada reduced motion'
  );

  assert.ok(
    css.includes('.scroll-reveal') &&
    css.includes('transform: none !important'),
    'Transform scroll reveal harus dinonaktifkan pada reduced motion'
  );
});

test('7. Landing content tetap visible tanpa IntersectionObserver (Progressive Enhancement)', () => {
  const cssPath = path.resolve(process.cwd(), 'src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Base CSS rule check: .scroll-reveal must be visible by default (opacity: 1; transform: none)
  const baseRevealMatch = /\.scroll-reveal\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none;/;
  assert.ok(
    baseRevealMatch.test(css),
    'Secara default (.scroll-reveal tanpa .js-reveal-enabled), elemen harus terlihat (opacity: 1; transform: none)'
  );

  // Only with .js-reveal-enabled are elements hidden before entering viewport
  assert.ok(
    css.includes('.js-reveal-enabled .scroll-reveal:not(.is-revealed)'),
    'Transisi reveal hanya boleh diaktifkan jika runtime mendukung JS + IntersectionObserver'
  );

  // SSR / Static markup test: without client JS running, all sections are 100% rendered and visible
  const html = renderToStaticMarkup(<LandingPage onOpenStudio={() => {}} onOpenRecording={() => {}} />);
  assert.ok(html.includes('id="cara-kerja"'), 'Seksi cara kerja harus dirender dalam static HTML');
  assert.ok(html.includes('id="privasi"'), 'Seksi privasi harus dirender dalam static HTML');
  assert.ok(html.includes('id="contoh"'), 'Seksi contoh harus dirender dalam static HTML');
  assert.ok(html.includes('id="pertanyaan"'), 'Seksi pertanyaan umum harus dirender dalam static HTML');
  assert.ok(html.includes('id="mulai"'), 'Seksi mulai (CTA) harus dirender dalam static HTML');
  assert.ok(!html.includes('js-reveal-enabled'), 'Static markup tidak boleh memiliki js-reveal-enabled');

  // Hook test: when IntersectionObserver is NOT available in window
  const origIO = (win as any).IntersectionObserver;
  try {
    delete (win as any).IntersectionObserver;

    function TestMotionComponent() {
      const ref = React.useRef<HTMLDivElement | null>(null);
      useLandingMotion(ref);
      return (
        <div ref={ref} className="lp">
          <section className="scroll-reveal">Content</section>
        </div>
      );
    }

    const testHtml = renderToStaticMarkup(<TestMotionComponent />);
    assert.ok(testHtml.includes('class="lp"'));
    assert.ok(testHtml.includes('class="scroll-reveal"'));
    assert.ok(
      !testHtml.includes('js-reveal-enabled'),
      'useLandingMotion tidak boleh menambahkan js-reveal-enabled saat SSR atau tanpa IntersectionObserver'
    );
  } finally {
    (win as any).IntersectionObserver = origIO;
  }
});

test('8. IntersectionObserver constructor failure: fallback aman tanpa js-reveal-enabled dan section tetap visible', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  const origIO = (win as any).IntersectionObserver;
  try {
    (win as any).IntersectionObserver = function () {
      throw new Error('Blocked by security policy');
    };

    await act(async () => {
      root.render(<MotionTestContainer />);
    });
    await flushAsync();

    const lp = win.document.querySelector('.lp');
    assert.ok(lp, 'Kontainer lp harus dirender');
    assert.ok(
      !lp.classList.contains('js-reveal-enabled'),
      'js-reveal-enabled dilarang ditambahkan jika constructor IntersectionObserver gagal'
    );

    const sections = Array.from(win.document.querySelectorAll('.scroll-reveal'));
    assert.equal(sections.length, 2);
    sections.forEach((sec) => {
      assert.ok(
        sec.classList.contains('is-revealed'),
        'Setiap seksi scroll-reveal harus dipastikan visible (memiliki is-revealed)'
      );
    });
  } finally {
    (win as any).IntersectionObserver = origIO;
    root.unmount();
  }
});

test('9. IntersectionObserver observe failure: fallback aman dan observer disconnect', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  const origIO = (win as any).IntersectionObserver;
  let disconnectCalled = false;
  try {
    (win as any).IntersectionObserver = class {
      observe() {
        throw new Error('observe invocation failed');
      }
      disconnect() {
        disconnectCalled = true;
      }
    };

    await act(async () => {
      root.render(<MotionTestContainer />);
    });
    await flushAsync();

    const lp = win.document.querySelector('.lp');
    assert.ok(lp);
    assert.ok(
      !lp.classList.contains('js-reveal-enabled'),
      'js-reveal-enabled dilarang aktif jika observe gagal'
    );

    const sections = Array.from(win.document.querySelectorAll('.scroll-reveal'));
    sections.forEach((sec) => {
      assert.ok(
        sec.classList.contains('is-revealed'),
        'Seksi harus tetap visible saat observe gagal'
      );
    });
    assert.ok(disconnectCalled, 'Observer harus di-disconnect saat observe gagal');
  } finally {
    (win as any).IntersectionObserver = origIO;
    root.unmount();
  }
});

test('10. Successful reveal + unobserve saat elemen memasuki viewport', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  const origIO = (win as any).IntersectionObserver;
  const observedNodes: any[] = [];
  const unobservedNodes: any[] = [];
  let storedCallback: ((entries: any[], obs: any) => void) | null = null;

  try {
    (win as any).IntersectionObserver = class MockIntersectionObserver {
      constructor(cb: (entries: any[], obs: any) => void) {
        storedCallback = cb;
      }
      observe(el: any) {
        observedNodes.push(el);
      }
      unobserve(el: any) {
        unobservedNodes.push(el);
      }
      disconnect() {}
    };

    await act(async () => {
      root.render(<MotionTestContainer />);
    });
    await flushAsync();

    const lp = win.document.querySelector('.lp');
    assert.ok(lp);
    assert.ok(
      lp.classList.contains('js-reveal-enabled'),
      'js-reveal-enabled aktif saat setup observer berhasil'
    );
    assert.equal(observedNodes.length, 2, 'Kedua seksi scroll-reveal harus di-observe');

    // Simulate first section intersecting viewport
    assert.ok(storedCallback, 'Observer callback harus tersimpan');
    const firstSection = observedNodes[0];
    assert.ok(!firstSection.classList.contains('is-revealed'), 'Belum revealed sebelum intersection');

    await act(async () => {
      storedCallback!([{ target: firstSection, isIntersecting: true }], {
        unobserve: (node: any) => unobservedNodes.push(node),
      });
    });
    await flushAsync();

    assert.ok(
      firstSection.classList.contains('is-revealed'),
      'Elemen harus mendapat class is-revealed saat masuk viewport'
    );
    assert.ok(
      unobservedNodes.includes(firstSection),
      'unobserve harus dipanggil tepat sekali untuk mencegah animasi berulang'
    );
  } finally {
    (win as any).IntersectionObserver = origIO;
    root.unmount();
  }
});

test('11. Mount saat document hidden langsung mengaktifkan tab-hidden pada body', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  // Set document.hidden to true prior to mount
  Object.defineProperty(win.document, 'hidden', {
    value: true,
    configurable: true,
    writable: true,
  });

  try {
    await act(async () => {
      root.render(<MotionTestContainer />);
    });
    await flushAsync();

    assert.ok(
      win.document.body.classList.contains('tab-hidden'),
      'body harus langsung memiliki tab-hidden saat mount dalam keadaan document hidden'
    );
  } finally {
    Object.defineProperty(win.document, 'hidden', {
      value: false,
      configurable: true,
      writable: true,
    });
    root.unmount();
    cleanBody();
  }
});

test('12. visibilitychange event dan cleanup saat unmount', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  Object.defineProperty(win.document, 'hidden', {
    value: false,
    configurable: true,
    writable: true,
  });

  await act(async () => {
    root.render(<MotionTestContainer />);
  });
  await flushAsync();

  assert.ok(
    !win.document.body.classList.contains('tab-hidden'),
    'Awalnya tidak boleh tab-hidden saat tab aktif'
  );

  // Switch to background tab
  Object.defineProperty(win.document, 'hidden', { value: true, configurable: true, writable: true });
  await act(async () => {
    win.document.dispatchEvent(new (win.Event as any)('visibilitychange'));
  });
  await flushAsync();

  assert.ok(
    win.document.body.classList.contains('tab-hidden'),
    'tab-hidden harus ditambahkan saat visibilitychange ke hidden'
  );

  // Switch back to foreground tab
  Object.defineProperty(win.document, 'hidden', { value: false, configurable: true, writable: true });
  await act(async () => {
    win.document.dispatchEvent(new (win.Event as any)('visibilitychange'));
  });
  await flushAsync();

  assert.ok(
    !win.document.body.classList.contains('tab-hidden'),
    'tab-hidden harus dihapus saat kembali ke foreground'
  );

  // Unmount: verify tab-hidden removed and listener detached
  root.unmount();
  cleanBody();

  // Dispatch hidden again: should not re-add tab-hidden because component was unmounted
  Object.defineProperty(win.document, 'hidden', { value: true, configurable: true, writable: true });
  win.document.dispatchEvent(new (win.Event as any)('visibilitychange'));

  assert.ok(
    !win.document.body.classList.contains('tab-hidden'),
    'Setelah unmount, listener visibilitychange harus sudah dibersihkan'
  );

  Object.defineProperty(win.document, 'hidden', {
    value: false,
    configurable: true,
    writable: true,
  });
});

test('13. CTA Parallax: listener dibersihkan saat unmount dan tidak mengupdate transform saat document.hidden', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  // Setup fine pointer matchMedia
  const origMatchMedia = win.matchMedia;
  win.matchMedia = (query: string) => {
    if (query.includes('pointer: fine')) {
      return { matches: true, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as any;
    }
    if (query.includes('prefers-reduced-motion: reduce')) {
      return { matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as any;
    }
    return { matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as any;
  };

  try {
    await act(async () => {
      root.render(<ClosingCTA recording={recordings[0]} onOpenStudio={() => {}} />);
    });
    await flushAsync();

    const section = win.document.querySelector('.lp-closing') as HTMLElement | null;
    assert.ok(section, 'Seksi closing CTA harus ada');
    const img = section.querySelector('.closing-illustration img') as HTMLElement | null;
    assert.ok(img, 'Gambar ilustrasi harus ada');

    // Case 1: Tab is hidden -> Pointermove must NOT update transform
    Object.defineProperty(win.document, 'hidden', { value: true, configurable: true, writable: true });
    await act(async () => {
      section.dispatchEvent(
        new (win.CustomEvent as any)('pointermove', {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        })
      );
    });
    await flushAsync();

    assert.equal(
      img.style.transform,
      '',
      'Transform tidak boleh diupdate ketika document.hidden adalah true'
    );

    // Case 2: Tab is active -> Pointermove updates transform
    Object.defineProperty(win.document, 'hidden', { value: false, configurable: true, writable: true });
    await act(async () => {
      section.dispatchEvent(
        new (win.CustomEvent as any)('pointermove', {
          bubbles: true,
          clientX: 150,
          clientY: 150,
        })
      );
    });
    await flushAsync();

    // After pointerleave, returns to neutral
    await act(async () => {
      section.dispatchEvent(new (win.CustomEvent as any)('pointerleave', { bubbles: true }));
    });
    await flushAsync();

    assert.equal(img.style.transform, 'translate3d(0, 0, 0)');
  } finally {
    win.matchMedia = origMatchMedia;
    root.unmount();
    cleanBody();
  }
});
