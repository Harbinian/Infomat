const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testDbPath, cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { verifyPassword } = require('../server/auth');
const { syncRosterToMdm } = require('./import-roster-users');

const rosterPath = path.join(path.dirname(testDbPath), '花名册.md');

function writeRoster(records) {
  const lines = [
    '# 花名册',
    '',
    `共 ${records.length} 人`,
    '',
    '| 姓名 | 工号 | 部门 | 职务 | 性别 | 人员类别 |',
    '|------|------|------|------|------|----------|'
  ];
  records.forEach(record => {
    lines.push(`| ${record.name} | ${record.employeeNo} | ${record.department} | ${record.post} | ${record.gender || ''} | ${record.category || '职员'} |`);
  });
  fs.writeFileSync(rosterPath, lines.join('\n'), 'utf8');
}

function personRow(employeeNo) {
  return db.prepare(`
    SELECT
      person.employee_no,
      person.person_name,
      person.status,
      person.employment_status,
      org_unit.org_unit_code,
      org_unit.org_unit_name,
      position.position_code,
      position.position_name,
      assignment.is_primary,
      assignment.status AS assignment_status
    FROM person
    JOIN person_position_assignment assignment ON assignment.person_id = person.person_id
    JOIN position ON position.position_id = assignment.position_id
    JOIN org_unit ON org_unit.org_unit_id = position.org_unit_id
    WHERE person.employee_no = ?
      AND assignment.status = 'active'
  `).get(employeeNo);
}

function userPasswordRow(employeeNo) {
  return db.prepare('SELECT password_hash, must_change_password FROM users WHERE employee_no=?').get(employeeNo);
}

function main() {
  try {
    writeRoster([
      {
        name: '花名册测试一',
        employeeNo: 'RT001',
        department: '工程技术部',
        post: '工艺技术员',
        gender: '女'
      },
      {
        name: '花名册测试二',
        employeeNo: 'RT002',
        department: '项目管理部',
        post: '项目助理',
        gender: '男'
      }
    ]);

    const first = syncRosterToMdm({ db, rosterPath });
    assert.strictEqual(first.rosterRows, 2);
    assert.strictEqual(first.createdUsers, 2);
    assert.strictEqual(first.createdPersons, 2);
    assert.strictEqual(first.createdAssignments, 2);
    assert.ok(first.createdPositions >= 2, 'roster import should create department positions');

    const engineer = personRow('RT001');
    assert.ok(engineer, 'roster employee should be visible in person master data');
    assert.strictEqual(engineer.person_name, '花名册测试一');
    assert.strictEqual(engineer.org_unit_code, 'OU-DEP-ENG');
    assert.strictEqual(engineer.org_unit_name, '工程技术部');
    assert.strictEqual(engineer.position_name, '工艺技术员');
    assert.strictEqual(engineer.status, 'active');
    assert.strictEqual(engineer.employment_status, 'active');
    assert.strictEqual(engineer.is_primary, 1);

    const engineerUser = userPasswordRow('RT001');
    assert.ok(engineerUser, 'roster employee should have a user account');
    assert.strictEqual(engineerUser.must_change_password, 1, 'roster employee should be forced to change password on first login');
    assert.ok(!verifyPassword('000000', engineerUser.password_hash), 'roster employee must not use 000000');
    assert.ok(!verifyPassword('init1234', engineerUser.password_hash), 'roster employee must not use init1234');

    writeRoster([
      {
        name: '花名册测试一改名',
        employeeNo: 'RT001',
        department: '工程技术部',
        post: '工艺技术员',
        gender: '女'
      },
      {
        name: '花名册测试二',
        employeeNo: 'RT002',
        department: '项目管理部',
        post: '项目助理',
        gender: '男'
      }
    ]);

    const second = syncRosterToMdm({ db, rosterPath });
    assert.strictEqual(second.createdUsers, 0);
    assert.strictEqual(second.createdPersons, 0);
    assert.strictEqual(second.updatedUsers, 2);
    assert.strictEqual(second.updatedPersons, 2);

    const updated = personRow('RT001');
    assert.strictEqual(updated.person_name, '花名册测试一改名');
    const activeAssignmentCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM person_position_assignment assignment
      JOIN person ON person.person_id = assignment.person_id
      WHERE person.employee_no = 'RT001'
        AND assignment.status = 'active'
    `).get().count;
    assert.strictEqual(activeAssignmentCount, 1, 'roster re-import should not duplicate active assignments');

    console.log('Roster user/person import test passed');
  } finally {
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main();
