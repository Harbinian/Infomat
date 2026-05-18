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
  const noKey = await request('GET', '/api/integration/persons');
  check('GET /integration/persons without key returns 401', noKey.status === 401);

  // 2. Generate API key
  const fs = require('fs');
  const cookie = fs.readFileSync(process.env.TEMP + '/smoke-cookie.txt', 'utf8').trim();
  const genRes = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_V2', permissions: ['read', 'write'] },
    { 'Cookie': cookie }
  );
  check('POST /credentials/generate', genRes.status === 201 && genRes.body.api_key);
  const apiKey = genRes.body.api_key;

  // 3. Valid key -> 200
  const withKey = await request('GET', '/api/integration/persons', null, { 'X-API-Key': apiKey });
  check('GET /integration/persons with key', withKey.status === 200 && Array.isArray(withKey.body.rows));

  // 4. Sync status
  const syncRes = await request('GET', '/api/integration/sync-status?entity_type=person&since=2020-01-01', null, { 'X-API-Key': apiKey });
  check('GET /sync-status', syncRes.status === 200 && typeof syncRes.body.total_changed === 'number');

  // 5. External identity upsert
  const extRes = await request('POST', '/api/integration/external-identities',
    { entity_type: 'Person', entity_id: 1, system_code: 'PLM', external_key: 'PLM-GUID-001' },
    { 'X-API-Key': apiKey }
  );
  check('POST /external-identities', extRes.status === 201);

  // 6. Read-only key can't write
  const roGen = await request('POST', '/api/integration/credentials/generate',
    { system_name: 'SMOKE_V2_RO', permissions: ['read'] },
    { 'Cookie': cookie }
  );
  const roKey = roGen.body.api_key;
  const roWrite = await request('POST', '/api/integration/external-identities',
    { entity_type: 'Person', entity_id: 1, system_code: 'ERP', external_key: 'ERP-001' },
    { 'X-API-Key': roKey }
  );
  check('Read-only key blocked from write', roWrite.status === 403);

  // 7. Org units via integration
  const orgRes = await request('GET', '/api/integration/org-units', null, { 'X-API-Key': apiKey });
  check('GET /integration/org-units', orgRes.status === 200 && Array.isArray(orgRes.body.rows));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
