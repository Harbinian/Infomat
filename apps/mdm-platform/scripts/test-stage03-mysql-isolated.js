// Creates ONLY a fresh labelled MySQL 8.4 container with tmpfs data, no existing
// volumes, and an ephemeral loopback port. Does not load any local/private env.
// Uses synthetic identities and a locally generated TLS certificate. Finally
// removes ONLY the container ID created here after checking its ownership label.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { execFileSync, fork } = require('node:child_process');
const { once } = require('node:events');
const mysql = require('mysql2/promise');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { SESSION_SCHEMA_SQL, MIGRATION_KEY, manageSessionSchema, inspectSessionSchema, cleanupSessions } = require('../server/sessionMigration');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { createReadiness } = require('../server/readiness');
const { sessionConfig } = require('../server/sessionConfig');
const { MysqlSessionStore } = require('../server/mysqlSessionStore');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const appRoot = path.resolve(__dirname, '..');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-stage03-'));
  const label = crypto.randomUUID();
  const syntheticPassword = crypto.randomBytes(24).toString('hex');
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(key)));
  const docker = args => execFileSync('docker', args, { env: { ...baseEnv, MYSQL_ROOT_PASSWORD: syntheticPassword }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  let id, admin, child, proxy, backendPort, cookie = '', csrf = '', ca, rootConfig, runtimeEnv;
  const outputs = [];
  async function stopApp() {
    if (!child) return;
    const old = child; child = null;
    const exit = once(old, 'exit');
    old.send('mdm:stop', () => {});
    const force = setTimeout(() => old.kill(), 18000);
    await exit; clearTimeout(force);
  }
  async function startApp() {
    child = fork(path.join(appRoot, 'server/index.js'), [], { cwd: appRoot, env: { ...runtimeEnv, PORT: String(backendPort || 0) }, execArgv: [], silent: true, windowsHide: true });
    child.stdout.on('data', data => outputs.push(data.toString()));
    child.stderr.on('data', data => outputs.push(data.toString()));
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await sleep(150);
      const line = outputs.join('').match(/MDM_LISTENING port=(\d+)/g);
      if (line && backendPort) {
        try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/health`)).ok) return; } catch (_) { /* startup */ }
      }
    }
    throw new Error('ISOLATED_APP_START_FAILED');
  }
  async function request(route, { method = 'GET', body, cookieValue = cookie, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request({ hostname: '127.0.0.1', servername: 'localhost', port: proxy.address().port, path: route, method, ca,
        headers: { 'Content-Type': 'application/json', Cookie: cookieValue, ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers } }, res => {
        let text = ''; res.on('data', data => { text += data; });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie && cookieValue === cookie) cookie = setCookie[0].split(';')[0];
          resolve({ status: res.statusCode, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body)); req.end();
    });
  }
  async function login() {
    cookie = ''; csrf = '';
    const result = await request('/api/org/login', { method: 'POST', body: { loginName: 'SYNTHETIC_STAGE03', password: syntheticPassword } });
    assert.equal(result.status, 200, 'synthetic login should succeed');
    assert.ok(cookie.startsWith('__Host-infomat.mdm.sid='));
    const header = result.headers['set-cookie'][0];
    for (const pattern of [/; Secure/i, /; HttpOnly/i, /; SameSite=Lax/i, /; Path=\//i]) assert.match(header, pattern);
    assert.doesNotMatch(header, /Domain=/i);
    csrf = (await request('/api/csrf-token')).body.csrfToken;
    return cookie;
  }
  try {
    id = docker(['run', '--detach', '--pull', 'never', '--name', `mdm-stage03-${label}`, '--label', `infomat.stage03=${label}`,
      '--tmpfs', '/var/lib/mysql:rw,size=1073741824', '--publish', '127.0.0.1::3306', '--env', 'MYSQL_ROOT_PASSWORD', 'mysql:8.4']);
    assert.match(id, /^[a-f0-9]{64}$/);
    const inspect = JSON.parse(docker(['inspect', id]))[0];
    assert.equal(inspect.Config.Labels['infomat.stage03'], label);
    assert.equal(inspect.HostConfig.Tmpfs['/var/lib/mysql'], 'rw,size=1073741824');
    assert.equal(inspect.Mounts.filter(m => m.Type === 'bind' || m.Type === 'volume').length, 0);
    const binding = inspect.NetworkSettings.Ports['3306/tcp'][0];
    assert.equal(binding.HostIp, '127.0.0.1');
    const dbPort = Number(binding.HostPort); assert.ok(dbPort !== 3306 && dbPort !== 3307);
    rootConfig = { host: '127.0.0.1', port: dbPort, user: 'root', password: syntheticPassword, connectTimeout: 1000 };
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try { admin = await mysql.createConnection(rootConfig); break; } catch (_) { await sleep(500); }
    }
    assert.ok(admin, 'isolated MySQL must start');
    await admin.execute('CREATE DATABASE stage03_isolated');
    await admin.changeUser({ database: 'stage03_isolated' });
    for (const sql of splitSqlStatements(mdmMysqlSchemaSql())) await admin.execute(sql);
    assert.equal((await manageSessionSchema(admin, 'inspect')).state, 'absent');
    assert.equal((await manageSessionSchema(admin, 'apply')).state, 'applied');
    assert.equal((await manageSessionSchema(admin, 'apply')).state, 'applied');
    assert.equal((await manageSessionSchema(admin, 'rollback')).state, 'absent');
    assert.equal((await manageSessionSchema(admin, 'rollback')).state, 'absent');
    assert.equal((await manageSessionSchema(admin, 'apply')).state, 'applied');
    await admin.execute('ALTER TABLE mdm_http_sessions DROP INDEX idx_mdm_http_sessions_expiry');
    assert.equal((await inspectSessionSchema(admin)).state, 'drift');
    await assert.rejects(manageSessionSchema(admin, 'apply'), /DRIFT/);
    await admin.execute('CREATE INDEX idx_mdm_http_sessions_expiry ON mdm_http_sessions (expires_at)');
    await admin.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
    assert.equal((await manageSessionSchema(admin, 'apply')).state, 'applied', 'resume empty exact schema after DDL interruption');
    // All fixture writes occur in the fresh container through its administration connection.
    await makeIdentityMysqlRepository(admin).initSchema();
    await admin.execute("INSERT INTO departments (id,code,name) VALUES (91,'SYNTHETIC','隔离合成部门')");
    await admin.execute("INSERT INTO person (person_id,employee_no,person_name,current_department_id) VALUES (81,'SYNTHETIC_STAGE03','隔离合成人员',91)");
    const passwordHash = require('bcryptjs').hashSync(syntheticPassword, 10);
    await admin.execute("INSERT INTO user_accounts (account_id,person_id,login_name,password_hash,account_status) VALUES (181,81,'SYNTHETIC_STAGE03',?,'active')", [passwordHash]);
    await admin.execute("INSERT INTO person_roles (person_id,role_id,scope_type,scope_department_id,authorization_basis) SELECT 81,role_id,'department',91,'synthetic test' FROM roles WHERE role_code='department_contact'");
    await admin.query("CREATE USER 'stage03_runtime'@'%' IDENTIFIED BY ?", [syntheticPassword]);
    await admin.execute("GRANT SELECT ON stage03_isolated.* TO 'stage03_runtime'@'%'");
    await admin.execute("GRANT INSERT, UPDATE, DELETE ON stage03_isolated.mdm_http_sessions TO 'stage03_runtime'@'%'");
    await admin.execute("GRANT UPDATE (last_login_at) ON stage03_isolated.user_accounts TO 'stage03_runtime'@'%'");
    const openssl = ['C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'].find(fs.existsSync);
    assert.ok(openssl, 'isolated TLS certificate generator required');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { env: baseEnv, windowsHide: true, stdio: 'ignore' });
    ca = fs.readFileSync(path.join(temp, 'cert.pem'));
    const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening'); backendPort = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    proxy = https.createServer({ key: fs.readFileSync(path.join(temp, 'key.pem')), cert: ca }, (req, res) => {
      const upstream = http.request({ host: '127.0.0.1', port: backendPort, localAddress: '127.0.0.2', path: req.url, method: req.method,
        headers: { ...req.headers, host: `localhost:${proxy.address().port}`, 'x-forwarded-host': `localhost:${proxy.address().port}`, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress } }, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
    });
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
    runtimeEnv = { ...baseEnv, NODE_ENV: 'production', HOST: '127.0.0.1', MDM_ACCESS_MODE: 'https-proxy', MDM_TRUST_PROXY: '127.0.0.2/32',
      MDM_PUBLIC_ORIGIN: `https://localhost:${proxy.address().port}`, SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      MDM_SESSION_STORE: 'mysql', MDM_READY_CACHE_MS: '1000', MDM_READY_TIMEOUT_MS: '500', MDM_SESSION_TIMEOUT_MS: '500',
      MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(dbPort), MYSQL_DATABASE: 'stage03_isolated', MYSQL_USER: 'stage03_runtime', MYSQL_PASSWORD: syntheticPassword, MYSQL_CONNECTION_LIMIT: '2',
      MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql', PROCESS_V7_PREVIEW_ENABLED: '0', PROCESS_V7_FORMAL_ENABLED: '0', PROCESS_DATA_GOVERNANCE_ENABLED: '0' };
    await startApp();
    assert.equal((await request('/api/ready')).status, 200);
    assert.equal((await request('/')).status, 200);
    const forged = await fetch(`http://127.0.0.1:${backendPort}/api/org/session`, { headers: { Host: 'localhost', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'localhost' } });
    assert.equal(forged.status, 400, 'untrusted direct source cannot forge TLS');
    assert.equal((await request('/api/org/me')).status, 401);
    await login();
    const beforeRestart = cookie;
    assert.equal((await request('/api/org/me')).body.personId, 81);
    await stopApp(); await startApp();
    cookie = beforeRestart; assert.equal((await request('/api/org/me')).status, 200, 'session survives a real application process restart');
    assert.equal((await request('/api/org/me', { cookieValue: '__Host-infomat.mdm.sid=invalid' })).status, 401);
    assert.equal((await request('/api/org/me', { cookieValue: cookie.replace('__Host-infomat.mdm.sid=', 'connect.sid=') })).status, 401);
    await admin.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=181');
    assert.equal((await request('/api/org/me')).status, 401);
    await login(); await admin.execute("UPDATE user_accounts SET account_status='disabled' WHERE account_id=181");
    assert.equal((await request('/api/org/me')).status, 401);
    await admin.execute("UPDATE user_accounts SET account_status='active',must_change_password=1 WHERE account_id=181");
    await login(); assert.ok(csrf, 'first-password session must obtain a CSRF token');
    assert.equal((await request('/api/org/departments')).status, 403);
    await admin.execute('UPDATE user_accounts SET must_change_password=0 WHERE account_id=181');
    await login();
    await admin.execute("REVOKE INSERT ON stage03_isolated.mdm_http_sessions FROM 'stage03_runtime'@'%'");
    const saveFailure = await request('/api/org/login', { method: 'POST', body: { loginName: 'SYNTHETIC_STAGE03', password: syntheticPassword }, cookieValue: '' });
    assert.equal(saveFailure.status, 503, 'a failed persistent session save must not report a successful login');
    await admin.execute("GRANT INSERT ON stage03_isolated.mdm_http_sessions TO 'stage03_runtime'@'%'");
    // A signed store record missing required account identity cannot use legacy authorization.
    const config = sessionConfig(runtimeEnv);
    const fixtureStore = new MysqlSessionStore(config, { env: runtimeEnv });
    const invalidSid = crypto.randomBytes(24).toString('hex');
    await new Promise((resolve, reject) => fixtureStore.set(invalidSid, { cookie: { expires: new Date(Date.now() + 60000).toISOString(), originalMaxAge: 60000 }, personId: 81 }, error => error ? reject(error) : resolve()));
    const signed = require('cookie-signature').sign(invalidSid, runtimeEnv.SESSION_SECRET);
    assert.equal((await request('/api/org/me', { cookieValue: `__Host-infomat.mdm.sid=${encodeURIComponent(`s:${signed}`)}` })).status, 401);
    await fixtureStore.close();
    await assert.rejects(manageSessionSchema(admin, 'rollback'), /NONEMPTY/);
    const logoutCookie = cookie;
    assert.equal((await request('/api/org/logout', { method: 'POST' })).status, 200);
    assert.equal((await request('/api/org/me', { cookieValue: logoutCookie })).status, 401);
    await login();
    await admin.execute('UPDATE mdm_http_sessions SET expires_at=0');
    assert.equal((await request('/api/org/me')).status, 401);
    assert.ok((await cleanupSessions(admin, { apply: false })).expired >= 1);
    assert.ok((await cleanupSessions(admin, { apply: true, limit: 1 })).deleted === 1);
    await login();
    await admin.execute('ALTER TABLE mdm_http_sessions DROP INDEX idx_mdm_http_sessions_expiry'); await sleep(1100);
    assert.equal((await request('/api/ready')).status, 503);
    await admin.execute('CREATE INDEX idx_mdm_http_sessions_expiry ON mdm_http_sessions (expires_at)'); await sleep(1100);
    assert.equal((await request('/api/ready')).status, 200);
    // A missing necessary business table is detected even after earlier successful probes.
    await admin.execute('RENAME TABLE mdm_todos TO isolated_held_todos'); await sleep(1100);
    assert.equal((await request('/api/ready')).status, 503);
    await admin.execute('RENAME TABLE isolated_held_todos TO mdm_todos'); await sleep(1100);
    assert.equal((await request('/api/ready')).status, 200);
    // Pause/unpause ONLY the new container to simulate a stalled database while
    // retaining its tmpfs. No existing instance is touched.
    await admin.end(); admin = null;
    docker(['pause', id]); await sleep(1100);
    assert.equal((await request('/api/health')).status, 200);
    assert.equal((await request('/api/ready')).status, 503);
    assert.equal((await request('/api/org/me')).status, 503);
    docker(['unpause', id]);
    const recoveryDeadline = Date.now() + 30000;
    while (Date.now() < recoveryDeadline) { if ((await request('/api/ready')).status === 200) break; await sleep(1100); }
    assert.equal((await request('/api/ready')).status, 200);
    assert.equal((await request('/api/org/me')).status, 200, 'existing session resumes after DB recovery');
    admin = await mysql.createConnection({ ...rootConfig, database: 'stage03_isolated' });
    // Runtime user has no DDL privileges; startup and login succeeded without them.
    const limited = await mysql.createConnection({ ...rootConfig, database: 'stage03_isolated', user: 'stage03_runtime' });
    await assert.rejects(limited.execute('CREATE TABLE forbidden_runtime_ddl (id INT)')); await limited.end();
    const readyProbe = createReadiness({ env: { ...runtimeEnv, MYSQL_PASSWORD: 'synthetic-wrong-password' }, version: { sourceDigest: 'synthetic' } });
    assert.equal((await readyProbe.check()).ready, false); await readyProbe.close();
    // Never print credentials or session material from a failed assertion or driver.
    assert.ok(!outputs.join('').includes(syntheticPassword));
    assert.ok(!outputs.join('').includes(cookie.split('=')[1]));
    console.log('STAGE03_MYSQL_ISOLATED_PASS: MySQL 8.4 tmpfs; migration replay/drift/interruption/nonempty protection; runtime without DDL grants; TLS proxy/cookies; login/restart/revocation/disable/first-password/logout/expiry; missing schema and database outage/recovery');
  } finally {
    await stopApp();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    if (admin) await admin.end();
    if (id) {
      const owner = docker(['inspect', '--format', '{{index .Config.Labels "infomat.stage03"}}', id]);
      if (owner === label) docker(['rm', '--force', id]);
      else throw new Error('ISOLATED_CONTAINER_OWNER_MISMATCH');
    }
    // Only test-generated certificate material in the freshly allocated directory.
    for (const file of ['key.pem', 'cert.pem']) { const target = path.join(temp, file); if (fs.existsSync(target)) fs.unlinkSync(target); }
    fs.rmdirSync(temp);
  }
}

main().catch(error => { console.error('STAGE03_MYSQL_ISOLATED_FAILED', error.code || error.name, String(error.stack || '').split('\n').find(line => line.includes('test-stage03-mysql-isolated.js:')) || ''); process.exitCode = 1; });
