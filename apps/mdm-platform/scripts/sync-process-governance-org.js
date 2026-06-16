const PROCESS_GOVERNANCE_DEPARTMENTS = [
  { name: '工程技术部', code: 'DEPT_GCJS', domain: '总经理直辖域', type: '业务', sort: 10 },
  { name: '质量管理部', code: 'DEPT_ZLGL', domain: '总经理直辖域', type: '职能', sort: 20 },
  { name: '财务部', code: 'DEPT_CW', domain: '总经理直辖域', type: '职能', sort: 30 },
  { name: '行政人事部', code: 'DEPT_XZRS', domain: '经营域', type: '职能', sort: 40 },
  { name: '经营发展部', code: 'DEPT_JYFZ', domain: '经营域', type: '业务', sort: 50 },
  { name: '物资保障部', code: 'DEPT_WZBZ', domain: '经营域', type: '业务', sort: 60 },
  { name: '项目管理部', code: 'DEPT_XMGL', domain: '生产域', type: '业务', sort: 70 },
  { name: '复材车间', code: 'DEPT_FCCJ', domain: '生产域', type: '生产', sort: 80 },
  { name: '运维安环部', code: 'DEPT_YWAH', domain: '生产域', type: '职能', sort: 90 }
];

function syncProcessGovernanceOrg(options = {}) {
  const database = options.db || require('../server/db');
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : true;
  const archiveNonCanonical = Boolean(options.archiveNonCanonical);

  const findByCode = database.prepare('SELECT id FROM departments WHERE code = ?');
  const findByName = database.prepare('SELECT id FROM departments WHERE name = ? ORDER BY id LIMIT 1');
  const updateDepartment = database.prepare(`
    UPDATE departments
    SET name = ?,
        code = ?,
        department_type = ?,
        sort_order = ?,
        status = 'active',
        source_system = CASE
          WHEN (external_id IS NULL OR external_id = '')
           AND (source_system IS NULL OR source_system = '' OR source_system = 'MDM_SYS')
          THEN 'PROCESS_GOVERNANCE'
          ELSE source_system
        END,
        external_id = CASE
          WHEN (external_id IS NULL OR external_id = '')
           AND (source_system IS NULL OR source_system = '' OR source_system = 'MDM_SYS')
          THEN ?
          ELSE external_id
        END,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  const insertDepartment = database.prepare(`
    INSERT INTO departments (
      name,
      code,
      department_type,
      sort_order,
      status,
      source_system,
      external_id
    ) VALUES (?, ?, ?, ?, 'active', 'PROCESS_GOVERNANCE', ?)
  `);

  function resolveCanonicalIds() {
    return PROCESS_GOVERNANCE_DEPARTMENTS
      .map(department => findByCode.get(department.code) || findByName.get(department.name))
      .filter(Boolean)
      .map(row => row.id);
  }

  function loadArchiveCandidates(canonicalIds) {
    const placeholders = canonicalIds.length ? canonicalIds.map(() => '?').join(', ') : 'NULL';
    return database.prepare(`
      SELECT id, name, code
      FROM departments
      WHERE status = 'active'
        AND id NOT IN (${placeholders})
      ORDER BY sort_order, name
    `).all(...canonicalIds);
  }

  if (dryRun) {
    const canonicalIds = resolveCanonicalIds();
    return {
      dryRun: true,
      canonicalDepartments: PROCESS_GOVERNANCE_DEPARTMENTS.map(department => ({ ...department })),
      archiveCandidates: loadArchiveCandidates(canonicalIds)
    };
  }

  let archiveCandidates = [];
  const sync = database.transaction(() => {
    const canonicalIds = [];

    for (const department of PROCESS_GOVERNANCE_DEPARTMENTS) {
      const existing = findByCode.get(department.code) || findByName.get(department.name);
      if (existing) {
        updateDepartment.run(
          department.name,
          department.code,
          department.type,
          department.sort,
          department.code,
          existing.id
        );
        canonicalIds.push(existing.id);
      } else {
        const result = insertDepartment.run(
          department.name,
          department.code,
          department.type,
          department.sort,
          department.code
        );
        canonicalIds.push(Number(result.lastInsertRowid));
      }
    }

    archiveCandidates = loadArchiveCandidates(canonicalIds);

    if (archiveNonCanonical && canonicalIds.length) {
      database.prepare(`
        UPDATE departments
        SET status = 'archived',
            updated_at = datetime('now')
        WHERE status = 'active'
          AND id NOT IN (${canonicalIds.map(() => '?').join(', ')})
      `).run(...canonicalIds);
    }
  });

  sync();
  return {
    dryRun: false,
    archiveNonCanonical,
    canonicalDepartments: PROCESS_GOVERNANCE_DEPARTMENTS.map(department => ({ ...department })),
    archiveCandidates
  };
}

module.exports = {
  PROCESS_GOVERNANCE_DEPARTMENTS,
  syncProcessGovernanceOrg
};

if (require.main === module) {
  const argv = new Set(process.argv.slice(2));
  const result = syncProcessGovernanceOrg({
    dryRun: !(argv.has('--write') || argv.has('--archive-non-canonical')),
    archiveNonCanonical: argv.has('--archive-non-canonical')
  });
  console.log(JSON.stringify(result, null, 2));
}
