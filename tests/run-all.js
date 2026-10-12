// Runs only the suites that validate the binary engine and its lifecycle.
// Market, spot and futures suites are intentionally excluded from this
// binary-only build; they are not production commands.
const { spawnSync } = require('child_process');
const path = require('path');

const files = [
  'audit-v4.test.js',
  'binary-lifecycle.test.js',
  'expiry-selection.test.js',
  'next-candle.test.js',
];

let failedFiles = 0;
let totalPassed = 0;
let totalTests = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
    encoding: 'utf8',
    env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL || 'silent' },
  });
  process.stdout.write(res.stdout || '');
  if (res.stderr && res.status !== 0) process.stderr.write(res.stderr);
  const match = /(\d+)\/(\d+) passed/.exec(res.stdout || '');
  if (match) {
    totalPassed += Number(match[1]);
    totalTests += Number(match[2]);
  }
  if (res.status !== 0 || !match) {
    if (!match) console.log(`  FAIL - ${file} produced no result summary`);
    failedFiles += 1;
  }
}
console.log(`\\n==== Binary-only: ${files.length} suite(s), ${totalPassed}/${totalTests} tests passed, ${failedFiles} suite(s) failed ====`);
process.exit(failedFiles ? 1 : 0);
