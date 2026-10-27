import { createAuthClient } from 'better-auth/react';

// Better Auth browser client using same-origin cookies.
// Tokens and sessions are managed exclusively via HTTP-only cookies.
// No tokens are stored in localStorage or IndexedDB.
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
});

