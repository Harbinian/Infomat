const http = require('http');
const BASE = 'http://localhost:3000';

function request(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  let pass = 0, fail = 0;
  function check(name, ok) { if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.error(`  FAIL ${name}`); } }

  // 1. No API key -> 401
  const noKey = await request('GET', '/api/integration/materials');
  check('GET /materials without key returns 401', noKey.status === 401);

  // 2. Get a session cookie and generate an API key (admin)
  const fs = require('fs');
  const cookie = fs.readFileSync(process.env.TEMP + '/smoke-cookie.txt', 'utf8').trim();
  const genRes = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_TEST', permissions: ['read', 'write'] },
    { 'Cookie': cookie }
  );
  check('POST /credentials/generate creates key', genRes.status === 201 && genRes.body.api_key);

  const apiKey = genRes.body.api_key;

  // 3. Valid API key -> 200
  const withKey = await request('GET', '/api/integration/materials', null, { 'X-API-Key': apiKey });
  check('GET /materials with key returns 200', withKey.status === 200 && Array.isArray(withKey.body.rows));

  // 4. Sync status
  const syncRes = await request('GET', '/api/integration/materials/sync-status?since=2020-01-01', null, { 'X-API-Key': apiKey });
  check('GET /materials/sync-status', syncRes.status === 200 && typeof syncRes.body.total_changed === 'number');

  // 5. Old code mapping -- 404 for unknown code
  const oldCodeRes = await request('GET', '/api/integration/old-code/ZZZ999', null, { 'X-API-Key': apiKey });
  check('GET /old-code/ZZZ999 returns 404 for unknown', oldCodeRes.status === 404);

  // 6. Consistency check callback
  const cbRes = await request('POST', '/api/integration/callback/consistency-check',
    { checks: [{ code: 'TEST001', field: 'material', md_value: 'TC4', consumer_value: 'TC4', match: true }] },
    { 'X-API-Key': apiKey }
  );
  check('POST /callback/consistency-check', cbRes.status === 200 && cbRes.body.mismatches === 0);

  // 7. Read-only key can't write
  const roKeyGen = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_TEST_RO', permissions: ['read'] },
    { 'Cookie': cookie }
  );
  const roKey = roKeyGen.body.api_key;
  const roWriteRes = await request('POST', '/api/integration/callback/consistency-check',
    { checks: [] },
    { 'X-API-Key': roKey }
  );
  check('Read-only key blocked from write', roWriteRes.status === 403);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
