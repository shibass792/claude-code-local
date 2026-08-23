const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureClaudeSettings, MCP_PERMISSIONS } = require('./ensure-claude-settings');

test('creates missing .claude folder before writing settings.json', () => {
  const home = path.join(os.tmpdir(), `claude-home-${Date.now()}`);
  const missingParent = path.join(home, '.claude');
  assert.equal(fs.existsSync(missingParent), false);

  const written = ensureClaudeSettings(missingParent);
  assert.equal(written, path.join(missingParent, 'settings.json'));
  assert.equal(fs.existsSync(written), true);

  const settings = JSON.parse(fs.readFileSync(written, 'utf8'));
  for (const permission of MCP_PERMISSIONS) {
    assert.ok(settings.permissions.allow.includes(permission));
  }
});

test('merges into existing settings without dropping other allows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({
    permissions: { allow: ['Bash(git *)'] },
    theme: 'dark',
  }), 'utf8');

  ensureClaudeSettings(dir);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.ok(settings.permissions.allow.includes('Bash(git *)'));
  assert.ok(settings.permissions.allow.includes('Bash(claude mcp *)'));
  assert.equal(settings.theme, 'dark');
});
