const http = require('http');

const BASE = 'http://localhost:3000';
const cookie = require('fs').readFileSync(process.env.TEMP + '/smoke-cookie.txt', 'utf8').trim();

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

  // 1. GET categories
  const cats = await request('GET', '/api/master-data/categories');
  check('GET /categories returns array', Array.isArray(cats.body) && cats.body.length === 6);

  // 2. configure code rule for category 1 (PART)
  const ruleRes = await request('PUT', '/api/master-data/code-rules/1', {
    prefix: 'CHX', total_length: 30, segment_defs: [{ type: 'category', length: 4, value: 'PART' }]
  });
  check('PUT /code-rules/1', ruleRes.body.success);

  // 3. set attributes for category 1
  const attrRes = await request('PUT', '/api/master-data/categories/1/attributes', {
    attributes: [
      { attr_name: 'drawing_no', attr_label: '图号', attr_type: '文本', required: 1 },
      { attr_name: 'material', attr_label: '材料牌号', attr_type: '文本', required: 1 },
      { attr_name: 'weight', attr_label: '重量(kg)', attr_type: '数字', required: 0 }
    ]
  });
  check('PUT /categories/1/attributes', attrRes.body.success);

  // 4. create an item (auto-generate code)
  const createRes = await request('POST', '/api/master-data/items', {
    category_id: 1, name: '机翼前缘肋', attributes: { drawing_no: 'CHX-001-001', material: 'TC4', weight: '2.3' }, maintain_dept_id: 1
  });
  check('POST /items creates with auto code', createRes.status === 201 && createRes.body.code && createRes.body.code.startsWith('CHX'));

  // 5. get items list
  const listRes = await request('GET', '/api/master-data/items?category_id=1');
  check('GET /items returns rows', Array.isArray(listRes.body.rows) && listRes.body.rows.length >= 1);

  // 6. get single by code
  const code = createRes.body.code;
  const getRes = await request('GET', `/api/master-data/items/${code}`);
  check('GET /items/:code returns attributes', getRes.body.attributes && getRes.body.attributes.drawing_no === 'CHX-001-001');

  // 7. update item
  const updateRes = await request('PUT', `/api/master-data/items/${code}`, { name: '机翼前缘肋(改)', attributes: { drawing_no: 'CHX-001-001', material: 'TC4', weight: '2.5' } });
  check('PUT /items/:code updates', updateRes.body.success);

  // 8. duplicate check
  const dupRes = await request('GET', '/api/master-data/duplicates/check');
  check('GET /duplicates/check', Array.isArray(dupRes.body.duplicates));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
