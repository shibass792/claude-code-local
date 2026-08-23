'use strict';

const fs = require('fs');
const path = require('path');

const MARKER = 'shibass-os-bridge-mount';
const HEALTH_PATH = '/api/os/health';
const SB_DAW_HEALTH = 'explicit health-check path: /api/sb-daw/jobs/';

function expressSnippet(relRequire) {
  return [
    `// ${MARKER}`,
    `const { mountOsBridge, tryHandleOsBridge } = require('${relRequire}');`,
    `if (typeof app !== 'undefined' && app && typeof app.use === 'function') {`,
    `  mountOsBridge(app);`,
    `}`,
    `// explicit health-check path: ${HEALTH_PATH}`,
    '',
  ].join('\n');
}

function rawSnippet(relRequire) {
  return [
    `  // ${MARKER}`,
    `  if (require('${relRequire}').tryHandleOsBridge(req, res)) return;`,
    `  // explicit health-check path: ${HEALTH_PATH}`,
    '',
  ].join('\n');
}

function relativeRequire(serverPath) {
  const serverDir = path.dirname(path.resolve(serverPath));
  const mountPath = path.resolve(__dirname, 'proxy.js');
  let rel = path.relative(serverDir, mountPath).replace(/\\/g, '/');
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel.replace(/\.js$/, '');
}

function insertAfterLine(source, needle, snippet) {
  const idx = source.indexOf(needle);
  if (idx < 0) {
    return null;
  }
  const endOfLine = source.indexOf('\n', idx);
  if (endOfLine < 0) {
    return `${source}\n${snippet}`;
  }
  return `${source.slice(0, endOfLine + 1)}${snippet}${source.slice(endOfLine + 1)}`;
}

function patchServerSource(source, serverPath) {
  if (typeof source !== 'string') {
    throw new Error('server.js source must be a string');
  }
  if (source.includes(MARKER) && source.includes(HEALTH_PATH)) {
    return { changed: false, source, reason: 'already patched' };
  }

  const rel = relativeRequire(serverPath);
  const express = expressSnippet(rel);
  const raw = rawSnippet(rel);

  const afterSbDaw = insertAfterLine(source, SB_DAW_HEALTH, source.includes('mountSbDawJobs') ? express : raw);
  if (afterSbDaw) {
    return { changed: true, source: afterSbDaw, style: 'after-sb-daw' };
  }

  if (/\bapp\.(get|use|listen)\s*\(/.test(source)) {
    const listenAt = source.search(/\napp\.listen\s*\(/);
    if (listenAt >= 0) {
      return {
        changed: true,
        source: `${source.slice(0, listenAt)}\n${express}${source.slice(listenAt + 1)}`,
        style: 'express',
      };
    }
    return { changed: true, source: `${source.trimEnd()}\n\n${express}`, style: 'express-append' };
  }

  const handlerAt = source.search(/\n\s*(async\s+)?function\s+onRequest\s*\(/);
  if (handlerAt >= 0) {
    const brace = source.indexOf('{', handlerAt);
    if (brace >= 0) {
      return {
        changed: true,
        source: `${source.slice(0, brace + 1)}\n${raw}${source.slice(brace + 1)}`,
        style: 'onRequest',
      };
    }
  }

  const createAt = source.search(/createServer\s*\(\s*(async\s*)?\(\s*req\s*,\s*res\s*\)\s*=>\s*\{/);
  if (createAt >= 0) {
    const brace = source.indexOf('{', createAt);
    return {
      changed: true,
      source: `${source.slice(0, brace + 1)}\n${raw}${source.slice(brace + 1)}`,
      style: 'createServer',
    };
  }

  return { changed: true, source: `${source.trimEnd()}\n\n${express}`, style: 'append' };
}

function patchServerFile(serverPath) {
  if (!serverPath || !fs.existsSync(serverPath)) {
    throw new Error(`server.js not found: ${serverPath}`);
  }
  const original = fs.readFileSync(serverPath, 'utf8');
  const result = patchServerSource(original, serverPath);
  if (!result.changed) {
    return { ...result, path: serverPath };
  }
  const backup = `${serverPath}.bak-os-bridge`;
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, original, 'utf8');
  }
  fs.writeFileSync(serverPath, result.source, 'utf8');
  return { ...result, path: serverPath, backup };
}

function findServerJs(root) {
  const candidates = [
    path.join(root, 'server.js'),
    path.join(root, 'src', 'server.js'),
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) || null;
}

module.exports = {
  MARKER,
  HEALTH_PATH,
  patchServerSource,
  patchServerFile,
  findServerJs,
  relativeRequire,
};

if (require.main === module) {
  const root = process.env.SHIBASS_ROOT || process.argv[2] || process.cwd();
  const serverPath = findServerJs(root);
  if (!serverPath) {
    console.error(`No server.js under ${root}`);
    process.exit(1);
  }
  const result = patchServerFile(serverPath);
  console.log(JSON.stringify({ ok: true, ...result, source: undefined }, null, 2));
}
