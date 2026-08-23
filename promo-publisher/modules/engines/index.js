const creationLog = require('./creation-log');
const instagram = require('./instagram-engine');
const reelhook = require('./reelhook');
const renderer = require('./video-renderer');
const player = require('./universal-player');

async function getEnginesStatus() {
  const [instagramStatus, ffmpeg, ollama, index] = await Promise.all([
    instagram.getStatus(),
    renderer.getFfmpegInfo(),
    reelhook.pingOllama(),
    Promise.resolve(player.getIndexOrEmpty()),
  ]);

  return {
    ok: ffmpeg.ok,
    instagram: instagramStatus,
    ffmpeg,
    ollama,
    player: {
      indexed: Boolean(index.scannedAt),
      scannedAt: index.scannedAt,
      count: index.count,
      audioCount: index.audioCount,
      midiCount: index.midiCount,
      roots: index.roots,
    },
    log: {
      path: creationLog.LOG_PATH,
      entries: creationLog.readLog(5).length,
    },
  };
}

module.exports = {
  creationLog,
  instagram,
  reelhook,
  renderer,
  player,
  getEnginesStatus,
};
