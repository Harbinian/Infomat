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
  const expectedNames = PROCESS_GOVERNANCE_DEPARTMENTS.map(department => department.name);

  const findByName = database.prepare('SELECT id FROM departments WHERE name = ?');
  const updateDepartment = database.prepare(`
    UPDATE departments
    SET code = ?,
        department_type = ?,
        sort_order = ?,
        status = 'active',
        source_system = 'PROCESS_GOVERNANCE',
        external_id = ?,
        updated_at = datetime('now')
    WHERE name = ?
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
  const archiveOtherActiveDepartments = database.prepare(`
    UPDATE departments
    SET status = 'archived',
        updated_at = datetime('now')
    WHERE status = 'active'
      AND name NOT IN (${expectedNames.map(() => '?').join(', ')})
  `);

  const sync = database.transaction(() => {
    for (const department of PROCESS_GOVERNANCE_DEPARTMENTS) {
      const existing = findByName.get(department.name);
      if (existing) {
        updateDepartment.run(
          department.code,
          department.type,
          department.sort,
          department.domain,
          department.name
        );
      } else {
        insertDepartment.run(
          department.name,
          department.code,
          department.type,
          department.sort,
          department.domain
        );
      }
    }

    archiveOtherActiveDepartments.run(...expectedNames);
  });

  sync();
}

module.exports = {
  PROCESS_GOVERNANCE_DEPARTMENTS,
  syncProcessGovernanceOrg
};

if (require.main === module) {
  syncProcessGovernanceOrg();
  console.log('Process governance organization scope synchronized');
}
