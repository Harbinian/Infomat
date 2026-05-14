const http = require('http');

const BASE = 'http://localhost:3000';

function req(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000,
      path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    const r = http.request(opts, res => {
      let data = '';
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
  console.log('   User:', login.name, login.role);

  // 2. GET /api/views/sankey
  console.log('2. GET /api/views/sankey ...');
  const sankey = await req('/api/views/sankey');
  console.log('   Nodes:', sankey.nodes ? sankey.nodes.length : 'MISSING');
  console.log('   Links:', sankey.links ? sankey.links.length : 'MISSING');
  if (sankey.nodes) {
    sankey.nodes.slice(0, 3).forEach(n => console.log('   -', n.name, 'layer', n.layer, 'type', n.type));
  }
  if (sankey.links && sankey.links.length > 0) {
    console.log('   Link example:', sankey.links[0].source, '→', sankey.links[0].target, 'value:', sankey.links[0].value);
  }

  // 3. GET /api/views/sankey with filters
  console.log('3. GET /api/views/sankey?cap_levels=L1 ...');
  const filtered = await req('/api/views/sankey?cap_levels=L1');
  console.log('   Nodes:', filtered.nodes ? filtered.nodes.length : 'MISSING');
  console.log('   Links:', filtered.links ? filtered.links.length : 'MISSING');

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
