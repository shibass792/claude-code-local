const fs = require('fs');
const path = require('path');
const { patchServerFile, findServerJs, findSbDawHtml } = require('./patch-server');
const { patchFastapiFile, findFastapiApps } = require('./patch-fastapi');
const { patchSbDawHtmlFile } = require('./patch-html');
const { healthReport } = require('./health-scan');

const ROUTE = '/api/sb-daw/jobs/';

function extraRoots(primaryRoot) {
  const roots = [primaryRoot];
  if (process.env.SHIBASS_PANEL_ROOT) {
    roots.push(process.env.SHIBASS_PANEL_ROOT);
  }
  const siblingPanel = path.join(path.dirname(primaryRoot), 'shibass-ai-panel');
  if (fs.existsSync(siblingPanel)) {
    roots.push(siblingPanel);
  }
  return [...new Set(roots.map((item) => path.resolve(item)))];
}

function applySbDaw(primaryRoot, options = {}) {
  if (!primaryRoot) {
    throw new Error('applySbDaw requires a target root');
  }
  const rewriteHtml = options.rewriteHtml === true;
  const origin = options.origin || 'http://127.0.0.1:4000';
  const report = {
    ok: false,
    mock: false,
    route: ROUTE,
    root: path.resolve(primaryRoot),
    servers: [],
    fastapi: [],
    html: [],
    health: [],
    restart: [
      'Restart node server.js on port 4000 (H:\\shibass-ai).',
      'If a FastAPI file was patched, restart Synth Studio on 8788. Do not bind a new listener on 8788.',
      'Reload http://127.0.0.1:8788/sb-daw.html',
    ],
  };

  for (const root of extraRoots(primaryRoot)) {
    const serverPath = findServerJs(root);
    if (serverPath) {
      const patched = patchServerFile(serverPath);
      const source = fs.readFileSync(serverPath, 'utf8');
      report.servers.push({
        path: serverPath,
        changed: Boolean(patched.changed),
        reason: patched.reason || patched.style,
        containsRoute: source.includes(ROUTE),
      });
    }

    for (const appFile of findFastapiApps(root)) {
      const patched = patchFastapiFile(appFile);
      report.fastapi.push({
        path: appFile,
        changed: Boolean(patched.changed),
        reason: patched.reason || patched.style,
      });
    }

    for (const htmlPath of findSbDawHtml(root)) {
      let htmlResult = { path: htmlPath, changed: false, reason: 'left relative (8788 will serve the route if FastAPI was patched)' };
      if (rewriteHtml || report.fastapi.length === 0) {
        const rewritten = patchSbDawHtmlFile(htmlPath, origin);
        htmlResult = {
          path: htmlPath,
          changed: Boolean(rewritten.changed),
          reason: rewritten.reason || rewritten.absolute,
        };
      }
      report.html.push(htmlResult);

      const htmlSource = fs.readFileSync(htmlPath, 'utf8');
      if (serverPath) {
        const serverSource = fs.readFileSync(serverPath, 'utf8');
        report.health.push({
          html: htmlPath,
          server: serverPath,
          ...healthReport(htmlSource, serverSource),
        });
      }
    }
  }

  report.ok = report.servers.some((row) => row.containsRoute);
  if (!report.ok) {
    report.error = `No server.js under ${primaryRoot} contains ${ROUTE}`;
  }
  return report;
}

module.exports = {
  ROUTE,
  applySbDaw,
  extraRoots,
};

if (require.main === module) {
  const root = process.env.SHIBASS_ROOT || process.argv[2] || process.cwd();
  const rewriteHtml = process.argv.includes('--rewrite-html');
  const report = applySbDaw(root, { rewriteHtml });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}
