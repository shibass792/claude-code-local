'use strict';

const fs = require('fs');
const path = require('path');
const { patchServerFile, findServerJs, HEALTH_PATH } = require('./patch-server');

function extraRoots(primaryRoot) {
  const roots = [primaryRoot];
  if (process.env.SHIBASS_PANEL_ROOT) {
    roots.push(process.env.SHIBASS_PANEL_ROOT);
  }
  return [...new Set(roots.map((item) => path.resolve(item)))];
}

function applyOsBridge(primaryRoot) {
  if (!primaryRoot) {
    throw new Error('applyOsBridge requires a target root');
  }
  const report = {
    ok: false,
    mock: false,
    route: HEALTH_PATH,
    root: path.resolve(primaryRoot),
    servers: [],
    restart: [
      'Restart node server.js on port 4000 (H:\\shibass-ai).',
      'Keep Studio API running: cd H:\\shibass-ai\\promo-publisher && npm run api (port 4052).',
      'Then run Scan-ShiBassApis.ps1. Studio /api paths on 4000 should no longer OPTIONS-404.',
    ],
  };

  for (const root of extraRoots(primaryRoot)) {
    const serverPath = findServerJs(root);
    if (!serverPath) {
      continue;
    }
    const patched = patchServerFile(serverPath);
    const source = fs.readFileSync(serverPath, 'utf8');
    report.servers.push({
      path: serverPath,
      changed: Boolean(patched.changed),
      reason: patched.reason || patched.style,
      containsRoute: source.includes(HEALTH_PATH),
    });
  }

  report.ok = report.servers.some((row) => row.containsRoute);
  if (!report.ok) {
    report.error = `No server.js under ${primaryRoot} contains ${HEALTH_PATH}`;
  }
  return report;
}

module.exports = {
  HEALTH_PATH,
  applyOsBridge,
  extraRoots,
};

if (require.main === module) {
  const root = process.env.SHIBASS_ROOT || process.argv[2] || process.cwd();
  const report = applyOsBridge(root);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}
