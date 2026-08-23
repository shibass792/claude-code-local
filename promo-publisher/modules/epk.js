'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, OUTPUT_DIR } = require('./store');

const DEFAULTS = {
  artist: 'ShiBass',
  legalName: 'Shaul',
  label: 'Blue Tunes Records',
  latestSet: 'Dextamine (June 2026)',
  city: 'Israel',
  email: '[EMAIL]',
  phone: '[PHONE]',
  beatport: '[BEATPORT]',
  soundcloud: '[SOUNDCLOUD]',
  site: 'https://shibass.co.il',
  instagram: 'https://instagram.com/shibassmusic',
  igHandle: '@shibassmusic',
  igFollowers: '20.4K',
  igEngagement: '1.56% (HypeAuditor, 23.08.2026)',
  youtubeLive: 'https://www.youtube.com/watch?v=EwVxKdqwoOI',
};

function buildEpk(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  const year = new Date().getFullYear();

  const promoterEmail = [
    `Subject: ${cfg.artist} — live psytrance / ${cfg.label} — available ${year}`,
    '',
    'Hi,',
    '',
    `I'm ${cfg.legalName} (${cfg.artist}), signed to ${cfg.label}. I write and play progressive / full-on psytrance.`,
    '',
    `Latest release: ${cfg.latestSet}.`,
    'Live: Orion / Cyclus (Brazil), Dream Shift / Konnyland (Zurich), Halfmoon (Thailand), Mexico, Fin del Mundo, Echo Club Tel Aviv.',
    'Next: Sukkot Wellness 1–2.10.2026 — lineup with Captain Hook, Freak Show, Omiki.',
    '',
    'Live video (unedited crowd, Zurich):',
    cfg.youtubeLive,
    '',
    'One-screen EPK',
    `- IG ${cfg.igHandle} · ${cfg.igFollowers} · engagement ${cfg.igEngagement}`,
    `- Site: ${cfg.site}`,
    `- Beatport: ${cfg.beatport}`,
    `- SoundCloud: ${cfg.soundcloud}`,
    `- Phone: ${cfg.phone}`,
    `- Email: ${cfg.email}`,
    '',
    'I can send a 15–20 min promo mix and a 3-track pack on request.',
    'Routing: Israel / Brazil / Switzerland / Thailand. Festival + club slots.',
    '',
    'Best,',
    `${cfg.legalName} / ${cfg.artist}`,
    cfg.label,
    '',
  ].join('\n');

  const onePager = [
    `# ${cfg.artist} — EPK (one screen)`,
    '',
    `Legal name: ${cfg.legalName}  ·  Label: ${cfg.label}  ·  Base: ${cfg.city}`,
    '',
    '## Bio (≤300 words)',
    `${cfg.artist} is an Israeli progressive / full-on psytrance producer and DJ signed to ${cfg.label}.`,
    `Latest original: ${cfg.latestSet}. Remix contact already exists with Argy (Melodia) and Anyma (After Love, Save Me).`,
    'Shows: Brazil (Orion, Cyclus), Zurich (Dream Shift, Konnyland), Thailand (Halfmoon), Mexico, Fin del Mundo, Echo Club TLV.',
    'Sukkot Wellness 1–2 October 2026 shares a lineup with Captain Hook, Freak Show and Omiki.',
    'Studio line is coded in-house (Phrygian Family MIDI → Cubase Audix templates → Serum / Sylenth1 → 9:16 reels).',
    '',
    '## Proof of live',
    `- Zurich set (crowd reacting, unedited): ${cfg.youtubeLive}`,
    '- Ask for one unedited clip per date — festivals check this before socials.',
    '',
    '## Numbers (23.08.2026)',
    `- Instagram ${cfg.igHandle}: ${cfg.igFollowers} followers, ${cfg.igEngagement}`,
    '- Spotify monthly listeners: not measured yet (geo target IL / BR / CH / TH → 5K / country)',
    '',
    '## Tech / show',
    '- Progressive / Full-On, 138–142 BPM',
    '- 60–90 min club set or festival support',
    '- Promo assets (9:16) delivered with the booking',
    '',
    '## Links',
    `- Site: ${cfg.site}`,
    `- Instagram: ${cfg.instagram}`,
    `- YouTube live: ${cfg.youtubeLive}`,
    `- Beatport: ${cfg.beatport}`,
    `- SoundCloud: ${cfg.soundcloud}`,
    '',
    '## Contact',
    `${cfg.email}  ·  ${cfg.phone}`,
    '',
    '## Booking question (Blue Tunes)',
    'Does Blue Tunes handle ShiBass booking? If not, please intro FM Booking (booking@fm-booking.com).',
    '',
  ].join('\n');

  const dir = path.join(OUTPUT_DIR, 'epk');
  ensureDir(dir);
  const stamp = new Date().toISOString().slice(0, 10);
  const emailPath = path.join(dir, `${stamp}_promoter_intro.txt`);
  const pagePath = path.join(dir, `${stamp}_epk_one_pager.md`);
  fs.writeFileSync(emailPath, promoterEmail, 'utf8');
  fs.writeFileSync(pagePath, onePager, 'utf8');

  return {
    success: true,
    source: 'epk-writer',
    emailPath,
    pagePath,
    promoterEmail,
    onePager,
    placeholders: ['[EMAIL]', '[PHONE]', '[BEATPORT]', '[SOUNDCLOUD]'],
  };
}

module.exports = { buildEpk, DEFAULTS };
