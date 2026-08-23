#!/usr/bin/env node
'use strict';

/**
 * Minimal MCP stdio server for ShiBass local tools.
 * Do not install globally — add this file path in Cursor MCP settings if you want it.
 *
 *   node promo-publisher/mcp-server.js
 */

const { generatePsyPack } = require('./modules/psy-pack');
const { buildProducerPack } = require('./modules/producer-pack');
const { buildEpk } = require('./modules/epk');
const { getSprint, toggleCell } = require('./modules/sprint');
const { getLadder } = require('./modules/ladder');
const { getWave1, evaluateCsv, evaluateCsvFile } = require('./modules/ads-cpc');
const { probeOps, formatOpsLog } = require('./modules/ops-probe');
const transcriber = require('./modules/transcriber');

const TOOLS = [
  { name: 'psy_generate', description: 'Generate dated Phrygian Family MIDI pack', inputSchema: { type: 'object', properties: { count: { type: 'number' }, bpm: { type: 'number' }, root: { type: 'string' } } } },
  { name: 'pack_build', description: 'Build Producer Pack zip', inputSchema: { type: 'object', properties: { count: { type: 'number' } } } },
  { name: 'epk_build', description: 'Write one-screen EPK + promoter email', inputSchema: { type: 'object', properties: {} } },
  { name: 'sprint_status', description: '14-day dual sprint checklist', inputSchema: { type: 'object', properties: {} } },
  { name: 'sprint_toggle', description: 'Toggle a sprint cell by id', inputSchema: { type: 'object', properties: { id: { type: 'string' }, done: { type: 'boolean' } }, required: ['id'] } },
  { name: 'ladder_get', description: 'Artist career ladder snapshot', inputSchema: { type: 'object', properties: {} } },
  { name: 'wave1_list', description: 'Wave 1 paused Meta campaigns (local JSON)', inputSchema: { type: 'object', properties: {} } },
  { name: 'ads_evaluate', description: 'Score Wave 1 from dropped Ads CSV. Never enables campaigns.', inputSchema: { type: 'object', properties: { csv: { type: 'string' }, filePath: { type: 'string' } } } },
  { name: 'ops_probe', description: 'Live HTTP probes of local ports. Honest offline.', inputSchema: { type: 'object', properties: {} } },
  { name: 'guides_list', description: 'List guide_he.md files', inputSchema: { type: 'object', properties: {} } },
  { name: 'guides_ingest', description: 'Ingest a local notes file into guide_he.md', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, title: { type: 'string' } }, required: ['filePath'] } },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'psy_generate':
      return generatePsyPack(args);
    case 'pack_build':
      return buildProducerPack(args);
    case 'epk_build':
      return buildEpk(args);
    case 'sprint_status':
      return getSprint();
    case 'sprint_toggle':
      return toggleCell(args.id, args.done);
    case 'ladder_get':
      return getLadder();
    case 'wave1_list':
      return getWave1();
    case 'ads_evaluate':
      if (args.filePath) return evaluateCsvFile(args.filePath);
      if (args.csv) return evaluateCsv(args.csv);
      return { success: false, error: 'csv or filePath required' };
    case 'ops_probe': {
      const report = await probeOps();
      return { ...report, log: formatOpsLog(report) };
    }
    case 'guides_list':
      return transcriber.listGuides();
    case 'guides_ingest':
      return transcriber.ingestFile(args);
    default:
      return { success: false, error: `unknown tool ${name}` };
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'shibass-local', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') {
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const result = await callTool(name, args);
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    } catch (err) {
      send({ jsonrpc: '2.0', id, error: { code: -32000, message: String(err.message || err) } });
    }
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}

function start() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch (err) {
        send({ jsonrpc: '2.0', error: { code: -32700, message: String(err.message || err) } });
      }
    }
  });
}

if (require.main === module) {
  start();
}

module.exports = { TOOLS, callTool, handle };
