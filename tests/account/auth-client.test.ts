import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionState } from '../../src/features/account/use-account-session.ts';

test('resolveSessionState menghasilkan authenticated jika user valid ada dalam payload', () => {
  const payload = {
    data: {
      user: {
        id: 'u1',
        name: 'Budi Santoso',
        email: 'budi@example.com',
        image: 'https://example.com/avatar.png',
      },
      session: {
        id: 's1',
        expiresAt: new Date(),
      },
    },
    error: null,
  };

  const state = resolveSessionState(payload, null);
  assert.equal(state.status, 'authenticated');
  assert.equal(state.user?.name, 'Budi Santoso');
  assert.equal(state.user?.email, 'budi@example.com');
  assert.equal(state.error, null);
});

test('resolveSessionState menghasilkan guest jika tidak ada sesi aktif', () => {
  const payload = { data: null, error: null };
  const state = resolveSessionState(payload, null);
  assert.equal(state.status, 'guest');
  assert.equal(state.user, null);
  assert.equal(state.error, null);
});

test('resolveSessionState menghasilkan unavailable jika terjadi network failure atau server error tanpa melempar exception', () => {
  const networkError = new TypeError('Failed to fetch');
  const state = resolveSessionState(null, networkError);
  assert.equal(state.status, 'unavailable');
  assert.equal(state.user, null);
  assert.ok(state.error);
});

test('resolveSessionState menghasilkan unavailable jika server mengembalikan error payload', () => {
  const errorPayload = {
    data: null,
    error: {
      status: 500,
      message: 'Authentication service not configured',
    },
  };
  const state = resolveSessionState(errorPayload, null);
  assert.equal(state.status, 'unavailable');
  assert.equal(state.user, null);
  assert.ok(state.error);
});

test('resolveSessionState menghasilkan guest jika payload error adalah 401 / unauthorized unauthenticated', () => {
  const unauthPayload = {
    data: null,
    error: {
      status: 401,
      message: 'Unauthorized',
    },
  };
  const state = resolveSessionState(unauthPayload, null);
  assert.equal(state.status, 'guest');
  assert.equal(state.user, null);
});

