const fs = require('fs');
const path = require('path');

if (process.env.ALLOW_PROJECT_USER_SETUP !== 'true') {
  console.error('setup-mdm-project-users.js uses project-roster scope. Set ALLOW_PROJECT_USER_SETUP=true to run it intentionally.');
  process.exit(1);
}

const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { resolveInitialPassword } = require('../server/passwordPolicy');
const { PROJECT_ROLE_DEFINITIONS } = require('../server/roleDefinitions');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ROSTER_PATH = path.join(REPO_ROOT, 'docs', 'organization', '花名册.md');

const DEPARTMENT_ALIASES = {
  '经营管理部': '经营发展部',
  '物资保障': '物资保障部'
};

const DEPARTMENT_CODES = {
  '公司领导': 'DEPT_GSLD',
  '行政人事部': 'DEPT_XZRS',
  '经营发展部': 'DEPT_JYFZ',
  '物资保障部': 'DEPT_WZBZ',
  '质量管理部': 'DEPT_ZLGL',
  '工程技术部': 'DEPT_GCJS',
  '复材车间': 'DEPT_FCCJ',
  '财务部': 'DEPT_CW',
  '项目管理部': 'DEPT_XMGL'
};

const DEPARTMENT_TYPES = {
  '公司领导': '其他',
  '行政人事部': '职能',
  '经营发展部': '业务',
  '物资保障部': '业务',
  '质量管理部': '职能',
  '工程技术部': '业务',
  '复材车间': '生产',
  '财务部': '职能',
  '项目管理部': '业务'
};

const SUPPLEMENTAL_PERSONNEL = {
  '马成文': {
    name: '马成文',
    employeeNo: '100000',
    department: '公司领导',
    team: '公司领导',
    post: '总经理 / 信息化项目组组长',
    category: '职员'
  }
};

const PARTICIPANTS = [
  { name: '马成文', department: '公司领导', projectRole: '信息化项目组组长/决策组' },
  { name: '赵亮', department: '公司领导', projectRole: '决策组' },
  { name: '李洪哲', department: '公司领导', projectRole: '决策组' },
  { name: '张广懿', department: '经营发展部', projectRole: '信息化负责人' },

  { name: '陈娟', department: '行政人事部', projectRole: '业务对接人' },
  { name: '赵襄璇', department: '行政人事部', projectRole: '数据质量员' },
  { name: '董含琪', department: '行政人事部', projectRole: '数据质量员' },

  { name: '刘春含', department: '经营管理部', projectRole: '业务对接人' },
  { name: '万恒洋', department: '经营管理部', projectRole: '业务对接人' },
  { name: '张琇雅', department: '经营管理部', projectRole: '数据质量员' },
  { name: '李铄康', department: '经营管理部', projectRole: '数据质量员' },

  { name: '黄吉', department: '物资保障部', projectRole: '业务对接人' },
  { name: '佟浩', department: '物资保障部', projectRole: '业务对接人' },
  { name: '胡婷婷', department: '物资保障部', projectRole: '业务对接人' },

  { name: '曲明盛', department: '质量管理部', projectRole: '项目组长' },
  { name: '安建国', department: '质量管理部', projectRole: '数据质量员' },
  { name: '刘楠楠', department: '质量管理部', projectRole: '数据质量员' },

  { name: '池炳辉', department: '工程技术部', projectRole: '项目组长' },
  { name: '常云龙', department: '工程技术部', projectRole: '业务对接人/数据质量员' },
  { name: '万旭', department: '工程技术部', projectRole: '业务对接人/数据质量员' },

  { name: '王潇', department: '复材车间', projectRole: '项目组长' },
  { name: '郎春生', department: '复材车间', projectRole: '业务对接人' },
  { name: '纪鹏飞', department: '复材车间', projectRole: '数据质量员' },

  { name: '刘洪雨', department: '物资保障部', projectRole: '项目组长' },
  { name: '李雪', department: '财务部', projectRole: '项目组长' },
  { name: '刘佳', department: '财务部', projectRole: '业务对接人/数据质量员' },
  { name: '李新潮', department: '财务部', projectRole: '业务对接人/数据质量员' },

  { name: '范秋南', department: '项目管理部', projectRole: '项目组长' },
  { name: '肖明哲', department: '项目管理部', projectRole: '业务对接人/数据质量员' },
  { name: '张席铭', department: '项目管理部', projectRole: '业务对接人/数据质量员' }
];

const DEPARTMENT_STEWARDS = [
  { department: '行政人事部', manager: '陈娟', dataOwner: '赵襄璇' },
  { department: '经营发展部', manager: '刘春含', dataOwner: '张琇雅' },
  { department: '物资保障部', manager: '刘洪雨', dataOwner: '佟浩' },
  { department: '质量管理部', manager: '曲明盛', dataOwner: '刘楠楠' },
  { department: '工程技术部', manager: '池炳辉', dataOwner: '常云龙' },
  { department: '复材车间', manager: '王潇', dataOwner: '纪鹏飞' },
  { department: '财务部', manager: '李雪', dataOwner: '刘佳' },
  { department: '项目管理部', manager: '范秋南', dataOwner: '肖明哲' }
];

function normalizeDepartment(name) {
  return DEPARTMENT_ALIASES[name] || name;
}

function parseRoster(markdown) {
  const records = new Map();
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('姓名')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length < 6) continue;
    const [name, employeeNo, department, team, post, category] = cells;
    if (!name || !employeeNo) continue;
    records.set(name, { name, employeeNo, department, team, post, category });
  }

  return records;
}

function inferLegacyRole(projectRole) {
  if (projectRole.includes('决策组')) return 'reviewer';
  if (projectRole.includes('信息化负责人')) return 'reviewer';
  if (projectRole.includes('数据质量员')) return 'reviewer';
  if (projectRole.includes('项目组长')) return 'owner';
  if (projectRole.includes('业务对接人')) return 'owner';
  return 'submitter';
}

function inferRbacRoles(projectRole) {
  const roles = new Set();
  if (projectRole.includes('决策组')) roles.add('decision_group');
  if (projectRole.includes('信息化负责人')) roles.add('it_lead');
  if (projectRole.includes('项目组长')) roles.add('project_lead');
  if (projectRole.includes('业务对接人')) roles.add('business_contact');
  if (projectRole.includes('数据质量员')) roles.add('data_quality');
  if (roles.size === 0) roles.add('submitter');
  return Array.from(roles);
}

function ensureDepartment(name) {
  const departmentName = normalizeDepartment(name);
  const existing = db.prepare('SELECT id FROM departments WHERE name=?').get(departmentName);
  if (existing) {
    db.prepare(`
      UPDATE departments
      SET code=COALESCE(code, ?),
          department_type=COALESCE(department_type, ?),
          status='active',
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(DEPARTMENT_CODES[departmentName] || null, DEPARTMENT_TYPES[departmentName] || null, existing.id);
    return existing.id;
  }

  const code = DEPARTMENT_CODES[departmentName];
  if (!code) throw new Error(`缺少部门编码: ${departmentName}`);

  return db.prepare(`
    INSERT INTO departments (name, code, department_type, status)
    VALUES (?, ?, ?, 'active')
  `).run(departmentName, code, DEPARTMENT_TYPES[departmentName] || null).lastInsertRowid;
}

function ensureRoleCodes() {
  const required = ['admin', 'reviewer', 'owner', 'submitter'];
  const existing = new Set(db.prepare('SELECT role_code FROM roles').all().map(row => row.role_code));
  const missing = required.filter(code => !existing.has(code));
  if (missing.length) {
    throw new Error(`缺少系统角色: ${missing.join(', ')}`);
  }
}

function ensureProjectRoles(assignedBy) {
  const insertPermission = db.prepare(`
    INSERT OR IGNORE INTO permissions (perm_code, resource, action, description)
    VALUES (?, ?, ?, ?)
  `);
  const upsertRole = db.prepare(`
    INSERT INTO roles (role_code, role_name, description, created_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(role_code) DO UPDATE SET
      role_name=excluded.role_name,
      description=excluded.description,
      updated_at=CURRENT_TIMESTAMP
  `);
  const roleByCode = db.prepare('SELECT role_id FROM roles WHERE role_code=?');
  const linkPermission = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, perm_id)
    SELECT ?, perm_id FROM permissions WHERE perm_code=?
  `);

  for (const role of PROJECT_ROLE_DEFINITIONS) {
    for (const permission of role.permissions) {
      insertPermission.run(...permission);
    }
    upsertRole.run(role.roleCode, role.roleName, role.description, assignedBy || null);
    const row = roleByCode.get(role.roleCode);
    db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(row.role_id);
    for (const [permCode] of role.permissions) {
      linkPermission.run(row.role_id, permCode);
    }
  }
}

function upsertUser(participant, rosterRecord, departmentId, passwordHash, mustChangePassword) {
  const role = inferLegacyRole(participant.projectRole);
  const existing = db.prepare('SELECT id FROM users WHERE employee_no=?').get(rosterRecord.employeeNo);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET name=?, department_id=?, post=?, role=?
      WHERE id=?
    `).run(rosterRecord.name, departmentId, rosterRecord.post || null, role, existing.id);
    return { id: existing.id, action: 'updated', role };
  }

  const id = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    rosterRecord.name,
    rosterRecord.employeeNo,
    departmentId,
    rosterRecord.post || null,
    role,
    passwordHash,
    mustChangePassword
  ).lastInsertRowid;

  return { id, action: 'created', role };
}

function assignRbacRoles(userId, roleCodes, assignedBy) {
  db.prepare('DELETE FROM user_roles WHERE user_id=?').run(userId);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by)
    SELECT ?, role_id, ? FROM roles WHERE role_code=?
  `);

  for (const code of roleCodes) {
    insert.run(userId, assignedBy || null, code);
  }
}

function syncExistingLegacyRoles(assignedBy) {
  const users = db.prepare('SELECT id, role FROM users').all();
  const count = db.prepare('SELECT COUNT(*) as count FROM user_roles WHERE user_id=?');
  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by)
    SELECT ?, role_id, ? FROM roles WHERE role_code=?
  `);

  for (const user of users) {
    if (count.get(user.id).count === 0 && user.role) {
      insert.run(user.id, assignedBy || null, user.role);
    }
  }
}

function updateDepartmentStewards(userIdsByName) {
  for (const item of DEPARTMENT_STEWARDS) {
    const departmentId = ensureDepartment(item.department);
    const managerId = userIdsByName.get(item.manager);
    const dataOwnerId = userIdsByName.get(item.dataOwner);
    if (!managerId || !dataOwnerId) {
      throw new Error(`部门 ${item.department} 的负责人或数据责任人未找到`);
    }

    db.prepare(`
      UPDATE departments
      SET manager_user_id=?,
          data_owner_user_id=?,
          department_type=COALESCE(department_type, ?),
          status='active',
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(managerId, dataOwnerId, DEPARTMENT_TYPES[item.department] || null, departmentId);
  }
}

function main() {
  ensureRoleCodes();

  const roster = parseRoster(fs.readFileSync(ROSTER_PATH, 'utf8'));
  const passwordSetup = resolveInitialPassword(process.env.MDM_INITIAL_USER_PASSWORD);
  if (passwordSetup.error) {
    console.error(passwordSetup.error);
    process.exit(1);
  }
  const passwordHash = hashPassword(passwordSetup.password);
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
  const assignedBy = admin ? admin.id : null;

  const seen = new Set();
  const results = [];
  const userIdsByName = new Map();

  const run = db.transaction(() => {
    ensureProjectRoles(assignedBy);

    for (const participant of PARTICIPANTS) {
      if (seen.has(participant.name)) continue;
      seen.add(participant.name);

      const rosterRecord = roster.get(participant.name) || SUPPLEMENTAL_PERSONNEL[participant.name];
      if (!rosterRecord) throw new Error(`花名册中未找到: ${participant.name}`);

      const normalizedDepartment = normalizeDepartment(participant.department);
      const departmentId = ensureDepartment(normalizedDepartment);
      const { id, action, role } = upsertUser(participant, rosterRecord, departmentId, passwordHash, passwordSetup.mustChangePassword);
      const rbacRoles = inferRbacRoles(participant.projectRole);
      assignRbacRoles(id, rbacRoles, assignedBy);

      userIdsByName.set(participant.name, id);
      results.push({
        action,
        name: participant.name,
        employeeNo: rosterRecord.employeeNo,
        department: normalizedDepartment,
        rosterDepartment: rosterRecord.department,
        projectRole: participant.projectRole,
        legacyRole: role,
        rbacRoles: rbacRoles.join(',')
      });
    }

    updateDepartmentStewards(userIdsByName);
    syncExistingLegacyRoles(assignedBy);
  });

  run();

  const created = results.filter(row => row.action === 'created').length;
  const updated = results.filter(row => row.action === 'updated').length;

  console.log(`MDM项目账号设置完成: 新增 ${created}, 更新 ${updated}, 合计 ${results.length}`);
  console.table(results);
  if (created > 0) {
    console.log(`本次新增账号统一初始密码: ${passwordSetup.password}`);
  }
}

main();
