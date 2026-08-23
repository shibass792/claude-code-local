'use strict';

const path = require('path');
const { ROOT, readJson } = require('./store');

const LADDER_FILE = path.join(ROOT, 'data', 'artist-ladder.json');

function getLadder() {
  const data = readJson(LADDER_FILE, null);
  if (!data) {
    return { success: false, error: 'artist-ladder.json missing' };
  }
  return {
    success: true,
    source: LADDER_FILE,
    asOf: data.asOf,
    self: data.self,
    nextRung: data.nextRung,
    deadlines: data.deadlines,
    rungs: data.rungs,
    patterns: data.patterns,
    booking: data.booking,
    stages: data.stages,
    sources: data.sources,
  };
}

module.exports = { getLadder, LADDER_FILE };
