'use strict';

/**
 * Windows-safe file:// URL. `file://H:/x.wav` does not play; `file:///H:/x.wav` does.
 */
function toFileUrl(absPath) {
  if (!absPath || typeof absPath !== 'string') {
    return null;
  }
  const p = absPath.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) {
    return `file:///${p}`;
  }
  if (p.startsWith('/')) {
    return `file://${p}`;
  }
  return `file:///${p}`;
}

function studioStreamUrl(item) {
  const port = Number(process.env.SHIBASS_API_PORT || 4051);
  if (item?.id) {
    return `http://127.0.0.1:${port}/api/media/stream?id=${encodeURIComponent(item.id)}`;
  }
  if (item?.path) {
    return `http://127.0.0.1:${port}/api/media/stream?path=${encodeURIComponent(item.path)}`;
  }
  return null;
}

module.exports = { toFileUrl, studioStreamUrl };
