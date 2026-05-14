const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runDbAction(res, action) {
  try { return action(); }
  catch (error) { return handleDbError(res, error); }
}

// GET /api/views/sankey?dept_ids=1,2&cap_levels=L1,L2
router.get('/sankey', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const deptIds = req.query.dept_ids ? req.query.dept_ids.split(',').map(Number).filter(Boolean) : [];
    const capLevels = req.query.cap_levels ? req.query.cap_levels.split(',').map(s => s.trim()) : ['L1','L2','L3'];

    // --- Collect all capability IDs (including descendants for hierarchy) ---
    let capIds = null;
    if (capLevels.length < 3) {
      // Need to expand: if user picks L1, include all L2/L3 descendants via parent_id chain
      const allCaps = db.prepare('SELECT id, level, parent_id FROM capabilities').all();
      const childrenOf = new Map();
      allCaps.forEach(c => {
        if (c.parent_id) {
          const arr = childrenOf.get(c.parent_id) || [];
          arr.push(c.id);
          childrenOf.set(c.parent_id, arr);
        }
      });
      function collectDescendants(id) {
        const result = [id];
        const children = childrenOf.get(id) || [];
        children.forEach(childId => result.push(...collectDescendants(childId)));
        return result;
      }
      const expanded = new Set();
      allCaps.filter(c => capLevels.includes(c.level)).forEach(c => {
        collectDescendants(c.id).forEach(id => expanded.add(id));
      });
      capIds = [...expanded];
    }

    // --- Layer 1: Departments ---
    let deptSql = `SELECT DISTINCT d.id, d.name FROM departments d
      JOIN mappings m ON (m.owner_dept_id = d.id OR d.id IN (
        SELECT mrd.department_id FROM mapping_related_departments mrd WHERE mrd.mapping_id = m.id
      ))
      WHERE m.status = 'published'`;
    const deptParams = [];
    if (deptIds.length > 0) {
      deptSql += ' AND d.id IN (' + deptIds.map(() => '?').join(',') + ')';
      deptParams.push(...deptIds);
    }
    const departments = db.prepare(deptSql).all(...deptParams);

    // --- Layer 2: Capabilities ---
    let capSql = `SELECT DISTINCT c.id, c.name, c.level FROM capabilities c
      JOIN processes p ON p.capability_id = c.id
      JOIN mappings m ON m.process_id = p.id AND m.status = 'published'`;
    const capParams = [];
    if (capIds && capIds.length > 0) {
      capSql += ' AND c.id IN (' + capIds.map(() => '?').join(',') + ')';
      capParams.push(...capIds);
    }
    const capabilities = db.prepare(capSql).all(...capParams);

    // --- Layer 3: Processes ---
    let procSql = `SELECT DISTINCT p.id, p.name FROM processes p
      JOIN mappings m ON m.process_id = p.id AND m.status = 'published'
      WHERE 1=1`;
    const procParams = [];
    if (capIds && capIds.length > 0) {
      procSql += ' AND p.capability_id IN (' + capIds.map(() => '?').join(',') + ')';
      procParams.push(...capIds);
    }
    const processes = db.prepare(procSql).all(...procParams);

    // --- Layer 4: Systems ---
    let sysSql = `SELECT DISTINCT s.id, s.name FROM systems s
      JOIN mapping_systems ms ON ms.system_id = s.id
      JOIN mappings m ON ms.mapping_id = m.id AND m.status = 'published'
      WHERE 1=1`;
    const sysParams = [];
    if (capIds && capIds.length > 0) {
      sysSql += ` AND m.process_id IN (
        SELECT p.id FROM processes p WHERE p.capability_id IN (` + capIds.map(() => '?').join(',') + `)
      )`;
      sysParams.push(...capIds);
    }
    const systems = db.prepare(sysSql).all(...sysParams);

    // --- Build nodes with metadata ---
    const nodeMap = new Map();
    const addNode = (name, layer, type, id, extra = {}) => {
      if (!nodeMap.has(name)) nodeMap.set(name, { name, layer, type, id, ...extra });
    };
    departments.forEach(d => addNode(d.name, 1, 'department', d.id));
    capabilities.forEach(c => addNode(c.name, 2, 'capability', c.id, { level: c.level }));
    processes.forEach(p => addNode(p.name, 3, 'process', p.id));
    systems.forEach(s => addNode(s.name, 4, 'system', s.id));

    // --- Build links with value = published mapping count ---
    const linkMap = new Map();
    const addLink = (source, target) => {
      const key = source + '|||' + target;
      linkMap.set(key, (linkMap.get(key) || 0) + 1);
    };

    // Department → Capability (via process owner_dept)
    let dcSql = `SELECT DISTINCT d.name as dept, c.name as cap
      FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      JOIN departments d ON m.owner_dept_id = d.id
      WHERE m.status = 'published'`;
    const dcParams = [];
    if (deptIds.length > 0) {
      dcSql += ' AND d.id IN (' + deptIds.map(() => '?').join(',') + ')';
      dcParams.push(...deptIds);
    }
    const dcLinks = db.prepare(dcSql).all(...dcParams);
    dcLinks.forEach(r => addLink(r.dept, r.cap));

    // Department → Capability (via related departments)
    let dc2Sql = `SELECT DISTINCT d.name as dept, c.name as cap
      FROM mappings m
      JOIN mapping_related_departments mrd ON mrd.mapping_id = m.id
      JOIN departments d ON mrd.department_id = d.id
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      WHERE m.status = 'published'`;
    const dc2Params = [];
    if (deptIds.length > 0) {
      dc2Sql += ' AND d.id IN (' + deptIds.map(() => '?').join(',') + ')';
      dc2Params.push(...deptIds);
    }
    const dcLinks2 = db.prepare(dc2Sql).all(...dc2Params);
    dcLinks2.forEach(r => addLink(r.dept, r.cap));

    // Capability → Process
    let cpSql = `SELECT c.name as cap, p.name as proc, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      WHERE m.status = 'published'`;
    const cpParams = [];
    if (deptIds.length > 0) {
      cpSql += ` AND (m.owner_dept_id IN (` + deptIds.map(() => '?').join(',') + `)
        OR m.id IN (SELECT mrd.mapping_id FROM mapping_related_departments mrd WHERE mrd.department_id IN (` + deptIds.map(() => '?').join(',') + `)))`;
      cpParams.push(...deptIds, ...deptIds);
    }
    cpSql += ' GROUP BY c.name, p.name';
    const cpLinks = db.prepare(cpSql).all(...cpParams);
    cpLinks.forEach(r => { for (let i = 0; i < r.cnt; i++) addLink(r.cap, r.proc); });

    // Process → System
    let psSql = `SELECT p.name as proc, s.name as sys, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN mapping_systems ms ON ms.mapping_id = m.id
      JOIN systems s ON ms.system_id = s.id
      JOIN processes p ON m.process_id = p.id
      WHERE m.status = 'published'`;
    const psParams = [];
    if (deptIds.length > 0) {
      psSql += ` AND (m.owner_dept_id IN (` + deptIds.map(() => '?').join(',') + `)
        OR m.id IN (SELECT mrd.mapping_id FROM mapping_related_departments mrd WHERE mrd.department_id IN (` + deptIds.map(() => '?').join(',') + `)))`;
      psParams.push(...deptIds, ...deptIds);
    }
    psSql += ' GROUP BY p.name, s.name';
    const psLinks = db.prepare(psSql).all(...psParams);
    psLinks.forEach(r => { for (let i = 0; i < r.cnt; i++) addLink(r.proc, r.sys); });

    const links = [...linkMap.entries()].map(([key, value]) => {
      const [source, target] = key.split('|||');
      return { source, target, value };
    });

    res.json({ nodes: [...nodeMap.values()], links });
  });
});

// GET /api/views/processes/:id
router.get('/processes/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const process = db.prepare(`
      SELECT p.*, c.name as cap_name, c.id as cap_id, d.name as dept_name
      FROM processes p
      LEFT JOIN capabilities c ON p.capability_id = c.id
      LEFT JOIN departments d ON p.owner_dept_id = d.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!process) return res.status(404).json({ error: '流程不存在' });

    // Associated systems via published mappings
    const systems = db.prepare(`
      SELECT DISTINCT s.id, s.name
      FROM systems s
      JOIN mapping_systems ms ON ms.system_id = s.id
      JOIN mappings m ON ms.mapping_id = m.id
      WHERE m.process_id = ? AND m.status = 'published'
      ORDER BY s.name
    `).all(req.params.id);

    // Field ledger summary: all field_entries across all published mappings for this process
    const fields = db.prepare(`
      SELECT fe.field_name_cn, fe.field_name_en, fe.data_object, fe.field_type,
             fe.sync_mode, fe.consume_systems, fe.note, m.id as mapping_id,
             d.name as dept_name
      FROM field_entries fe
      JOIN mappings m ON fe.mapping_id = m.id
      LEFT JOIN departments d ON m.owner_dept_id = d.id
      WHERE m.process_id = ? AND m.status = 'published'
      ORDER BY fe.field_name_cn
    `).all(req.params.id);

    // Upstream/downstream placeholder (V2 will expand)
    const relatedProcesses = [];

    res.json({ ...process, systems, fields, relatedProcesses });
  });
});

module.exports = router;
