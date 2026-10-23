# Service worker verification

- Date: 2026-10-23
- Browser: Google Chrome 156.0.8078.47, headless
- OS: Windows 11
- Build: `npm run build`
- Server: Vite preview on `http://127.0.0.1:4173`

## Online installation

A clean isolated Chrome profile opened the production build and remained active for six seconds so service-worker installation and app-shell precaching could complete. The application rendered normally.

## Offline restart

The preview server and isolated Chrome processes were stopped. The same browser profile then reopened the same URL with the server unavailable.

- Returned DOM length: 28,469 characters
- `<main>` present: yes
- React root rendered: yes
- Browser network-error page: no

The test initially exposed two real failures before passing:

1. The install cache contained HTML but not a reliable first-visit bundle path, so the worker now extracts and precaches hashed script/style assets from `index.html`.
2. Vite preview responses use `Vary: Origin`, so runtime requests did not match precached responses created with different request headers. Hashed assets now use their content-addressed pathname as the canonical cache key.

Update deferral while a transcription job is active is covered by the automated coordinator tests. A two-deployment Cloudflare rollout remains part of release verification when Task 5 reaches the deployed environment.
