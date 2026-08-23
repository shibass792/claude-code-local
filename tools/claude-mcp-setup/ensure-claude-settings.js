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

function ensureRealDirectory(dirPath) {
  let existing = null;
  try {
    existing = fs.lstatSync(dirPath);
  } catch {
    existing = null;
  }
  if (existing) {
    if (existing.isSymbolicLink()) {
      let targetOk = false;
      try {
        targetOk = fs.statSync(dirPath).isDirectory();
      } catch {
        targetOk = false;
      }
      if (!targetOk) {
        fs.unlinkSync(dirPath);
      }
    } else if (!existing.isDirectory()) {
      fs.renameSync(dirPath, `${dirPath}.bak-file-${Date.now()}`);
    }
  }
  fs.mkdirSync(dirPath, { recursive: true });
  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Failed to create a real folder at ${dirPath}`);
  }
}

function ensureClaudeSettings(claudeHome = defaultClaudeHome()) {
  if (!claudeHome) {
    throw new Error('claude home is required');
  }
  ensureRealDirectory(claudeHome);
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
  ensureRealDirectory,
  ensureClaudeSettings,
};
