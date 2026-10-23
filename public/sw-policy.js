export const APP_CACHE_PREFIX = 'catetin-app-';
export const APP_CACHE = `${APP_CACHE_PREFIX}v2`;

const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|wasm)$/;

export function classifyRequest(rawUrl, mode, origin) {
  const url = new URL(rawUrl, origin);
  if (url.origin !== origin) return 'bypass';
  if (mode === 'navigate') return 'network-first';
  return HASHED_ASSET.test(url.pathname) ? 'cache-first' : 'network-first';
}

export function obsoleteAppCaches(names, current = APP_CACHE) {
  return names.filter(name => name.startsWith(APP_CACHE_PREFIX) && name !== current);
}

export function extractBuildAssets(html, origin) {
  const assets = [];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], origin);
    if (url.origin === origin && HASHED_ASSET.test(url.pathname) && !assets.includes(url.pathname)) assets.push(url.pathname);
  }
  return assets;
}

export function prepareCacheWrite(response) {
  return response.ok ? { response, cacheCopy: response.clone() } : null;
}

export function cacheKeyForRequest(rawUrl, origin) {
  const url = new URL(rawUrl, origin);
  return HASHED_ASSET.test(url.pathname) ? url.pathname : url.href;
}
