'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const { isBrokenPipe } = require('../modules/safe-stdio');

test('isBrokenPipe recognizes EPIPE and destroyed streams', () => {
  assert.equal(isBrokenPipe({ code: 'EPIPE' }), true);
  assert.equal(isBrokenPipe({ code: 'ERR_STREAM_DESTROYED' }), true);
  assert.equal(isBrokenPipe({ code: 'ENOENT' }), false);
  assert.equal(isBrokenPipe(new Error('boom')), false);
  assert.equal(isBrokenPipe(null), false);
  assert.equal(isBrokenPipe('EPIPE'), false);
});

test('broken-pipe writes after stdout closes do not crash the process', () => {
  const script = `
    const { installProcessGuards } = require(${JSON.stringify(
      path.join(__dirname, '../modules/safe-stdio.js'),
    )});
    installProcessGuards();
    process.stdout.destroy();
    process.stderr.destroy();
    console.log('after-destroy-log');
    console.warn('after-destroy-warn');
    console.error('after-destroy-error');
    process.emitWarning('simulated electron warning');
    process.emit('uncaughtException', Object.assign(new Error('broken pipe, write'), { code: 'EPIPE' }));
    process.stdout.write('ok\\n');
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 8000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'child exited non-zero');
  assert.equal(result.signal, null);
});

test('non-EPIPE uncaughtException is still reported and does not swallow real errors', () => {
  const script = `
    const { installProcessGuards } = require(${JSON.stringify(
      path.join(__dirname, '../modules/safe-stdio.js'),
    )});
    installProcessGuards();
    process.emit('uncaughtException', Object.assign(new Error('real failure'), { code: 'ENOENT' }));
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 8000,
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /\[fatal\]/);
  assert.match(result.stderr, /real failure/);
});
