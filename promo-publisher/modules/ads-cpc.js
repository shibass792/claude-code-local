'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, OUTPUT_DIR, readJson, writeJson } = require('./store');

const WAVE1_FILE = path.join(ROOT, 'data', 'wave1-campaigns.json');

function loadWave1() {
  const data = readJson(WAVE1_FILE, null);
  if (!data || !Array.isArray(data.campaigns)) {
    throw new Error('wave1-campaigns.json missing');
  }
  return data;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const n = Number(String(value).replace(/[₪$,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function headerKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function parseAdsCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) {
    return [];
  }
  const headers = splitCsvLine(lines[0]).map(headerKey);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    const id = row.campaign_id || row.id || row.campaignid || '';
    rows.push({
      campaignId: String(id).replace(/\s/g, ''),
      name: row.campaign_name || row.name || '',
      cpc: parseNumber(row.cpc || row.cpc_ils || row.cost_per_link_click),
      lpv: parseNumber(row.lpv || row.landing_page_views || row.landing_page_view),
      spend: parseNumber(row.spend || row.amount_spent || row.spent),
      clicks: parseNumber(row.clicks || row.link_clicks),
      impressions: parseNumber(row.impressions || row.imps),
    });
  }
  return rows;
}

function decide(metrics, rules) {
  const cpcMax = rules.cpcIlsMax ?? 0.3;
  const lpvMin = rules.lpvMin ?? 1;
  if (metrics.cpc !== null && metrics.cpc > cpcMax) {
    return { action: 'KILL', reason: `CPC ₪${metrics.cpc} > ₪${cpcMax}` };
  }
  if (metrics.impressions !== null && metrics.impressions > 0 && (metrics.lpv === 0 || metrics.lpv === null)) {
    if (metrics.lpv === 0) {
      return { action: 'KILL', reason: '0 landing page views' };
    }
  }
  if (metrics.lpv === 0) {
    return { action: 'KILL', reason: '0 landing page views' };
  }
  if (metrics.cpc === null && metrics.lpv === null) {
    return { action: 'UNKNOWN', reason: 'no CPC/LPV in CSV' };
  }
  return { action: 'KEEP', reason: 'passes kill rule' };
}

function evaluateCsv(csvText) {
  const wave = loadWave1();
  const rows = parseAdsCsv(csvText);
  const byId = new Map(rows.filter((r) => r.campaignId).map((r) => [r.campaignId, r]));
  const evaluated = wave.campaigns.map((campaign) => {
    const metrics = byId.get(campaign.id) || {
      campaignId: campaign.id,
      cpc: null,
      lpv: null,
      spend: null,
      clicks: null,
      impressions: null,
    };
    const verdict = decide(metrics, wave.killRule || {});
    return {
      ...campaign,
      metrics,
      ...verdict,
    };
  });
  const report = {
    success: true,
    source: 'dropped-csv',
    note: 'This module never enables Meta campaigns. Shaul pauses/kills in Ads Manager.',
    account: wave.account,
    killRule: wave.killRule,
    keep: evaluated.filter((r) => r.action === 'KEEP'),
    kill: evaluated.filter((r) => r.action === 'KILL'),
    unknown: evaluated.filter((r) => r.action === 'UNKNOWN'),
    campaigns: evaluated,
  };
  writeJson(path.join(OUTPUT_DIR, 'wave1-cpc-report.json'), {
    checkedAt: new Date().toISOString(),
    keep: report.keep.map((c) => c.id),
    kill: report.kill.map((c) => c.id),
    unknown: report.unknown.map((c) => c.id),
  });
  return report;
}

function evaluateCsvFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    return { success: false, error: `CSV not found: ${abs}` };
  }
  return evaluateCsv(fs.readFileSync(abs, 'utf8'));
}

function getWave1() {
  const wave = loadWave1();
  return { success: true, ...wave };
}

module.exports = {
  WAVE1_FILE,
  loadWave1,
  getWave1,
  parseAdsCsv,
  evaluateCsv,
  evaluateCsvFile,
};
