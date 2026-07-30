// 导入 MDM 参与人员: 读取 Excel 并写入 users 表
console.error('LEGACY_ACCOUNT_SCRIPT_RETIRED：Excel名单脚本不得创建3000账号。');
process.exit(1);

const ExcelJS = require('exceljs');
const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { resolveInitialPassword } = require('../server/passwordPolicy');

const EXCEL_PATH = process.env.MDM_USERS_EXCEL_PATH || 'C:/Users/charl/Desktop/MDM参与人员.xlsx';

// 部门中文名 → 拼音简码映射
const DEPT_CODE_MAP = {
  '经营发展部': 'DEPT_JYFZ',
  '生产部':    'DEPT_SCB',
  '财务部':    'DEPT_CW',
  '工程技术部': 'DEPT_GCJS',
  '复材车间':   'DEPT_FCCJ',
  '行政人事部': 'DEPT_XZRS',
  '质量安环部': 'DEPT_ZLAH',
  '物资保障部': 'DEPT_WZBZ',
  '质量管理部': 'DEPT_ZLGL',
  '项目管理部': 'DEPT_XMGL',
};

async function main() {
  // 1. 读取 Excel
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const ws = wb.worksheets[0];

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = row.getCell(1).value;
    const badgeNo = row.getCell(2).value?.toString();
    const oaAccount = row.getCell(3).value?.toString() || '';
    const deptName = row.getCell(4).value;
    const team = row.getCell(5).value;
    const post = row.getCell(6).value;
    if (name && badgeNo && deptName) {
      rows.push({ name, badgeNo, oaAccount, deptName, team, post });
    }
  }
  console.log(`读取到 ${rows.length} 条人员记录`);

  // 2. 创建缺失部门
  const deptNames = [...new Set(rows.map(r => r.deptName))];
  console.log(`涉及 ${deptNames.length} 个部门: ${deptNames.join(', ')}`);

  const existingDepts = {};
  db.prepare('SELECT id, name FROM departments').all().forEach(d => {
    existingDepts[d.name] = d.id;
  });

  const deptInsert = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)');

  for (const name of deptNames) {
    if (!existingDepts[name]) {
      const code = DEPT_CODE_MAP[name] || ('DEPT_' + Math.random().toString(36).slice(2, 6).toUpperCase());
      const info = deptInsert.run(name, code);
      existingDepts[name] = info.lastInsertRowid;
      console.log(`  创建部门: ${name} (code=${code}, id=${info.lastInsertRowid})`);
    }
  }

  // 3. 按职务推断角色
  function inferRole(post) {
    if (!post) return 'submitter';
    if (post.includes('主任')) return 'reviewer';
    return 'submitter';
  }

  // 4. 批量插入用户
  const userInsert = db.prepare(
    'INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const passwordSetup = resolveInitialPassword(process.env.MDM_INITIAL_USER_PASSWORD);
  if (passwordSetup.error) throw new Error(passwordSetup.error);
  const defaultHash = hashPassword(passwordSetup.password);

  let created = 0;
  let skipped = 0;

  const insertMany = db.transaction(() => {
    for (const row of rows) {
      const existing = db.prepare('SELECT id FROM users WHERE employee_no = ?').get(row.badgeNo);
      if (existing) { skipped++; continue; }
      const deptId = existingDepts[row.deptName] || null;
      const role = inferRole(row.post);
      userInsert.run(row.name, row.badgeNo, deptId, row.post, role, defaultHash, passwordSetup.mustChangePassword);
      created++;
    }
  });
  insertMany();

  console.log(`用户导入完成: 新增 ${created}, 跳过(已存在) ${skipped}`);
  console.log(`当前用户总数: ${db.prepare('SELECT COUNT(*) as c FROM users').get().c}`);
  if (created > 0) {
    console.log(`本次新增账号统一初始密码: ${passwordSetup.password}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
