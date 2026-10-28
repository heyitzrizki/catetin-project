import { betterAuth } from 'better-auth';
import type { Env } from './env.ts';
import {
  getTrustedOrigins,
  isOriginAllowed,
  isRedirectAllowed,
  normalizeOrigin,
  configurationProblem,
  jsonResponse,
} from './http.ts';

export function createAuth(env: Env) {
  const canonicalBaseURL = normalizeOrigin(env.APP_ORIGIN!);
  const trustedOrigins = getTrustedOrigins(canonicalBaseURL);

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: canonicalBaseURL,
    trustedOrigins,
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      },
    },
  });
}

const AUTH_SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Vary': 'Cookie, Origin',
};

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const problem = configurationProblem(env);
  if (problem) {
    return jsonResponse({ error: 'configuration_error', message: problem }, 500, AUTH_SECURITY_HEADERS);
  }

  const canonical = normalizeOrigin(env.APP_ORIGIN!);
  const origin = request.headers.get('Origin');
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

  // 1. Strict Origin verification for mutations
  if (isMutation) {
    if (!origin) {
      return jsonResponse({ error: 'untrusted_origin', message: 'Origin header is required for mutations' }, 403, AUTH_SECURITY_HEADERS);
    }
    if (!isOriginAllowed(origin, canonical)) {
      return jsonResponse({ error: 'untrusted_origin' }, 403, AUTH_SECURITY_HEADERS);
    }
  } else {
    // Non-mutation (e.g. GET OAuth callback): verify Origin only if present
    if (origin && !isOriginAllowed(origin, canonical)) {
      return jsonResponse({ error: 'untrusted_origin' }, 403, AUTH_SECURITY_HEADERS);
    }
  }

  const url = new URL(request.url);
  const queryCallback = url.searchParams.get('callbackURL') || url.searchParams.get('redirectTo');
  if (queryCallback && !isRedirectAllowed(queryCallback, canonical)) {
    return jsonResponse({ error: 'untrusted_redirect' }, 403, AUTH_SECURITY_HEADERS);
  }

  if (request.method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const cloned = request.clone();
        const body = await cloned.json();
        if (body && typeof body === 'object') {
          const bodyCallback = (body as any).callbackURL || (body as any).redirectTo;
          if (bodyCallback && !isRedirectAllowed(bodyCallback, canonical)) {
            return jsonResponse({ error: 'untrusted_redirect' }, 403, AUTH_SECURITY_HEADERS);
          }
        }
      } catch {
        // Handled by auth handler
      }
    }
  }

  try {
    const auth = createAuth(env);
    const authRes = await auth.handler(request);

    // Build response preserving multiple Set-Cookie headers and enforcing sensitive cache policy
    const headers = new Headers();
    for (const [key, value] of authRes.headers.entries()) {
      if (key.toLowerCase() !== 'set-cookie') {
        headers.set(key, value);
      }
    }

    if (typeof (authRes.headers as any).getSetCookie === 'function') {
      const cookies = (authRes.headers as any).getSetCookie();
      for (const cookie of cookies) {
        headers.append('Set-Cookie', cookie);
      }
    } else {
      const single = authRes.headers.get('set-cookie');
      if (single) {
        headers.set('Set-Cookie', single);
      }
    }

    headers.set('Cache-Control', 'no-store');
    const existingVary = headers.get('Vary');
    const varyTokens = existingVary ? existingVary.split(',').map(s => s.trim()) : [];
    if (!varyTokens.some(v => v.toLowerCase() === 'cookie')) varyTokens.push('Cookie');
    if (!varyTokens.some(v => v.toLowerCase() === 'origin')) varyTokens.push('Origin');
    headers.set('Vary', varyTokens.join(', '));

    return new Response(authRes.body, {
      status: authRes.status,
      statusText: authRes.statusText,
      headers,
    });
  } catch {
    return jsonResponse({ error: 'auth_error' }, 500, AUTH_SECURITY_HEADERS);
  }
}
