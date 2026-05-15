const bcrypt = require('bcryptjs');
const db = require('./db');

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: '缺少 X-API-Key' });

  const credentials = db.prepare('SELECT * FROM integration_credentials WHERE enabled=1').all();

  let matched = null;
  for (const cred of credentials) {
    if (bcrypt.compareSync(apiKey, cred.api_key_hash)) {
      matched = cred;
      break;
    }
  }

  if (!matched) return res.status(403).json({ error: 'API Key 无效' });

  req.integrationSystem = {
    name: matched.system_name,
    permissions: JSON.parse(matched.permissions_json || '["read"]')
  };

  db.prepare('UPDATE integration_credentials SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(matched.id);
  next();
}

function requireIntegrationPermission(action) {
  return (req, res, next) => {
    if (!req.integrationSystem) return res.status(401).json({ error: '未认证' });
    if (!req.integrationSystem.permissions.includes(action)) {
      return res.status(403).json({ error: '该 API Key 无此操作权限' });
    }
    next();
  };
}

module.exports = { apiKeyAuth, requireIntegrationPermission };
