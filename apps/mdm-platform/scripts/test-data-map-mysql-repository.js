const assert = require('assert');

const { makeDataMapMysqlRepository } = require('../server/dataMapMysqlRepository');

function makeFakePool() {
  const state = {
    statements: [],
    contexts: [],
    objects: [],
    fields: [],
    links: [],
    identities: [],
    terms: [
      { term: '客户编号', term_type_code: 'noun', preferred_term: '客户编码', forbidden_term: '客户编号', definition: '客户唯一编码', scope_type: 'field', severity: 'block', status: 'active' },
      { term: '客户姓名', term_type_code: 'noun', preferred_term: '客户名称', forbidden_term: '客户姓名', definition: '客户名称', scope_type: 'field', severity: 'warn', status: 'active' }
    ],
    namingRules: [
      { id: 1, rule_type: 'forbidden', match_value: '临时字段', replacement_value: '正式字段', severity: 'warn', status: 'active' }
    ],
    qualityIssues: [],
    changeSets: [],
    versionLogs: [],
    importBatches: [],
    nextId: 1
  };

  function insertId() {
    const id = state.nextId;
    state.nextId += 1;
    return id;
  }

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE')) return [[], undefined];

      if (normalizedSql.includes('INSERT INTO data_map_contexts')) {
        const id = insertId();
        state.contexts.push({
          id,
          context_key: params[0],
          context_type: params[1],
          title: params[2],
          dept_id: params[3],
          dept_name: params[4],
          owner_user_id: params[5],
          process_snapshot_id: params[6],
          process_mapping_record_id: params[7],
          process_node_key: params[8],
          a1_code: params[9],
          l3_name: params[10],
          source_file: params[11],
          source_anchor: params[12],
          source_excerpt: params[13],
          status: params[14],
          created_by: params[15],
          updated_by: params[15]
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM data_map_contexts') && normalizedSql.includes('WHERE id=?')) {
        const row = state.contexts.find(item => item.id === Number(params[0]));
        return [[row].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM data_map_contexts') && normalizedSql.includes('ORDER BY updated_at DESC')) {
        return [state.contexts.slice().sort((a, b) => b.id - a.id), undefined];
      }

      if (normalizedSql.startsWith('UPDATE data_map_contexts')) {
        const id = Number(params[15]);
        const context = state.contexts.find(item => item.id === id);
        if (context) {
          Object.assign(context, {
            context_key: params[0],
            context_type: params[1],
            title: params[2],
            dept_id: params[3],
            dept_name: params[4],
            owner_user_id: params[5],
            process_snapshot_id: params[6],
            process_mapping_record_id: params[7],
            process_node_key: params[8],
            a1_code: params[9],
            l3_name: params[10],
            source_file: params[11],
            source_anchor: params[12],
            source_excerpt: params[13],
            status: params[14],
            updated_by: params[15]
          });
        }
        return [{ affectedRows: context ? 1 : 0 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_objects')) {
        let object = state.objects.find(item => item.object_key === params[0]);
        if (!object) {
          object = {
            id: insertId(),
            object_key: params[0],
            object_name_cn: params[1],
            object_name_en: params[2],
            object_type: params[3],
            owner_dept_id: params[4],
            steward_user_id: params[5],
            description: params[6],
            status: params[7],
            source_type: params[8],
            source_ref: params[9],
            created_by: params[10]
          };
          state.objects.push(object);
        }
        return [{ insertId: object.id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM data_map_objects') && normalizedSql.includes('WHERE object_key=?')) {
        const object = state.objects.find(item => item.object_key === params[0]);
        return [[object].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM data_map_terms')) {
        return [state.terms.filter(item => item.status === 'active'), undefined];
      }

      if (normalizedSql.includes('FROM data_map_naming_rules')) {
        return [state.namingRules.filter(item => item.status === 'active'), undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_fields')) {
        const id = insertId();
        state.fields.push({
          id,
          context_id: params[0],
          object_id: params[1],
          field_key: params[2],
          field_name_cn: params[3],
          field_name_en: params[4],
          business_definition: params[5],
          data_type: params[6],
          data_format: params[7],
          length_precision: params[8],
          nullable: params[9],
          enum_values_json: params[10],
          sensitivity_level: params[11],
          master_data_level: params[12],
          process_governance_node_key: params[13],
          process_governance_a1_code: params[14],
          source_file: params[15],
          source_anchor: params[16],
          source_excerpt: params[17],
          status: params[18],
          quality_status: params[19],
          submitted_by: params[20]
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_field_system_links')) {
        state.links.push({
          id: insertId(),
          field_id: params[0],
          system_name: params[1],
          system_code: params[2],
          relation_type: params[3],
          sync_mode: params[4],
          interface_note: params[5],
          is_primary: params[6],
          status: params[7]
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_quality_issues')) {
        state.qualityIssues.push({
          id: insertId(),
          field_id: params[0],
          context_id: params[1],
          issue_type: params[2],
          severity: params[3],
          message: params[4],
          suggestion: params[5],
          status: params[6],
          created_by: params[7]
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM data_map_fields f') && normalizedSql.includes('WHERE f.context_id=?')) {
        const rows = state.fields
          .filter(field => field.context_id === Number(params[0]))
          .map(field => {
            const object = state.objects.find(item => item.id === field.object_id);
            return {
              ...field,
              data_object: object ? object.object_name_cn : null,
              object_key: object ? object.object_key : null,
              mapping_id: field.context_id
            };
          });
        return [rows, undefined];
      }

      if (normalizedSql.includes('FROM data_map_fields f') && normalizedSql.includes('WHERE f.id=?')) {
        const field = state.fields.find(item => item.id === Number(params[0]));
        if (!field) return [[], undefined];
        const object = state.objects.find(item => item.id === field.object_id);
        return [[{ ...field, data_object: object ? object.object_name_cn : null, mapping_id: field.context_id }], undefined];
      }

      if (normalizedSql.includes('FROM data_map_field_system_links') && normalizedSql.includes('WHERE field_id IN')) {
        const ids = new Set(params.map(Number));
        return [state.links.filter(link => ids.has(link.field_id)), undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM data_map_field_system_links')) {
        state.links = state.links.filter(link => link.field_id !== Number(params[0]));
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE data_map_fields')) {
        const id = Number(params[20]);
        const field = state.fields.find(item => item.id === id);
        if (field) {
          Object.assign(field, {
            object_id: params[0],
            field_key: params[1],
            field_name_cn: params[2],
            field_name_en: params[3],
            business_definition: params[4],
            data_type: params[5],
            data_format: params[6],
            length_precision: params[7],
            nullable: params[8],
            enum_values_json: params[9],
            sensitivity_level: params[10],
            master_data_level: params[11],
            process_governance_node_key: params[12],
            process_governance_a1_code: params[13],
            source_file: params[14],
            source_anchor: params[15],
            source_excerpt: params[16],
            status: params[17],
            quality_status: params[18],
            reviewed_by: params[19]
          });
        }
        return [{ affectedRows: field ? 1 : 0 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_change_sets')) {
        const id = insertId();
        state.changeSets.push({ id, entity_type: params[0], entity_id: params[1], operated_by: params[2], description: params[3] });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_version_log')) {
        state.versionLogs.push({
          id: insertId(),
          entity_type: params[0],
          entity_id: params[1],
          field_name: params[2],
          old_value: params[3],
          new_value: params[4],
          operation: params[5],
          operated_by: params[6],
          change_set_id: params[7]
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM data_map_fields')) {
        const before = state.fields.length;
        state.fields = state.fields.filter(field => field.id !== Number(params[0]));
        state.links = state.links.filter(link => link.field_id !== Number(params[0]));
        return [{ affectedRows: before - state.fields.length }, undefined];
      }

      if (normalizedSql.includes('FROM data_map_field_identities') && normalizedSql.includes('WHERE field_id=?')) {
        const identity = state.identities.find(item => item.field_id === Number(params[0]));
        return [[identity].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_field_identities')) {
        let identity = state.identities.find(item => item.field_id === Number(params[0]));
        if (!identity) {
          identity = { id: insertId(), field_id: Number(params[0]) };
          state.identities.push(identity);
        }
        Object.assign(identity, {
          field_id: Number(params[0]),
          authoritative_system_name: params[1],
          authoritative_system_code: params[2],
          maintain_dept_id: params[3],
          owner_user_id: params[4],
          confidence_level: params[5],
          confirmed: params[6],
          note: params[7],
          status: params[8]
        });
        return [{ insertId: identity.id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE data_map_field_identities SET authoritative_system_name=')) {
        const identity = state.identities.find(item => item.field_id === Number(params[4]));
        if (identity) {
          identity.authoritative_system_name = params[0];
          identity.authoritative_system_code = params[1];
          identity.confirmed = 1;
          identity.confirmed_by = params[2];
          identity.status = params[3];
        }
        return [{ affectedRows: identity ? 1 : 0 }, undefined];
      }

      if (normalizedSql.includes('COUNT(*) AS total') && normalizedSql.includes('FROM data_map_field_identities')) {
        return [[{
          total: state.identities.length,
          confirmed: state.identities.filter(identity => identity.confirmed).length
        }], undefined];
      }

      if (normalizedSql.includes('GROUP BY o.object_name_cn')) {
        const byObject = new Map();
        for (const identity of state.identities) {
          const field = state.fields.find(item => item.id === identity.field_id);
          const object = field ? state.objects.find(item => item.id === field.object_id) : null;
          const key = object ? object.object_name_cn : '未归类';
          const current = byObject.get(key) || { domain: key, total: 0, confirmed: 0 };
          current.total += 1;
          if (identity.confirmed) current.confirmed += 1;
          byObject.set(key, current);
        }
        return [[...byObject.values()], undefined];
      }

      if (normalizedSql.includes('INSERT INTO data_map_import_batches')) {
        const id = insertId();
        state.importBatches.push({ id, source_type: params[0], file_name: params[1], context_id: params[2], imported_by: params[3], row_count: params[4], status: params[5], note: params[6] });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      throw new Error(`Unhandled SQL in fake Data Map pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makeFakePool();
  const repo = makeDataMapMysqlRepository(pool);
  await repo.initSchema();

  const context = await repo.createContext({
    context_key: 'ctx-customer-maintenance',
    context_type: 'process',
    title: '客户主数据维护',
    dept_id: 9,
    dept_name: '经营发展部',
    owner_user_id: 42,
    l3_name: '客户资料维护',
    a1_code: 'A1-001',
    source_file: '客户管理程序.docx',
    source_anchor: 'P7',
    created_by: 42
  });
  assert.strictEqual(context.mapping_id, context.id);
  assert.strictEqual((await repo.listContexts())[0].title, '客户主数据维护');

  const blocked = await repo.validateFieldName('客户编号');
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.issues[0].severity, 'block');

  const created = await repo.createField({
    context_id: context.id,
    data_object: '客户',
    field_name_cn: '客户姓名',
    field_name_en: 'customer_name',
    business_definition: '客户展示名称',
    field_type: '文本',
    consume_systems: ['CRM', 'ERP'],
    sync_mode: '实时',
    note: '来自客户主数据维护',
    submitted_by: 42
  }, 42);
  assert.strictEqual(created.mapping_id, context.id);
  assert.strictEqual(created.context_id, context.id);
  assert.strictEqual(created.data_object, '客户');
  assert.ok(pool.state.qualityIssues.some(issue => issue.severity === 'warn'), 'warn naming rules should create quality issue');

  const fields = await repo.getFieldsByContext(context.id);
  assert.strictEqual(fields.length, 1);
  assert.strictEqual(fields[0].consume_systems, JSON.stringify(['CRM', 'ERP']));

  await repo.updateField(created.id, {
    ...created,
    field_name_cn: '客户名称',
    data_object: '客户',
    field_type: '文本',
    consume_systems: ['CRM'],
    sync_mode: '批量'
  }, 43);
  assert.ok(pool.state.versionLogs.some(row => row.field_name === 'field_name_cn'), 'field updates should be audited');

  const identity = await repo.upsertFieldIdentity(created.id, {
    authoritative_system: 'CRM',
    authoritative_system_code: 'CRM',
    maintain_dept_id: 9,
    owner_user_id: 42,
    confidence_level: 'high',
    confirmed: false,
    note: '候选黄金源'
  });
  assert.strictEqual(identity.authoritative_system, 'CRM');
  assert.strictEqual(identity.confirmed, 0);

  const confirmed = await repo.confirmFieldIdentity(created.id, { authoritative_system: 'CRM', authoritative_system_code: 'CRM' }, 42);
  assert.strictEqual(confirmed.confirmed, 1);
  assert.strictEqual(confirmed.confirmed_by, 42);

  const progress = await repo.fieldIdentityProgress();
  assert.deepStrictEqual(progress.overall, { total: 1, confirmed: 1, pct: 100 });
  assert.strictEqual(progress.by_domain[0].domain, '客户');

  await repo.recordImportBatch({
    source_type: 'excel',
    file_name: 'fields.xlsx',
    context_id: context.id,
    imported_by: 42,
    row_count: 1,
    status: 'imported',
    note: '字段台账导入'
  });
  assert.strictEqual(pool.state.importBatches.length, 1);

  await repo.deleteField(created.id, 42);
  assert.strictEqual((await repo.getFieldsByContext(context.id)).length, 0);

  const sqlText = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!/\bFROM\s+field_entries\b/i.test(sqlText) && !/\bINTO\s+field_entries\b/i.test(sqlText), 'Data Map repository must not query SQLite field_entries');
  assert.ok(!/\bFROM\s+field_identities\b/i.test(sqlText) && !/\bINTO\s+field_identities\b/i.test(sqlText), 'Data Map repository must not query SQLite field_identities');
  assert.ok(!sqlText.includes(' sqlite_master'), 'Data Map repository must not use SQLite catalog tables');
  assert.ok(!sqlText.includes('PRAGMA'), 'Data Map repository must not use SQLite PRAGMA');
  assert.ok(!sqlText.includes('lastInsertRowid'), 'Data Map repository must not use SQLite lastInsertRowid');

  console.log('Data Map MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
