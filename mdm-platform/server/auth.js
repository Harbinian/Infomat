const bcrypt = require('bcryptjs');

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: '未登录' });
    }
    if (!roles.includes(req.session.userRole)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

function send401(res, message) {
  return res.status(401).json({ error: message || '未登录' });
}

function send403(res, message) {
  return res.status(403).json({ error: message || '权限不足' });
}

function send404(res, message) {
  return res.status(404).json({ error: message || '不存在' });
}

function send409(res, message) {
  return res.status(409).json({ error: message || '状态冲突' });
}

function send422(res, errors) {
  return res.status(422).json({ error: '校验失败', details: errors });
}

function requireDataPermission(categoryCode, action) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: '未登录' });
    }
    if (req.session.userRole === 'admin') return next();

    const db = require('./db');
    const user = db.prepare('SELECT permissions FROM users WHERE id=?').get(req.session.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });

    const permissions = JSON.parse(user.permissions || '{}');
    const catPerms = permissions[categoryCode];
    if (!catPerms || !catPerms.includes(action)) {
      return res.status(403).json({ error: `无 ${categoryCode} 的 ${action} 权限` });
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  requireAuth,
  requireRole,
  requireDataPermission,
  send401,
  send403,
  send404,
  send409,
  send422
};
