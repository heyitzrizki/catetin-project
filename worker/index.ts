import type { Env, ExecutionContext } from './env.ts';
import { handleAuthRequest } from './auth.ts';
import { handleAccountRequest } from './account.ts';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
      return handleAuthRequest(request, env);
    }

    if (url.pathname === '/api/account' || url.pathname.startsWith('/api/account/')) {
      return handleAccountRequest(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
