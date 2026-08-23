#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const studioRoot = process.env.STUDIO_ROOT
  || path.resolve(__dirname, '..', '..', 'promo-publisher');

if (!fs.existsSync(path.join(studioRoot, 'modules', 'sql-db.js'))) {
  console.error(`Studio SQL installer cannot find sql-db.js under ${studioRoot}`);
  process.exit(1);
}

const sql = require(path.join(studioRoot, 'modules', 'sql-db'));
const { scanFakeApis } = require(path.join(studioRoot, 'modules', 'scan-fake'));

const installed = sql.installStudioSql({ importExisting: true });
const scan = scanFakeApis();

const report = {
  success: Boolean(installed.success),
  mock: false,
  installed,
  scan: {
    root: scan.root,
    fakeCount: scan.fakeCount,
    findings: scan.findings,
    mcp: scan.mcp,
    servers: scan.servers,
  },
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.success ? 0 : 1);
