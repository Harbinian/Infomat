// Docker transport only. Application stays in the existing loopback/http-local
// mode. A raw TCP bridge on the container's IPv4 address handles the host's
// loopback-only published port, without rewriting HTTP or trusting proxy headers.
// Read only the mounted runtime secret; never log it or expose it in Docker Env.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
let application, listener, bridge;
const sockets = new Set();
async function main() {
  const expected = process.env.MDM_EXPECTED_SOURCE_DIGEST;
  const previewEnabled = process.env.PROCESS_V7_PREVIEW_ENABLED || '0';
  assert(['0', '1'].includes(previewEnabled));
  assert.match(expected || '', /^[a-f0-9]{64}$/);
  const bytes = fs.readFileSync('/run/secrets/mdm-runtime.json');
  let secret;
  try { secret = JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
  assert.deepEqual(Object.keys(secret).sort(), ['database', 'mysqlHost', 'mysqlPassword', 'mysqlPort', 'sessionSecret', 'username'].sort());
  assert.equal(secret.database, 'infomat_mdm_upgrade_20260916');
  assert.equal(secret.mysqlHost, 'host.docker.internal');
  assert.equal(secret.mysqlPort, 3307);
  assert.equal(secret.username, 'infomat_mdm_upg_app_20260916');
  assert(typeof secret.mysqlPassword === 'string' && secret.mysqlPassword.length >= 32);
  assert(typeof secret.sessionSecret === 'string' && secret.sessionSecret.length >= 32);
  Object.assign(process.env, {
    HOST: '127.0.0.1', PORT: '3000', NODE_ENV: 'development', MDM_ACCESS_MODE: 'http-local',
    MYSQL_HOST: secret.mysqlHost, MYSQL_PORT: String(secret.mysqlPort), MYSQL_DATABASE: secret.database,
    MYSQL_USER: secret.username, MYSQL_PASSWORD: secret.mysqlPassword, SESSION_SECRET: secret.sessionSecret,
    MYSQL_CONNECTION_LIMIT: '4', MDM_SESSION_STORE: 'mysql', MDM_IDENTITY_READ_MODEL: 'mysql',
    PROCESS_GOVERNANCE_READ_MODEL: 'mysql', MDM_SYSTEM_ADMIN_ENABLED: '1',
    PROCESS_V7_PREVIEW_ENABLED: previewEnabled, PROCESS_V7_FORMAL_ENABLED: '0', PROCESS_V7_AUTHORING_ENABLED: '0',
    PROCESS_DATA_GOVERNANCE_ENABLED: '0', MDM_ALLOW_LEGACY_TEST_MODE: '0', ALLOW_INSECURE_SESSION_SECRET: '0'
  });
  delete process.env.MDM_TRUST_PROXY; delete process.env.MDM_PUBLIC_ORIGIN;
  secret = null;
  const root = path.resolve(__dirname, '..');
  assert.equal(require(path.join(root, 'server/runtimeVersion')).runtimeVersion(root).sourceDigest, expected);
  require(path.join(root, 'server/runtimeBoundary')).assertRuntimeConfig(process.env);
  const addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && !a.internal && a.family === 'IPv4');
  assert.equal(addresses.length, 1, 'single isolated container interface required');
  application = require(path.join(root, 'server/index.js'));
  listener = application.listen(3000, '127.0.0.1');
  await new Promise((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
  bridge = net.createServer(client => {
    const target = net.connect(3000, '127.0.0.1');
    sockets.add(client); sockets.add(target);
    for (const socket of [client, target]) socket.once('close', () => sockets.delete(socket));
    client.once('error', () => target.destroy()); target.once('error', () => client.destroy());
    client.once('close', () => target.destroy()); target.once('close', () => client.destroy());
    client.pipe(target); target.pipe(client);
  });
  bridge.listen(3000, addresses[0].address);
  await new Promise((resolve, reject) => { bridge.once('listening', resolve); bridge.once('error', reject); });
  console.log(JSON.stringify({ event: 'MDM_DOCKER_LISTENING', port: 3000, sourceDigest: expected, legacyMode: false, previewEnabled: previewEnabled === '1', formalEnabled: false, authoringEnabled: false, dataGovernanceEnabled: false }));
}
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000);
  if (bridge) bridge.close();
  for (const socket of sockets) socket.destroy();
  if (listener) {
    listener.closeIdleConnections();
    await new Promise(resolve => listener.close(resolve));
  }
  if (application) await application.locals.closeRuntime().catch(() => {});
  clearTimeout(deadline); process.exit(0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
main().catch(() => { console.error('MDM_DOCKER_START_FAILED'); shutdown().catch(() => process.exit(1)); });
