const fs = require('fs');

const MARKER = 'shibass-sb-daw-jobs-html';
const ROUTE = '/api/sb-daw/jobs/';
const DEFAULT_ORIGIN = 'http://127.0.0.1:4000';

function rewriteSbDawHtml(source, origin = DEFAULT_ORIGIN) {
  if (typeof source !== 'string') {
    throw new Error('sb-daw.html source must be a string');
  }
  if (!source.includes(ROUTE) && !source.includes('/api/sb-daw/jobs')) {
    return { changed: false, source, reason: 'no sb-daw jobs path in html' };
  }
  if (source.includes(MARKER)) {
    return { changed: false, source, reason: 'already patched' };
  }

  const absolute = `${origin.replace(/\/$/, '')}${ROUTE}`;
  let next = source;
  next = next.replaceAll(`'${ROUTE}'`, `'${absolute}'`);
  next = next.replaceAll(`"${ROUTE}"`, `"${absolute}"`);
  next = next.replaceAll(`\`${ROUTE}\``, `\`${absolute}\``);
  next = next.replaceAll("'/api/sb-daw/jobs'", `'${absolute}'`);
  next = next.replaceAll('"/api/sb-daw/jobs"', `"${absolute}"`);

  const banner = `<!-- ${MARKER} jobs API: ${absolute} -->\n`;
  if (next.startsWith('<!')) {
    const htmlTag = next.match(/<html[^>]*>/i);
    if (htmlTag) {
      const at = next.indexOf(htmlTag[0]) + htmlTag[0].length;
      next = `${next.slice(0, at)}\n${banner}${next.slice(at)}`;
    } else {
      next = banner + next;
    }
  } else {
    next = banner + next;
  }

  return {
    changed: next !== source,
    source: next,
    origin,
    absolute,
  };
}

function patchSbDawHtmlFile(htmlPath, origin = DEFAULT_ORIGIN) {
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    throw new Error(`sb-daw.html not found: ${htmlPath}`);
  }
  const original = fs.readFileSync(htmlPath, 'utf8');
  const result = rewriteSbDawHtml(original, origin);
  if (!result.changed) {
    return { ...result, path: htmlPath };
  }
  const backup = `${htmlPath}.bak-sb-daw`;
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, original, 'utf8');
  }
  fs.writeFileSync(htmlPath, result.source, 'utf8');
  return { ...result, path: htmlPath, backup };
}

module.exports = {
  MARKER,
  ROUTE,
  DEFAULT_ORIGIN,
  rewriteSbDawHtml,
  patchSbDawHtmlFile,
};
