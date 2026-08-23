'use strict';

/**
 * Electron on Windows inherits the parent console. When that parent is a
 * PowerShell pipeline, a closed cmd window, or `npm start` after the launcher
 * has already exited, the next `console.error` / process warning write hits a
 * closed pipe and throws `EPIPE: broken pipe, write`.
 *
 * Node then surfaces that as an uncaughtException in the Electron main
 * process — the dialog the user sees. Swallowing EPIPE on stdout/stderr and
 * never re-logging it through console.error stops the crash.
 */

function isBrokenPipe(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }
  return err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED';
}

function swallowBrokenPipe(stream) {
  if (!stream || typeof stream.on !== 'function') {
    return;
  }
  stream.on('error', (err) => {
    if (isBrokenPipe(err)) {
      return;
    }
  });
}

function wrapConsoleMethod(methodName) {
  const original = console[methodName].bind(console);
  console[methodName] = (...args) => {
    try {
      original(...args);
    } catch (err) {
      if (!isBrokenPipe(err)) {
        throw err;
      }
    }
  };
  return original;
}

const originalError = wrapConsoleMethod('error');
wrapConsoleMethod('warn');
wrapConsoleMethod('log');

swallowBrokenPipe(process.stdout);
swallowBrokenPipe(process.stderr);

function installProcessGuards() {
  if (installProcessGuards.installed) {
    return;
  }
  installProcessGuards.installed = true;

  process.on('uncaughtException', (err) => {
    if (isBrokenPipe(err)) {
      return;
    }
    try {
      originalError('[fatal]', err);
    } catch (writeErr) {
      if (!isBrokenPipe(writeErr)) {
        throw writeErr;
      }
    }
  });

  process.on('unhandledRejection', (reason) => {
    if (isBrokenPipe(reason)) {
      return;
    }
    try {
      originalError('[unhandled]', reason);
    } catch (writeErr) {
      if (!isBrokenPipe(writeErr)) {
        throw writeErr;
      }
    }
  });
}

module.exports = {
  isBrokenPipe,
  installProcessGuards,
  swallowBrokenPipe,
};
