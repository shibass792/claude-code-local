#!/usr/bin/env node
'use strict';

/**
 * ShiBass local CLI — no Chrome.
 *   node cli.js psy|pack|epk|sprint|ladder|wave1|ads|ops|guides
 */

const path = require('path');

function print(obj) {
  process.stdout.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)}\n`);
}

async function main(argv) {
  const cmd = String(argv[2] || 'help').toLowerCase();
  const rest = argv.slice(3);

  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    print([
      'ShiBass CLI',
      '  node cli.js psy [count]     Phrygian Family MIDI (dated folder)',
      '  node cli.js pack [count]    Producer Pack zip',
      '  node cli.js epk             One-screen EPK + promoter email',
      '  node cli.js sprint          14-day checklist',
      '  node cli.js sprint-toggle <id> [true|false]',
      '  node cli.js ladder          Artist ladder JSON',
      '  node cli.js wave1           20 paused Meta campaigns',
      '  node cli.js ads <csv-path>  CPC kill/keep from dropped CSV (never enables ads)',
      '  node cli.js ops             Live HTTP probes',
      '  node cli.js guides          List guide_he.md',
      '  node cli.js ingest <file>   Local notes → guide_he.md',
    ].join('\n'));
    return 0;
  }

  if (cmd === 'psy') {
    const { generatePsyPack } = require('./modules/psy-pack');
    print(generatePsyPack({ count: Number(rest[0] || 50), root: 'E' }));
    return 0;
  }
  if (cmd === 'pack') {
    const { buildProducerPack } = require('./modules/producer-pack');
    print(buildProducerPack({ count: Number(rest[0] || 50) }));
    return 0;
  }
  if (cmd === 'epk') {
    const { buildEpk } = require('./modules/epk');
    print(buildEpk());
    return 0;
  }
  if (cmd === 'sprint') {
    const { getSprint } = require('./modules/sprint');
    const s = getSprint();
    print(`${s.title}  ${s.completed}/${s.total} (${s.pct}%)  ${s.start}→${s.end}`);
    for (const cell of s.cells) {
      print(`${cell.done ? '[x]' : '[ ]'} ${cell.id} D${cell.day} ${cell.lane}  ${cell.title}`);
    }
    return 0;
  }
  if (cmd === 'sprint-toggle') {
    const { toggleCell } = require('./modules/sprint');
    const done = rest[1] === undefined ? undefined : rest[1] === 'true';
    const s = toggleCell(rest[0], done);
    print(`${s.completed}/${s.total} (${s.pct}%)`);
    return 0;
  }
  if (cmd === 'ladder') {
    const { getLadder } = require('./modules/ladder');
    print(getLadder());
    return 0;
  }
  if (cmd === 'wave1') {
    const { getWave1 } = require('./modules/ads-cpc');
    print(getWave1());
    return 0;
  }
  if (cmd === 'ads') {
    const { evaluateCsvFile } = require('./modules/ads-cpc');
    if (!rest[0]) {
      print('usage: node cli.js ads <csv-path>');
      return 1;
    }
    const report = evaluateCsvFile(path.resolve(rest[0]));
    print(`KEEP ${report.keep?.length || 0}  KILL ${report.kill?.length || 0}  UNKNOWN ${report.unknown?.length || 0}`);
    print(report);
    return report.success ? 0 : 1;
  }
  if (cmd === 'ops') {
    const { probeOps, formatOpsLog } = require('./modules/ops-probe');
    const report = await probeOps();
    print(formatOpsLog(report));
    return 0;
  }
  if (cmd === 'guides') {
    const { listGuides } = require('./modules/transcriber');
    print(listGuides());
    return 0;
  }
  if (cmd === 'ingest') {
    const { ingestFile } = require('./modules/transcriber');
    if (!rest[0]) {
      print('usage: node cli.js ingest <local-file>');
      return 1;
    }
    print(ingestFile({ filePath: path.resolve(rest[0]) }));
    return 0;
  }

  print(`unknown command: ${cmd}`);
  return 1;
}

if (require.main === module) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

module.exports = { main };
