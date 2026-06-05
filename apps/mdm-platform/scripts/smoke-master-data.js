const http = require('http');
const path = require('path');
const fs = require('fs');
const BASE = 'http://localhost:3000';
const COOKIE_FILE = path.join(__dirname, '..', '.smoke-cookie.txt');

function readCookie() {
  const raw = fs.readFileSync(COOKIE_FILE, 'utf8');
  const lines = raw.split(/\r?\n/);
  let cookie = '';
  for (const line of lines) {
    if (line.startsWith('# ') || line.startsWith('#\t') || line === '#HttpOnly_' || !line.trim()) continue;
    const cleanLine = line.startsWith('#HttpOnly_') ? line.substring(1) : line;
    const parts = cleanLine.split('\t');
    if (parts.length >= 7) {
      if (cookie) cookie += '; ';
      cookie += parts[5] + '=' + parts[6];
    }
  }
  if (!cookie) throw new Error('No cookie parsed');
  return cookie;
}

const cookie = readCookie();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
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

  // 1. Create org unit
  const orgRes = await request('POST', '/api/org-units', { org_unit_name: '工程技术部', org_type: 'department', org_mnemonic: 'ENG' });
  check('POST /org-units creates org', orgRes.status === 201 && orgRes.body.org_unit_code && orgRes.body.org_unit_code.startsWith('OU-DEPT-ENG'));
  const orgCode = orgRes.body.org_unit_code;

  // 2. Activate org unit
  const actRes = await request('POST', `/api/org-units/${encodeURIComponent(orgCode)}/activate`);
  check('POST /org-units/:code/activate', actRes.body.success);

  // 3. List org units
  const listOrgRes = await request('GET', '/api/org-units?status=active');
  check('GET /org-units lists orgs', Array.isArray(listOrgRes.body.rows) && listOrgRes.body.rows.length >= 1);

  // 4. Get org unit by code
  const getOrgRes = await request('GET', `/api/org-units/${encodeURIComponent(orgCode)}`);
  check('GET /org-units/:code', getOrgRes.status === 200 && getOrgRes.body.org_unit_name === '工程技术部');

  // 5. Create person
  const personRes = await request('POST', '/api/persons', { person_name: '张三', mobile: '13800138000', email: 'zhangsan@test.com' });
  check('POST /persons creates person', personRes.status === 201 && personRes.body.employee_no && personRes.body.employee_no.startsWith('EMP-'));
  const empNo = personRes.body.employee_no;

  // 6. Activate person
  const actPersonRes = await request('POST', `/api/persons/${encodeURIComponent(empNo)}/activate`);
  check('POST /persons/:no/activate', actPersonRes.body.success);

  // 7. Get person
  const getPersonRes = await request('GET', `/api/persons/${encodeURIComponent(empNo)}`);
  check('GET /persons/:no', getPersonRes.body.person_name === '张三');

  // 8. Update person
  const updRes = await request('PUT', `/api/persons/${encodeURIComponent(empNo)}`, { mobile: '13900139000' });
  check('PUT /persons/:no updates', updRes.body.success);

  // 9. Create product family
  const pfRes = await request('POST', '/api/product-families', { model_name: '枭龙S19', model_code: 'S19', class_major: 'CF' });
  check('POST /product-families creates', pfRes.status === 201 && pfRes.body.product_family_code && pfRes.body.product_family_code.startsWith('PF-S19-CF'));
  const pfCode = pfRes.body.product_family_code;

  // 10. Activate product family
  const actPfRes = await request('POST', `/api/product-families/${encodeURIComponent(pfCode)}/activate`);
  check('POST /product-families/:code/activate', actPfRes.body.success);

  // 11. Create product
  const prodRes = await request('POST', '/api/products', { product_family_id: 1, revision: 'A', class_mid: 'RFF', class_minor: 'PNL' });
  check('POST /products creates', prodRes.status === 201 && prodRes.body.product_code && prodRes.body.product_code.startsWith('PRD-S19-CF-RFF-PNL'));
  const prodCode = prodRes.body.product_code;

  // 12. Release product
  const relRes = await request('POST', `/api/products/${encodeURIComponent(prodCode)}/release`);
  check('POST /products/:code/release', relRes.body.success);

  // 13. Quality dashboard
  const dashRes = await request('GET', '/api/quality/dashboard');
  check('GET /quality/dashboard', dashRes.status === 200 && typeof dashRes.body.org_person === 'object');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
