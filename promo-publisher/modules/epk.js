'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, OUTPUT_DIR } = require('./store');

function buildEpk({
  artist = 'ShiBass',
  label = 'Audix Records',
  latestSet = 'Shiva Mangala remix / edits',
  city = 'Israel',
  email = 'bookings@example.com',
} = {}) {
  const promoterEmail = [
    `Subject: ${artist} — live psytrance / ${label} — available ${new Date().getFullYear()}`,
    '',
    'Hi,',
    '',
    `I'm ${artist}, signed to ${label}. I write and perform progressive / full-on psytrance and I also build the production tools I play with (MIDI generation → Cubase → Serum/Sylenth1 → reel pipeline).`,
    '',
    `Latest set / edits: ${latestSet}.`,
    'I can send a 15–20 min promo mix and a 3-track EP pack on request.',
    '',
    'What I bring to a night:',
    '- Originals + label edits, 142 BPM pocket',
    '- Visuals / short-form content already running for the date',
    `- Based in ${city}, available for club + festival slots`,
    '',
    `EPK + links on request. Reply here or ${email}.`,
    '',
    'Best,',
    artist,
    label,
    '',
  ].join('\n');

  const onePager = [
    `# ${artist} — EPK`,
    '',
    `Label: ${label}`,
    `Base: ${city}`,
    '',
    '## Bio (short)',
    `${artist} is a psytrance producer-performer who codes the studio line used on the records: generated Phrygian MIDI, Cubase templates, Serum/Sylenth1 design, then Social Studio reels for each release and show.`,
    '',
    '## Latest',
    `- ${latestSet}`,
    '- ShiBass Producer Pack v1 (MIDI bank for producers)',
    '',
    '## Tech / show',
    '- Progressive / Full-On, ~142 BPM',
    '- 60–90 min club set or festival support',
    '- Promo assets (9:16) delivered with the booking',
    '',
    '## Contact',
    email,
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
  };
}

module.exports = { buildEpk };
