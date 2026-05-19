const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function handleDbError(res, error) {
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

router.get('/dashboard', requireAuth, (req, res) => {
  try {
    const orgCount = db.prepare("SELECT COUNT(*) as cnt FROM org_unit WHERE status != 'inactive'").get().cnt;
    const positionCount = db.prepare("SELECT COUNT(*) as cnt FROM position WHERE status != 'inactive'").get().cnt;
    const personCount = db.prepare("SELECT COUNT(*) as cnt FROM person WHERE status != 'inactive'").get().cnt;
    const assignmentCount = db.prepare("SELECT COUNT(*) as cnt FROM person_position_assignment WHERE status='active'").get().cnt;
    const pfCount = db.prepare("SELECT COUNT(*) as cnt FROM product_family WHERE status != 'inactive'").get().cnt;
    const productCount = db.prepare("SELECT COUNT(*) as cnt FROM product WHERE lifecycle_state != 'obsolete'").get().cnt;
    const releasedCount = db.prepare("SELECT COUNT(*) as cnt FROM product WHERE lifecycle_state='released'").get().cnt;
    const extIdCount = db.prepare('SELECT COUNT(*) as cnt FROM external_identity').get().cnt;
    const extSysCount = db.prepare('SELECT COUNT(*) as cnt FROM external_system').get().cnt;
    const sync30d = db.prepare("SELECT COUNT(*) as cnt FROM integration_sync_log WHERE created_at >= datetime('now', '-30 days') AND status='success'").get().cnt;

    res.json({
      org_person: { org_units: orgCount, positions: positionCount, persons: personCount, active_assignments: assignmentCount },
      product: { families: pfCount, total: productCount, released: releasedCount },
      integration: { external_systems: extSysCount, external_identities: extIdCount, syncs_30d: sync30d }
    });
  } catch (e) { handleDbError(res, e); }
});

router.get('/field-identities/progress', requireAuth, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as cnt FROM field_identities').get().cnt;
    const confirmed = db.prepare('SELECT COUNT(*) as cnt FROM field_identities WHERE confirmed=1').get().cnt;
    const byDomain = db.prepare(`
      SELECT fe.data_object as domain, COUNT(fi.id) as total, SUM(CASE WHEN fi.confirmed=1 THEN 1 ELSE 0 END) as confirmed
      FROM field_identities fi
      JOIN field_entries fe ON fi.field_entry_id = fe.id
      GROUP BY fe.data_object ORDER BY fe.data_object
    `).all();
    res.json({
      overall: { total, confirmed, pct: total > 0 ? Math.round((confirmed / total) * 100) : 0 },
      by_domain: byDomain.map(d => ({ ...d, pct: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0 }))
    });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
