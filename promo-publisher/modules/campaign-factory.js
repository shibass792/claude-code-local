'use strict';

const renderEngine = require('./render-engine');
const hookGenerator = require('./hook-generator');
const approvalEngine = require('./approval-publisher');

async function createCampaignFromRender(body = {}) {
  const track = String(body.track || 'ShiBass Drop').slice(0, 80);
  let render = body.render;
  if (!render?.success) {
    render = await renderEngine.renderReel({
      audioPath: body.audioPath,
      videoPath: body.videoPath,
      hook: body.hook,
      durationSec: body.durationSec,
      fps: body.fps,
    });
  }
  if (!render.success) {
    return render;
  }

  let hooks = body.hooks;
  if (!hooks?.length) {
    const generated = await hookGenerator.generateHooks({
      track,
      bpm: body.bpm,
      genre: body.genre,
    });
    hooks = generated.hooks;
  }

  const captionHe = hooks[0]?.text || `${track} בחוץ עכשיו`;
  const campaign = {
    id: `camp_${Date.now()}`,
    title: track,
    videoPath: render.relativePath,
    duration: `00:${String(render.durationSec || 15).padStart(2, '0')}`,
    format: 'Reels / TikTok (9:16)',
    templateId: body.templateId || null,
    watched: false,
    captionHe,
    captionEn: `${track} — Out Now 🔥 #ShiBass`,
    hashtags: '#Psytrance #ShiBass #ElectronicMusic #ProducerLife',
    platforms: body.platforms || ['instagram', 'tiktok'],
    hooks,
    render,
    createdAt: new Date().toISOString(),
  };

  const queue = approvalEngine.getPendingQueue();
  queue.unshift(campaign);
  approvalEngine.savePendingQueue(queue);

  return {
    success: true,
    campaign,
    render,
    hooks,
    log: [
      `[SUCCESS] Rendered ${render.relativePath} (${render.width}x${render.height} ${render.fps}fps)`,
      `[HOOKS] count=${hooks.length}`,
      `[QUEUE] campaign ${campaign.id} added to approval queue`,
    ].join('\n'),
  };
}

module.exports = {
  createCampaignFromRender,
};
