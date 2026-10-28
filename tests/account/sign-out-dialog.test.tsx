import { win } from './dom-setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { SignOutConfirmDialog } from '../../src/components/account/SignOutConfirmDialog.tsx';
import { AccountControlView } from '../../src/components/account/AccountControl.tsx';
import { AccountCenterView } from '../../src/components/account/AccountCenter.tsx';
import { executeSignOut, type AccountSessionState } from '../../src/features/account/use-account-session.ts';

function cleanBody() {
  win.document.body.innerHTML = '';
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

test('1. Klik sign-out membuka dialog konfirmasi dan belum memanggil signOut', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let signOutCalls = 0;
  const mockSignOut = async () => {
    signOutCalls++;
  };

  await act(async () => {
    root.render(
      <AccountControlView
        status="authenticated"
        user={{
          id: 'u_1',
          name: 'Budi Santoso',
          email: 'budi@example.com',
          image: null,
        }}
        error={null}
        onSignIn={() => {}}
        onSignOut={mockSignOut}
      />
    );
  });
  await flushAsync();

  // Find Keluar button in AccountControl
  const signoutBtn = win.document.querySelector('.account-btn-signout') as HTMLButtonElement | null;
  assert.ok(signoutBtn, 'Tombol Keluar harus ada di header');

  // Dialog should not be open yet
  assert.strictEqual(signOutCalls, 0);
  assert.ok(!win.document.body.textContent?.includes('Konfirmasi keluar'));

  // Click Keluar
  await act(async () => {
    signoutBtn.click();
  });
  await flushAsync();

  // Dialog should now be open, but signOut must NOT have been called yet
  assert.strictEqual(signOutCalls, 0, 'signOut belum boleh dipanggil saat dialog baru dibuka');
  assert.ok(win.document.body.textContent?.includes('Konfirmasi keluar'), 'Dialog harus menampilkan judul Konfirmasi keluar');
  assert.ok(
    win.document.body.textContent?.includes('hanya mengakhiri sesi akun') &&
    win.document.body.textContent?.includes('tetap tersimpan aman di penyimpanan lokal'),
    'Dialog harus menjelaskan bahwa data lokal tetap aman'
  );

  root.unmount();
});

test('2. Konfirmasi memanggil signOut tepat sekali dan menutup dialog setelah sukses', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let signOutCalls = 0;
  let isOpen = true;
  const mockSignOut = async () => {
    signOutCalls++;
  };

  await act(async () => {
    root.render(
      <SignOutConfirmDialog
        open={isOpen}
        onOpenChange={(open) => {
          isOpen = open;
        }}
        onConfirm={mockSignOut}
      />
    );
  });
  await flushAsync();

  // Find confirm button ("Keluar dari akun")
  const buttons = Array.from(win.document.querySelectorAll('button')) as any[];
  const confirmBtn = buttons.find((b) => b.textContent?.includes('Keluar dari akun'));
  assert.ok(confirmBtn, 'Tombol konfirmasi "Keluar dari akun" harus ada');

  await act(async () => {
    confirmBtn.click();
  });
  await flushAsync();

  assert.strictEqual(signOutCalls, 1, 'signOut harus dipanggil tepat sekali');
  assert.strictEqual(isOpen, false, 'Dialog harus ditutup setelah signOut sukses');

  root.unmount();
});

test('3. Batal dan Escape menutup dialog tanpa memanggil signOut', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let signOutCalls = 0;
  let isOpen = true;
  const mockSignOut = async () => {
    signOutCalls++;
  };

  // Test Batal button
  await act(async () => {
    root.render(
      <SignOutConfirmDialog
        open={isOpen}
        onOpenChange={(open) => {
          isOpen = open;
        }}
        onConfirm={mockSignOut}
      />
    );
  });
  await flushAsync();

  const buttons = Array.from(win.document.querySelectorAll('button')) as any[];
  const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Batal');
  assert.ok(cancelBtn, 'Tombol Batal harus ada');

  await act(async () => {
    cancelBtn.click();
  });
  await flushAsync();

  assert.strictEqual(signOutCalls, 0, 'signOut tidak boleh dipanggil saat menekan Batal');
  assert.strictEqual(isOpen, false, 'Dialog harus ditutup saat menekan Batal');

  // Test Escape key
  isOpen = true;
  await act(async () => {
    root.render(
      <SignOutConfirmDialog
        open={isOpen}
        onOpenChange={(open) => {
          isOpen = open;
        }}
        onConfirm={mockSignOut}
      />
    );
  });
  await flushAsync();

  // Dispatch Escape key
  await act(async () => {
    win.document.dispatchEvent(new (win.KeyboardEvent as any)('keydown', { key: 'Escape', bubbles: true }));
  });
  await flushAsync();

  assert.strictEqual(signOutCalls, 0, 'signOut tidak boleh dipanggil saat menekan Escape');

  root.unmount();
});

test('4. Initial focus wajib pada Batal dan fokus kembali ke trigger saat ditutup', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let signOutCalls = 0;
  await act(async () => {
    root.render(
      <AccountControlView
        status="authenticated"
        user={{
          id: 'u_2',
          name: 'Siti Rahma',
          email: 'siti@example.com',
          image: null,
        }}
        error={null}
        onSignIn={() => {}}
        onSignOut={async () => {
          signOutCalls++;
        }}
      />
    );
  });
  await flushAsync();

  const signoutBtn = win.document.querySelector('.account-btn-signout') as any;
  assert.ok(signoutBtn);
  signoutBtn.focus();
  assert.strictEqual(win.document.activeElement, signoutBtn);

  // Click Keluar to open dialog
  await act(async () => {
    signoutBtn.click();
  });
  await flushAsync();

  // Radix dialog onOpenAutoFocus focuses the Batal button
  const buttons = Array.from(win.document.querySelectorAll('button')) as any[];
  const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Batal');
  assert.ok(cancelBtn, 'Tombol Batal harus ditemukan');

  // Verify focus was moved to Batal
  assert.strictEqual(win.document.activeElement, cancelBtn, 'Initial focus harus berada pada tombol Batal');

  // Cancel dialog and verify focus restoration to the sign-out trigger
  await act(async () => {
    cancelBtn.click();
  });
  await flushAsync();

  assert.strictEqual(win.document.activeElement, signoutBtn, 'Fokus harus kembali ke trigger setelah dialog ditutup');

  root.unmount();
});

test('5. Rapid double-click tidak menggandakan sign-out dan error kegagalan dapat dicoba lagi', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let calls = 0;
  let shouldFail = true;
  let resolveFirstCall!: () => void;
  const inFlightPromise = new Promise<void>((res) => {
    resolveFirstCall = res;
  });

  const controlledSignOut = async () => {
    calls++;
    if (shouldFail) {
      await inFlightPromise;
      throw new Error('Koneksi internet terputus');
    }
  };

  let isOpen = true;
  await act(async () => {
    root.render(
      <SignOutConfirmDialog
        open={isOpen}
        onOpenChange={(open) => {
          isOpen = open;
        }}
        onConfirm={controlledSignOut}
      />
    );
  });
  await flushAsync();

  const buttons = Array.from(win.document.querySelectorAll('button')) as any[];
  const confirmBtn = buttons.find((b) => b.textContent?.includes('Keluar dari akun'));
  assert.ok(confirmBtn);

  // Rapid double-click while in-flight
  await act(async () => {
    confirmBtn.click();
    confirmBtn.click();
  });

  assert.strictEqual(calls, 1, 'Hanya boleh memicu 1 panggilan signOut saat in-flight');

  // Resolve the failure
  await act(async () => {
    resolveFirstCall();
  });
  await flushAsync();

  // Dialog must NOT close on error, and must show retryable alert
  assert.strictEqual(isOpen, true, 'Dialog jangan ditutup jika sign-out gagal');
  const alertEl = win.document.querySelector('[role="alert"]');
  assert.ok(alertEl, 'Alert error harus ditampilkan');
  assert.ok(alertEl.textContent?.includes('Koneksi internet terputus'));

  // Retry after fixing error
  shouldFail = false;
  await act(async () => {
    confirmBtn.click();
  });
  await flushAsync();

  assert.strictEqual(calls, 2, 'Pengguna dapat mencoba lagi (retryable)');
  assert.strictEqual(isOpen, false, 'Dialog ditutup setelah percobaan kedua berhasil');

  root.unmount();
});

test('6. Dialog benar-benar unmount dari DOM setelah Batal atau Escape', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  function StatefulHost() {
    const [open, setOpen] = React.useState(true);
    return (
      <SignOutConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={async () => {}}
      />
    );
  }

  // Case A: Unmount after clicking Batal
  await act(async () => {
    root.render(<StatefulHost key="case-a" />);
  });
  await flushAsync();

  assert.ok(win.document.querySelector('[role="dialog"]'), 'Dialog harus ada di DOM saat open=true');

  const buttons = Array.from(win.document.querySelectorAll('button')) as any[];
  const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Batal');
  assert.ok(cancelBtn, 'Tombol Batal harus ada');

  await act(async () => {
    cancelBtn.click();
  });
  await flushAsync();

  assert.equal(
    win.document.querySelector('[role="dialog"]'),
    null,
    'Dialog harus benar-benar unmount dari DOM setelah menekan Batal'
  );

  // Case B: Unmount after pressing Escape
  await act(async () => {
    root.render(<StatefulHost key="case-b" />);
  });
  await flushAsync();

  assert.ok(win.document.querySelector('[role="dialog"]'), 'Dialog harus terbuka kembali');

  await act(async () => {
    win.document.dispatchEvent(
      new (win.KeyboardEvent as any)('keydown', { key: 'Escape', bubbles: true })
    );
  });
  await flushAsync();

  assert.equal(
    win.document.querySelector('[role="dialog"]'),
    null,
    'Dialog harus benar-benar unmount dari DOM setelah menekan Escape'
  );

  root.unmount();
});

test('7. AccountControl dan AccountCenter sama-sama memakai konfirmasi sebelum sign-out', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let controlSignOutCalls = 0;
  let centerSignOutCalls = 0;

  const testUser = {
    id: 'u_test_sync',
    name: 'Dewi Lestari',
    email: 'dewi@example.com',
    image: null,
  };

  // 1. Check AccountControlView
  await act(async () => {
    root.render(
      <AccountControlView
        status="authenticated"
        user={testUser}
        error={null}
        onSignIn={() => {}}
        onSignOut={async () => {
          controlSignOutCalls++;
        }}
      />
    );
  });
  await flushAsync();

  const controlSignOutBtn = win.document.querySelector('.account-btn-signout') as HTMLButtonElement | null;
  assert.ok(controlSignOutBtn, 'Tombol sign-out AccountControl harus ada');

  await act(async () => {
    controlSignOutBtn.click();
  });
  await flushAsync();

  assert.equal(controlSignOutCalls, 0, 'AccountControl tidak boleh memanggil signOut sebelum konfirmasi');
  assert.ok(
    win.document.querySelector('[role="dialog"]'),
    'AccountControl harus membuka dialog konfirmasi'
  );

  // Close dialog via Batal
  const cancelBtn1 = Array.from(win.document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Batal'
  ) as HTMLButtonElement | undefined;
  await act(async () => {
    cancelBtn1?.click();
  });
  await flushAsync();

  // 2. Check AccountCenterView
  await act(async () => {
    root.render(
      <AccountCenterView
        status="authenticated"
        user={testUser}
        currentSessionId="s_1"
        summary={{
          user: { id: testUser.id, name: testUser.name, email: testUser.email, image: null, createdAt: new Date().toISOString() },
          usage: {
            totals: {
              local_transcription_completed: 2,
              transcript_export_completed: 1,
              catetin_backup_completed: 1,
            },
            recentDaily: [],
            totalCount: 4,
          },
        }}
        sessions={[
          {
            id: 's_1',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            userAgent: 'Mozilla/5.0 Chrome',
            isCurrent: true,
          },
        ]}
        onBack={() => {}}
        onSignOut={async () => {
          centerSignOutCalls++;
        }}
        onRevokeOtherSessions={async () => {}}
        onRevokeSession={async () => {}}
        onDeleteAccount={async () => {}}
        onRetry={() => {}}
        onSignIn={() => {}}
      />
    );
  });
  await flushAsync();

  const centerSignOutBtn = Array.from(win.document.querySelectorAll('button')).find(
    (b) => b.textContent?.includes('Keluar') && !b.closest('[role="dialog"]')
  ) as HTMLButtonElement | undefined;
  assert.ok(centerSignOutBtn, 'Tombol Keluar pada AccountCenter harus ada');

  await act(async () => {
    centerSignOutBtn.click();
  });
  await flushAsync();

  assert.equal(centerSignOutCalls, 0, 'AccountCenter tidak boleh memanggil signOut sebelum konfirmasi');
  assert.ok(
    win.document.querySelector('[role="dialog"]'),
    'AccountCenter harus membuka dialog konfirmasi'
  );

  root.unmount();
});

test('8. Integrasi real executeSignOut: kegagalan mempertahankan dialog dan retry berhasil', async () => {
  cleanBody();
  const rootEl = win.document.createElement('div');
  win.document.body.appendChild(rootEl);
  const root = ReactDOM.createRoot(rootEl as any);

  let serverStatus = 'error';
  let currentState: AccountSessionState = {
    status: 'authenticated',
    user: { id: 'u_real_1', name: 'User Real', email: 'user.real@example.com', image: null },
    error: null,
  };

  const mockClient = {
    signOut: async () => {
      if (serverStatus === 'error') {
        return { error: { message: 'Cloud service temporarily unavailable' } };
      }
      return undefined;
    },
  };

  const fetchSession = async (): Promise<AccountSessionState> => {
    if (serverStatus === 'error') {
      return {
        status: 'authenticated',
        user: { id: 'u_real_1', name: 'User Real', email: 'user.real@example.com', image: null },
        error: null,
      };
    }
    return { status: 'guest', user: null, error: null };
  };

  const realSignOut = async (): Promise<{ success: true }> => {
    const nextState = await executeSignOut(
      mockClient,
      fetchSession,
      (next) => {
        currentState = next;
      }
    );
    if (nextState.status !== 'guest' || nextState.error) {
      throw new Error(nextState.error || 'sign_out_failed');
    }
    return { success: true };
  };

  function RealSessionHost() {
    const [open, setOpen] = React.useState(true);
    return (
      <SignOutConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={realSignOut}
      />
    );
  }

  await act(async () => {
    root.render(<RealSessionHost />);
  });
  await flushAsync();

  const confirmBtn = Array.from(win.document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Keluar dari akun')
  ) as HTMLButtonElement | undefined;
  assert.ok(confirmBtn, 'Tombol konfirmasi harus ada');

  // Attempt sign out while server returns error
  await act(async () => {
    confirmBtn.click();
  });
  await flushAsync();

  // Dialog must stay open and display error alert
  assert.ok(
    win.document.querySelector('[role="dialog"]'),
    'Dialog harus tetap terbuka jika executeSignOut gagal'
  );
  const alertEl = win.document.querySelector('[role="alert"]');
  assert.ok(alertEl, 'Alert error harus ditampilkan');
  assert.ok(alertEl.textContent?.includes('Cloud service temporarily unavailable'));
  assert.equal(currentState.status, 'authenticated');

  // Server recovers
  serverStatus = 'success';

  // Retry
  await act(async () => {
    confirmBtn.click();
  });
  await flushAsync();

  // Now dialog must close
  assert.equal(
    win.document.querySelector('[role="dialog"]'),
    null,
    'Dialog harus tertutup setelah retry berhasil'
  );
  assert.equal(currentState.status, 'guest');
  assert.equal(currentState.error, null);

  root.unmount();
});
