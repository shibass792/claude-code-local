const fs = require('fs');
const path = require('path');

const MARKER = 'shibass-sb-daw-jobs-mount';
const ROUTE = '/api/sb-daw/jobs/';
const HELPER_NAME = '_shibass_sb_daw_jobs.py';

function fastapiSnippet() {
  return [
    `# ${MARKER}`,
    `from ${HELPER_NAME.replace('.py', '')} import install as install_sb_daw_jobs`,
    'install_sb_daw_jobs(app)',
    `# explicit health-check path: ${ROUTE}`,
    '',
  ].join('\n');
}

function looksLikeFastapiApp(source) {
  return (
    typeof source === 'string' &&
    /FastAPI\s*\(/.test(source) &&
    /\bapp\s*=/.test(source)
  );
}

function patchFastapiSource(source) {
  if (typeof source !== 'string') {
    throw new Error('FastAPI source must be a string');
  }
  if (!looksLikeFastapiApp(source)) {
    return { changed: false, source, reason: 'not a FastAPI app' };
  }
  if (source.includes(MARKER) && source.includes(ROUTE)) {
    return { changed: false, source, reason: 'already patched' };
  }

  const snippet = fastapiSnippet();
  const anchors = [
    source.search(/\nif\s+__name__\s*==\s*['"]__main__['"]/),
    source.search(/\nuvicorn\.run\s*\(/),
  ].filter((index) => index >= 0);

  let next;
  if (anchors.length > 0) {
    const insertAt = Math.min(...anchors);
    next = `${source.slice(0, insertAt)}\n${snippet}${source.slice(insertAt + 1)}`;
  } else {
    next = `${source.trimEnd()}\n\n${snippet}`;
  }
  return { changed: true, source: next, style: 'fastapi' };
}

function copyHelper(appFile) {
  const src = path.join(__dirname, 'fastapi_jobs.py');
  const dest = path.join(path.dirname(appFile), HELPER_NAME);
  fs.copyFileSync(src, dest);
  return dest;
}

function patchFastapiFile(appFile) {
  if (!appFile || !fs.existsSync(appFile)) {
    throw new Error(`FastAPI file not found: ${appFile}`);
  }
  const original = fs.readFileSync(appFile, 'utf8');
  const result = patchFastapiSource(original);
  if (!result.changed) {
    return { ...result, path: appFile };
  }
  const helper = copyHelper(appFile);
  const backup = `${appFile}.bak-sb-daw`;
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, original, 'utf8');
  }
  fs.writeFileSync(appFile, result.source, 'utf8');
  return { ...result, path: appFile, backup, helper };
}

function collectFastapiFiles(root, preferSynth) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 3 || hits.length >= 12) {
      return;
    }
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (
        name === 'node_modules' ||
        name === '.git' ||
        name === 'venv' ||
        name === '.venv' ||
        name === '__pycache__' ||
        name === 'output'
      ) {
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
        continue;
      }
      if (!name.endsWith('.py')) {
        continue;
      }
      let text = '';
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!looksLikeFastapiApp(text)) {
        continue;
      }
      if (preferSynth && !/8788|sb-daw|synth/i.test(`${full}\n${text}`)) {
        continue;
      }
      hits.push(full);
    }
  };
  walk(root, 0);
  return hits;
}

function findFastapiApps(root) {
  const preferred = collectFastapiFiles(root, true);
  if (preferred.length > 0) {
    return [...new Set(preferred)];
  }
  return [...new Set(collectFastapiFiles(root, false))];
}

module.exports = {
  MARKER,
  ROUTE,
  HELPER_NAME,
  looksLikeFastapiApp,
  patchFastapiSource,
  patchFastapiFile,
  findFastapiApps,
  fastapiSnippet,
};
