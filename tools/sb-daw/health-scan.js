function extractApiPaths(html) {
  if (typeof html !== 'string' || !html) {
    return [];
  }
  const found = new Set();
  const patterns = [
    /['"`](\/api\/[A-Za-z0-9_\-\/]*?)['"`]/g,
    /fetch\(\s*['"`](\/api\/[^'"`]+)['"`]/g,
    /https?:\/\/[^'"`\s]+(\/api\/[A-Za-z0-9_\-\/]+)/g,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      found.add(match[1]);
      match = pattern.exec(html);
    }
  }
  return [...found];
}

function missingApiPaths(html, serverSource) {
  if (typeof serverSource !== 'string') {
    throw new Error('server.js source must be a string');
  }
  return extractApiPaths(html).filter((apiPath) => !serverSource.includes(apiPath));
}

function healthReport(html, serverSource) {
  const paths = extractApiPaths(html);
  const missing = missingApiPaths(html, serverSource);
  return {
    ok: missing.length === 0,
    mock: false,
    scanned: paths,
    missing,
    message:
      missing.length === 0
        ? 'All panel API paths exist in server.js'
        : `${missing.length} of ${paths.length} API calls point to paths that do not exist in server.js`,
  };
}

module.exports = {
  extractApiPaths,
  missingApiPaths,
  healthReport,
};
