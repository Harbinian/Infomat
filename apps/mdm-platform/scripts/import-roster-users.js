const fs = require('fs');
const path = require('path');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { resolveInitialPassword } = require('../server/passwordPolicy');
const {
  LEADERSHIP_OFFICE_ASSIGNMENTS,
  syncOrganizationStructure
} = require('./sync-organization-structure');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_ROSTER_PATH = path.join(REPO_ROOT, 'docs', 'organization', '花名册.md');
const ROSTER_PATH = path.resolve(process.env.MDM_ROSTER_PATH || DEFAULT_ROSTER_PATH);
const DRY_RUN = process.env.MDM_ROSTER_DRY_RUN === '1';

const DEPARTMENT_CODE_MAP = {
  '公司领导': 'DEPT_GSLD',
  '行政人事部': 'DEPT_XZRS',
  '经营发展部': 'DEPT_JYFZ',
  '物资保障部': 'DEPT_WZBZ',
  '质量管理部': 'DEPT_ZLGL',
  '工程技术部': 'DEPT_GCJS',
  '复材车间': 'DEPT_FCCJ',
  '财务部': 'DEPT_CW',
  '项目管理部': 'DEPT_XMGL',
  '运维安环部': 'DEPT_YWAH'
};

const DEPARTMENT_TYPE_MAP = {
  '公司领导': '其他',
  '行政人事部': '职能',
  '经营发展部': '业务',
  '物资保障部': '业务',
  '质量管理部': '职能',
  '工程技术部': '业务',
  '复材车间': '生产',
  '财务部': '职能',
  '项目管理部': '业务',
  '运维安环部': '职能'
};

const ROSTER_DEPARTMENT_ORG_UNIT_CODE_MAP = {
  '工程技术部': 'OU-DEP-ENG',
  '质量管理部': 'OU-DEP-QMS',
  '财务部': 'OU-DEP-FIN',
  '行政人事部': 'OU-DEP-AHR',
  '经营发展部': 'OU-DEP-BDV',
  '物资保障部': 'OU-DEP-MAT',
  '项目管理部': 'OU-DEP-PMO',
  '复材车间': 'OU-DEP-CMP',
  '运维安环部': 'OU-DEP-EHS'
};

const LEADERSHIP_ASSIGNMENT_BY_EMPLOYEE_NO = new Map(
  LEADERSHIP_OFFICE_ASSIGNMENTS.map(assignment => [assignment.employeeNo, assignment])
);

function splitTableLine(line) {
  return line.split('|').slice(1, -1).map(cell => cell.trim());
}

function parseRoster(markdown) {
  const lines = markdown.split(/\r?\n/).filter(line => line.startsWith('|'));
  let headers = null;
  const records = [];
  const seen = new Set();

  for (const line of lines) {
    const cells = splitTableLine(line);
    if (cells.length === 0 || cells.every(cell => /^-+$/.test(cell))) continue;
    if (cells.includes('姓名')) {
      headers = cells;
      continue;
    }
    if (!headers) continue;

    const value = name => {
      const index = headers.indexOf(name);
      return index >= 0 ? cells[index] || '' : '';
    };

    const employeeNo = value('工号') || value('胸卡号');
    const record = {
      name: value('姓名'),
      employeeNo,
      department: value('部门'),
      post: value('职务') || value('岗位'),
      gender: value('性别'),
      category: value('人员类别')
    };
    if (!record.name || !record.employeeNo || !record.department) {
      throw new Error(`花名册存在必填项为空的行: ${line}`);
    }
    if (seen.has(record.employeeNo)) {
      throw new Error(`花名册工号重复: ${record.employeeNo}`);
    }
    seen.add(record.employeeNo);
    records.push(record);
  }

  if (!records.length) {
    throw new Error(`花名册未解析到人员记录: ${ROSTER_PATH}`);
  }
  return records;
}

function stableToken(value, width = 6) {
  const text = String(value || '').trim();
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(width, '0').slice(-width);
}

function getRosterAssignment(record) {
  const leadership = LEADERSHIP_ASSIGNMENT_BY_EMPLOYEE_NO.get(record.employeeNo);
  if (leadership) {
    return {
      orgUnitCode: leadership.officeCode,
      positionCode: leadership.positionCode,
      positionName: leadership.positionName,
      posMnemonic: leadership.posMnemonic
    };
  }

  const orgUnitCode = ROSTER_DEPARTMENT_ORG_UNIT_CODE_MAP[record.department];
  if (!orgUnitCode) {
    throw new Error(`花名册部门未映射到 MDM 组织：${record.department}`);
  }

  const positionName = record.post || '未定岗';
  const posMnemonic = `R${stableToken(positionName, 7)}`;
  return {
    orgUnitCode,
    positionCode: null,
    positionName,
    posMnemonic
  };
}

function ensureDepartment(name, cache, createdDepartments, database = db) {
  if (cache.has(name)) return cache.get(name);

  const code = DEPARTMENT_CODE_MAP[name];
  if (!code) throw new Error(`缺少部门编码映射: ${name}`);

  const existingByCode = database.prepare('SELECT id, name FROM departments WHERE code=?').get(code);
  if (existingByCode && existingByCode.name !== name) {
    throw new Error(`部门编码 ${code} 已被 ${existingByCode.name} 使用，不能用于 ${name}`);
  }

  const result = database.prepare(`
    INSERT INTO departments (name, code, department_type, status)
    VALUES (?, ?, ?, 'active')
  `).run(name, code, DEPARTMENT_TYPE_MAP[name] || null);

  const department = {
    id: result.lastInsertRowid,
    name,
    code,
    department_type: DEPARTMENT_TYPE_MAP[name] || null
  };
  cache.set(name, department);
  createdDepartments.push(department);
  return department;
}

function syncRosterToMdm(options = {}) {
  if (process.env.MDM_ALLOW_LEGACY_TEST_MODE !== '1') {
    throw new Error('LEGACY_ACCOUNT_SCRIPT_RETIRED：花名册脚本不得创建3000账号，请由管理员在账号管理页面手工开户。');
  }
  const database = options.db || db;
  const rosterPath = path.resolve(options.rosterPath || process.env.MDM_ROSTER_PATH || DEFAULT_ROSTER_PATH);
  const dryRun = options.dryRun !== undefined ? options.dryRun : process.env.MDM_ROSTER_DRY_RUN === '1';

  if (!fs.existsSync(rosterPath)) {
    throw new Error(`花名册不存在: ${rosterPath}`);
  }

  const records = parseRoster(fs.readFileSync(rosterPath, 'utf8'));
  if (!dryRun) syncOrganizationStructure({ db: database });

  const departments = new Map(database.prepare('SELECT id, name, code, department_type FROM departments').all().map(row => [row.name, row]));
  const existingUsers = new Map(database.prepare('SELECT id, employee_no FROM users').all().map(row => [row.employee_no, row]));
  const createdDepartments = [];
  const missingUsers = records.filter(record => !existingUsers.has(record.employeeNo));
  const existingRosterUsers = records.filter(record => existingUsers.has(record.employeeNo));

  if (dryRun) {
    const missingDepartments = [...new Set(records.map(record => record.department))]
      .filter(name => !departments.has(name));
    return {
      dryRun: true,
      dbPath: database.__dbPath,
      rosterPath,
      rosterRows: records.length,
      createUsers: missingUsers.length,
      updateUsers: existingRosterUsers.length,
      createDepartments: missingDepartments
    };
  }

  const passwordSetup = resolveInitialPassword(process.env.MDM_INITIAL_USER_PASSWORD);
  if (passwordSetup.error) throw new Error(passwordSetup.error);

  const passwordHash = hashPassword(passwordSetup.password);
  const submitterRole = database.prepare("SELECT role_id FROM roles WHERE role_code='submitter'").get();
  if (!submitterRole) throw new Error('缺少 submitter / 报送人 角色');

  const admin = database.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
  const assignedBy = admin ? admin.id : null;

  const updateUser = database.prepare(`
    UPDATE users
    SET name=?, department_id=?, post=?
    WHERE id=?
  `);
  const insertUser = database.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash, must_change_password)
    VALUES (?, ?, ?, ?, 'submitter', ?, ?)
  `);
  const assignSubmitter = database.prepare(`
    INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by)
    VALUES (?, ?, ?)
  `);
  const orgUnitByCode = database.prepare(`
    SELECT org_unit_id, org_unit_code, org_unit_name, org_mnemonic
    FROM org_unit
    WHERE org_unit_code=?
  `);
  const findPositionByCode = database.prepare('SELECT position_id FROM position WHERE position_code=?');
  const findPositionByOrgMnemonic = database.prepare('SELECT position_id FROM position WHERE org_unit_id=? AND pos_mnemonic=?');
  const updatePosition = database.prepare(`
    UPDATE position
    SET position_code=?,
        position_name=?,
        pos_mnemonic=?,
        org_unit_id=?,
        status='active',
        effective_from=COALESCE(effective_from, CURRENT_DATE),
        effective_to=NULL,
        updated_at=CURRENT_TIMESTAMP
    WHERE position_id=?
  `);
  const insertPosition = database.prepare(`
    INSERT INTO position (position_code, position_name, pos_mnemonic, org_unit_id, status, effective_from)
    VALUES (?, ?, ?, ?, 'active', CURRENT_DATE)
  `);
  const findPersonByEmployeeNo = database.prepare('SELECT person_id FROM person WHERE employee_no=?');
  const updatePerson = database.prepare(`
    UPDATE person
    SET person_name=?,
        employment_status='active',
        status='active',
        effective_from=COALESCE(effective_from, CURRENT_DATE),
        effective_to=NULL,
        updated_at=CURRENT_TIMESTAMP
    WHERE person_id=?
  `);
  const insertPerson = database.prepare(`
    INSERT INTO person (employee_no, person_name, employment_status, status, effective_from)
    VALUES (?, ?, 'active', 'active', CURRENT_DATE)
  `);
  const clearPrimaryAssignment = database.prepare(`
    UPDATE person_position_assignment
    SET is_primary=0, updated_at=CURRENT_TIMESTAMP
    WHERE person_id=? AND status='active'
  `);
  const findActiveAssignment = database.prepare(`
    SELECT assignment_id
    FROM person_position_assignment
    WHERE person_id=? AND position_id=? AND status='active'
    ORDER BY assignment_id
    LIMIT 1
  `);
  const updateAssignment = database.prepare(`
    UPDATE person_position_assignment
    SET is_primary=1,
        end_date=NULL,
        status='active',
        updated_at=CURRENT_TIMESTAMP
    WHERE assignment_id=?
  `);
  const insertAssignment = database.prepare(`
    INSERT INTO person_position_assignment (person_id, position_id, is_primary, status, start_date)
    VALUES (?, ?, 1, 'active', CURRENT_DATE)
  `);

  const results = {
    dbPath: database.__dbPath,
    rosterPath,
    rosterRows: records.length,
    createdUsers: 0,
    updatedUsers: 0,
    createdPersons: 0,
    updatedPersons: 0,
    createdPositions: 0,
    updatedPositions: 0,
    createdAssignments: 0,
    updatedAssignments: 0,
    createdDepartments: [],
    initialPassword: null
  };

  const run = database.transaction(() => {
    for (const record of records) {
      const department = ensureDepartment(record.department, departments, createdDepartments, database);
      const existing = existingUsers.get(record.employeeNo);
      if (existing) {
        updateUser.run(record.name, department.id, record.post || null, existing.id);
        results.updatedUsers += 1;
      } else {
        const userId = insertUser.run(
          record.name,
          record.employeeNo,
          department.id,
          record.post || null,
          passwordHash,
          passwordSetup.mustChangePassword
        ).lastInsertRowid;
        assignSubmitter.run(userId, submitterRole.role_id, assignedBy);
        results.createdUsers += 1;
      }

      const assignment = getRosterAssignment(record);
      const orgUnit = orgUnitByCode.get(assignment.orgUnitCode);
      if (!orgUnit) {
        throw new Error(`MDM 组织不存在，请先同步组织架构：${assignment.orgUnitCode}`);
      }
      const positionCode = assignment.positionCode || `POS-${orgUnit.org_mnemonic}-${assignment.posMnemonic}`;
      const existingPosition =
        findPositionByCode.get(positionCode) ||
        findPositionByOrgMnemonic.get(orgUnit.org_unit_id, assignment.posMnemonic);
      let positionId;
      if (existingPosition) {
        positionId = Number(existingPosition.position_id);
        updatePosition.run(
          positionCode,
          assignment.positionName,
          assignment.posMnemonic,
          orgUnit.org_unit_id,
          positionId
        );
        results.updatedPositions += 1;
      } else {
        positionId = Number(insertPosition.run(
          positionCode,
          assignment.positionName,
          assignment.posMnemonic,
          orgUnit.org_unit_id
        ).lastInsertRowid);
        results.createdPositions += 1;
      }

      const existingPerson = findPersonByEmployeeNo.get(record.employeeNo);
      let personId;
      if (existingPerson) {
        personId = Number(existingPerson.person_id);
        updatePerson.run(record.name, personId);
        results.updatedPersons += 1;
      } else {
        personId = Number(insertPerson.run(record.employeeNo, record.name).lastInsertRowid);
        results.createdPersons += 1;
      }

      clearPrimaryAssignment.run(personId);
      const existingAssignment = findActiveAssignment.get(personId, positionId);
      if (existingAssignment) {
        updateAssignment.run(existingAssignment.assignment_id);
        results.updatedAssignments += 1;
      } else {
        insertAssignment.run(personId, positionId);
        results.createdAssignments += 1;
      }
    }
  });

  run();
  results.createdDepartments = createdDepartments.map(department => department.name);
  if (results.createdUsers > 0) results.initialPassword = passwordSetup.password;

  return results;
}

function main() {
  const results = syncRosterToMdm();
  console.log(JSON.stringify(results, null, 2));
}

module.exports = {
  DEFAULT_ROSTER_PATH,
  parseRoster,
  getRosterAssignment,
  syncRosterToMdm
};

if (require.main === module) {
  main();
}
