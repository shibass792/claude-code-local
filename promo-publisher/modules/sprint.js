'use strict';

const path = require('path');
const { ROOT, OUTPUT_DIR, readJson, writeJson } = require('./store');

const TEMPLATE = path.join(ROOT, 'data', 'sprint-14day.json');
const PROGRESS = path.join(OUTPUT_DIR, 'sprint-progress.json');

function loadTemplate() {
  const data = readJson(TEMPLATE, null);
  if (!data || !Array.isArray(data.cells)) {
    throw new Error('sprint template missing: data/sprint-14day.json');
  }
  return data;
}

function loadProgress() {
  return readJson(PROGRESS, { done: {}, updatedAt: null });
}

function saveProgress(progress) {
  writeJson(PROGRESS, progress);
  return progress;
}

function getSprint() {
  const template = loadTemplate();
  const progress = loadProgress();
  const cells = template.cells.map((cell) => ({
    ...cell,
    done: Boolean(progress.done[cell.id] ?? cell.done),
  }));
  const total = cells.length;
  const completed = cells.filter((c) => c.done).length;
  return {
    success: true,
    id: template.id,
    title: template.title,
    start: template.start,
    end: template.end,
    goals: template.goals,
    cells,
    total,
    completed,
    pct: total ? Math.round((completed / total) * 100) : 0,
    progressPath: PROGRESS,
  };
}

function toggleCell(id, done) {
  if (!id) {
    throw new Error('cell id required');
  }
  const sprint = getSprint();
  const cell = sprint.cells.find((c) => c.id === id);
  if (!cell) {
    throw new Error(`unknown sprint cell: ${id}`);
  }
  const progress = loadProgress();
  const next = done === undefined ? !cell.done : Boolean(done);
  progress.done[id] = next;
  progress.updatedAt = new Date().toISOString();
  saveProgress(progress);
  return getSprint();
}

function resetSprint() {
  saveProgress({ done: {}, updatedAt: new Date().toISOString() });
  return getSprint();
}

module.exports = {
  TEMPLATE,
  PROGRESS,
  getSprint,
  toggleCell,
  resetSprint,
};
