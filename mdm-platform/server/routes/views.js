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

    const placeholders = values => values.map(() => '?').join(',');

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

    if (capIds && capIds.length === 0) {
      return res.json({ nodes: [], links: [] });
    }

    function addMappingFilters(sql, params) {
      if (deptIds.length > 0) {
        sql += ` AND (m.owner_dept_id IN (${placeholders(deptIds)})
          OR EXISTS (
            SELECT 1 FROM mapping_related_departments mrd_filter
            WHERE mrd_filter.mapping_id = m.id AND mrd_filter.department_id IN (${placeholders(deptIds)})
          ))`;
        params.push(...deptIds, ...deptIds);
      }
      if (capIds) {
        sql += ` AND p.capability_id IN (${placeholders(capIds)})`;
        params.push(...capIds);
      }
      return sql;
    }

    function addVisibleDepartmentFilter(sql, params, alias) {
      if (deptIds.length === 0) return sql;
      sql += ` AND ${alias}.id IN (${placeholders(deptIds)})`;
      params.push(...deptIds);
      return sql;
    }

    // --- Layer 1: Departments ---
    const ownerDeptParams = [];
    let ownerDeptSql = `SELECT DISTINCT d.id, d.name FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN departments d ON m.owner_dept_id = d.id
      WHERE m.status = 'published'`;
    ownerDeptSql = addMappingFilters(ownerDeptSql, ownerDeptParams);
    ownerDeptSql = addVisibleDepartmentFilter(ownerDeptSql, ownerDeptParams, 'd');

    const relatedDeptParams = [];
    let relatedDeptSql = `SELECT DISTINCT d.id, d.name FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN mapping_related_departments mrd ON mrd.mapping_id = m.id
      JOIN departments d ON mrd.department_id = d.id
      WHERE m.status = 'published'`;
    relatedDeptSql = addMappingFilters(relatedDeptSql, relatedDeptParams);
    relatedDeptSql = addVisibleDepartmentFilter(relatedDeptSql, relatedDeptParams, 'd');

    const departments = [
      ...db.prepare(ownerDeptSql).all(...ownerDeptParams),
      ...db.prepare(relatedDeptSql).all(...relatedDeptParams)
    ].filter((dept, index, rows) => rows.findIndex(row => row.id === dept.id) === index);

    // --- Layer 2: Capabilities ---
    const capParams = [];
    let capSql = `SELECT DISTINCT c.id, c.name, c.level FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      WHERE m.status = 'published'`;
    capSql = addMappingFilters(capSql, capParams);
    const capabilities = db.prepare(capSql).all(...capParams);

    // --- Layer 3: Processes ---
    const procParams = [];
    let procSql = `SELECT DISTINCT p.id, p.name FROM mappings m
      JOIN processes p ON m.process_id = p.id
      WHERE m.status = 'published'`;
    procSql = addMappingFilters(procSql, procParams);
    const processes = db.prepare(procSql).all(...procParams);

    // --- Layer 4: Systems ---
    const sysParams = [];
    let sysSql = `SELECT DISTINCT s.id, s.name FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN mapping_systems ms ON ms.mapping_id = m.id
      JOIN systems s ON ms.system_id = s.id
      WHERE m.status = 'published'`;
    sysSql = addMappingFilters(sysSql, sysParams);
    const systems = db.prepare(sysSql).all(...sysParams);

    // --- Build nodes with metadata ---
    const nodeMap = new Map();
    const nodeKey = (type, id) => `${type}:${id}`;
    const addNode = (type, id, label, layer, extra = {}) => {
      const name = nodeKey(type, id);
      if (!nodeMap.has(name)) nodeMap.set(name, { name, label, layer, type, id, ...extra });
    };
    departments.forEach(d => addNode('department', d.id, d.name, 1));
    capabilities.forEach(c => addNode('capability', c.id, c.name, 2, { level: c.level }));
    processes.forEach(p => addNode('process', p.id, p.name, 3));
    systems.forEach(s => addNode('system', s.id, s.name, 4));

    // --- Build links with value = published mapping count ---
    const linkMap = new Map();
    const addLink = (source, target, value = 1) => {
      const key = source + '|||' + target;
      linkMap.set(key, (linkMap.get(key) || 0) + value);
    };

    // Department → Capability (via process owner_dept)
    const dcParams = [];
    let dcSql = `SELECT d.id as dept_id, c.id as cap_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      JOIN departments d ON m.owner_dept_id = d.id
      WHERE m.status = 'published'`;
    dcSql = addMappingFilters(dcSql, dcParams);
    dcSql = addVisibleDepartmentFilter(dcSql, dcParams, 'd');
    dcSql += ' GROUP BY d.id, c.id';
    const dcLinks = db.prepare(dcSql).all(...dcParams);
    dcLinks.forEach(r => addLink(nodeKey('department', r.dept_id), nodeKey('capability', r.cap_id), r.cnt));

    // Department → Capability (via related departments)
    const dc2Params = [];
    let dc2Sql = `SELECT d.id as dept_id, c.id as cap_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN mapping_related_departments mrd ON mrd.mapping_id = m.id
      JOIN departments d ON mrd.department_id = d.id
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      WHERE m.status = 'published'`;
    dc2Sql = addMappingFilters(dc2Sql, dc2Params);
    dc2Sql = addVisibleDepartmentFilter(dc2Sql, dc2Params, 'd');
    dc2Sql += ' GROUP BY d.id, c.id';
    const dcLinks2 = db.prepare(dc2Sql).all(...dc2Params);
    dcLinks2.forEach(r => addLink(nodeKey('department', r.dept_id), nodeKey('capability', r.cap_id), r.cnt));

    // Capability → Process
    const cpParams = [];
    let cpSql = `SELECT c.id as cap_id, p.id as proc_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN processes p ON m.process_id = p.id
      JOIN capabilities c ON p.capability_id = c.id
      WHERE m.status = 'published'`;
    cpSql = addMappingFilters(cpSql, cpParams);
    cpSql += ' GROUP BY c.id, p.id';
    const cpLinks = db.prepare(cpSql).all(...cpParams);
    cpLinks.forEach(r => addLink(nodeKey('capability', r.cap_id), nodeKey('process', r.proc_id), r.cnt));

    // Process → System
    const psParams = [];
    let psSql = `SELECT p.id as proc_id, s.id as sys_id, COUNT(DISTINCT m.id) as cnt
      FROM mappings m
      JOIN mapping_systems ms ON ms.mapping_id = m.id
      JOIN systems s ON ms.system_id = s.id
      JOIN processes p ON m.process_id = p.id
      WHERE m.status = 'published'`;
    psSql = addMappingFilters(psSql, psParams);
    psSql += ' GROUP BY p.id, s.id';
    const psLinks = db.prepare(psSql).all(...psParams);
    psLinks.forEach(r => addLink(nodeKey('process', r.proc_id), nodeKey('system', r.sys_id), r.cnt));

    const links = [...linkMap.entries()].map(([key, value]) => {
      const [source, target] = key.split('|||');
      return { source, target, value };
    }).filter(link => nodeMap.has(link.source) && nodeMap.has(link.target));

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
