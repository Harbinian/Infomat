const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const router = express.Router();

const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleDbError(res, error) {
  if (sendMysqlUnavailable(res, error)) return;
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}



router.get('/field-identities/progress', requireAuth, async (req, res) => {
  try {
    const personId = req.session.personId || req.session.userId;
    const { permSet } = await getUserEffectivePermissionsAsync(personId);
    let scope = null;
    if (permSet.has('governance:read-global')) {
      scope = {};
    } else if (permSet.has('governance:read-department') && req.session.departmentId) {
      scope = { departmentId: req.session.departmentId };
    }
    if (!scope) return res.status(403).json({ error: '无权查看字段身份质量进度' });
    const repo = await dataMapRepository();
    res.json(await repo.fieldIdentityProgress(scope));
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
