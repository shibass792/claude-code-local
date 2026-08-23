const PLACEHOLDERS = {
  setLink: '[LINK_SET]',
  audixLink: '[LINK_AUDIX]',
  packLink: '[LINK_PACK]',
};

function fill(template, links = {}) {
  return template
    .replaceAll(PLACEHOLDERS.setLink, links.setLink || PLACEHOLDERS.setLink)
    .replaceAll(PLACEHOLDERS.audixLink, links.audixLink || PLACEHOLDERS.audixLink)
    .replaceAll(PLACEHOLDERS.packLink, links.packLink || PLACEHOLDERS.packLink);
}

function promoterEmailHe(links = {}) {
  const body = [
    'היי [שם],',
    '',
    'אני ShiBass — מפיק progressive psytrance ב-Blue Tunes / Audix Records.',
    'מחפש סלוט לסט חי 60–90 דק׳ בליינאפ שלכם (מועדון / פסטיבל / after).',
    '',
    'מספרים (אומתו 23.08.2026):',
    '• אינסטגרם @shibassmusic — 20.4K עוקבים, 1.56% מעורבות (HypeAuditor)',
    '• אתר: https://shibass.co.il',
    '',
    'האזנה / צפייה:',
    `• סט אחרון: ${PLACEHOLDERS.setLink}`,
    `• שחרור Audix: ${PLACEHOLDERS.audixLink}`,
    `• Producer Pack (Psy-Tech Vol. 1): ${PLACEHOLDERS.packLink}`,
    '',
    'תאריכים: Sukkot Wellness 1–2.10.2026. שווקים פעילים: ישראל, ברזיל, שוויץ, תאילנד.',
    'אם זה רלוונטי — אשלח EPK בעמוד אחד + טק-ריידר.',
    '',
    'תודה,',
    'ShiBass',
    'https://www.instagram.com/shibassmusic/',
  ].join('\n');

  return {
    locale: 'he',
    subject: 'ShiBass — בוקינג / סט חי + שחרור Audix',
    body: fill(body, links),
  };
}

function promoterEmailEn(links = {}) {
  const body = [
    'Hi [Name],',
    '',
    "I'm ShiBass — progressive psytrance producer on Blue Tunes / Audix Records.",
    'Looking for a 60–90 min live slot on your lineup (club / festival / after).',
    '',
    'Numbers (verified 23.08.2026):',
    '• Instagram @shibassmusic — 20.4K followers, 1.56% ER (HypeAuditor)',
    '• Site: https://shibass.co.il',
    '',
    'Listen / watch:',
    `• Latest set: ${PLACEHOLDERS.setLink}`,
    `• Audix release: ${PLACEHOLDERS.audixLink}`,
    `• Producer Pack (Psy-Tech Vol. 1): ${PLACEHOLDERS.packLink}`,
    '',
    'Routing: Israel, Brazil, Switzerland, Thailand. Live: Sukkot Wellness 1–2 Oct 2026.',
    'Happy to send a one-page EPK + tech rider.',
    '',
    'Thanks,',
    'ShiBass',
    'https://www.instagram.com/shibassmusic/',
  ].join('\n');

  return {
    locale: 'en',
    subject: 'ShiBass — booking / live set + Audix release',
    body: fill(body, links),
  };
}

function weekSprint() {
  return {
    title: 'שבועיים: תוכן + Pack + בוקינג',
    weeks: [
      {
        id: 'week-1',
        title: 'שבוע 1 — ייצור ואריזה',
        days: [
          {
            id: 'd1-2',
            title: 'ימים 1–2',
            items: [
              'הרץ psy_pack_v3: 3 שלדי טראק (MIDI + מבנה פריג׳י).',
              'פתח תבנית Cubase / Ableton, הלביש Serum / Sylenth1, קבע Kick & Bass.',
              'Transcriber מקומי על 2–3 מדריכי מיקס → guide_he.md למאסטרינג (במחשב שלך).',
            ],
          },
          {
            id: 'd3-4',
            title: 'ימים 3–4',
            items: [
              'בחר את השלד החזק וסגור Arrangement מלא.',
              'מיקס 80/20: ניקיון תדרים, בדיקה על מוניטורים, ייצוא ל-Audix Records.',
            ],
          },
          {
            id: 'd5-7',
            title: 'ימים 5–7',
            items: [
              'אסוף 30–50 MIDI מובילים + 10 פריסטים.',
              'ארוז ZIP: ShiBass Psy-Tech Pack Vol. 1.',
              'דף מכירה (Gumroad / אתר הלייבל), מחיר $15–$25.',
            ],
          },
        ],
      },
      {
        id: 'week-2',
        title: 'שבוע 2 — שיווק, הפצה, בוקינג',
        days: [
          {
            id: 'd8-9',
            title: 'ימים 8–9',
            items: [
              'סרטון מסך 30–60 שנ׳: הקוד מייצר תווים → הדרופ ב-DAW.',
              'חתוך 3 רילס / TikTok / Shorts: «איך אני משלב תכנות והפקת פסייטראנס».',
              'CTA בסוף: Pack + הטראק החדש.',
            ],
          },
          {
            id: 'd10-11',
            title: 'ימים 10–11',
            items: [
              'הפצה רשמית דרך הלייבל — Spotify + Beatport.',
              'קמפיין ממומן נשאר מחוץ לסטודיו (גל 1 PAUSED). לא מדליקים מודעות מכאן.',
            ],
          },
          {
            id: 'd12-14',
            title: 'ימים 12–14',
            items: [
              'שלח את מייל ה-EPK הקצר ל-10–15 פרומוטרים בארץ + 10 בחו״ל.',
              'העתק מהפאנל: עברית לפנים, אנגלית ליעדים שאתה מגיע אליהם.',
            ],
          },
        ],
      },
    ],
  };
}

module.exports = {
  PLACEHOLDERS,
  promoterEmailHe,
  promoterEmailEn,
  weekSprint,
};
