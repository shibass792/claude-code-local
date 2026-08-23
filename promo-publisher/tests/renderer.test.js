'use strict';

// Redirect all generated files to a scratch dir BEFORE the modules are loaded,
// so running the suite never touches a real approval queue, radar feed or index.
process.env.SHIBASS_OUTPUT_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'shibass-out-'),
);

/**
 * These tests run the real ffmpeg binary. When ffmpeg is absent the encoding
 * tests skip rather than fail, but the pure argument/ASS builders always run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const renderer = require('../modules/renderer');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shibass-render-'));

function ffmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_FFMPEG = ffmpegAvailable();

// MP3 is used rather than WAV because WAV has no standard BPM tag — ffmpeg
// silently drops `-metadata BPM` on WAV, which would make the tag assertions
// test nothing.
function makeTestAudio(name = 'tone.mp3', seconds = 4) {
  const target = path.join(TMP, name);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=120:duration=${seconds}`,
    '-metadata', 'title=Test Track',
    '-metadata', 'artist=ShiBass',
    '-metadata', 'BPM=142',
    target,
  ]);
  return target;
}

test('isAudioFile recognises studio formats only', () => {
  assert.equal(renderer.isAudioFile('a.wav'), true);
  assert.equal(renderer.isAudioFile('a.FLAC'), true);
  assert.equal(renderer.isAudioFile('a.mp4'), false);
  assert.equal(renderer.isAudioFile(''), false);
  assert.equal(renderer.isAudioFile(undefined), false);
});

test('toAssTime formats ASS timestamps', () => {
  assert.equal(renderer.toAssTime(0), '0:00:00.00');
  assert.equal(renderer.toAssTime(75.5), '0:01:15.50');
  assert.equal(renderer.toAssTime(-5), '0:00:00.00');
});

test('escapeFilterPath neutralises characters that break filtergraphs', () => {
  assert.equal(renderer.escapeFilterPath('C:\\Users\\a\\b.ass'), 'C\\:/Users/a/b.ass');
  assert.equal(renderer.escapeFilterPath("/tmp/it's [1].ass"), "/tmp/it\\'s \\[1\\].ass");
});

test('buildAssFile writes a 1080x1920 script containing the hook', () => {
  const target = path.join(TMP, 'sub.ass');
  renderer.buildAssFile({
    hook: 'הסוד לקיק ובס',
    subtitle: 'ShiBass',
    duration: 12,
    outputPath: target,
  });

  const content = fs.readFileSync(target, 'utf8');
  assert.match(content, /PlayResX: 1080/);
  assert.match(content, /PlayResY: 1920/);
  assert.match(content, /הסוד לקיק ובס/);
  assert.match(content, /0:00:12\.00/);
  assert.match(content, /Style: Hook/);
});

test('buildAssFile escapes braces that would be read as ASS override tags', () => {
  const target = path.join(TMP, 'braces.ass');
  renderer.buildAssFile({ hook: 'a {\\b1} b', duration: 3, outputPath: target });
  const content = fs.readFileSync(target, 'utf8');
  assert.ok(!content.includes('{\\b1}'), 'literal override tag must be neutralised');
});

test('buildVisualizerFilter keys out black so the overlay blends', () => {
  for (const style of Object.keys(renderer.STYLES)) {
    const filter = renderer.buildVisualizerFilter(style);
    assert.match(filter, /colorkey=0x000000/, `${style} should key out black`);
    assert.match(filter, /format=rgba/);
  }
});

test('buildFfmpegArgs targets 1080x1920 and maps both streams', () => {
  const args = renderer.buildFfmpegArgs({
    audioPath: '/tmp/a.wav',
    coverPath: null,
    assPath: '/tmp/a.ass',
    outputPath: '/tmp/out.mp4',
    startSec: 12,
    durationSec: 15,
    style: 'bars',
    encoder: 'libx264',
  });

  const joined = args.join(' ');
  assert.match(joined, /-ss 12/);
  assert.match(joined, /-t 15/);
  assert.match(joined, /1080x1920/);
  assert.match(joined, /-map \[vout\]/);
  assert.match(joined, /-map 0:a/);
  assert.match(joined, /-movflags \+faststart/);
  assert.match(joined, /-c:v libx264/);
});

test('buildFfmpegArgs omits -ss when starting at zero', () => {
  const args = renderer.buildFfmpegArgs({
    audioPath: '/tmp/a.wav',
    assPath: '/tmp/a.ass',
    outputPath: '/tmp/out.mp4',
    startSec: 0,
    durationSec: 10,
    style: 'bars',
    encoder: 'libx264',
  });
  assert.ok(!args.includes('-ss'));
});

test('buildFfmpegArgs adds the cover input when a cover exists', (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const cover = path.join(TMP, 'cover.png');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.1',
    '-frames:v', '1', cover,
  ]);

  const args = renderer.buildFfmpegArgs({
    audioPath: '/tmp/a.wav',
    coverPath: cover,
    assPath: '/tmp/a.ass',
    outputPath: '/tmp/out.mp4',
    startSec: 0,
    durationSec: 5,
    style: 'bars',
    encoder: 'libx264',
  });

  const joined = args.join(' ');
  assert.match(joined, /-loop 1/);
  assert.match(joined, /zoompan/);
});

test('probeAudio reads real duration and embedded tags', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const audio = makeTestAudio('probe.mp3', 4);
  const meta = await renderer.probeAudio(audio);

  assert.ok(Math.abs(meta.duration - 4) < 0.2, `duration ${meta.duration}`);
  assert.equal(meta.title, 'Test Track');
  assert.equal(meta.artist, 'ShiBass');
  assert.equal(meta.bpm, 142);
  assert.equal(meta.channels, 1);
  assert.ok(meta.sampleRate > 0);
});

test('probeAudio parses BPM from the filename when tags are absent', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const target = path.join(TMP, 'Forest Psy 143BPM G.wav');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=100:duration=1', target,
  ]);

  const meta = await renderer.probeAudio(target);
  assert.equal(meta.bpm, 143);
});

test('probeAudio rejects a missing file', async () => {
  await assert.rejects(() => renderer.probeAudio('/nope/missing.wav'), /not found/);
});

test('detectEncoder only returns an encoder that can actually run', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const encoder = await renderer.detectEncoder();
  assert.ok(renderer.ENCODER_PREFERENCE.includes(encoder), `unexpected encoder ${encoder}`);
  assert.equal(await renderer.canEncode(encoder), true, 'chosen encoder must be usable');
});

test('renderReel produces a real playable 1080x1920 file', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const audio = makeTestAudio('reel.mp3', 5);
  const output = path.join(TMP, 'reel.mp4');
  const seen = [];

  const result = await renderer.renderReel({
    audioPath: audio,
    hook: 'שמעתם את הדרופ הזה?',
    subtitle: 'ShiBass · 142 BPM',
    style: 'bars',
    durationSec: 3,
    outputPath: output,
    onProgress: (p) => seen.push(p.percent),
  });

  assert.equal(result.success, true);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.ok(Math.abs(result.durationSec - 3) < 0.5, `duration ${result.durationSec}`);
  assert.ok(result.sizeBytes > 10000, 'output should be a real encode');
  assert.ok(fs.existsSync(output));
  assert.ok(seen.length > 0, 'progress must come from ffmpeg output');
  assert.equal(result.source.bpm, 142, 'source metadata is carried through');
});

test('renderReel clamps the duration to the available audio', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const audio = makeTestAudio('short.mp3', 2);
  const result = await renderer.renderReel({
    audioPath: audio,
    durationSec: 60,
    outputPath: path.join(TMP, 'clamped.mp4'),
  });

  assert.ok(result.durationSec <= 2.5, `expected clamp, got ${result.durationSec}`);
});

test('renderReel refuses a start offset past the end of the track', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const audio = makeTestAudio('offset.mp3', 2);
  await assert.rejects(
    () => renderer.renderReel({ audioPath: audio, startSec: 30, durationSec: 5 }),
    /beyond the/,
  );
});

test('renderReel requires an audio path', async () => {
  await assert.rejects(() => renderer.renderReel({}), /requires audioPath/);
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
