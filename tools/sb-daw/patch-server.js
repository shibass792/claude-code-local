const fs = require('fs');
const path = require('path');

const ROUTE = '/api/sb-daw/jobs/';
const MARKER = 'shibass-sb-daw-jobs-mount';

function expressSnippet(relRequire) {
  return [
    `// ${MARKER}`,
    `const { mountSbDawJobs, tryHandleSbDaw } = require('${relRequire}');`,
    `if (typeof app !== 'undefined' && app && typeof app.get === 'function') {`,
    `  mountSbDawJobs(app);`,
    `}`,
    `// explicit health-check path: ${ROUTE}`,
    '',
  ].join('\n');
}

function rawSnippet(relRequire) {
  return [
    `  // ${MARKER}`,
    `  if (require('${relRequire}').tryHandleSbDaw(req, res)) return;`,
    `  // explicit health-check path: ${ROUTE}`,
    '',
  ].join('\n');
}

function relativeRequire(serverPath) {
  const serverDir = path.dirname(path.resolve(serverPath));
  const mountPath = path.resolve(__dirname, 'mount.js');
  let rel = path.relative(serverDir, mountPath).replace(/\\/g, '/');
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel.replace(/\.js$/, '');
}

function patchServerSource(source, serverPath) {
  if (typeof source !== 'string') {
    throw new Error('server.js source must be a string');
  }
  if (source.includes(MARKER) && source.includes(ROUTE)) {
    return { changed: false, source, reason: 'already patched' };
  }

  const rel = relativeRequire(serverPath);
  let next = source;

  if (/\bapp\.(get|use|listen)\s*\(/.test(source)) {
    const listenAt = next.search(/\napp\.listen\s*\(/);
    const snippet = expressSnippet(rel);
    if (listenAt >= 0) {
      next = `${next.slice(0, listenAt)}\n${snippet}${next.slice(listenAt + 1)}`;
    } else {
      next = `${next.trimEnd()}\n\n${snippet}`;
    }
    return { changed: true, source: next, style: 'express' };
  }

  const handlerAt = next.search(/\n\s*(async\s+)?function\s+onRequest\s*\(/);
  if (handlerAt >= 0) {
    const brace = next.indexOf('{', handlerAt);
    if (brace >= 0) {
      next = `${next.slice(0, brace + 1)}\n${rawSnippet(rel)}${next.slice(brace + 1)}`;
      return { changed: true, source: next, style: 'onRequest' };
    }
  }

  const createAt = next.search(/createServer\s*\(\s*(async\s*)?\(\s*req\s*,\s*res\s*\)\s*=>\s*\{/);
  if (createAt >= 0) {
    const brace = next.indexOf('{', createAt);
    next = `${next.slice(0, brace + 1)}\n${rawSnippet(rel)}${next.slice(brace + 1)}`;
    return { changed: true, source: next, style: 'createServer' };
  }

  next = `${next.trimEnd()}\n\n${expressSnippet(rel)}`;
  return { changed: true, source: next, style: 'append' };
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
  const backup = `${serverPath}.bak-sb-daw`;
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

function findSbDawHtml(root) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 4 || hits.length >= 8) {
      return;
    }
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === 'node_modules' || name === '.git' || name === 'output') {
        continue;
      }
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1);
      } else if (name.toLowerCase() === 'sb-daw.html') {
        hits.push(full);
      }
    }
  };
  walk(root, 0);
  return hits;
}

module.exports = {
  ROUTE,
  MARKER,
  patchServerSource,
  patchServerFile,
  findServerJs,
  findSbDawHtml,
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
