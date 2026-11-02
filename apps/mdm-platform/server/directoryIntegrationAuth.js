const crypto = require('node:crypto');
const { securityLog } = require('./securityLog');

// Independent machine credentials grant only the versioned directory read API.
// Configuration contains SHA-256 digests, never plaintext API credentials.
function configuredClients(env = process.env) {
  if (env.DIRECTORY_INTEGRATION_ENABLED !== '1') return null;
  try {
    const clients = JSON.parse(env.DIRECTORY_API_CLIENTS_JSON || '[]');
    if (!Array.isArray(clients) || !clients.length || clients.length > 100) throw new Error();
    const ids = new Set(), digests = new Set();
    for (const client of clients) {
      if (!client || !/^[A-Za-z0-9_-]{1,64}$/.test(client.client_id) ||
          !/^[a-f0-9]{64}$/.test(client.token_sha256) ||
          typeof client.enabled !== 'boolean' ||
          typeof client.expires_at !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(client.expires_at) ||
          !Number.isFinite(Date.parse(client.expires_at)) ||
          ids.has(client.client_id) || digests.has(client.token_sha256)) throw new Error();
      ids.add(client.client_id); digests.add(client.token_sha256);
    }
    return clients;
  } catch {
    throw Object.assign(new Error('Directory client configuration unavailable'), { code: 'DIRECTORY_CLIENT_CONFIG_INVALID' });
  }
}

function authenticateDirectoryClient(header, clients, now = Date.now()) {
  if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(header)) return null;
  const digest = crypto.createHash('sha256').update(header.slice(7)).digest();
  let matched = null;
  for (const client of clients || []) {
    const equal = crypto.timingSafeEqual(digest, Buffer.from(client.token_sha256, 'hex'));
    if (equal && client.enabled && Date.parse(client.expires_at) > now) matched = client.client_id;
  }
  return matched;
}

function requireDirectoryClient(req, res, next) {
  res.set('Cache-Control', 'no-store');
  let clients;
  try { clients = configuredClients(); }
  catch {
    securityLog(req).write({ event: 'dependency_degraded', code: 'DIRECTORY_CLIENT_CONFIG_INVALID', status: 503 });
    return res.status(503).json({ code: 'DIRECTORY_CLIENT_CONFIG_INVALID', error: '目录接口访问配置尚未就绪' });
  }
  if (!clients) return res.status(503).json({ code: 'DIRECTORY_INTEGRATION_DISABLED', error: '系统间目录读取尚未开启' });
  const clientId = authenticateDirectoryClient(req.headers.authorization, clients);
  if (!clientId) {
    securityLog(req).write({ event: 'access_denied', code: 'DIRECTORY_CLIENT_UNAUTHORIZED', status: 401 });
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ code: 'DIRECTORY_CLIENT_UNAUTHORIZED', error: '系统访问凭证无效或已到期' });
  }
  req.directoryClientId = clientId;
  next();
}

module.exports = { configuredClients, authenticateDirectoryClient, requireDirectoryClient };
