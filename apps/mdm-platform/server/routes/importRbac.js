const express = require('express');
const { requireAuth, requirePermission } = require('../auth');

const router = express.Router();

function rejectLegacyIdentityImport(req, res) {
  return res.status(410).json({
    code: 'LEGACY_IDENTITY_API_RETIRED',
    error: 'RBAC 批量导入已停用。账号和角色只能由管理员手工维护。'
  });
}

router.use(requireAuth, requirePermission('identity:read'));
router.all('*', rejectLegacyIdentityImport);

module.exports = router;
