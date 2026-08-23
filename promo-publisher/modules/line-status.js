'use strict';

const http = require('http');

function probeHttp(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 500,
        statusCode: res.statusCode,
        url,
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', url });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message, url }));
  });
}

async function getLineStatus() {
  const studioPort = Number(process.env.SHIBASS_API_PORT || 4051);
  const transcriberPort = Number(process.env.SHIBASS_TRANSCRIBER_PORT || 4340);
  const idePort = Number(process.env.SHIBASS_IDE_PORT || 4000);

  const [studio, transcriber, ide] = await Promise.all([
    probeHttp(`http://127.0.0.1:${studioPort}/api/health`),
    probeHttp(`http://127.0.0.1:${transcriberPort}/api/health`),
    probeHttp(`http://127.0.0.1:${idePort}/api/ops/health`),
  ]);

  return {
    success: true,
    checkedAt: new Date().toISOString(),
    goal14: 'Dual sprint: Audix track + Producer Pack v1 + Wave 1 ads (24.08–06.09.2026)',
    services: {
      studioApi: { port: studioPort, ...studio, role: 'Library + render + pack + psy_pack' },
      transcriber: { port: transcriberPort, ...transcriber, role: 'guide_he.md from notes/videos' },
      mainIde: {
        port: idePort,
        ...ide,
        role: 'ShiBass AI IDE (optional). Library UI should use :4051, not :4000',
        hint: ide.ok
          ? 'IDE online'
          : 'API 4000 not reachable — start H:\\shibass-ai\\server.js OR use Studio at http://127.0.0.1:4051/',
      },
    },
  };
}

module.exports = { probeHttp, getLineStatus };
