'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, writeJson, readJson, OUTPUT_DIR, ROOT } = require('./store');

const GUIDES_DIR = path.join(OUTPUT_DIR, 'guides');
const INDEX_FILE = path.join(GUIDES_DIR, 'index.json');

function slugify(text) {
  return String(text || 'guide')
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'guide';
}

function loadIndex() {
  return readJson(INDEX_FILE, { items: [] });
}

function saveIndex(index) {
  writeJson(INDEX_FILE, index);
  return index;
}

function wrapHe(title, body, source) {
  return [
    `# ${title}`,
    '',
    `מקור: ${source || 'manual-notes'}`,
    `נוצר: ${new Date().toISOString()}`,
    '',
    '## נקודות עבודה (לשימוש בזמן מיקס)',
    '',
    body.trim() || '- (הדבק כאן תמלול / נקודות מהווידאו)',
    '',
    '## פעולה באולפן',
    '- פתח Serum / Sylenth1 / Backbone על הטראק הפעיל.',
    '- יישם רק טכניקה אחת מהמדריך, ואז שמור פריסט.',
    '',
  ].join('\n');
}

function createGuide({ title, notes, source, url } = {}) {
  ensureDir(GUIDES_DIR);
  let safeTitle = title;
  if (!safeTitle && url) {
    try {
      safeTitle = `מדריך ${new URL(url).hostname}`;
    } catch {
      safeTitle = 'guide';
    }
  }
  if (!safeTitle) {
    safeTitle = `guide_${Date.now()}`;
  }
  const slug = `${new Date().toISOString().slice(0, 10)}_${slugify(safeTitle)}`;
  const fileName = `${slug}_guide_he.md`;
  const abs = path.join(GUIDES_DIR, fileName);
  const text = wrapHe(safeTitle, notes || '', source || url || 'notes');
  fs.writeFileSync(abs, text, 'utf8');

  const item = {
    id: slug,
    title: safeTitle,
    file: fileName,
    path: abs,
    url: url || null,
    createdAt: new Date().toISOString(),
  };
  const index = loadIndex();
  index.items.unshift(item);
  index.items = index.items.slice(0, 200);
  saveIndex(index);
  return { success: true, guide: item, preview: text.slice(0, 400) };
}

function listGuides() {
  const index = loadIndex();
  return {
    success: true,
    count: (index.items || []).length,
    dir: GUIDES_DIR,
    items: index.items || [],
  };
}

function isAllowedIngestPath(abs) {
  const roots = [
    OUTPUT_DIR,
    ROOT,
    process.env.SHIBASS_ROOT,
    process.env.SHIBASS_NOTES,
  ].filter(Boolean);
  return roots.some((root) => {
    const base = path.resolve(root);
    return abs === base || abs.startsWith(`${base}${path.sep}`);
  });
}

function ingestFile({ filePath, title } = {}) {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'filePath required' };
  }
  const abs = path.resolve(filePath);
  if (!isAllowedIngestPath(abs)) {
    return {
      success: false,
      error: 'path not allowed — put notes under promo-publisher/output, the repo, or SHIBASS_ROOT',
    };
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { success: false, error: `file not found: ${abs}` };
  }
  const ext = path.extname(abs).toLowerCase();
  if (!['.md', '.txt', '.json', '.csv'].includes(ext)) {
    return { success: false, error: 'only .md .txt .json .csv' };
  }
  const notes = fs.readFileSync(abs, 'utf8').slice(0, 80000);
  return createGuide({
    title: title || path.basename(abs),
    notes,
    source: abs,
  });
}

function readGuide(id) {
  const item = (loadIndex().items || []).find((g) => g.id === id || g.file === id);
  if (!item || !fs.existsSync(item.path)) {
    return null;
  }
  return { ...item, content: fs.readFileSync(item.path, 'utf8') };
}

module.exports = {
  GUIDES_DIR,
  createGuide,
  listGuides,
  readGuide,
  ingestFile,
};
