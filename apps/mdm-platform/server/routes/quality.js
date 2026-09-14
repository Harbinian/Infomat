const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const router = express.Router();
function legacyDb() { return require('../db'); }
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleDbError(res, error) {
  if (sendMysqlUnavailable(res, error)) return;
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

router.get('/dashboard', requireAuth, (req, res) => {
  const { legacyTestMode, rejectLegacyRoute } = require('../runtimeBoundary');
  if (!legacyTestMode()) return rejectLegacyRoute(req, res);
  try {
    const orgCount = legacyDb().prepare("SELECT COUNT(*) as cnt FROM org_unit WHERE status != 'inactive'").get().cnt;
    const positionCount = legacyDb().prepare("SELECT COUNT(*) as cnt FROM position WHERE status != 'inactive'").get().cnt;
    const personCount = legacyDb().prepare("SELECT COUNT(*) as cnt FROM person WHERE status != 'inactive'").get().cnt;
    const assignmentCount = legacyDb().prepare("SELECT COUNT(*) as cnt FROM person_position_assignment WHERE status='active'").get().cnt;
    const pfCount = legacyDb().prepare("SELECT COUNT(*) as cnt FROM product_family WHERE status != 'inactive'").get().cnt;
    const productCount = legacyDb().prepare("SELECT COUNT(*) as cnt FROM product WHERE lifecycle_state != 'obsolete'").get().cnt;
    const releasedCount = legacyDb().prepare("SELECT COUNT(*) as cnt FROM product WHERE lifecycle_state='released'").get().cnt;
    const extIdCount = legacyDb().prepare('SELECT COUNT(*) as cnt FROM external_identity').get().cnt;
    const extSysCount = legacyDb().prepare('SELECT COUNT(*) as cnt FROM external_system').get().cnt;
    const sync30d = legacyDb().prepare("SELECT COUNT(*) as cnt FROM integration_sync_log WHERE created_at >= datetime('now', '-30 days') AND status='success'").get().cnt;

    res.json({
      org_person: { org_units: orgCount, positions: positionCount, persons: personCount, active_assignments: assignmentCount },
      product: { families: pfCount, total: productCount, released: releasedCount },
      integration: { external_systems: extSysCount, external_identities: extIdCount, syncs_30d: sync30d }
    });
  } catch (e) { handleDbError(res, e); }
});

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
