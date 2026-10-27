import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountControlView, createGuardedAction } from '../../src/components/account/AccountControl.tsx';
import { executeSignOut, type AccountSessionState } from '../../src/features/account/use-account-session.ts';

test('AccountControlView pada state guest menampilkan tombol Masuk dengan accessible label yang benar', () => {
  const html = renderToStaticMarkup(
    <AccountControlView
      status="guest"
      user={null}
      error={null}
      onSignIn={() => {}}
      onSignOut={() => {}}
    />
  );

  assert.ok(html.includes('Masuk'));
  assert.ok(html.includes('aria-label="Masuk dengan Google"') || html.includes('aria-label="Sign in with Google"'));
});

test('AccountControlView pada state loading menonaktifkan kontrol untuk mencegah double-action', () => {
  const html = renderToStaticMarkup(
    <AccountControlView
      status="loading"
      user={null}
      error={null}
      onSignIn={() => {}}
      onSignOut={() => {}}
    />
  );

  assert.ok(html.includes('disabled') || html.includes('aria-busy="true"'));
});

test('AccountControlView pada state authenticated menampilkan identitas aman dan tombol Keluar', () => {
  const html = renderToStaticMarkup(
    <AccountControlView
      status="authenticated"
      user={{
        id: 'u123',
        name: 'Ahmad Dahlan',
        email: 'ahmad@example.com',
        image: null,
      }}
      error={null}
      onSignIn={() => {}}
      onSignOut={() => {}}
    />
  );

  assert.ok(html.includes('Ahmad Dahlan'));
  assert.ok(html.includes('Keluar') || html.includes('Sign out'));
});

test('AccountControlView pada state unavailable menginformasikan bahwa Studio lokal tetap aktif dan memiliki tombol retry', () => {
  const html = renderToStaticMarkup(
    <AccountControlView
      status="unavailable"
      user={null}
      error="auth_unavailable"
      onSignIn={() => {}}
      onSignOut={() => {}}
      onRetry={() => {}}
    />
  );

  assert.ok(html.includes('Studio lokal tetap aktif') || html.includes('Local Studio stays active'));
  assert.ok(html.includes('Coba lagi') || html.includes('Retry'));
});

test('AccountControlView memenuhi target sentuh minimal 44px', () => {
  const html = renderToStaticMarkup(
    <AccountControlView
      status="guest"
      user={null}
      error={null}
      onSignIn={() => {}}
      onSignOut={() => {}}
    />
  );

  assert.ok(html.includes('account-btn') || html.includes('min-h-11'));
});

test('interaction: createGuardedAction mencegah double-submit saat aksi in-flight', async () => {
  let calls = 0;
  let finishInFlight!: () => void;
  const inFlightPromise = new Promise<void>(res => {
    finishInFlight = res;
  });

  let busyState = false;
  const guarded = createGuardedAction(
    () => {
      calls++;
      return inFlightPromise;
    },
    busy => {
      busyState = busy;
    }
  );

  assert.equal(busyState, false);

  // Trigger panggilan pertama
  const p1 = guarded();
  assert.equal(busyState, true);

  // Trigger panggilan kedua saat promise pertama belum selesai
  const p2 = guarded();

  finishInFlight();
  await p1;
  await p2;

  assert.equal(calls, 1, 'createGuardedAction hanya memanggil aksi 1 kali saat in-flight');
  assert.equal(busyState, false);
});

test('interaction: createGuardedAction untuk sign-in, sign-out, dan retry memanggil callback dengan benar', async () => {
  let signInCalled = false;
  let signOutCalled = false;
  let retryCalled = false;

  const handleSignIn = createGuardedAction(() => { signInCalled = true; });
  const handleSignOut = createGuardedAction(() => { signOutCalled = true; });
  const handleRetry = createGuardedAction(() => { retryCalled = true; });

  await handleSignIn();
  await handleSignOut();
  await handleRetry();

  assert.equal(signInCalled, true);
  assert.equal(signOutCalled, true);
  assert.equal(retryCalled, true);
});

test('sign-out failure: jika logout gagal, jangan klaim user sudah guest tetapi verifikasi server session', async () => {
  let currentState: AccountSessionState = {
    status: 'authenticated',
    user: { id: 'u1', name: 'Test User', email: 'test@example.com' },
    error: null,
  };

  const failingClient = {
    signOut: async () => {
      throw new TypeError('Failed to fetch (network error during sign out)');
    },
  };

  const fetchSessionThatRemainsAuthenticated = async (): Promise<AccountSessionState> => {
    return {
      status: 'authenticated',
      user: { id: 'u1', name: 'Test User', email: 'test@example.com' },
      error: null,
    };
  };

  const nextState = await executeSignOut(
    failingClient,
    fetchSessionThatRemainsAuthenticated,
    updated => { currentState = updated; }
  );

  // User tidak boleh dinyatakan guest jika logout gagal di server
  assert.equal(nextState.status, 'authenticated');
  assert.ok(nextState.error?.includes('network error') || nextState.error === 'sign_out_failed');
  assert.equal(currentState.status, 'authenticated');
});

test('sign-out success: jika logout berhasil, transisi ke guest secara bersih', async () => {
  let currentState: AccountSessionState = {
    status: 'authenticated',
    user: { id: 'u1', name: 'Test User', email: 'test@example.com' },
    error: null,
  };

  const successfulClient = {
    signOut: async () => {},
  };

  const fetchSessionEmpty = async (): Promise<AccountSessionState> => {
    return { status: 'guest', user: null, error: null };
  };

  const nextState = await executeSignOut(
    successfulClient,
    fetchSessionEmpty,
    updated => { currentState = updated; }
  );

  assert.equal(nextState.status, 'guest');
  assert.equal(nextState.user, null);
  assert.equal(nextState.error, null);
  assert.equal(currentState.status, 'guest');
});
