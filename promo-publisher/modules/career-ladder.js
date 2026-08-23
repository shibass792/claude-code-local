const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ensureDir, writeJson } = require('./store');
const { appendLog } = require('./creation-log');
const { promoterEmailHe, promoterEmailEn, weekSprint } = require('./epk-copy');
const { getPackStatus } = require('./psy-pack');

const UPDATED_AT = '2026-08-23';
const EPK_PATH = path.join(OUTPUT_DIR, 'epk.md');
const EPK_HE_PATH = path.join(OUTPUT_DIR, 'epk_promoter_he.txt');
const EPK_EN_PATH = path.join(OUTPUT_DIR, 'epk_promoter_en.txt');
const CAREER_STATE = path.join(OUTPUT_DIR, 'career_state.json');

const SHIBASS = {
  id: 'shibass',
  name: 'ShiBass',
  highlight: true,
  instagramFollowers: 20400,
  instagramHandle: '@shibassmusic',
  instagramEngagementPct: 1.56,
  instagramSource: 'HypeAuditor',
  spotifyMonthly: null,
  spotifyVerified: false,
  nextRung: 'Captain Hook / Ace Ventura / Blastoyz',
  nextRungIg: [150000, 180000],
};

function logScalePercent(value, min = 10000, max = 10000000) {
  if (!value || value <= 0) {
    return 0;
  }
  const clamped = Math.min(max, Math.max(min, value));
  const start = Math.log10(min);
  const end = Math.log10(max);
  return Number((((Math.log10(clamped) - start) / (end - start)) * 100).toFixed(1));
}

function formatCount(value) {
  if (value == null) {
    return 'לא נמדד';
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1000) {
    const k = value / 1000;
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(k >= 10 ? 0 : 1))}K`;
  }
  return String(value);
}

const ARTISTS = [
  {
    id: 'freak-show',
    name: 'The Freak Show',
    layer: 'אותו לייבל',
    instagramFollowers: null,
    spotifyMonthly: null,
    path: 'דואו מ-2007, אחר כך סולו. Blue Tunes (Brain Attack, Miracle, Juan עם Soundbuster) ו-UP Records.',
    money: 'לא אומת — נתונים פומביים דלים.',
    moneyVerified: false,
    promo: 'שחרורים בלייבל + הופעות בישראל (URBAN MUSIC, Sukkot Wellness איתך).',
    why: 'הבנצ׳מרק הישיר: אותו לייבל, אותם ליינאפים. קולאב איתו = הצעד הזול ביותר למעלה.',
    links: {
      instagram: 'https://www.instagram.com/explore/tags/thefreakshow/',
      soundcloud: 'https://soundcloud.com/search?q=The%20Freak%20Show%20Blue%20Tunes',
      beatport: 'https://www.beatport.com/search?q=The%20Freak%20Show',
    },
  },
  {
    id: 'captain-hook',
    name: 'Captain Hook',
    layer: 'שכבה 1',
    instagramFollowers: 177000,
    spotifyMonthly: 203000,
    path: 'תקליטן ויניל → Quantize → Captain Hook. 4 אלבומים ב-Iboga. Alien Art עם Ace Ventura (2024). Ouroboros 2024–26: 3 פרקים × 4 מקוריים × 3 רמיקסרים, על ויניל.',
    money: 'FM Booking (booking@fm-booking.com). Bungee Jump — 15.9M סטרימים.',
    moneyVerified: true,
    promo: 'סדרת רמיקסים רב-שנתית כמנוע תוכן; קולאבים עם Astrix ו-Ace Ventura.',
    why: 'הרף הריאלי הבא: 150–180K IG, רוסטר FM Booking.',
    links: {
      instagram: 'https://www.instagram.com/captainhookmusic/',
      spotify: 'https://open.spotify.com/search/Captain%20Hook',
      youtube: 'https://www.youtube.com/results?search_query=Captain+Hook+psytrance',
      booking: 'mailto:booking@fm-booking.com',
    },
  },
  {
    id: 'ace-ventura',
    name: 'Ace Ventura',
    layer: 'שכבה 1',
    instagramFollowers: 149000,
    spotifyMonthly: 290000,
    path: 'סאונד לטלוויזיה → Psysex (HOMmega) → Ace Ventura 2006, Rebirth ב-Iboga 2007, פרס Beatport 2008. Alpha Portal, Alien Art, Liquid Ace, Easy Riders, Acid Punks, Psy-Nation.',
    money: 'FM Booking (עולם) + Kontrol Agency (ברזיל). מרצ׳ באתר, Bandcamp, Psy-Nation כמותג אירועים ורדיו.',
    moneyVerified: true,
    promo: 'רדיו חודשי Psy-Nation; 5+ פרויקטים = 5+ זרמי שחרורים והזמנות; רמיקסים לעמיתים.',
    why: 'מודל ׳אליאסים׳: כל שם = סלוט נפרד. Pranava 14.1M.',
    links: {
      instagram: 'https://www.instagram.com/aceventuramusic/',
      spotify: 'https://open.spotify.com/search/Ace%20Ventura',
      site: 'https://www.aceventura.co.il/',
      booking: 'mailto:booking@fm-booking.com',
    },
  },
  {
    id: 'blastoyz',
    name: 'Blastoyz',
    layer: 'שכבה 1',
    instagramFollowers: 182000,
    spotifyMonthly: 497000,
    path: 'מפיק מגיל 9. פריצה עם Parvati Valley ו-Mandala (30.5M). Iboga, Alteza, Armada, Ophelia, Monstercat. 2021 לייבל WELVRAVE. אלבום 2025. Tomorrowland, EDC, Ultra.',
    money: 'סוכן עצמאי בת״א (בעבר Fantastic Management / Alteza Bookings). לייבל WELVRAVE, מרצ׳ ב-KT8.',
    moneyVerified: true,
    promo: 'רמיקסים חוצי ז׳אנר (Above & Beyond, Illenium) → קולאבים (Seven Lions, Vini Vici, Moby). פלייליסט משלו בספוטיפיי. מזמין מעריצים ל-DM.',
    why: 'הישראלי שגשר הכי מהר ל-EDM אמריקאי דרך לייבלים חוצי ז׳אנר.',
    links: {
      instagram: 'https://www.instagram.com/blastoyz/',
      spotify: 'https://open.spotify.com/search/Blastoyz',
      site: 'https://blastoyz.com/',
      label: 'https://welvrave.com/',
    },
  },
  {
    id: 'infected-mushroom',
    name: 'Infected Mushroom',
    layer: 'שכבה 2',
    instagramFollowers: 245000,
    spotifyMonthly: 756000,
    path: '1996 חיפה. The Gathering 1999. אלבום כל 1–2 שנים עד היום (IM30 ב-2026). DJ Mag #9 ב-2007. Dim Mak, Monstercat. קרדיט הפקה ל-Lady Gaga.',
    money: 'UTA (לא אומת). Polyverse Music — חברת פלאגינים (Manipulator, Wider). מאסטרקלאסים, סאמפל-פאקים, NFT, VR, ויניל. ~120 הופעות בשנה, סלקטיבי.',
    moneyVerified: false,
    promo: 'סטים מלאים ביוטיוב; קולאבים חוצי ז׳אנר (311, Korn); חינוך = מותג = משפך למוצר.',
    why: 'ההוכחה שהכנסה מפלאגינים וחינוך יכולה להיות עסק שני שלם.',
    links: {
      instagram: 'https://www.instagram.com/infectedmushroom/',
      spotify: 'https://open.spotify.com/artist/6S2tas4o4SDE3VSs7oXKcR',
      youtube: 'https://www.youtube.com/infectedmushroom',
      polyverse: 'https://polyversemusic.com/',
    },
  },
  {
    id: 'neelix',
    name: 'Neelix',
    layer: 'שכבה 2',
    instagramFollowers: 372000,
    spotifyMonthly: 825000,
    path: 'המבורג, קומפוזיטינג לקולנוע → הפקה ~2000. No Way To Leave 2005. בית קבוע: Spin Twist Records. הדליין ב-Indian Spirit, Universo Paralello.',
    money: 'Spin Twist = לייבל + סוכנות (טופס בוקינג). Assured Agency; Season Bookings בברזיל. מוזיקה לפרסומות וסרטים (סינק).',
    moneyVerified: true,
    promo: 'מאות רמיקסים ב-Beatport; פלייליסט של הלייבל ביוטיוב; סטים מלאים מפסטיבלים.',
    why: 'המודל ׳לייבל = סוכנות׳ — הלייבל דוחף את הבוקינג.',
    links: {
      instagram: 'https://www.instagram.com/neelixmusic/',
      spotify: 'https://open.spotify.com/search/Neelix',
      beatport: 'https://www.beatport.com/artist/neelix/16468',
      booking: 'https://spintwist-records.com/',
    },
  },
  {
    id: 'astrix',
    name: 'Astrix',
    layer: 'שכבה 3',
    instagramFollowers: 606000,
    spotifyMonthly: 703000,
    path: '1997 תל אביב. HOMmega 2002 (Eye to Eye). DJ Mag #18 ב-2007. He.art 2016 בלייבל משלו Shamanic Tales. Alpha Portal עם Ace Ventura. 1,000+ הופעות.',
    money: 'FM Booking. לייבל Shamanic Tales + חנות מרצ׳ + Bandcamp. Merchbar.',
    moneyVerified: true,
    promo: 'יוטיוב של סטים מלאים ׳היפנוטיים׳; חבילות רמיקסים בלייבל; קולאבים עם Vini Vici, Captain Hook.',
    why: 'הדרך הישראלית הקלאסית: HOMmega → לייבל משלו → מרצ׳.',
    links: {
      instagram: 'https://www.instagram.com/astrixofficial/',
      spotify: 'https://open.spotify.com/search/Astrix',
      youtube: 'https://www.youtube.com/results?search_query=Astrix+full+set',
      label: 'https://shamanictales.com/',
    },
  },
  {
    id: 'vini-vici',
    name: 'Vini Vici',
    layer: 'שכבה 3',
    instagramFollowers: 728000,
    spotifyMonthly: 3190000,
    path: 'Sesto Sento 2001 → Vini Vici 2013 ב-Iboga. The Tribe 2015 → Armin שמע. Free Tibet 2016 — הפסיי הראשון בטופ-10 של Beatport. Great Spirit עם Armin. 2018 Alteza Records. DJ Mag #32 (2025). ~200 הופעות בשנה.',
    money: 'Fantastic Management (dima@fantastic-management.com). Alteza Records (Smash The House). Armada Publishing. במות Alteza ב-Tomorrowland/Ultra.',
    moneyVerified: true,
    promo: 'קולאב כלפי מעלה (Armin, W&W, Aoki); רמיקס עם הוק ענק; תוכן הומוריסטי בקורונה; ׳השנה עם הכי הרבה טראקים׳ ב-2022.',
    why: 'הפריצה הכי גדולה מפסיי למיין-סטייג׳ — דרך רמיקס אחד וקולאב אחד.',
    links: {
      instagram: 'https://www.instagram.com/vinivicimusic/',
      spotify: 'https://open.spotify.com/search/Vini%20Vici',
      youtube: 'https://www.youtube.com/results?search_query=Vini+Vici',
      booking: 'mailto:dima@fantastic-management.com',
    },
  },
  {
    id: 'argy',
    name: 'Argy',
    layer: 'מלודיק',
    instagramFollowers: 882000,
    spotifyMonthly: 3900000,
    path: 'רודוס → לונדון 2004. Love Dose 2005 בגיל 19. Cocoon, Defected. פיבוט ל-Afterlife: Tataki 2022, Higher Power עם Anyma 2023, Aria 134.7M. לייבל NEW WORLD, NEWORLD II 2026.',
    money: 'לייבל (Afterlife + NEW WORLD), The Soundtrack Company — מוזיקה למותגים (Ferrari, BMW, Bvlgari). סוכנות: לא אומת.',
    moneyVerified: false,
    promo: 'זהות ויזואלית/אופנה כמותג; הוקים של 2 דקות ידידותיים לרילס; קולאבים עם MEDUZA, Anyma.',
    why: 'אתה כבר עשית לו רמיקס (Melodia) — נקודת מגע קיימת.',
    links: {
      instagram: 'https://www.instagram.com/argy/',
      spotify: 'https://open.spotify.com/search/Argy',
      youtube: 'https://www.youtube.com/results?search_query=Argy+melodic',
      site: 'https://argyofficial.com/',
    },
  },
  {
    id: 'anyma',
    name: 'Anyma',
    layer: 'מלודיק',
    instagramFollowers: 3880000,
    spotifyMonthly: 6900000,
    path: 'Tale of Us 2008 → Afterlife 2016 → Anyma 2021. Genesys 2023 (#1 Beatport). רזידנסי ב-Sphere Las Vegas 2024–25 (200K אנשים). DJ Mag #10 (2025).',
    money: 'CAA עולמי. Afterlife/Interscope, Kobalt. רזידנסי UNVRS Ibiza, פסטיבל Afterlife, מותגים (Bvlgari, Oakley).',
    moneyVerified: true,
    promo: '׳50% מהזמן על ויז׳ואל׳ — טראקים אינסטרומנטליים עם ויז׳ואל קולנועי ניצחו קולאבים עם פופ. טרילוגיית אלבומים = יקום נרטיבי.',
    why: 'אתה כבר עשית לו רמיקסים (After Love, Save Me). התקרה של הז׳אנר.',
    links: {
      instagram: 'https://www.instagram.com/anyma/',
      spotify: 'https://open.spotify.com/search/Anyma',
      beatport: 'https://www.beatport.com/search?q=Anyma',
      unvrs: 'https://www.unvrs.com/',
    },
  },
];

const PATTERNS = [
  {
    title: 'טראק/רמיקס אחד פתח את כל הדלתות',
    body: 'Free Tibet (Vini Vici), Mandala (Blastoyz), Tataki ו-Aria (Argy), Pranava (Ace Ventura), Bungee Jump (Captain Hook). לכל אחד יש המנון אחד של 10–100M סטרימים שהסוכנות מוכרת.',
  },
  {
    title: 'רמיקס כלפי מעלה, קולאב לצדדים',
    body: 'Vini Vici רימקסו את Hilight Tribe ואז עבדו עם Armin. Blastoyz רימקס ל-Above & Beyond ואז קולאב עם Seven Lions ו-Moby. Neelix בנה קטלוג של מאות רמיקסים.',
  },
  {
    title: 'לייבל-בית חזק, ואז לייבל משלך',
    body: 'HOMmega→Shamanic Tales (Astrix), Iboga→Alteza (Vini Vici), Iboga→WELVRAVE (Blastoyz), Afterlife→NEW WORLD (Argy). הלייבל שלהם מחתים את הדור הבא של מפיקים ישראלים.',
  },
  {
    title: 'פרויקט צד = סלוט נוסף בפסטיבל',
    body: 'Ace Ventura מריץ 5+ פרויקטים. כל שם = הזמנה נפרדת ורצף רילסים נפרד.',
  },
  {
    title: 'קצב הוצאה גבוה',
    body: 'Vini Vici: ״השנה עם הכי הרבה טראקים״; Infected Mushroom אלבום כל 1–2 שנים במשך 27 שנה; 200+ הופעות בשנה ל-Vini Vici.',
  },
  {
    title: 'הווידאו הוא המוצר',
    body: 'כולם מעלים סטים מלאים מפסטיבלים ליוטיוב. Anyma: ״50% מהזמן על ויז׳ואל״ — קליפים אינסטרומנטליים עם ויז׳ואל קולנועי ניצחו קולאבים עם זמרי פופ.',
  },
  {
    title: 'הכנסה מעבר לדמי הופעה',
    body: 'פלאגינים (Polyverse), סינק (Neelix, Argy), מרצ׳ (Astrix, Blastoyz), מאסטרקלאסים, פרסום מוזיקלי, מותגי אירועים (Psy-Nation, Afterlife).',
  },
  {
    title: 'גשר ל-EDM מיינסטרים = מכפיל',
    body: 'Vini Vici על המיין-סטייג׳ של Tomorrowland/Ultra, Blastoyz ב-Monstercat/Spinnin׳, Infected Mushroom עם Lady Gaga. הישראלים שצמחו הכי הרבה יצאו מהבועה.',
  },
];

const AGENCIES = [
  { name: 'FM Booking', detail: '70+ אמני פסיי (Astrix, Vini Vici, Ace Ventura, Captain Hook…).', contact: 'booking@fm-booking.com' },
  { name: 'Spin Twist Records (DE)', detail: 'לייבל = סוכנות (Neelix). טופס בוקינג פתוח.', contact: 'https://spintwist-records.com/' },
  { name: 'Blue Tunes Booking', detail: 'הלייבל שלך. לשאול אם הם מטפלים בבוקינג ל-ShiBass.', contact: null },
  { name: 'Season Bookings + Kontrol Agency', detail: 'ברזיל — השוק שכבר ניגנת בו.', contact: null },
  { name: 'Siam Bookings', detail: 'תאילנד.', contact: null },
  { name: 'Chakradelic / Spiralbooking / Psylicious / Triskele', detail: 'מרשימת Goabase (CH / München).', contact: null },
  { name: 'Bom Shanka Bookings (UK)', detail: 'שוק בריטי.', contact: null },
];

const STAGES = [
  {
    id: 'now-sukkot',
    title: 'עכשיו → סוכות (23.08–02.10)',
    subtitle: 'בסיס + מדידה',
    items: [
      'Sukkot Wellness 1–2.10: קליפ חי אחד לא ערוך של קהל מגיב + סט מלא מוקלט ליוטיוב.',
      'EPK במסך אחד: ביו ≤300 מילים, וידאו חי, מספרים, תאריכים — נכתב מהמחשב בלחיצה.',
      'מייל ל-Blue Tunes: האם הם מטפלים בבוקינג? אם לא — לבקש הפניה ל-FM Booking.',
    ],
    metric: '1 קליפ חי לכל הופעה · EPK מוכן מקומית',
  },
  {
    id: 'oct-jan',
    title: 'אוקטובר → ינואר 2027',
    subtitle: 'משיכה מקומית ב-4 שווקים',
    items: [
      'ישראל, ברזיל, שוויץ, תאילנד — עד 5K מאזינים חודשיים בכל מדינה.',
      'רמיקס אחד לאמן גדול יותר ב-Blue Tunes או Iboga (רמיקס כלפי מעלה).',
      'הגשה ל-Boom Festival לפני 31.01 — הגשה מלאה, לא חצי.',
    ],
    metric: '5K+ מאזינים חודשיים ב-2 מדינות · 1 רמיקס · Boom הוגש',
  },
  {
    id: 'feb-jul',
    title: 'פברואר → יולי 2027',
    subtitle: 'קצב + קולאב',
    items: [
      'סינגל/רמיקס כל 4–6 שבועות (מודל Vini Vici 2022 / Neelix).',
      'קולאב עם Freak Show (אותו לייבל) → שכבת Blastoyz.',
      'סט מלא ביוטיוב מכל הופעה; רילס 15–30 שניות מכל סט.',
    ],
    metric: '6 שחרורים · 1 קולאב · 50K IG',
  },
  {
    id: 'aug-plus',
    title: 'אוגוסט 2027 והלאה',
    subtitle: 'סוכנות + טראק חתימה',
    items: [
      'להיכנס לרוסטר של FM Booking / Spin Twist / Bom Shanka.',
      'לדחוף טראק חתימה אחד עם כל התקציב האורגני (פלייליסטים, רילס, רמיקס-פאק).',
      'הכנסות מעבר להופעות: סאמפל-פאק / מאסטרקלאס / מרצ׳ קטן.',
    ],
    metric: 'סוכנות חתומה · טראק 1M+ · 150K IG',
  },
];

const WAVE1_CAMPAIGNS = [
  { id: 'W1-01', creative: 'KIDS Reel → Sukkot', audience: 'IL Warm 30-46', campaignId: '120249738379150378' },
  { id: 'W1-02', creative: 'KIDS Reel → Profile', audience: 'IL Cold 21-45', campaignId: '120249738383750378' },
  { id: 'W1-03', creative: 'KIDS Reel → Profile', audience: 'Global Cold Psy/EDM', campaignId: '120249738384050378' },
  { id: 'W1-04', creative: 'KIDS Reel → Profile', audience: 'Industry Pros', campaignId: '120249738384220378' },
  { id: 'W1-05', creative: 'KIDS Img → Sukkot Tickets', audience: 'IL Warm 30-46', campaignId: '120249738384440378' },
  { id: 'W1-06', creative: 'KIDS Img → Sukkot Tickets', audience: 'IL Cold 21-45', campaignId: '120249738384540378' },
  { id: 'W1-07', creative: 'KIDS Img → Sukkot Tickets', audience: 'IL Families 25-45', campaignId: '120249738384640378' },
  { id: 'W1-08', creative: 'Sukkot Lineup → Tickets', audience: 'IL Warm 30-46', campaignId: '120249738384800378' },
  { id: 'W1-09', creative: 'Sukkot Lineup → Tickets', audience: 'IL Cold 21-45', campaignId: '120249738385120378' },
  { id: 'W1-10', creative: 'Sukkot Lineup → Tickets', audience: 'IL Families 25-45', campaignId: '120249738385230378' },
  { id: 'W1-11', creative: 'Dextamine → Beatport', audience: 'IL Warm 30-46', campaignId: '120249738385400378' },
  { id: 'W1-12', creative: 'Dextamine → Beatport', audience: 'IL Cold 21-45', campaignId: '120249738385710378' },
  { id: 'W1-13', creative: 'Dextamine → Beatport (EN)', audience: 'Global Cold Psy/EDM', campaignId: '120249738385900378' },
  { id: 'W1-14', creative: 'Dextamine → Beatport (EN)', audience: 'Industry Pros', campaignId: '120249738386140378' },
  { id: 'W1-15', creative: 'Bookings → shibass.co.il', audience: 'IL Warm 30-46', campaignId: '120249738386290378' },
  { id: 'W1-16', creative: 'Bookings → shibass.co.il', audience: 'IL Cold 21-45', campaignId: '120249738386500378' },
  { id: 'W1-17', creative: 'Bookings (EN) → shibass.co.il', audience: 'Global Cold Psy/EDM', campaignId: '120249738386640378' },
  { id: 'W1-18', creative: 'Bookings (EN) → shibass.co.il', audience: 'Industry Pros', campaignId: '120249738386770378' },
  { id: 'W1-19', creative: 'Set Me Free → YouTube', audience: 'Global Cold Psy/EDM', campaignId: '120249738386830378' },
  { id: 'W1-20', creative: 'Set Me Free → YouTube', audience: 'Industry Pros', campaignId: '120249738387000378' },
].map((row) => ({
  ...row,
  dailyIls: 20,
  status: 'PAUSED',
}));

function organicTools(engines, inventory) {
  const pack = getPackStatus();
  const ffmpeg = Boolean(engines?.ffmpeg?.available);
  const musicReady = (inventory.tracks ?? 0) > 0;
  const ollama = Boolean(engines?.ollama?.available);
  const openai = Boolean(engines?.openaiCompat?.available);
  const ytdlp = Boolean(engines?.ytDlp?.available);
  const meta = Boolean(engines?.meta?.available);
  const hooksReady = ollama || openai || true;

  return [
    {
      id: 'catalog',
      tab: 'player-tab',
      action: 'scan-music',
      title: 'ספריית המחשב → קטלוג אורגני',
      ready: musicReady,
      tool: 'Music scan / Universal Player',
      how: 'סריקה מקומית של WAV/MP3/MIDI. זה המלאי שממנו בוחרים טראק חתימה, סאמפל-פאק, וריל בלי לקנות מדיה.',
      next: musicReady
        ? `${inventory.tracks} קבצים באינדקס — בחר טראק ורוץ לרינדור 9:16`
        : 'אין אינדקס — לחץ סרוק ספרייה',
    },
    {
      id: 'reel',
      tab: 'create-tab',
      action: 'render',
      title: 'FFmpeg 9:16 → ריל אורגני',
      ready: ffmpeg,
      tool: 'FFmpeg מקומי',
      how: 'ריל 1080×1920 מהטראק + רקע שהורדת מאתר הטראק. נכנס לתור אישור — לא עולה לרשת בלי צפייה + אשר ופרסם.',
      next: ffmpeg ? 'בחר רקע + טראק בטאב יצירה, או גרור WAV' : 'התקן FFmpeg — בלי זה אין ריל מקומי',
    },
    {
      id: 'hooks',
      tab: 'create-tab',
      action: 'hooks',
      title: 'הוקים מהמחשב → כיתוב רילס',
      ready: hooksReady,
      tool: ollama ? 'Ollama' : openai ? 'OpenAI-compatible' : 'Metadata engine',
      how: 'שלושה הוקים ויראליים בלי קופירייטר. Ollama אם רץ על 11434; אחרת מנוע metadata על שם הטראק וה-BPM.',
      next: ollama || openai ? 'ReelHook AI על הטראק הנבחר' : 'Ollama כבוי — ההוקים עדיין אמיתיים מהמטא-דאטה של הטראק',
    },
    {
      id: 'radar',
      tab: 'radar-tab',
      action: 'radar',
      title: 'רדאר מתחרים → רמיקס כלפי מעלה',
      ready: ytdlp,
      tool: ytdlp ? 'yt-dlp' : 'Watchlist מקומי',
      how: 'הדפוס של כולם: רמיקס לאמן גדול יותר. הרדאר מאתר הוקים שחורגים ≥2.5x. בלי yt-dlp נשארים עם רשימת המעקב (Astrix, Vini Vici, Ace…).',
      next: ytdlp ? 'סרוק רדאר לפוסטים חיים' : 'התקן yt-dlp לסריקה חיה — בינתיים הרשימה בפאנל הרדאר',
    },
    {
      id: 'publish',
      tab: 'approval-tab',
      action: 'instagram',
      title: 'Graph API → פרסום אורגני (לא מודעה)',
      ready: meta,
      tool: 'Meta Graph',
      how: 'שער אישור: צופים בריל פעם אחת, אז מעלים ל-Reels. זה חשיפה אורגנית. גל 1 הממומן נשאר PAUSED — הסטודיו לא מדליק מודעות.',
      next: meta ? 'אשר ריל מהתור' : 'חסרים META_* ב-.env — הריל נשאר מקומי בתור האישור',
    },
    {
      id: 'pack',
      tab: 'career-tab',
      action: 'pack',
      title: 'psy_pack_v3 → Pack Vol. 1',
      ready: pack.ready,
      tool: 'psy_pack_v3',
      how: '3 שלדי MIDI פריג׳יים + 40 קליפים מובילים + 10 משבצות Serum/Sylenth1. ZIP מוכן למכירה $15–$25. פריסטים מיוצאים מהראק במחשב — אין כאן .fxp מזויף.',
      next: pack.next,
    },
    {
      id: 'epk',
      tab: 'career-tab',
      action: 'epk',
      title: 'EPK במסך אחד מהמחשב',
      ready: true,
      tool: 'Studio API',
      how: 'מזמינים בודקים היסטוריה חיה ואז סטרימים. EPK ≤300 מילים + מייל מדויק לפרומוטרים (עברית + אנגלית). נכתב ל-output/.',
      next: 'כתוב EPK + מייל בוקינג עכשיו',
    },
  ];
}

function ladderRows() {
  const self = {
    id: SHIBASS.id,
    name: SHIBASS.name,
    highlight: true,
    instagramFollowers: SHIBASS.instagramFollowers,
    instagramBar: logScalePercent(SHIBASS.instagramFollowers),
    instagramLabel: formatCount(SHIBASS.instagramFollowers),
    spotifyMonthly: SHIBASS.spotifyMonthly,
    spotifyBar: 0,
    spotifyLabel: 'לא נמדד',
  };
  const others = ARTISTS.filter((artist) => artist.instagramFollowers).map((artist) => ({
    id: artist.id,
    name: artist.name,
    highlight: false,
    instagramFollowers: artist.instagramFollowers,
    instagramBar: logScalePercent(artist.instagramFollowers),
    instagramLabel: formatCount(artist.instagramFollowers),
    spotifyMonthly: artist.spotifyMonthly,
    spotifyBar: logScalePercent(artist.spotifyMonthly),
    spotifyLabel: formatCount(artist.spotifyMonthly),
  }));
  return [self, ...others];
}

function buildCareerBoard({ engines = {}, inventory = {}, pending = 0 } = {}) {
  const tools = organicTools(engines, inventory);
  const readyCount = tools.filter((tool) => tool.ready).length;
  return {
    mock: false,
    updatedAt: UPDATED_AT,
    title: 'ShiBass · מעקב אמנים ומסלול קריירה',
    subtitle: 'הסולם: מאיפה ShiBass לאן — וחשיפה אורגנית עם הכלים שכבר במחשב.',
    kpis: [
      {
        value: '20.4K',
        label: `עוקבי אינסטגרם ${SHIBASS.instagramHandle}`,
        note: `${SHIBASS.instagramEngagementPct}% מעורבות (${SHIBASS.instagramSource})`,
        verified: true,
      },
      {
        value: '150–180K',
        label: 'השלב הבא בסולם',
        note: SHIBASS.nextRung,
        verified: true,
      },
      {
        value: '5K+',
        label: 'מאזינים חודשיים בספוטיפיי למדינה',
        note: 'הסף שבו פסטיבלים מקבלים פי 3',
        verified: true,
      },
      {
        value: '31.01',
        label: 'סגירת הגשות ל-Boom Festival',
        note: '2,719 הגשות ב-2025',
        verified: true,
      },
    ],
    shibass: SHIBASS,
    ladder: ladderRows(),
    artists: ARTISTS,
    patterns: PATTERNS,
    agencies: AGENCIES,
    stages: STAGES,
    wave1: {
      account: 'act_447647440556829',
      status: 'PAUSED',
      note: 'הסטודיו לא מדליק מודעות. גל 1 מתועד כאן כהפניה בלבד — החשיפה מהפאנל הזה היא אורגנית (ריל, סט, EPK, רדאר).',
      dailyTotalIls: 400,
      campaigns: WAVE1_CAMPAIGNS,
    },
    sprint: weekSprint(),
    pack: getPackStatus(),
    organic: {
      readyCount,
      total: tools.length,
      pendingRenders: pending,
      tracks: inventory.tracks ?? 0,
      tools,
    },
    sources: [
      'HypeAuditor',
      'Spotify artist pages',
      'Wikipedia',
      'FM Booking',
      'DJ Mag Top 100 2025',
      'Boom Festival',
      'Chartlex',
      'Pirate.com',
      'Beats to Rap On',
      'Goabase',
    ],
  };
}

function writeEpk({ inventory = {}, engines = {}, pending = 0, links = {} } = {}) {
  ensureDir(OUTPUT_DIR);
  const pack = getPackStatus();
  const he = promoterEmailHe(links);
  const en = promoterEmailEn(links);
  const bio = [
    'ShiBass is a progressive psytrance producer (Blue Tunes / Audix Records).',
    'Instagram @shibassmusic: 20.4K followers, 1.56% engagement (HypeAuditor, 23.08.2026).',
    'Live: Sukkot Wellness 1–2.10.2026; Brazil routing already started.',
    'Ask: 60–90 min slot; full-set YouTube + one unedited crowd clip per show.',
  ].join(' ');

  if (bio.split(/\s+/).length > 300) {
    throw new Error('EPK bio exceeded 300 words');
  }

  const lines = [
    '# ShiBass EPK',
    `Updated: ${new Date().toISOString()} (ladder data ${UPDATED_AT})`,
    '',
    '## Bio (≤300 words)',
    bio,
    '',
    '## Numbers',
    `- Instagram: ${SHIBASS.instagramHandle} ${formatCount(SHIBASS.instagramFollowers)} · ${SHIBASS.instagramEngagementPct}% ER`,
    '- Spotify monthly: not measured yet — target 5K+/country',
    `- Local catalog on this computer: ${inventory.tracks ?? 0} indexed files`,
    `- Renders waiting for approval: ${pending}`,
    `- FFmpeg: ${engines.ffmpeg?.available ? 'ready' : 'missing'}`,
    `- Meta Graph: ${engines.meta?.available ? 'configured' : 'tokens missing'}`,
    `- Ollama: ${engines.ollama?.available ? 'ready' : 'offline'}`,
    `- Psy-Tech Pack Vol. 1: ${pack.ready ? `${pack.midiCount} MIDI ready` : 'not generated yet'}`,
    '',
    '## Live video',
    '- Need: 1 unedited crowd-reaction clip per gig + 1 full set on YouTube.',
    '- Pipeline on this PC: Universal Player → FFmpeg 9:16 → Approval tab → Instagram Reels (organic).',
    '',
    '## Routing / dates',
    '- Sukkot Wellness 1–2.10.2026',
    '- Boom Festival submission deadline 31.01 (independent slots reserved)',
    '- Markets: IL, BR, CH, TH',
    '',
    '## Booking ask',
    '- Blue Tunes: do you book ShiBass? If not, intro to FM Booking (booking@fm-booking.com).',
    '- Send output/epk_promoter_he.txt in Israel and output/epk_promoter_en.txt abroad.',
    '',
    '## Contact',
    '- https://shibass.co.il',
    '- Instagram https://www.instagram.com/shibassmusic/',
  ];

  const markdown = `${lines.join('\n')}\n`;
  fs.writeFileSync(EPK_PATH, markdown, 'utf-8');
  fs.writeFileSync(EPK_HE_PATH, `נושא: ${he.subject}\n\n${he.body}\n`, 'utf-8');
  fs.writeFileSync(EPK_EN_PATH, `Subject: ${en.subject}\n\n${en.body}\n`, 'utf-8');
  writeJson(CAREER_STATE, {
    mock: false,
    epkWrittenAt: Date.now(),
    relativePath: 'output/epk.md',
    emails: ['output/epk_promoter_he.txt', 'output/epk_promoter_en.txt'],
  });
  appendLog({
    source: 'career',
    message: `Wrote organic EPK + promoter emails (${inventory.tracks ?? 0} local tracks, ${pending} pending renders)`,
  });
  return {
    success: true,
    mock: false,
    path: EPK_PATH,
    relativePath: 'output/epk.md',
    emails: {
      he,
      en,
      relativeHe: 'output/epk_promoter_he.txt',
      relativeEn: 'output/epk_promoter_en.txt',
    },
    markdown,
    wordCount: bio.split(/\s+/).length,
  };
}

module.exports = {
  UPDATED_AT,
  SHIBASS,
  ARTISTS,
  PATTERNS,
  AGENCIES,
  STAGES,
  WAVE1_CAMPAIGNS,
  EPK_PATH,
  EPK_HE_PATH,
  EPK_EN_PATH,
  logScalePercent,
  formatCount,
  organicTools,
  buildCareerBoard,
  writeEpk,
};
