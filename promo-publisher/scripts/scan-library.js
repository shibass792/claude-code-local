#!/usr/bin/env node
'use strict';

/**
 * CLI music library scan. Real filesystem walk + ffprobe tag read.
 *
 *   node scripts/scan-library.js                  # uses MUSIC_ROOTS from .env
 *   node scripts/scan-library.js "H:\\Samples"    # explicit roots
 *   node scripts/scan-library.js --no-probe       # names only, skip ffprobe
 */

require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const library = require('../modules/library');

const args = process.argv.slice(2);
const probe = !args.includes('--no-probe');
const roots = args.filter((arg) => !arg.startsWith('--'));

(async () => {
  const result = await library.scanLibrary({
    roots: roots.length ? roots : undefined,
    probe,
    onProgress: (p) => {
      if (p.phase === 'walk') {
        process.stderr.write(`found ${p.found} files, reading tags...\n`);
      } else if (p.phase === 'probe') {
        process.stderr.write(`ffprobe ${p.done}/${p.total}\r`);
      }
    },
  });

  process.stderr.write('\n');
  console.log(`roots:   ${result.roots.join(', ') || '(none)'}`);
  console.log(
    `totals:  ${result.totals.all} files — ${result.totals.audio} audio, ` +
      `${result.totals.midi} midi, ${result.totals.project} project`,
  );
  console.log(`probed:  ${result.probed} (cached results reused)`);
  console.log(`elapsed: ${result.scanMs}ms`);
  console.log(`index:   ${library.MUSIC_INDEX}`);

  if (result.warning) {
    console.log(`\n⚠ ${result.warning}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
