'use strict';

const http = require('http');

const DEFAULT_KIRO_PORT = 5476;

function resolveKiroConfig() {
  const port = Number(process.env.KIROCREW_PORT || DEFAULT_KIRO_PORT);
  const origin = process.env.KIROCREW_ORIGIN || `http://127.0.0.1:${port}`;
  return { port, origin };
}

function probeKiroCrew(timeoutMs = 800) {
  const { port, origin } = resolveKiroConfig();
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
      target = new URL('/', origin);
    } catch (error) {
      finish({
        ok: false,
        mock: false,
        up: false,
        status: 0,
        port,
        origin,
        error: error.message,
      });
      return;
    }

    const req = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || port,
      path: '/',
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      finish({
        ok: true,
        mock: false,
        up: res.statusCode !== 404 && res.statusCode < 500,
        status: res.statusCode,
        port,
        origin,
        error: null,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      finish({
        ok: false,
        mock: false,
        up: false,
        status: 0,
        port,
        origin,
        error: 'timeout',
      });
    });
    req.on('error', (error) => {
      finish({
        ok: false,
        mock: false,
        up: false,
        status: 0,
        port,
        origin,
        error: error.message,
      });
    });
    req.end();
  });
}

async function kiroConnectionCard() {
  const { port, origin } = resolveKiroConfig();
  const probe = await probeKiroCrew();
  let displayPort = port;
  try {
    const parsed = new URL(origin);
    if (parsed.port) {
      displayPort = Number(parsed.port);
    }
  } catch {
    displayPort = port;
  }
  return {
    label: 'Kiro Crew dashboard',
    configured: probe.up,
    available: probe.up,
    mock: false,
    url: origin,
    port: displayPort,
    statusText: probe.up
      ? `Running on ${displayPort}`
      : 'Down — run START-KIRO-CREW.ps1',
    error: probe.error,
  };
}

module.exports = {
  DEFAULT_KIRO_PORT,
  resolveKiroConfig,
  get KIRO_PORT() {
    return resolveKiroConfig().port;
  },
  get KIRO_ORIGIN() {
    return resolveKiroConfig().origin;
  },
  probeKiroCrew,
  kiroConnectionCard,
};
