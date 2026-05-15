const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function handleDbError(res, error) {
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

// GET /api/quality/dashboard — 数据质量仪表盘
router.get('/dashboard', requireAuth, (req, res) => {
  try {
    const completeness = db.prepare(`
      WITH required_counts AS (
        SELECT c.id as cat_id, COUNT(a.id) as req_count
        FROM master_data_categories c
        JOIN master_data_attributes a ON a.category_id=c.id AND a.required=1
        GROUP BY c.id
      ),
      item_checks AS (
        SELECT i.id, i.category_id, i.attributes_json,
          (SELECT r.req_count FROM required_counts r WHERE r.cat_id = i.category_id) as req_count
        FROM master_data_items i
        WHERE i.status != 'archived'
      )
      SELECT
        COUNT(*) as total_items,
        SUM(CASE WHEN req_count IS NULL OR req_count = 0 THEN 1 ELSE 0 END) as no_req_items,
        ROUND(AVG(CASE WHEN req_count > 0 THEN 1.0 ELSE NULL END) * 100, 1) as completeness_pct
      FROM item_checks
    `).get();

    const dupCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT code FROM master_data_items WHERE status != 'archived' GROUP BY code HAVING COUNT(*) > 1
      )
    `).get().cnt;

    const totalItems = db.prepare("SELECT COUNT(*) as cnt FROM master_data_items WHERE status != 'archived'").get().cnt;

    const timeliness = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM master_data_items WHERE updated_at >= datetime('now', '-30 days')) as changed_30d,
        (SELECT COUNT(*) FROM integration_sync_log WHERE created_at >= datetime('now', '-30 days') AND status='success') as synced_30d
    `).get();

    const consistency = db.prepare(`
      SELECT COUNT(*) as total_checks,
        SUM(CASE WHEN params_json LIKE '%"match":true%' THEN 1 ELSE 0 END) as matched
      FROM integration_sync_log
      WHERE endpoint LIKE '%consistency%' AND created_at >= datetime('now', '-30 days')
    `).get();

    res.json({
      completeness: {
        pct: completeness.completeness_pct || 100,
        target: 99,
        status: (completeness.completeness_pct || 100) >= 99 ? 'pass' : 'warn'
      },
      uniqueness: {
        pct: totalItems > 0 ? Math.round((1 - dupCount / totalItems) * 10000) / 100 : 100,
        duplicate_count: dupCount,
        target: 99,
        status: dupCount === 0 ? 'pass' : 'fail'
      },
      timeliness: {
        changed_count: timeliness.changed_30d,
        synced_count: timeliness.synced_30d,
        pct: timeliness.changed_30d > 0 ? Math.round((timeliness.synced_30d / timeliness.changed_30d) * 100) : 100,
        target: 95,
        status: 'info'
      },
      consistency: {
        total_checks: consistency.total_checks,
        matched: consistency.matched,
        pct: consistency.total_checks > 0 ? Math.round((consistency.matched / consistency.total_checks) * 100) : 100,
        target: 99,
        status: 'info'
      }
    });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/quality/field-identities/progress — 黄金源确认进度（模块 F）
router.get('/field-identities/progress', requireAuth, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as cnt FROM field_identities').get().cnt;
    const confirmed = db.prepare('SELECT COUNT(*) as cnt FROM field_identities WHERE confirmed=1').get().cnt;

    const byDomain = db.prepare(`
      SELECT fe.data_object as domain, COUNT(fi.id) as total, SUM(CASE WHEN fi.confirmed=1 THEN 1 ELSE 0 END) as confirmed
      FROM field_identities fi
      JOIN field_entries fe ON fi.field_entry_id = fe.id
      GROUP BY fe.data_object
      ORDER BY fe.data_object
    `).all();

    res.json({
      overall: { total, confirmed, pct: total > 0 ? Math.round((confirmed / total) * 100) : 0 },
      by_domain: byDomain.map(d => ({ ...d, pct: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0 }))
    });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
