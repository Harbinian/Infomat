const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { syncProcessGovernanceOrg } = require('./sync-process-governance-org');

try {
  db.prepare("INSERT INTO departments (name, code, status, department_type) VALUES ('公司领导', 'DEPT_GSLD', 'active', '其他')").run();
  db.prepare("INSERT INTO departments (name, code, status, department_type) VALUES ('信息化部', 'IT', 'active', '其他')").run();
  db.prepare(`
    INSERT INTO departments (name, code, status, department_type, sort_order)
    VALUES ('经营管理部', 'DEPT_JYFZ', 'active', '业务', 999)
  `).run();
  db.prepare(`
    INSERT INTO departments (name, code, status, department_type, sort_order, source_system, external_id)
    VALUES ('质量管理部', 'OLD_ZLGL', 'inactive', '其他', 999, 'MDM_SYS', '')
  `).run();
  db.prepare(`
    INSERT INTO departments (name, code, status, department_type, sort_order, source_system, external_id)
    VALUES ('工程技术部', 'DEPT_GCJS', 'inactive', '其他', 999, 'HR_SYSTEM', 'HR-DEPT-GCJS')
  `).run();

  const dryRun = syncProcessGovernanceOrg({ db });
  assert.strictEqual(dryRun.dryRun, true);
  assert.deepStrictEqual(
    dryRun.archiveCandidates.map(row => row.name).sort(new Intl.Collator('zh-Hans-CN').compare),
    ['公司领导', '信息化部']
  );
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM departments WHERE name IN ('公司领导', '信息化部') AND status='active'").get().count,
    2,
    '默认预览模式不得归档现有部门'
  );

  syncProcessGovernanceOrg({ db, dryRun: false });
  syncProcessGovernanceOrg({ db, dryRun: false, archiveNonCanonical: true });

  const active = db.prepare("SELECT name FROM departments WHERE status='active' ORDER BY sort_order, name").all().map(row => row.name);
  assert.deepStrictEqual(active, [
    '工程技术部',
    '质量管理部',
    '财务部',
    '行政人事部',
    '经营发展部',
    '物资保障部',
    '项目管理部',
    '复材车间',
    '运维安环部'
  ]);

  const archived = db.prepare("SELECT name FROM departments WHERE status='archived' ORDER BY name")
    .all()
    .map(row => row.name)
    .sort(new Intl.Collator('zh-Hans-CN').compare);
  assert.deepStrictEqual(archived, ['公司领导', '信息化部']);

  const canonicalAlias = db.prepare("SELECT name, code, status FROM departments WHERE code='DEPT_JYFZ'").get();
  assert.deepStrictEqual(canonicalAlias, {
    name: '经营发展部',
    code: 'DEPT_JYFZ',
    status: 'active'
  });

  const activeAliasCount = db.prepare("SELECT COUNT(*) AS count FROM departments WHERE name='经营管理部' AND status='active'").get().count;
  assert.strictEqual(activeAliasCount, 0);

  const corrected = db.prepare("SELECT code, department_type, sort_order, status, source_system, external_id FROM departments WHERE name='质量管理部'").get();
  assert.deepStrictEqual(corrected, {
    code: 'DEPT_ZLGL',
    department_type: '职能',
    sort_order: 20,
    status: 'active',
    source_system: 'PROCESS_GOVERNANCE',
    external_id: 'DEPT_ZLGL'
  });

  const preserved = db.prepare("SELECT code, department_type, sort_order, status, source_system, external_id FROM departments WHERE name='工程技术部'").get();
  assert.deepStrictEqual(preserved, {
    code: 'DEPT_GCJS',
    department_type: '业务',
    sort_order: 10,
    status: 'active',
    source_system: 'HR_SYSTEM',
    external_id: 'HR-DEPT-GCJS'
  });

  const domainExternalIds = db.prepare(`
    SELECT COUNT(*) AS count
    FROM departments
    WHERE external_id IN ('总经理直辖域', '经营域', '生产域')
  `).get().count;
  assert.strictEqual(domainExternalIds, 0);

  console.log('Process governance org sync test passed');
} finally {
  db.close();
  cleanupDb();
}
