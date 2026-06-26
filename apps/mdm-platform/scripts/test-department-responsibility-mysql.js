const assert = require('assert');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

function makePool() {
  const state = {
    departments: [
      { id: 20, name: '工程技术部', manager_user_id: 1, data_owner_user_id: 1, final_responsible_person_id: null, data_owner_person_id: null },
      { id: 21, name: '公司领导', manager_user_id: 9, data_owner_user_id: 9, final_responsible_person_id: null, data_owner_person_id: null }
    ],
    users: [
      { id: 1, name: '池炳辉', employee_no: 'A001', department_id: 20, role: 'owner', password_hash: 'hash', must_change_password: 0, created_at: '2026-06-01' },
      { id: 9, name: '总经理', employee_no: 'LEADER001', department_id: 21, role: 'owner', password_hash: 'hash', must_change_password: 0, created_at: '2026-06-01' }
    ],
    persons: [{ person_id: 501, employee_no: 'A001', person_name: '池炳辉', current_department_id: 20 }]
  };

  return {
    state,
    async execute(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      if (normalizedSql.startsWith('CREATE TABLE') || normalizedSql.startsWith('ALTER TABLE')) return [[], undefined];
      if (normalizedSql.startsWith('INSERT INTO person')) return [{ affectedRows: 0 }, undefined];
      if (normalizedSql.startsWith('INSERT INTO user_accounts')) return [{ affectedRows: 0 }, undefined];
      if (normalizedSql.startsWith('INSERT IGNORE INTO person_roles')) return [{ affectedRows: 0 }, undefined];
      if (normalizedSql.startsWith('UPDATE departments d JOIN person p ON p.person_name=?')) {
        const [personName, departmentName] = params;
        const person = state.persons.find(row => row.person_name === personName);
        const department = state.departments.find(row => row.name === departmentName);
        if (person && department && departmentName !== '公司领导') {
          department.final_responsible_person_id = person.person_id;
          return [{ affectedRows: 1 }, undefined];
        }
        return [{ affectedRows: 0 }, undefined];
      }
      throw new Error(`Unhandled SQL in department responsibility fake pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makePool();
  await makeIdentityMysqlRepository(pool).initSchema();
  assert.strictEqual(
    pool.state.departments.find(row => row.name === '工程技术部').final_responsible_person_id,
    501
  );
  assert.strictEqual(
    pool.state.departments.find(row => row.name === '公司领导').final_responsible_person_id,
    null
  );
  console.log('Department responsibility MySQL test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
