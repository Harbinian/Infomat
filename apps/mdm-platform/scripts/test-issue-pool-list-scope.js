// P24: real HTTP/session + owned tmpfs MySQL; synthetic identities only.
// Input: --output NEW directory under artifacts. Output: checks and cleanup logs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const i = process.argv.indexOf('--output'), output = path.resolve(process.argv[i + 1] || '.');
assert(i >= 0 && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const checks = [];
async function main() {
  await withStage05Fixture(async ({ pool, expect, request }) => {
    for (const endpoint of ['queues', 'issues']) {
      const url = '/api/process-governance/issue-pool/' + endpoint;
      await expect('lead', url, 'GET');
      await expect('contact', url, 'GET');
      await expect('admin', url, 'GET');
      await expect('outsider', url, 'GET');
      checks.push(endpoint + ': global/admin read and current department reads allowed');
      try {
        await pool.execute('UPDATE person SET current_department_id=NULL WHERE person_id=83');
        const result = await request('contact', url, 'GET');
        assert([401, 403].includes(result.status));
        checks.push(endpoint + ': missing current department denied with ' + result.status);
      } finally { await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=83'); }
      await expect('contact', url, 'GET');
    }
  }, { evidenceDir: output, previewOnly: true });
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, real_http: true, owned_mysql: true, formal_environment: false }, null, 2));
}
main().catch(error => { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, checks }, null, 2)); console.error(error.message); process.exitCode = 1; });
