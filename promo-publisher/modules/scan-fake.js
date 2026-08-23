const fs = require('fs');
const path = require('path');
const { ROOT } = require('./store');
const { upsertMcpServer, replaceScanFindings } = require('./sql-db');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.electron-user-data',
  'dist',
  'output',
  '__pycache__',
  '.venv',
]);

const FAKE_PATTERNS = [
  { kind: 'simulator_banner', severity: 'high', regex: /סימולטור בלבד/ },
  { kind: 'template_log', severity: 'high', regex: /אין כאן קריאה אמיתית/ },
  { kind: 'mock_true', severity: 'high', regex: /mock\s*:\s*true/ },
  { kind: 'window_api_stub', severity: 'high', regex: /if\s*\(\s*window\.api\s*\)\s*\{\s*return;/ },
  { kind: 'instapy_template', severity: 'medium', regex: /InstaPy Pyt/ },
  { kind: 'python3_only', severity: 'medium', regex: /spawn\(\s*['"]python3['"]|runCommand\(\s*['"]python3['"]/ },
];

function scanRoot() {
  return process.env.SHIBASS_SCAN_ROOT || path.resolve(ROOT, '..');
}

function claudeHome() {
  if (process.env.CLAUDE_CONFIG_DIR) {
    return process.env.CLAUDE_CONFIG_DIR;
  }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.claude');
}

function walkFiles(dir, acc, depth = 0) {
  if (depth > 8 || acc.length > 4000) {
    return acc;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.claude') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name === 'tests') {
        continue;
      }
      walkFiles(full, acc, depth + 1);
      continue;
    }
    if (entry.name === 'scan-fake.js' || entry.name.endsWith('.test.js')) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!['.js', '.html', '.ps1', '.md', '.json', '.py'].includes(ext)) {
      continue;
    }
    acc.push(full);
  }
  return acc;
}

function scanFiles(rootDir) {
  const findings = [];
  const files = walkFiles(rootDir, []);
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const pattern of FAKE_PATTERNS) {
      if (pattern.regex.test(text)) {
        findings.push({
          kind: pattern.kind,
          severity: pattern.severity,
          file: file,
          detail: `Matched ${pattern.kind} in ${path.relative(rootDir, file) || path.basename(file)}`,
          fixed: false,
        });
      }
    }
  }
  return findings;
}

function inspectClaudeHome() {
  const home = claudeHome();
  let item = null;
  try {
    item = fs.lstatSync(home);
  } catch {
    return {
      path: home,
      exists: false,
      isDirectory: false,
      isFile: false,
      isReparse: false,
      error: 'Claude home missing — run Repair-ClaudeHome.ps1 then INSTALL-CLAUDE-MCP.ps1',
    };
  }
  return {
    path: home,
    exists: true,
    isDirectory: item.isDirectory(),
    isFile: item.isFile(),
    isReparse: Boolean(item.isSymbolicLink?.() || (item.mode && (item.mode & 0o120000))),
    error: item.isFile()
      ? 'C:\\Users\\shibass\\.claude is a FILE, not a folder — Repair-ClaudeHome.ps1'
      : null,
  };
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function scanMcp() {
  const homeInfo = inspectClaudeHome();
  const servers = [];
  const findings = [];

  if (!homeInfo.exists) {
    servers.push({
      name: 'claude-home',
      kind: 'config',
      status: 'missing',
      detail: homeInfo.error,
    });
    findings.push({
      kind: 'mcp_home_missing',
      severity: 'high',
      file: homeInfo.path,
      detail: homeInfo.error,
      fixed: false,
    });
  } else if (homeInfo.isFile) {
    servers.push({
      name: 'claude-home',
      kind: 'config',
      status: 'broken_file',
      detail: homeInfo.error,
    });
    findings.push({
      kind: 'mcp_home_is_file',
      severity: 'high',
      file: homeInfo.path,
      detail: homeInfo.error,
      fixed: false,
    });
  } else {
    const settingsPath = path.join(homeInfo.path, 'settings.json');
    const settings = readJsonSafe(settingsPath);
    const allow = settings?.permissions?.allow;
    const hasMcp = Array.isArray(allow) && allow.some((item) => String(item).includes('claude mcp'));
    servers.push({
      name: 'claude-settings',
      kind: 'permissions',
      status: hasMcp ? 'ready' : 'incomplete',
      detail: hasMcp
        ? settingsPath
        : 'settings.json missing Bash(claude mcp *) — run INSTALL-CLAUDE-MCP.ps1?v=repair',
    });
    if (!hasMcp) {
      findings.push({
        kind: 'mcp_permission_missing',
        severity: 'high',
        file: settingsPath,
        detail: 'Claude MCP permission is not in settings.json',
        fixed: false,
      });
    }
  }

  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const mcpCandidates = [
    path.join(homeInfo.path, 'mcp.json'),
    path.join(userHome, '.claude.json'),
    path.join(userHome, '.cursor', 'mcp.json'),
  ];
  let registered = 0;
  for (const candidate of mcpCandidates) {
    const data = readJsonSafe(candidate);
    const map = data?.mcpServers || data?.mcp?.servers || null;
    if (!map || typeof map !== 'object') {
      continue;
    }
    for (const [name, spec] of Object.entries(map)) {
      registered += 1;
      servers.push({
        name,
        kind: spec.command || spec.type || 'mcp',
        status: 'registered',
        detail: candidate,
      });
    }
  }
  if (!registered) {
    servers.push({
      name: 'shibass-files',
      kind: 'filesystem',
      status: 'not_registered',
      detail: 'No MCP servers registered. After settings.json is fixed, run: claude mcp add',
    });
    findings.push({
      kind: 'mcp_server_missing',
      severity: 'medium',
      file: path.join(homeInfo.path, 'mcp.json'),
      detail: 'No filesystem MCP server is registered for ShiBass folders',
      fixed: false,
    });
  }

  return { home: homeInfo, servers, findings };
}

function scanFakeApis(rootDir = scanRoot()) {
  const fileFindings = scanFiles(rootDir);
  const mcp = scanMcp();
  const findings = [...fileFindings, ...mcp.findings];

  replaceScanFindings(findings);
  for (const server of mcp.servers) {
    upsertMcpServer(server);
  }

  const fakeCount = findings.filter((item) => item.severity === 'high' || item.severity === 'medium').length;
  return {
    mock: false,
    scannedAt: new Date().toISOString(),
    root: rootDir,
    fakeCount,
    findings,
    mcp: mcp.home,
    servers: mcp.servers,
  };
}

module.exports = {
  FAKE_PATTERNS,
  scanRoot,
  scanFiles,
  scanMcp,
  scanFakeApis,
  inspectClaudeHome,
};
