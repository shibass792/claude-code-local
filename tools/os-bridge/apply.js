'use strict';

const fs = require('fs');
const path = require('path');
const { patchServerFile, findServerJs, HEALTH_PATH } = require('./patch-server');

const STANDALONE_MARKER = 'shibass-os-bridge-standalone';

function standaloneServerSource() {
  return [
    "'use strict';",
    `// ${STANDALONE_MARKER}`,
    `// explicit health-check path: ${HEALTH_PATH}`,
    "const { listenOsBridge } = require('./tools/os-bridge/listen');",
    'const port = Number(process.env.OS_PORT || 4000);',
    'listenOsBridge(port).catch((error) => {',
    '  console.error(error);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}

function writeStandaloneServer(root) {
  const dest = path.join(root, 'server.js');
  fs.writeFileSync(dest, standaloneServerSource(), 'utf8');
  return dest;
}

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
      'Start or restart H:\\shibass-ai\\START-OS-SERVER.cmd (port 4000).',
      'Start H:\\shibass-ai\\START-STUDIO-API.cmd (port 4052).',
      'Then run Scan.ps1. Studio /api paths on 4000 should no longer OPTIONS-404.',
    ],
  };

  for (const root of extraRoots(primaryRoot)) {
    let serverPath = findServerJs(root);
    if (!serverPath) {
      serverPath = writeStandaloneServer(root);
      const source = fs.readFileSync(serverPath, 'utf8');
      report.servers.push({
        path: serverPath,
        changed: true,
        reason: 'wrote-standalone',
        containsRoute: source.includes(HEALTH_PATH),
      });
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
  STANDALONE_MARKER,
  applyOsBridge,
  extraRoots,
  writeStandaloneServer,
  standaloneServerSource,
};

if (require.main === module) {
  const root = process.env.SHIBASS_ROOT || process.argv[2] || process.cwd();
  const report = applyOsBridge(root);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}
