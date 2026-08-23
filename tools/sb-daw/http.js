const { listJobs, getJob, createJob, patchJob } = require('./jobs');

function sendJson(res, status, payload) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    if (status === 204) {
      res.status(204).end();
      return;
    }
    res.status(status).json(payload);
    return;
  }
  const body = JSON.stringify(payload);
  if (typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
  }
  res.end(body);
}

function jobsPathname(urlPath) {
  if (!urlPath) {
    return null;
  }
  const pathname = String(urlPath).split('?')[0];
  if (pathname === '/api/sb-daw/jobs' || pathname === '/api/sb-daw/jobs/') {
    return { kind: 'collection' };
  }
  const match = pathname.match(/^\/api\/sb-daw\/jobs\/([^/]+)\/?$/);
  if (match) {
    return { kind: 'item', id: decodeURIComponent(match[1]) };
  }
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

async function dispatch(req, res, route) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return true;
  }
  try {
    if (route.kind === 'collection' && method === 'GET') {
      sendJson(res, 200, listJobs());
      return true;
    }
    if (route.kind === 'collection' && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 201, createJob(body));
      return true;
    }
    if (route.kind === 'item' && method === 'GET') {
      const found = getJob(route.id);
      if (!found) {
        sendJson(res, 404, { ok: false, mock: false, error: 'Job not found' });
        return true;
      }
      sendJson(res, 200, found);
      return true;
    }
    if (route.kind === 'item' && method === 'POST') {
      const body = await readJsonBody(req);
      const patched = patchJob(route.id, body);
      if (!patched) {
        sendJson(res, 404, { ok: false, mock: false, error: 'Job not found' });
        return true;
      }
      sendJson(res, 200, patched);
      return true;
    }
    sendJson(res, 405, { ok: false, mock: false, error: `Method ${method} not allowed` });
    return true;
  } catch (error) {
    sendJson(res, 400, { ok: false, mock: false, error: error.message });
    return true;
  }
}

function tryHandleSbDaw(req, res) {
  const route = jobsPathname(req.url);
  if (!route) {
    return false;
  }
  Promise.resolve(dispatch(req, res, route)).catch((error) => {
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, mock: false, error: error.message });
    }
  });
  return true;
}

module.exports = {
  sendJson,
  jobsPathname,
  readJsonBody,
  tryHandleSbDaw,
};
