const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function runDbAction(res, action) {
  try {
    return action();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  }
}

function activeSnapshot() {
  return db.prepare(`
    SELECT *
    FROM process_governance_snapshots
    WHERE status='active'
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
  `).get();
}

function snapshotStats(snapshot) {
  if (!snapshot) return {};
  try {
    return JSON.parse(snapshot.stats_json || '{}');
  } catch {
    return {};
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function emptySankey() {
  return {
    nodes: [],
    links: [],
    systems: [],
    stats: {},
    crossDept: { stats: {}, risks: [], interactionChains: [], source: null }
  };
}

function emptyQualitySummary() {
  return { BLOCK: 0, WARN: 0, INFO: 0 };
}

function qualitySummary(snapshotId) {
  const summary = emptyQualitySummary();
  if (!snapshotId) return summary;
  const rows = db.prepare(`
    SELECT severity, COUNT(*) AS count
    FROM process_governance_quality_findings
    WHERE snapshot_id=?
    GROUP BY severity
  `).all(snapshotId);
  rows.forEach(row => {
    if (Object.prototype.hasOwnProperty.call(summary, row.severity)) {
      summary[row.severity] = row.count;
    }
  });
  return summary;
}

router.get('/snapshots', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const snapshots = db.prepare(`
      SELECT id, source_json_path, source_hash, generated_at, imported_at, status, note
      FROM process_governance_snapshots
      ORDER BY imported_at DESC, id DESC
    `).all();
    res.json(snapshots);
  });
});

router.get('/current', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({});
    res.json({
      id: snapshot.id,
      source_json_path: snapshot.source_json_path,
      source_hash: snapshot.source_hash,
      generated_at: snapshot.generated_at,
      imported_at: snapshot.imported_at,
      status: snapshot.status,
      note: snapshot.note,
      stats: snapshotStats(snapshot),
      qualitySummary: qualitySummary(snapshot.id)
    });
  });
});

router.get('/sankey', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json(emptySankey());

    const nodes = db.prepare(`
      SELECT node_key AS name, name AS label, node_type, domain_name, dept_name, parent_key, source_file
      FROM process_governance_nodes
      WHERE snapshot_id=?
      ORDER BY sort_order, id
    `).all(snapshot.id);

    const links = db.prepare(`
      SELECT source_key AS source, target_key AS target, value
      FROM process_governance_edges
      WHERE snapshot_id=?
      ORDER BY id
    `).all(snapshot.id);

    const systems = nodes
      .filter(node => node.node_type === 'system')
      .map(node => node.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const risks = db.prepare(`
      SELECT source_dept AS source, target_dept AS target, a1_code AS a1, refs,
             risk_level AS risk, confirm_status AS status, description AS desc, source_report
      FROM process_cross_dept_interactions
      WHERE snapshot_id=?
      ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id
    `).all(snapshot.id);

    const interactionChains = db.prepare(`
      SELECT name, status, breaks_json, source_report
      FROM process_interaction_chains
      WHERE snapshot_id=?
      ORDER BY id
    `).all(snapshot.id).map(row => ({
      name: row.name,
      status: row.status,
      breaks: parseJsonArray(row.breaks_json),
      source_report: row.source_report
    }));

    const stats = snapshotStats(snapshot);
    res.json({
      nodes,
      links,
      systems,
      stats: {
        mappings: stats.mappings || 0,
        a1: stats.a1 || 0,
        departmentsWithData: stats.departmentsWithData || 0,
        departmentsEmpty: stats.departmentsEmpty || 0
      },
      crossDept: {
        stats: stats.crossDept || {},
        risks: risks.map(({ source_report, ...risk }) => risk),
        interactionChains,
        source: risks[0] && risks[0].source_report || interactionChains[0] && interactionChains[0].source_report || null
      }
    });
  });
});

router.get('/a1', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ items: [] });

    const params = [snapshot.id];
    let sql = `
      SELECT *
      FROM process_a1_items
      WHERE snapshot_id=?
    `;

    if (req.query.dept) {
      sql += ' AND dept_name=?';
      params.push(req.query.dept);
    }
    if (req.query.l3) {
      sql += ' AND l3_name=?';
      params.push(req.query.l3);
    }
    if (req.query.system) {
      sql += ' AND suggested_systems LIKE ?';
      params.push(`%"${req.query.system}"%`);
    }

    sql += ' ORDER BY dept_name, l3_name, a1_code, id';
    const items = db.prepare(sql).all(...params).map(row => ({
      ...row,
      suggested_systems: parseJsonArray(row.suggested_systems)
    }));
    res.json({ items });
  });
});

router.get('/cross-dept', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ items: [] });

    const params = [snapshot.id];
    let sql = `
      SELECT *
      FROM process_cross_dept_interactions
      WHERE snapshot_id=?
    `;

    if (req.query.risk) {
      sql += ' AND risk_level=?';
      params.push(req.query.risk);
    }
    if (req.query.status) {
      sql += ' AND confirm_status=?';
      params.push(req.query.status);
    }
    if (req.query.dept) {
      sql += ' AND (source_dept=? OR target_dept=?)';
      params.push(req.query.dept, req.query.dept);
    }

    sql += " ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id";
    res.json({ items: db.prepare(sql).all(...params) });
  });
});

router.get('/quality', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ summary: emptyQualitySummary(), items: [] });

    const params = [snapshot.id];
    let sql = `
      SELECT id, severity, area, source_file, source_line, message, suggestion, dept_name, imported_at
      FROM process_governance_quality_findings
      WHERE snapshot_id=?
    `;

    const severity = String(req.query.severity || '').toUpperCase();
    if (['BLOCK', 'WARN', 'INFO'].includes(severity)) {
      sql += ' AND severity=?';
      params.push(severity);
    }
    if (req.query.area) {
      sql += ' AND area=?';
      params.push(String(req.query.area));
    }
    if (req.query.dept) {
      sql += ' AND dept_name=?';
      params.push(String(req.query.dept));
    }

    sql += `
      ORDER BY CASE severity WHEN 'BLOCK' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END,
               area, source_file, COALESCE(source_line, 0), id
    `;

    res.json({
      summary: qualitySummary(snapshot.id),
      items: db.prepare(sql).all(...params)
    });
  });
});

router.get('/chains', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ items: [] });
    const items = db.prepare(`
      SELECT *
      FROM process_interaction_chains
      WHERE snapshot_id=?
      ORDER BY id
    `).all(snapshot.id).map(row => ({
      ...row,
      breaks: parseJsonArray(row.breaks_json)
    }));
    res.json({ items });
  });
});

module.exports = router;
