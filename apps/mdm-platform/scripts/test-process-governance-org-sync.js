const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { syncProcessGovernanceOrg } = require('./sync-process-governance-org');

try {
  db.prepare("INSERT INTO departments (name, code, status, department_type) VALUES ('公司领导', 'DEPT_GSLD', 'active', '其他')").run();
  db.prepare("INSERT INTO departments (name, code, status, department_type) VALUES ('信息化部', 'IT', 'active', '其他')").run();

  syncProcessGovernanceOrg({ db });

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

  console.log('Process governance org sync test passed');
} finally {
  db.close();
  cleanupDb();
}
