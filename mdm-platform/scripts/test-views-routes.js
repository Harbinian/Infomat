const http = require('http');

let sessionCookie = null;

function req(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionCookie) headers['Cookie'] = sessionCookie;
    const opts = { hostname: 'localhost', port: 3000, path, method, headers };
    const r = http.request(opts, res => {
      let data = '';
      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        sessionCookie = setCookie[0].split(';')[0];
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  console.log('=== Views Routes Smoke Test ===\n');

  // 1. Login
  console.log('1. Login...');
  const login = await req('/api/org/login', 'POST', { employee_no: 'ADMIN001', password: 'admin123' });
  if (login.error) { console.log('   FAIL:', login.error); process.exit(1); }
  console.log('   User:', login.name, login.role);

  // 2. GET /api/views/sankey
  console.log('2. GET /api/views/sankey ...');
  const sankey = await req('/api/views/sankey');
  if (sankey.error) { console.log('   FAIL:', sankey.error); } else {
    console.log('   Nodes:', sankey.nodes ? sankey.nodes.length : 'MISSING');
    console.log('   Links:', sankey.links ? sankey.links.length : 'MISSING');
    if (sankey.nodes) {
      sankey.nodes.slice(0, 3).forEach(n => console.log('   -', n.name, 'layer', n.layer, 'type', n.type));
    }
    if (sankey.links && sankey.links.length > 0) {
      console.log('   Link example:', sankey.links[0].source, '→', sankey.links[0].target, 'value:', sankey.links[0].value);
    }
  }

  // 3. GET /api/views/sankey with filters
  console.log('3. GET /api/views/sankey?cap_levels=L1 ...');
  const filtered = await req('/api/views/sankey?cap_levels=L1');
  if (filtered.error) { console.log('   FAIL:', filtered.error); } else {
    console.log('   Nodes:', filtered.nodes ? filtered.nodes.length : 'MISSING');
    console.log('   Links:', filtered.links ? filtered.links.length : 'MISSING');
  }

  // 4. GET /api/views/processes/:id (first process if any)
  console.log('4. GET /api/views/processes/1 ...');
  const proc = await req('/api/views/processes/1');
  if (proc.error) {
    console.log('   No process id=1:', proc.error);
  } else {
    console.log('   Name:', proc.name);
    console.log('   Systems:', proc.systems ? proc.systems.length : 0);
    console.log('   Fields:', proc.fields ? proc.fields.length : 0);
  }

  console.log('\n=== Done ===');
}

main().catch(e => { console.error(e); process.exit(1); });
