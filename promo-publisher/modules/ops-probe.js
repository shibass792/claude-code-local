'use strict';

const http = require('http');
const path = require('path');
const { ROOT, readJson } = require('./store');
const { probeHttp } = require('./line-status');

function loadPortRegistry() {
  const candidates = [
    path.join(ROOT, '..', 'scripts', 'config', 'shibass-ports.json'),
    path.join(ROOT, 'config', 'shibass-ports.json'),
  ];
  for (const file of candidates) {
    const data = readJson(file, null);
    if (data) {
      return { file, data };
    }
  }
  return { file: null, data: null };
}

function extraTargets() {
  return [
    {
      id: 'studio_api',
      name: 'Studio API',
      port: Number(process.env.SHIBASS_API_PORT || 4051),
      health: '/api/health',
    },
    {
      id: 'transcriber',
      name: 'Transcriber',
      port: Number(process.env.SHIBASS_TRANSCRIBER_PORT || 4340),
      health: '/api/health',
    },
    {
      id: 'main_ide',
      name: 'ShiBass AI IDE',
      port: Number(process.env.SHIBASS_IDE_PORT || 4000),
      health: '/api/ops/health',
    },
    {
      id: 'diklest_master',
      name: 'Diklest Master Suite',
      port: Number(process.env.SHIBASS_DIKLEST_PORT || 4327),
      health: '/',
    },
    {
      id: 'club_sound_doctor',
      name: 'Club Sound Doctor',
      port: Number(process.env.SHIBASS_CSD_PORT || 4330),
      health: '/',
    },
    {
      id: 'promo_web',
      name: 'Promo Publisher web',
      port: 4050,
      health: '/',
    },
    {
      id: 'ollama',
      name: 'Ollama',
      port: 11434,
      health: '/api/tags',
    },
  ];
}

function registryTargets(registry) {
  if (!registry) {
    return [];
  }
  const out = [];
  for (const groupName of ['tier1_always_on', 'tier2_panel_managed', 'dev_only']) {
    const group = registry[groupName] || {};
    for (const [id, spec] of Object.entries(group)) {
      if (!spec || !spec.port) continue;
      out.push({
        id,
        name: spec.name || id,
        port: spec.port,
        health: spec.health || '/',
        group: groupName,
      });
    }
  }
  return out;
}

function mergeTargets(registry) {
  const map = new Map();
  for (const t of [...registryTargets(registry), ...extraTargets()]) {
    map.set(`${t.port}:${t.health}`, t);
  }
  return [...map.values()].sort((a, b) => a.port - b.port);
}

async function probeTarget(target) {
  const url = `http://127.0.0.1:${target.port}${target.health}`;
  const result = await probeHttp(url, 1200);
  return {
    id: target.id,
    name: target.name,
    port: target.port,
    url,
    online: Boolean(result.ok),
    statusCode: result.statusCode || null,
    error: result.error || null,
  };
}

async function probeOps() {
  const registry = loadPortRegistry();
  const targets = mergeTargets(registry.data);
  const services = await Promise.all(targets.map((target) => probeTarget(target)));
  const online = services.filter((s) => s.online).length;
  return {
    success: true,
    checkedAt: new Date().toISOString(),
    honest: true,
    fakeForbidden: 'Do not print 12/12 ONLINE or static Grafana/Ansible/Sentry logs',
    registryFile: registry.file,
    checked: services.length,
    online,
    offline: services.length - online,
    summary: `${online}/${services.length} listening on this machine`,
    services,
  };
}

function formatOpsLog(report) {
  const lines = [
    `[OPS] ${report.checkedAt}`,
    `[OPS] ${report.summary} — live HTTP probes, not a simulator`,
  ];
  for (const s of report.services) {
    const mark = s.online ? 'ONLINE ' : 'OFFLINE';
    const extra = s.online ? `HTTP ${s.statusCode}` : (s.error || 'no listener');
    lines.push(`  ${mark}  :${s.port}  ${s.name}  ${extra}`);
  }
  return lines.join('\n');
}

module.exports = {
  loadPortRegistry,
  mergeTargets,
  probeOps,
  formatOpsLog,
  extraTargets,
};
