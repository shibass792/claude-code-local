'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { probeKiroCrew, kiroConnectionCard } = require('../modules/kiro-crew');

test('probe reports down when nothing listens on the Kiro port', async () => {
  const prev = process.env.KIROCREW_ORIGIN;
  process.env.KIROCREW_ORIGIN = 'http://127.0.0.1:9';
  try {
    const probe = await probeKiroCrew(400);
    assert.equal(probe.mock, false);
    assert.equal(probe.up, false);
    const card = await kiroConnectionCard();
    assert.equal(card.configured, false);
    assert.match(card.statusText, /START-KIRO-CREW/);
  } finally {
    if (prev === undefined) {
      delete process.env.KIROCREW_ORIGIN;
    } else {
      process.env.KIROCREW_ORIGIN = prev;
    }
  }
});

test('probe reports up when a local Kiro-like server answers', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('kiro');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const prev = process.env.KIROCREW_ORIGIN;
  process.env.KIROCREW_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  try {
    const probe = await probeKiroCrew(800);
    assert.equal(probe.up, true);
    assert.equal(probe.mock, false);
    const card = await kiroConnectionCard();
    assert.equal(card.configured, true);
    assert.match(card.url, /127\.0\.0\.1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prev === undefined) {
      delete process.env.KIROCREW_ORIGIN;
    } else {
      process.env.KIROCREW_ORIGIN = prev;
    }
  }
});
