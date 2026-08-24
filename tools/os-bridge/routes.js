'use strict';

const STUDIO_PREFIXES = Object.freeze([
  '/api/db',
  '/api/engines',
  '/api/log',
  '/api/render',
  '/api/hooks',
  '/api/instagram',
  '/api/music',
  '/api/catalog',
  '/api/backgrounds',
  '/api/radar',
  '/api/approval',
  '/api/career',
  '/api/pack',
  '/api/connections',
  '/api/media',
  '/api/file',
  '/api/mcp',
  '/api/scan',
]);

const LOCAL_OS_PATHS = Object.freeze([
  '/api/os/health',
  '/api/os/scan',
  '/api/ops/health',
]);

const LOCAL_SB_DAW_PREFIX = '/api/sb-daw';
const LOCAL_IDE_HEALTH = '/api/health';
const OLLAMA_PATHS = Object.freeze(['/api/tags', '/api/generate']);

function pathnameOf(urlPath) {
  if (!urlPath) {
    return '';
  }
  return String(urlPath).split('?')[0];
}

function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isStudioProxyPath(urlPath) {
  const pathname = pathnameOf(urlPath);
  if (!pathname.startsWith('/api/')) {
    return false;
  }
  if (pathname === LOCAL_IDE_HEALTH || matchesPrefix(pathname, '/api/os') || matchesPrefix(pathname, LOCAL_SB_DAW_PREFIX)) {
    return false;
  }
  if (OLLAMA_PATHS.includes(pathname)) {
    return false;
  }
  return STUDIO_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

function classifyPath(urlPath) {
  const pathname = pathnameOf(urlPath);
  if (!pathname.startsWith('/api/')) {
    return { pathname, host: null, kind: 'not-api' };
  }
  if (pathname === LOCAL_IDE_HEALTH) {
    return { pathname, host: 4000, kind: 'local-ide' };
  }
  if (matchesPrefix(pathname, '/api/os') || matchesPrefix(pathname, '/api/ops')) {
    return { pathname, host: 4000, kind: 'os-bridge' };
  }
  if (matchesPrefix(pathname, LOCAL_SB_DAW_PREFIX)) {
    return { pathname, host: 4000, kind: 'sb-daw' };
  }
  if (OLLAMA_PATHS.includes(pathname)) {
    return { pathname, host: 11434, kind: 'ollama' };
  }
  if (isStudioProxyPath(pathname)) {
    return { pathname, host: 4052, kind: 'studio-proxy' };
  }
  return { pathname, host: null, kind: 'unknown' };
}

function studioOrigin() {
  return process.env.STUDIO_API_ORIGIN || 'http://127.0.0.1:4052';
}

module.exports = {
  STUDIO_PREFIXES,
  LOCAL_OS_PATHS,
  LOCAL_SB_DAW_PREFIX,
  LOCAL_IDE_HEALTH,
  OLLAMA_PATHS,
  pathnameOf,
  matchesPrefix,
  isStudioProxyPath,
  classifyPath,
  studioOrigin,
};
