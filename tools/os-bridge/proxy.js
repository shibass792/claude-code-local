'use strict';

const http = require('http');
const { URL } = require('url');
const {
  STUDIO_PREFIXES,
  LOCAL_OS_PATHS,
  LOCAL_SB_DAW_PREFIX,
  isStudioProxyPath,
  classifyPath,
  pathnameOf,
  studioOrigin,
} = require('./routes');
const { buildScanReport } = require('./scan');

function sendJson(res, status, payload) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Filename,X-Background-Id');
  }
  if (status === 204) {
    if (typeof res.status === 'function') {
      res.status(204).end();
      return;
    }
    if (typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Filename,X-Background-Id',
      });
    }
    res.end();
    return;
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(payload);
    return;
  }
  const body = JSON.stringify(payload);
  if (typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
  }
  res.end(body);
}

function sendCors204(res) {
  sendJson(res, 204, { ok: true });
}

function probeStudio(origin, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    let target;
    try {
      target = new URL('/api/health', origin);
    } catch (error) {
      finish({ up: false, status: 0, error: error.message, origin });
      return;
    }
    const req = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname,
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      finish({
        up: res.statusCode !== 404 && res.statusCode < 500,
        status: res.statusCode,
        origin,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      finish({ up: false, status: 0, error: 'timeout', origin });
    });
    req.on('error', (error) => {
      finish({ up: false, status: 0, error: error.message, origin });
    });
    req.end();
  });
}

async function localHealth() {
  const origin = studioOrigin();
  const studio = await probeStudio(origin);
  return {
    ok: true,
    mock: false,
    port: 4000,
    path: '/api/os/health',
    studio: {
      origin,
      up: studio.up,
      status: studio.status,
      error: studio.error || null,
    },
    local: [...LOCAL_OS_PATHS, `${LOCAL_SB_DAW_PREFIX}/jobs/`],
    proxied: [...STUDIO_PREFIXES],
    note: studio.up
      ? 'Studio API is up. 4000 proxies studio /api routes to 4052.'
      : 'Studio API is down. Start promo-publisher with npm run api. Missing OPTIONS on 4000 before this bridge was a false alarm.',
  };
}

function proxyToStudio(req, res) {
  const origin = studioOrigin();
  let target;
  try {
    target = new URL(req.url, origin);
  } catch (error) {
    sendJson(res, 400, { ok: false, mock: false, error: error.message });
    return;
  }

  const headers = { ...req.headers, host: target.host };
  delete headers.connection;

  const proxyReq = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || 80,
    path: `${target.pathname}${target.search}`,
    method: req.method,
    headers,
  }, (proxyRes) => {
    const outHeaders = { ...proxyRes.headers, 'access-control-allow-origin': '*' };
    if (typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(proxyRes.statusCode || 502, outHeaders);
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, 502, {
      ok: false,
      mock: false,
      error: `Studio API not running on ${origin}`,
      studio: origin,
      detail: error.message,
    });
  });

  req.pipe(proxyReq);
}

async function dispatchLocal(req, res, pathname) {
  if (pathname === '/api/os/health') {
    sendJson(res, 200, await localHealth());
    return;
  }
  if (pathname === '/api/os/scan') {
    const root = process.env.SHIBASS_ROOT || process.cwd();
    sendJson(res, 200, buildScanReport({
      root,
      probe: false,
    }));
    return;
  }
  sendJson(res, 404, { ok: false, mock: false, error: `Unknown OS route ${pathname}` });
}

function tryHandleOsBridge(req, res) {
  const pathname = pathnameOf(req.url);
  const method = String(req.method || 'GET').toUpperCase();

  if (pathname === '/api/os/health' || pathname === '/api/os/scan') {
    if (method === 'OPTIONS') {
      sendCors204(res);
      return true;
    }
    Promise.resolve(dispatchLocal(req, res, pathname)).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, mock: false, error: error.message });
      }
    });
    return true;
  }

  if (!isStudioProxyPath(pathname)) {
    return false;
  }

  if (method === 'OPTIONS') {
    sendCors204(res);
    return true;
  }

  proxyToStudio(req, res);
  return true;
}

function mountOsBridge(app) {
  if (!app || typeof app.use !== 'function') {
    throw new Error('mountOsBridge requires an Express-style app with use()');
  }
  app.use((req, res, next) => {
    if (tryHandleOsBridge(req, res)) {
      return;
    }
    next();
  });
  return {
    ok: true,
    mock: false,
    local: [...LOCAL_OS_PATHS],
    proxied: [...STUDIO_PREFIXES],
  };
}

module.exports = {
  sendJson,
  sendCors204,
  probeStudio,
  localHealth,
  proxyToStudio,
  tryHandleOsBridge,
  mountOsBridge,
  classifyPath,
};
