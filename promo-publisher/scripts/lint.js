#!/usr/bin/env node
'use strict';

/**
 * Portable syntax check.
 *
 * The previous `node --check modules/*.js` form relies on shell glob expansion,
 * which cmd.exe does not do — on Windows it checked a literal path and passed
 * vacuously. This walks the tree itself so it behaves the same everywhere.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'output', '.electron-user-data', 'dist', '.git']);

function collect(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (SKIP.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collect(full));
    } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const files = collect(ROOT).sort();
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failures.push({ file: path.relative(ROOT, file), message: error.stderr?.toString().trim() });
  }
}

for (const failure of failures) {
  console.error(`✗ ${failure.file}\n${failure.message}\n`);
}

console.log(
  `${failures.length ? '✗' : '✓'} checked ${files.length} files — ${failures.length} error(s)`,
);
process.exit(failures.length ? 1 : 0);
