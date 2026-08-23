const { listJobs, createJob, getJob, patchJob } = require('./jobs');
const { tryHandleSbDaw, sendJson, readJsonBody } = require('./http');

function wrap(res, fn) {
  return (req, expressRes) => {
    try {
      const result = fn(req);
      if (result && typeof result.then === 'function') {
        result
          .then((payload) => sendJson(expressRes, payload.__status || 200, payload))
          .catch((error) => sendJson(expressRes, 400, { ok: false, mock: false, error: error.message }));
        return;
      }
      sendJson(expressRes, result && result.__status ? result.__status : 200, result);
    } catch (error) {
      sendJson(expressRes, 400, { ok: false, mock: false, error: error.message });
    }
  };
}

function mountSbDawJobs(app) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('mountSbDawJobs requires an Express-style app with get/post');
  }
  const list = wrap(null, () => listJobs());
  const create = async (req, res) => {
    try {
      const body = req.body && Object.keys(req.body).length > 0
        ? req.body
        : await readJsonBody(req);
      sendJson(res, 201, createJob(body));
    } catch (error) {
      sendJson(res, 400, { ok: false, mock: false, error: error.message });
    }
  };
  const one = (req, res) => {
    const found = getJob(req.params.id);
    if (!found) {
      sendJson(res, 404, { ok: false, mock: false, error: 'Job not found' });
      return;
    }
    sendJson(res, 200, found);
  };
  const update = async (req, res) => {
    try {
      const body = req.body && Object.keys(req.body).length > 0
        ? req.body
        : await readJsonBody(req);
      const patched = patchJob(req.params.id, body);
      if (!patched) {
        sendJson(res, 404, { ok: false, mock: false, error: 'Job not found' });
        return;
      }
      sendJson(res, 200, patched);
    } catch (error) {
      sendJson(res, 400, { ok: false, mock: false, error: error.message });
    }
  };

  app.get('/api/sb-daw/jobs/', list);
  app.get('/api/sb-daw/jobs', list);
  app.post('/api/sb-daw/jobs/', create);
  app.post('/api/sb-daw/jobs', create);
  app.get('/api/sb-daw/jobs/:id', one);
  app.post('/api/sb-daw/jobs/:id', update);
  return {
    ok: true,
    mock: false,
    routes: ['/api/sb-daw/jobs/', '/api/sb-daw/jobs', '/api/sb-daw/jobs/:id'],
  };
}

module.exports = {
  mountSbDawJobs,
  tryHandleSbDaw,
};
