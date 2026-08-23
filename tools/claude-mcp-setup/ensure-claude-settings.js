#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const MCP_PERMISSIONS = ['Bash(claude mcp *)', 'Bash(claude mcp add *)'];

function defaultClaudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  const raw = fs.readFileSync(settingsPath, 'utf8');
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    const backup = `${settingsPath}.bak-${Date.now()}`;
    fs.copyFileSync(settingsPath, backup);
    return {};
  }
}

function ensureClaudeSettings(claudeHome = defaultClaudeHome()) {
  if (!claudeHome) {
    throw new Error('claude home is required');
  }
  fs.mkdirSync(claudeHome, { recursive: true });
  const settingsPath = path.join(claudeHome, 'settings.json');
  const settings = readSettings(settingsPath);
  if (!settings.permissions || typeof settings.permissions !== 'object') {
    settings.permissions = {};
  }
  const existing = Array.isArray(settings.permissions.allow)
    ? settings.permissions.allow
    : settings.permissions.allow
      ? [settings.permissions.allow]
      : [];
  const allow = existing.slice();
  for (const permission of MCP_PERMISSIONS) {
    if (!allow.includes(permission)) {
      allow.push(permission);
    }
  }
  settings.permissions.allow = allow;
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settingsPath;
}

if (require.main === module) {
  const written = ensureClaudeSettings();
  process.stdout.write(`${written}\n`);
}

module.exports = {
  MCP_PERMISSIONS,
  defaultClaudeHome,
  ensureClaudeSettings,
};
