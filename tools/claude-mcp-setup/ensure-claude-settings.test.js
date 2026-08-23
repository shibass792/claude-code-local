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

test('Windows installer creates .claude before writing settings.json', () => {
  const installer = fs.readFileSync(path.join(__dirname, '..', '..', 'INSTALL-CLAUDE-MCP.ps1'), 'utf8');
  assert.match(installer, /Creating \$claudeHome \(this is the folder that was missing\)/);
  const createAt = installer.indexOf('Ensure-Directory $claudeHome');
  const writeAt = installer.indexOf('Writing ~/.claude/settings.json');
  assert.ok(createAt >= 0 && writeAt > createAt);
});

test('replaces a file sitting where .claude should be', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-file-'));
  const claudeHome = path.join(home, '.claude');
  fs.writeFileSync(claudeHome, 'not a directory');
  const written = ensureClaudeSettings(claudeHome);
  assert.equal(fs.statSync(claudeHome).isDirectory(), true);
  assert.equal(fs.existsSync(written), true);
});

test('replaces a broken symlink at .claude', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-link-'));
  const claudeHome = path.join(home, '.claude');
  fs.symlinkSync(path.join(home, 'missing-target'), claudeHome);
  const written = ensureClaudeSettings(claudeHome);
  assert.equal(fs.statSync(claudeHome).isDirectory(), true);
  assert.equal(fs.existsSync(written), true);
});

test('Windows installer repairs file or broken junction before writing', () => {
  const installer = fs.readFileSync(path.join(__dirname, '..', '..', 'INSTALL-CLAUDE-MCP.ps1'), 'utf8');
  assert.match(installer, /FileAttributes\]::ReparsePoint/);
  assert.match(installer, /Directory\]::CreateDirectory/);
  assert.match(installer, /WriteAllText/);
  assert.equal(installer.includes('Set-Content -LiteralPath $settingsPath'), false);
});

test('Windows installer scripts are ASCII so PowerShell 5.1 does not eat quotes', () => {
  const files = [
    path.join(__dirname, '..', '..', 'INSTALL-CLAUDE-MCP.ps1'),
    path.join(__dirname, 'Setup-ShiBass-Claude-MCP.ps1'),
    path.join(__dirname, 'Repair-ClaudeHome.ps1'),
  ];
  for (const filePath of files) {
    const bytes = fs.readFileSync(filePath);
    for (let i = 0; i < bytes.length; i += 1) {
      assert.ok(bytes[i] <= 127, `${path.basename(filePath)} has non-ASCII at byte ${i}`);
    }
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
