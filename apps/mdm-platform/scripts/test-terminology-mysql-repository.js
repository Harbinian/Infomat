const assert = require('assert');

const { makeTerminologyMysqlRepository } = require('../server/terminologyMysqlRepository');

function makeFakePool() {
  const state = {
    statements: [],
    termTypes: [],
    processes: [
      { id: 31, record_type: 'l3', status: 'active', l3_name: '客户主数据维护', dept_name: '经营发展部' },
      { id: 32, record_type: 'l3', status: 'active', l3_name: '应付账款维护', dept_name: '财务部' }
    ],
    departments: [
      { id: 9, name: '经营发展部' },
      { id: 10, name: '财务部' }
    ],
    terms: [],
    nextId: 100
  };

  function insertId() {
    const id = state.nextId;
    state.nextId += 1;
    return id;
  }

  function publicProcess(row) {
    const dept = state.departments.find(item => item.name === row.dept_name) || {};
    return {
      id: row.id,
      name: row.l3_name,
      cap_name: '流程治理读模型',
      owner_dept_id: dept.id || null,
      dept_name: row.dept_name
    };
  }

  function publicTerm(row) {
    const termType = state.termTypes.find(item => item.code === row.term_type_code) || {};
    const process = state.processes.find(item => Number(item.id) === Number(row.process_mapping_record_id));
    const processPayload = process ? publicProcess(process) : {};
    return {
      id: row.id,
      term: row.term,
      term_type_code: row.term_type_code,
      term_type_name: termType.name || null,
      term_type_description: termType.description || null,
      definition: row.definition,
      scope: row.scope,
      forbidden: row.forbidden,
      status: row.status,
      process_id: row.process_mapping_record_id || null,
      process_name: processPayload.name || null,
      process_owner_dept_id: processPayload.owner_dept_id || null,
      process_dept_name: processPayload.dept_name || null,
      created_by: row.created_by,
      approved_by: row.approved_by || null
    };
  }

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE')) return [[], undefined];

      if (normalizedSql.includes('INSERT INTO terminology_term_types')) {
        if (params.length === 0) {
          for (const row of [
            { code: 'noun', name: '名词', description: '业务对象、字段和交付物', sort_order: 10, active: 1 },
            { code: 'role', name: '角色词', description: '流程角色', sort_order: 30, active: 1 }
          ]) {
            const existing = state.termTypes.find(type => type.code === row.code);
            if (existing) Object.assign(existing, row);
            else state.termTypes.push(row);
          }
          return [{ affectedRows: 2 }, undefined];
        }
        const existing = state.termTypes.find(type => type.code === params[0]);
        const row = {
          code: params[0],
          name: params[1],
          description: params[2],
          sort_order: params[3],
          active: params[4] === undefined ? 1 : params[4]
        };
        if (existing) Object.assign(existing, row);
        else state.termTypes.push(row);
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM terminology_term_types') && normalizedSql.includes('WHERE code=?')) {
        return [[state.termTypes.find(type => type.code === params[0] && type.active) || null].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM terminology_term_types') && normalizedSql.includes('ORDER BY sort_order')) {
        return [state.termTypes.filter(type => type.active).sort((a, b) => a.sort_order - b.sort_order), undefined];
      }

      if (normalizedSql.includes('FROM process_mapping_records') && normalizedSql.includes('r.id=?')) {
        const processId = Number(params[0]);
        let rows = state.processes.filter(process => Number(process.id) === processId).map(publicProcess);
        if (normalizedSql.includes('AND (d.id=? OR r.dept_name=?')) {
          const departmentId = Number(params[1]);
          const departmentName = params[2];
          rows = rows.filter(row => Number(row.owner_dept_id || 0) === departmentId || row.dept_name === departmentName);
        }
        return [rows, undefined];
      }

      if (normalizedSql.includes('FROM process_mapping_records')) {
        let rows = state.processes.map(publicProcess);
        if (normalizedSql.includes('AND (d.id=? OR r.dept_name=?')) {
          const departmentId = Number(params[0]);
          const departmentName = params[1];
          rows = rows.filter(row => Number(row.owner_dept_id || 0) === departmentId || row.dept_name === departmentName);
        }
        return [rows, undefined];
      }

      if (normalizedSql.includes('INSERT INTO terminology_terms')) {
        const id = insertId();
        state.terms.push({
          id,
          term: params[0],
          term_type_code: params[1],
          definition: params[2],
          scope: params[3],
          forbidden: params[4],
          process_mapping_record_id: params[5],
          created_by: params[6],
          status: 'pending'
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM terminology_terms') && normalizedSql.includes('WHERE t.id=?')) {
        return [[state.terms.find(term => Number(term.id) === Number(params[0]))].filter(Boolean).map(publicTerm), undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM terminology_terms')) {
        const statusParam = normalizedSql.includes('t.status=?') ? params[0] : null;
        return [state.terms.filter(term => !statusParam || term.status === statusParam).map(publicTerm), undefined];
      }

      if (normalizedSql.startsWith('UPDATE terminology_terms SET term=')) {
        const id = Number(params[6]);
        const term = state.terms.find(item => Number(item.id) === id);
        if (term) {
          Object.assign(term, {
            term: params[0],
            term_type_code: params[1],
            definition: params[2],
            scope: params[3],
            forbidden: params[4],
            process_mapping_record_id: params[5]
          });
        }
        return [{ affectedRows: term ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE terminology_terms SET status=')) {
        const id = Number(params[2]);
        const term = state.terms.find(item => Number(item.id) === id);
        if (term) {
          term.status = params[0];
          term.approved_by = params[1];
        }
        return [{ affectedRows: term ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM terminology_terms')) {
        const before = state.terms.length;
        state.terms = state.terms.filter(term => Number(term.id) !== Number(params[0]));
        return [{ affectedRows: before - state.terms.length }, undefined];
      }

      throw new Error(`Unhandled SQL in fake terminology pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makeFakePool();
  const repo = makeTerminologyMysqlRepository(pool);
  await repo.initSchema();

  const types = await repo.listTermTypes();
  assert.ok(types.some(type => type.code === 'noun' && type.name === '名词'));
  assert.ok(types.some(type => type.code === 'role' && type.name === '角色词'));

  const deptProcesses = await repo.listProcesses({ canViewAll: false, departmentId: 9, departmentName: '经营发展部' });
  assert.deepStrictEqual(deptProcesses.map(row => row.id), [31]);

  const allProcesses = await repo.listProcesses({ canViewAll: true, departmentId: 9, departmentName: '经营发展部' });
  assert.deepStrictEqual(allProcesses.map(row => row.id), [31, 32]);

  assert.ok(await repo.getProcess(31, { canViewAll: false, departmentId: 9, departmentName: '经营发展部' }));
  assert.strictEqual(await repo.getProcess(32, { canViewAll: false, departmentId: 9, departmentName: '经营发展部' }), null);
  assert.strictEqual(await repo.processExists(32), true);

  const created = await repo.createTerm({
    term: '客户',
    term_type_code: 'noun',
    definition: '购买产品或服务的对象',
    scope: '集团',
    forbidden: '客商',
    process_id: 31
  }, 42);
  assert.ok(created.id);
  assert.strictEqual(created.term_type_name, '名词');
  assert.strictEqual(created.process_name, '客户主数据维护');

  const updated = await repo.updateTerm(created.id, {
    term: '客户',
    term_type_code: 'role',
    definition: '与集团发生业务关系的外部对象',
    scope: '主数据域',
    forbidden: '客户资料',
    process_id: 31
  });
  assert.strictEqual(updated.term_type_code, 'role');
  assert.strictEqual(updated.term_type_name, '角色词');

  const reviewed = await repo.reviewTerm(created.id, 'approve', 42);
  assert.strictEqual(reviewed.status, 'approved');
  assert.strictEqual(reviewed.approved_by, 42);

  const approved = await repo.listTerms({ status: 'approved', canViewAll: true });
  assert.strictEqual(approved.length, 1);
  assert.strictEqual(approved[0].definition, '与集团发生业务关系的外部对象');

  assert.strictEqual(await repo.deleteTerm(created.id), true);
  assert.strictEqual((await repo.listTerms({ canViewAll: true })).length, 0);

  const sqlText = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!/\bFROM\s+terms\b/i.test(sqlText), 'terminology repository must not query SQLite terms');
  assert.ok(!/\bINTO\s+terms\b/i.test(sqlText), 'terminology repository must not insert SQLite terms');
  assert.ok(!/\bUPDATE\s+terms\b/i.test(sqlText), 'terminology repository must not update SQLite terms');
  assert.ok(!sqlText.includes('sqlite_master'), 'terminology repository must not use SQLite catalog tables');
  assert.ok(!sqlText.includes('PRAGMA'), 'terminology repository must not use SQLite PRAGMA');
  assert.ok(!sqlText.includes('lastInsertRowid'), 'terminology repository must not use SQLite lastInsertRowid');

  console.log('Terminology MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
