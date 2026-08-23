'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { classifyPath, STUDIO_PREFIXES, LOCAL_OS_PATHS } = require('./routes');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.cursor',
  'output',
  'media',
  'FM',
  'FX',
  'Kick',
  'dist',
  'coverage',
]);

const SKIP_FILES = new Set([
  'scan.js',
  'routes.js',
  'os-bridge.test.js',
]);

const EXTRACT_PATTERNS = [
  /(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*[`'"](?:window\.__getApiBase\(\)\s*\+\s*)?(\/api\/[^`'"]+)/g,
  /json\(\s*['"](?:GET|POST|PUT|DELETE)['"]\s*,\s*[`'"](\/api\/[^`'"]+)/g,
  /['"`](\/api\/[A-Za-z0-9_\-\/\${}]+)['"`]/g,
];

function normalizeEndpoint(raw) {
  if (!raw) {
    return '';
  }
  let value = String(raw).split('?')[0];
  value = value.replace(/\$\{[^}]+\}/g, '');
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1 && value.endsWith('/') && !value.endsWith('jobs/')) {
    value = value.replace(/\/+$/, '');
  }
  return value;
}

function extractApiPaths(source) {
  if (typeof source !== 'string' || !source) {
    return [];
  }
  const found = new Set();
  for (const pattern of EXTRACT_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      const normalized = normalizeEndpoint(match[1]);
      if (normalized.startsWith('/api/')) {
        found.add(normalized);
      }
      match = pattern.exec(source);
    }
  }
  return [...found].sort();
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

function shouldSkipFile(fullPath) {
  const base = path.basename(fullPath);
  if (SKIP_FILES.has(base) && fullPath.replace(/\\/g, '/').includes('/os-bridge/')) {
    return true;
  }
  const ext = path.extname(base).toLowerCase();
  return ext !== '.js' && ext !== '.html';
}

function walkFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  const maxFiles = options.maxFiles ?? 2000;
  const files = [];

  const visit = (dir, depth) => {
    if (depth > maxDepth || files.length >= maxFiles) {
      return;
    }
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (files.length >= maxFiles) {
        return;
      }
      if (shouldSkipDir(name)) {
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
        visit(full, depth + 1);
      } else if (!shouldSkipFile(full)) {
        files.push(full);
      }
    }
  };

  visit(path.resolve(root), 0);
  return files;
}

function collectEndpoints(root, options = {}) {
  const files = walkFiles(root, options);
  const byEndpoint = new Map();

  for (const filePath of files) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const endpoint of extractApiPaths(content)) {
      const row = byEndpoint.get(endpoint) || {
        endpoint,
        ...classifyPath(endpoint),
        files: [],
      };
      const relative = path.relative(root, filePath).replace(/\\/g, '/');
      if (!row.files.includes(relative)) {
        row.files.push(relative);
      }
      byEndpoint.set(endpoint, row);
    }
  }

  return [...byEndpoint.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

function requestOnce(origin, pathname, method) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(pathname, origin);
    } catch (error) {
      resolve({ origin, pathname, method, status: 0, ok: false, error: error.message, down: true });
      return;
    }
    const req = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method,
      timeout: 2500,
    }, (res) => {
      res.resume();
      resolve({
        origin,
        pathname,
        method,
        status: res.statusCode,
        ok: res.statusCode !== 404,
        down: false,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ origin, pathname, method, status: 0, ok: false, error: 'timeout', down: true });
    });
    req.on('error', (error) => {
      resolve({
        origin,
        pathname,
        method,
        status: 0,
        ok: false,
        error: error.message,
        down: true,
      });
    });
    req.end();
  });
}

async function probeEndpoints(endpoints, osOrigin, studioOrigin) {
  const osHealth = await requestOnce(osOrigin, '/api/os/health', 'GET');
  const studioHealth = await requestOnce(studioOrigin, '/api/health', 'GET');
  const probes = [];

  for (const item of endpoints) {
    if (item.kind === 'ollama' || item.kind === 'not-api') {
      continue;
    }
    const options = await requestOnce(osOrigin, item.endpoint, 'OPTIONS');
    probes.push({
      endpoint: item.endpoint,
      kind: item.kind,
      options,
    });
  }

  return {
    os: osHealth,
    studio: studioHealth,
    probes,
  };
}

function summarize(endpoints, live) {
  const groups = {
    'os-bridge': [],
    'sb-daw': [],
    'local-ide': [],
    'studio-proxy': [],
    ollama: [],
    unknown: [],
  };
  for (const item of endpoints) {
    const bucket = groups[item.kind] || groups.unknown;
    bucket.push(item.endpoint);
  }

  const missingOnOs = [];
  const workingOnOs = [];
  if (live && Array.isArray(live.probes)) {
    for (const probe of live.probes) {
      if (probe.options.down) {
        continue;
      }
      if (probe.options.ok) {
        workingOnOs.push(probe.endpoint);
      } else {
        missingOnOs.push(probe.endpoint);
      }
    }
  }

  return {
    counts: {
      total: endpoints.length,
      studioProxy: groups['studio-proxy'].length,
      local4000: groups['os-bridge'].length + groups['sb-daw'].length + groups['local-ide'].length,
      ollama: groups.ollama.length,
      unknown: groups.unknown.length,
    },
    groups,
    workingOnOs,
    missingOnOs,
    osDown: Boolean(live && live.os && live.os.down),
    studioDown: Boolean(live && live.studio && live.studio.down),
  };
}

function buildScanReport(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const osOrigin = options.osOrigin || 'http://127.0.0.1:4000';
  const studioOriginUrl = options.studioOrigin || 'http://127.0.0.1:4052';
  const endpoints = collectEndpoints(root, options);
  const report = {
    ok: true,
    mock: false,
    root,
    osOrigin,
    studioOrigin: studioOriginUrl,
    generatedAt: new Date().toISOString(),
    endpoints,
    summary: summarize(endpoints),
    live: null,
    note: [
      'Studio UI /api routes belong on 4052 (npm run api).',
      'After INSTALL-OS-BRIDGE.ps1, port 4000 proxies those prefixes and answers OPTIONS 204.',
      'Do not treat a 4000 OPTIONS 404 as a missing backend if 4052 already serves the route.',
    ].join(' '),
    localOs: [...LOCAL_OS_PATHS],
    studioPrefixes: [...STUDIO_PREFIXES],
  };
  return report;
}

async function runScan(options = {}) {
  const report = buildScanReport(options);
  if (options.probe) {
    report.live = await probeEndpoints(report.endpoints, report.osOrigin, report.studioOrigin);
    report.summary = summarize(report.endpoints, report.live);
  }
  return report;
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    osOrigin: 'http://127.0.0.1:4000',
    studioOrigin: 'http://127.0.0.1:4052',
    probe: false,
    out: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root' && next) {
      options.root = next;
      i += 1;
    } else if (arg === '--os' && next) {
      options.osOrigin = next;
      i += 1;
    } else if (arg === '--studio' && next) {
      options.studioOrigin = next;
      i += 1;
    } else if (arg === '--out' && next) {
      options.out = next;
      i += 1;
    } else if (arg === '--probe') {
      options.probe = true;
    }
  }
  return options;
}

function printReport(report) {
  const { summary } = report;
  console.log(`[scan] root=${report.root}`);
  console.log(`[scan] ${summary.counts.total} unique /api paths`);
  console.log(`[scan] studio-proxy (4052 via 4000): ${summary.counts.studioProxy}`);
  console.log(`[scan] local 4000: ${summary.counts.local4000}`);
  console.log(`[scan] ollama (not 4000): ${summary.counts.ollama}`);
  console.log(`[scan] unknown: ${summary.counts.unknown}`);

  if (summary.osDown) {
    console.log('[!] OS server is not answering on 4000. Start node server.js first.');
  }
  if (summary.studioDown) {
    console.log('[!] Studio API is not answering on 4052. Run: cd promo-publisher && npm run api');
  }

  if (summary.workingOnOs.length) {
    console.log('[OK] Present on 4000 (OPTIONS not 404):');
    for (const endpoint of summary.workingOnOs) {
      console.log(`  + ${endpoint}`);
    }
  }
  if (summary.missingOnOs.length) {
    console.log('[!!] OPTIONS 404 on 4000 (install the OS bridge, or this path is unknown):');
    for (const endpoint of summary.missingOnOs) {
      console.log(`  - ${endpoint}`);
    }
  }
  if (summary.groups.unknown.length) {
    console.log('[??] Unknown /api paths (not studio, not sb-daw, not os-bridge):');
    for (const endpoint of summary.groups.unknown) {
      console.log(`  ? ${endpoint}`);
    }
  }
}

module.exports = {
  extractApiPaths,
  normalizeEndpoint,
  collectEndpoints,
  buildScanReport,
  runScan,
  walkFiles,
};

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runScan(options)
    .then((report) => {
      printReport(report);
      if (options.out) {
        fs.mkdirSync(path.dirname(options.out), { recursive: true });
        fs.writeFileSync(options.out, JSON.stringify(report, null, 2), 'utf8');
        console.log(`[scan] wrote ${options.out}`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
