import type { Env } from './env.ts';

export const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8787',
];

export const PROD_ORIGIN = 'https://catetin-project.anwars-rizki.workers.dev';

export function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, '');
  }
}

export function isLocalDevOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function getTrustedOrigins(canonicalAppOrigin: string): string[] {
  const canonical = normalizeOrigin(canonicalAppOrigin);
  if (isLocalDevOrigin(canonical)) {
    return Array.from(new Set([...DEV_ORIGINS, canonical]));
  }
  // Lingkungan produksi hanya mempercayai canonical production origin
  return [canonical];
}

export function isOriginAllowed(origin: string | null | undefined, canonicalAppOrigin: string): boolean {
  if (!origin) return true; // Direct same-origin requests may omit Origin header
  const normalized = normalizeOrigin(origin);
  const trusted = getTrustedOrigins(canonicalAppOrigin);
  return trusted.includes(normalized);
}

export function isRedirectAllowed(targetUrl: string | null | undefined, canonicalAppOrigin: string): boolean {
  if (!targetUrl) return true;
  // Relative paths are always safe same-origin redirects (except protocol-relative //)
  if (targetUrl.startsWith('/') && !targetUrl.startsWith('//')) return true;
  try {
    const targetOrigin = new URL(targetUrl).origin;
    const canonical = normalizeOrigin(canonicalAppOrigin);
    // Absolute redirect harus sama persis dengan canonical APP_ORIGIN aktif
    return targetOrigin === canonical;
  } catch {
    return false;
  }
}

export function configurationProblem(env: Env): string | null {
  const missing: string[] = [];

  if (!env.DB || typeof env.DB.prepare !== 'function') {
    missing.push('DB');
  }
  if (!env.BETTER_AUTH_SECRET || typeof env.BETTER_AUTH_SECRET !== 'string' || env.BETTER_AUTH_SECRET.length < 32) {
    missing.push('BETTER_AUTH_SECRET');
  }
  if (!env.GOOGLE_CLIENT_ID || typeof env.GOOGLE_CLIENT_ID !== 'string') {
    missing.push('GOOGLE_CLIENT_ID');
  }
  if (!env.GOOGLE_CLIENT_SECRET || typeof env.GOOGLE_CLIENT_SECRET !== 'string') {
    missing.push('GOOGLE_CLIENT_SECRET');
  }
  if (!env.APP_ORIGIN || typeof env.APP_ORIGIN !== 'string' || !isValidOrigin(env.APP_ORIGIN)) {
    missing.push('APP_ORIGIN');
  }

  if (missing.length === 0) return null;
  return `Missing or invalid configuration: ${missing.join(', ')}`;
}

function isValidOrigin(originStr: string): boolean {
  try {
    const parsed = new URL(originStr);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function jsonResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
