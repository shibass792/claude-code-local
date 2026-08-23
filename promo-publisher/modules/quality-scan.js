'use strict';

/**
 * Live local quality scan. Counts real files and runs real parsers.
 * Never prints canned "0 Errors / 826,500 files / PHPStan Level 9" unless those
 * tools actually exist and those numbers were measured.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./store');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.electron-user-data',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
]);

const JS_EXT = new Set(['.js', '.cjs', '.mjs']);
const PY_EXT = new Set(['.py']);
const PS1_EXT = new Set(['.ps1']);
const PHP_EXT = new Set(['.php']);

function workspaceRoot() {
  if (process.env.SHIBASS_ROOT && fs.existsSync(process.env.SHIBASS_ROOT)) {
    return process.env.SHIBASS_ROOT;
  }
  const parent = path.join(ROOT, '..');
  if (fs.existsSync(path.join(parent, 'promo-publisher'))) {
    return parent;
  }
  return ROOT;
}

function which(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

function walkFiles(dir, acc, limits) {
  if (acc.all >= limits.maxWalk) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.all >= limits.maxWalk) {
      return;
    }
    if (entry.name.startsWith('.') && entry.name !== '.') {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      if (entry.name === '.git') continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(full, acc, limits);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    acc.all += 1;
    if (JS_EXT.has(ext)) acc.js.push(full);
    else if (PY_EXT.has(ext)) acc.py.push(full);
    else if (PS1_EXT.has(ext)) acc.ps1.push(full);
    else if (PHP_EXT.has(ext)) acc.php.push(full);
  }
}

function runNodeCheck(files) {
  const errors = [];
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8',
      timeout: 8000,
    });
    if (r.status !== 0) {
      errors.push({
        file,
        message: (r.stderr || r.stdout || 'node --check failed').trim().slice(0, 400),
      });
    }
  }
  return errors;
}

function runPyCompile(files) {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  if (!which(py) && !which('python')) {
    return { skipped: true, reason: `${py} not on PATH`, errors: [] };
  }
  const bin = which(py) ? py : 'python';
  const errors = [];
  for (const file of files) {
    const r = spawnSync(bin, ['-m', 'py_compile', file], {
      encoding: 'utf8',
      timeout: 8000,
    });
    if (r.status !== 0) {
      errors.push({
        file,
        message: (r.stderr || r.stdout || 'py_compile failed').trim().slice(0, 400),
      });
    }
  }
  return { skipped: false, errors };
}

function optionalTool(name, args) {
  if (!which(name)) {
    return { installed: false, name };
  }
  const r = spawnSync(name, args, { encoding: 'utf8', timeout: 20000 });
  return {
    installed: true,
    name,
    status: r.status,
    output: ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 800),
  };
}

function scanQuality(options = {}) {
  const started = Date.now();
  const root = options.root ? path.resolve(options.root) : workspaceRoot();
  const maxWalk = Number(options.maxWalk || 8000);
  const jsLimit = Number(options.jsLimit || 120);
  const pyLimit = Number(options.pyLimit || 40);

  const acc = { all: 0, js: [], py: [], ps1: [], php: [] };
  if (fs.existsSync(root)) {
    walkFiles(root, acc, { maxWalk });
  }

  const jsSample = acc.js.slice(0, jsLimit);
  const pySample = acc.py.slice(0, pyLimit);
  const jsErrors = runNodeCheck(jsSample);
  const py = runPyCompile(pySample);

  const phpstan = optionalTool('phpstan', ['--version']);
  const psalm = optionalTool('psalm', ['--version']);
  const eslintBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
  let eslint = { installed: false, name: 'eslint' };
  if (fs.existsSync(eslintBin)) {
    const r = spawnSync(eslintBin, ['--version'], { encoding: 'utf8', timeout: 8000 });
    eslint = { installed: true, name: 'eslint', version: (r.stdout || '').trim() };
  }

  const errorCount = jsErrors.length + (py.errors || []).length;
  const result = {
    success: true,
    source: 'live-local-scan',
    simulator: false,
    root,
    checkedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    walkedFiles: acc.all,
    capped: acc.all >= maxWalk,
    counts: {
      js: acc.js.length,
      py: acc.py.length,
      ps1: acc.ps1.length,
      php: acc.php.length,
    },
    checked: {
      js: jsSample.length,
      py: py.skipped ? 0 : pySample.length,
    },
    errors: {
      js: jsErrors,
      py: py.errors || [],
    },
    skipped: {
      python: py.skipped ? py.reason : null,
      phpstan: phpstan.installed ? null : 'phpstan not on PATH — not claimed',
      psalm: psalm.installed ? null : 'psalm not on PATH — not claimed',
      pyright: which('pyright') ? null : 'pyright not on PATH — not claimed',
      eslint: eslint.installed ? null : 'eslint not installed in promo-publisher',
    },
    tools: { phpstan, psalm, eslint },
    errorCount,
  };
  result.log = formatQualityLog(result);
  return result;
}

function formatQualityLog(report) {
  const lines = [
    `[SOURCE] live-local-scan · ran on this PC · not a template`,
    `[ROOT] ${report.root}`,
    `[WALK] ${report.walkedFiles} files (skipped node_modules/.git)${report.capped ? ' · hit cap' : ''}`,
    `[JS] found ${report.counts.js} · node --check on ${report.checked.js} · ${report.errors.js.length} syntax errors`,
    `[PY] found ${report.counts.py} · ${report.skipped.python || `py_compile on ${report.checked.py} · ${report.errors.py.length} errors`}`,
    `[PS1] found ${report.counts.ps1} · counted only (no Invoke-ScriptAnalyzer unless installed)`,
    `[PHP] found ${report.counts.php} · ${report.skipped.phpstan}`,
    `[PSALM] ${report.skipped.psalm}`,
    `[PYRIGHT] ${report.skipped.pyright}`,
    `[ESLINT] ${report.skipped.eslint || report.tools.eslint.version}`,
    `[RESULT] ${report.errorCount} parse errors in the files actually checked`,
    `[TIME] ${report.elapsedMs}ms · ${report.checkedAt}`,
  ];
  for (const err of report.errors.js.slice(0, 8)) {
    lines.push(`[JS-ERR] ${err.file}`);
    lines.push(`         ${err.message.split('\n')[0]}`);
  }
  for (const err of report.errors.py.slice(0, 8)) {
    lines.push(`[PY-ERR] ${err.file}`);
    lines.push(`         ${err.message.split('\n')[0]}`);
  }
  return lines.join('\n');
}

module.exports = {
  scanQuality,
  formatQualityLog,
  workspaceRoot,
};
