const { checkRuntimeSchema } = require('./mysqlRuntimeSchema');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { createRegisteredPool } = require('./mysqlPoolRegistry');
const {identityInteger,sameIdentityInteger:same}=require('./sessionSubject');
const recheck=require('./legacyConflictRecheck');
const {timestampColumns,timeRow}=require('./governanceTimeProjection');

let conflictRepoPromise = null;
let conflictRepositoryFactory = null;

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

async function first(pool, sql, params = []) {
  const result = await rows(pool, sql, params);
  return result[0] || null;
}

function insertId(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.insertId || 0);
}

function affectedRows(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.affectedRows || 0);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function conflictDomainSchemaStatements() {
  const allowed = [
    'schema_migrations',
    'departments',
    'users',
    'process_governance_snapshots',
    'process_mapping_records',
    'terminology_term_types',
    'terminology_terms',
    'data_map_objects',
    'data_map_contexts',
    'data_map_fields',
    'data_map_field_system_links',
    'data_map_field_identities',
    'mdm_field_conflicts',
    'mdm_term_conflicts',
    'mdm_conflict_assignments',
    'mdm_conflict_coordination_history',
    'mdm_todos',
    'mdm_todo_events'
  ];
  return splitSqlStatements(mdmMysqlSchemaSql()).filter(statement => {
    const normalized = statement.replace(/\s+/g, ' ');
    return allowed.some(table => normalized.includes(`CREATE TABLE IF NOT EXISTS ${table} `));
  });
}

function addWorkingDays(startDate, days) {
  const d = new Date(startDate);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added += 1;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function conflictTimeRow(row){const value=timeRow(row);if(value&&Object.hasOwn(value,'resolved_at_epoch'))value.resolved_at=value.resolved_at_epoch==null?null:new Date(Number(value.resolved_at_epoch)*1000).toISOString();return value;}
function publicFieldConflict(row) {
  if (!row) return null;
  row=conflictTimeRow(row);
  return {
    ...row,
    id: identityInteger(row.id),
    conflict_type: 'field',
    field_entry_a_id: identityInteger(row.field_id_a ?? row.field_entry_a_id),
    field_entry_b_id: identityInteger(row.field_id_b ?? row.field_entry_b_id),
    field_id_a: identityInteger(row.field_id_a ?? row.field_entry_a_id),
    field_id_b: identityInteger(row.field_id_b ?? row.field_entry_b_id),
    dept_a: identityInteger(row.dept_a),
    dept_b: identityInteger(row.dept_b),
    escalated: row.escalated ? 1 : 0
  };
}

function publicTermConflict(row) {
  if (!row) return null;
  row=conflictTimeRow(row);
  return {
    ...row,
    id: identityInteger(row.id),
    conflict_type: 'term',
    dept_a: identityInteger(row.dept_a),
    dept_b: identityInteger(row.dept_b),
    escalated: row.escalated ? 1 : 0
  };
}

function resultError(statusCode, error) {
  return { ok: false, statusCode, error };
}

function filterClause(alias, conflictType, filters = {}, scope = {}) {
  const params = [];
  const table = alias || 'c';
  const conditions = ['1=1'];
  if (filters.severity) {
    conditions.push(`${table}.severity=?`);
    params.push(filters.severity);
  }
  if (filters.status) {
    conditions.push(`${table}.status=?`);
    params.push(filters.status);
  } else if (!scope.canViewAll) {
    conditions.push(`${table}.status NOT IN ('archived','silenced')`);
  }
  const mode = scope.mode || (scope.canViewAll ? 'global' : 'none');
  if(mode==='combined'){
    const clauses=(scope.modes||[]).filter(value=>['department','assigned','escalated'].includes(value)).map(mode=>{const part=filterClause(alias,conflictType,{status:filters.status},{...scope,mode,modes:[]});params.push(...part.params);return '('+part.sql+')';});
    conditions.push(clauses.length?'('+clauses.join(' OR ')+')':'1=0');
  } else if (mode === 'department') {
    conditions.push(`(${table}.dept_a=CAST(? AS SIGNED) OR ${table}.dept_b=CAST(? AS SIGNED))`);
    params.push(String(identityInteger(scope.departmentId)||0), String(identityInteger(scope.departmentId)||0));
  } else if (mode === 'assigned') {
    conditions.push(`EXISTS (
      SELECT 1
      FROM mdm_conflict_assignments assignment_scope
      WHERE assignment_scope.conflict_id=${table}.id
        AND assignment_scope.conflict_type=?
        AND assignment_scope.id=(
          SELECT MAX(latest_assignment.id)
          FROM mdm_conflict_assignments latest_assignment
          WHERE latest_assignment.conflict_id=${table}.id
            AND latest_assignment.conflict_type=?
        )
        AND assignment_scope.assignee_person_id=CAST(? AS SIGNED)
    )`);
    params.push(conflictType, conflictType, String(identityInteger(scope.userId)||0));
  } else if (mode === 'escalated') {
    conditions.push(`(${table}.status='escalated' OR ${table}.escalated=1)`);
  } else if (mode !== 'global') {
    conditions.push('1=0');
  }
  return { sql: conditions.join(' AND '), params };
}

function conflictValueFromPair(pair = {}) {
  if (pair.conflict_field) {
    return {
      conflictField: pair.conflict_field,
      valueA: pair.value_a,
      valueB: pair.value_b,
      severity: pair.severity || 'warn'
    };
  }
  if (pair.authoritative_a && pair.authoritative_b && pair.authoritative_a !== pair.authoritative_b) {
    return {
      conflictField: 'authoritative_system',
      valueA: pair.authoritative_a,
      valueB: pair.authoritative_b,
      severity: 'error'
    };
  }
  if ((pair.definition_a || '') !== (pair.definition_b || '')) {
    return {
      conflictField: 'business_definition',
      valueA: pair.definition_a || '',
      valueB: pair.definition_b || '',
      severity: 'warn'
    };
  }
  if ((pair.data_type_a || '') !== (pair.data_type_b || '')) {
    return {
      conflictField: 'data_type',
      valueA: pair.data_type_a || '',
      valueB: pair.data_type_b || '',
      severity: 'warn'
    };
  }
  return null;
}

function personIdFromPayload(payload = {}, fallback = null) {
  return payload.actor_person_id || payload.actorPersonId || payload.person_id || payload.personId || fallback || null;
}

function assigneePersonIdFromPayload(payload = {}) {
  return payload.assignee_person_id || payload.assigneePersonId || payload.assignee_user_id || payload.assigneeUserId || null;
}
const casts=(alias,fields)=>fields.map(field=>`CAST(${alias}.${field} AS CHAR) AS ${field}`).join(', ');
const fieldCasts=alias=>casts(alias,['id','field_id_a','field_id_b','submitter_a','submitter_b','dept_a','dept_b','resolved_by']);
const termCasts=alias=>casts(alias,['id','term_a_id','term_b_id','dept_a','dept_b','resolved_by']);

function makeConflictMysqlRepository(pool) {
  const writes = require('./legacyGovernanceWrites');
  async function mutate(action, conflictId, conflictType, payload) {
    const session = payload.actor_session;
    // Legacy pages cannot supply their original snapshot. Capture the server's
    // admission read so the wait-for-lock window still cannot overwrite a winner.
    const admitted = await makeConflictMysqlRepository(pool).getConflict(conflictId, conflictType, {canViewAll:true});
    if (!admitted) throw writes.fail(404,'LEGACY_CONFLICT_MISSING','冲突不存在');
    const expected = payload.expected_token === undefined ? admitted.write_token : payload.expected_token;
    return await writes.transaction(pool, async db => {
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      const [[root]] = await db.execute(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`,[conflictId]);
      if (!root) throw writes.fail(404,'LEGACY_CONFLICT_MISSING','冲突不存在');
      const repo = makeConflictMysqlRepository(db);
      const before = await repo.getConflict(conflictId,conflictType,{canViewAll:true});
      const workflowAction=['finalDecideConflict','departmentRecheck','reopenConflict'].includes(action);
      if(!workflowAction)writes.compareToken(expected,before.write_token);
      const permission = {assignConflict:'governance:assign-work',reassignConflict:'governance:assign-work',submitCoordination:'governance:handle-assigned-conflict',
        finalDecideConflict:before.status==='escalated'||before.escalated?'governance:decide-escalation':'governance:handle-assigned-conflict',
        departmentRecheck:'governance:record-department-decision',escalateConflict:'governance:escalate-conflict',reopenConflict:'governance:assign-work',archiveConflict:'governance:structure-gate'}[action];
      if (!session && action !== 'escalateConflict') throw writes.fail(403,'LEGACY_WRITE_FORBIDDEN','缺少人员写入身份');
      // The existing overdue-escalation script is an internal caller, not an HTTP
      // identity. Keep its null actor and rule; serialize it against human decisions.
      const current = session ? await writes.actor(db,session,permission) : {person_id:null,current_department_id:null,effects:new Map()};
      const actorId = identityInteger(current.person_id),assignedId=identityInteger(before.currentAssignee?.assignee_person_id);
      if(workflowAction)return recheck.perform(db,before,session,current,action,payload.request_body||{});
      if (session && (action==='submitCoordination' || (action==='escalateConflict' && current.effects.get('governance:assign-work')!=='allow')) && !same(actorId,assignedId)) throw writes.fail(403,'LEGACY_WRITE_FORBIDDEN','只能处理本人当前被分派的冲突');
      const workflow=await recheck.project(db,before,{session,who:session?current:null,lock:true});
      const uiAction={assignConflict:'assign',reassignConflict:'reassign',submitCoordination:'coordination',escalateConflict:'escalate',archiveConflict:'archive'}[action];
      if(session&&!workflow.allowed_actions.includes(uiAction)&&!(action==='assignConflict'&&workflow.allowed_actions.includes('reassign')))throw writes.fail(409,'LEGACY_WRITE_CONFLICT','当前冲突正在等待部门本人重核或状态已变化，请刷新核对');
      if(!session&&workflow.workflow_state==='awaiting_department_recheck')throw writes.fail(409,'LEGACY_WRITE_CONFLICT','当前冲突正在等待部门本人重核，不能自动改变办理阶段');
      let assigneeDept = payload.assignee_dept_id;
      if (['assignConflict','reassignConflict'].includes(action)) {
        const assigneeId = assigneePersonIdFromPayload(payload);
        const [[account]] = await db.execute('SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=CAST(? AS SIGNED) FOR SHARE',[String(assigneeId)]);
        if (!account) throw writes.fail(422,'LEGACY_ASSIGNEE_INVALID','只能分派给当前有效的数据冲突处理人');
        let assignee;
        try {assignee = await require('./processV7Authoring').activeActor(db,{personId:assigneeId,accountId:account.account_id,authVersion:account.auth_version});}
        catch(error) {if(error.statusCode===401) throw writes.fail(422,'LEGACY_ASSIGNEE_INVALID','所选冲突处理人当前无效');throw error;}
        if (assignee.admin || !assignee.grants.some(g=>g.role_code==='data_conflict_handler' && (g.scope_type==='global'||same(g.scope_department_id,assignee.current_department_id)))) throw writes.fail(422,'LEGACY_ASSIGNEE_INVALID','只能分派给当前有效的数据冲突处理人');
        assigneeDept = assignee.current_department_id;
      }
      const result = await repo[action](conflictId,conflictType,{...payload,actor_session:undefined,actor_person_id:session ? String(actorId) : payload.actor_person_id || null,actor_user_id:session?.userId || payload.actor_user_id || null,
        actor_dept_id:current.current_department_id,assignee_dept_id:assigneeDept,canManageAll:false,requireAssignment:action==='finalDecideConflict' && before.status!=='escalated'});
      if (result?.ok===false) throw writes.fail(result.statusCode,'LEGACY_WRITE_CONFLICT',result.error);
      const after = await repo.getConflict(conflictId,conflictType,{canViewAll:true});
      const auditActor=session?await first(db,'SELECT person_name FROM person WHERE person_id=CAST(? AS SIGNED)',[String(actorId)]):null;
      await db.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by,operated_by_person_id,metadata_json)
        VALUES(?,CAST(? AS SIGNED),?,CAST(? AS SIGNED),CAST(? AS SIGNED),?)`,['conflict_'+conflictType,String(conflictId),action,
        session?String(actorId):payload.actor_user_id||null,session?String(actorId):payload.actor_person_id||null,
        JSON.stringify({schema_version:'legacy-governance-write-v1',...(session?{actor_snapshot:{person_id:String(actorId),person_name:auditActor?.person_name||null}}:{}),before,after})]);
      return result;
    });
  }
  async function insertTodo(payload = {}, actorUserId = null) {
    const actorPersonId = personIdFromPayload(payload, actorUserId);
    const result = await pool.execute(
      `INSERT INTO mdm_todos
        (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date, urgency, created_by, created_by_person_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.from_dept_id || null,
        payload.to_dept_id || null,
        payload.type || 'conflict_resolution',
        payload.related_mapping_id || null,
        payload.related_field_id || null,
        payload.content || null,
        payload.due_date || null,
        payload.urgency || 'high',
        actorUserId || null,
        actorPersonId
      ]
    );
    const todoId = insertId(result);
    await pool.execute(
      `INSERT INTO mdm_todo_events (todo_id, event_type, actor_user_id, actor_person_id, note)
       VALUES (?, 'created', ?, ?, ?)`,
      [todoId, actorUserId || null, actorPersonId, payload.content || null]
    );
    return todoId;
  }

  async function getBaseConflict(conflictId, conflictType) {
    if (conflictType === 'term') {
      return publicTermConflict(await first(
        pool,
        `SELECT tc.*, ${termCasts('tc')}, ${timestampColumns('tc',['created_at','updated_at'])}, UNIX_TIMESTAMP(tc.resolved_at) AS resolved_at_epoch, 'term' AS conflict_type,
                da.name AS dept_a_name, db.name AS dept_b_name
         FROM mdm_term_conflicts tc
         LEFT JOIN departments da ON da.id=tc.dept_a
         LEFT JOIN departments db ON db.id=tc.dept_b
         WHERE tc.id=?
         LIMIT 1`,
        [conflictId]
      ));
    }
    const value=publicFieldConflict(await first(
      pool,
        `SELECT fc.*, ${fieldCasts('fc')}, ${timestampColumns('fc',['created_at','updated_at'])}, UNIX_TIMESTAMP(fc.resolved_at) AS resolved_at_epoch, fc.field_id_a AS field_entry_a_id, fc.field_id_b AS field_entry_b_id,
              'field' AS conflict_type,
              NULL AS field_name_a,
              NULL AS field_name_b,
              da.name AS dept_a_name,
              db.name AS dept_b_name
       FROM mdm_field_conflicts fc
       LEFT JOIN departments da ON fc.dept_a = da.id
       LEFT JOIN departments db ON fc.dept_b = db.id
       WHERE fc.id=?
       LIMIT 1`,
      [conflictId]
    ));
    return value?{...value,...await require('./dataMapHandoffCompatibility').relatedHistoryContext(pool,'field_conflict',value.id)}:null;
  }

  async function conflictAssignments(conflictId, conflictType) {
    return (await rows(
      pool,
      `SELECT ca.*, ${casts('ca',['id','conflict_id','assignee_user_id','assignee_person_id','assigned_by','assigned_by_person_id'])}, ${timestampColumns('ca',['created_at','updated_at'])}, p.person_name AS assignee_name, ap.person_name AS assigned_by_name
       FROM mdm_conflict_assignments ca
       LEFT JOIN person p ON p.person_id = ca.assignee_person_id
       LEFT JOIN person ap ON ap.person_id = ca.assigned_by_person_id
       WHERE ca.conflict_id=? AND ca.conflict_type=?
       ORDER BY ca.created_at DESC, ca.id DESC`,
      [conflictId, conflictType]
    )).map(timeRow);
  }

  async function coordinationHistory(conflictId, conflictType) {
    return (await rows(
      pool,
      `SELECT cch.*, ${casts('cch',['id','conflict_id','assignee_user_id','assignee_person_id'])}, ${timestampColumns('cch',['created_at'])}, p.person_name AS assignee_name
       FROM mdm_conflict_coordination_history cch
       LEFT JOIN person p ON p.person_id = cch.assignee_person_id
       WHERE cch.conflict_id=? AND cch.conflict_type=?
       ORDER BY cch.created_at DESC, cch.id DESC`,
      [conflictId, conflictType]
    )).map(timeRow);
  }

  async function createConflictTodoForDepartments(conflict, conflictType, actorUserId = null) {
    const deadline = conflict.deadline || addWorkingDays(new Date().toISOString().slice(0, 10), 3);
    const title = conflictType === 'term'
      ? `Term conflict: ${conflict.term || conflict.id}`
      : `Field conflict #${conflict.id}`;
    for (const deptId of [conflict.dept_a, conflict.dept_b].filter(Boolean)) {
      await insertTodo({
        from_dept_id: null,
        to_dept_id: deptId,
        type: 'conflict_resolution',
        content: `${title} coordination due ${deadline}`,
        due_date: deadline,
        urgency: 'high'
      }, actorUserId);
    }
  }

  async function conflictExists(pair, conflictField) {
    return Boolean(await first(
      pool,
      `SELECT id
       FROM mdm_field_conflicts
       WHERE field_id_a=? AND field_id_b=? AND conflict_field=? AND status IN ('pending','coordinating','silenced')
       LIMIT 1`,
      [pair.a_id, pair.b_id, conflictField]
    ));
  }

  async function termConflictExists(term, meaningA, meaningB) {
    return Boolean(await first(
      pool,
      `SELECT id
       FROM mdm_term_conflicts
       WHERE term=? AND dept_a_meaning=? AND dept_b_meaning=? AND status IN ('pending','coordinating','silenced')
       LIMIT 1`,
      [term, meaningA || null, meaningB || null]
    ));
  }

  return {
    async initSchema() {
      for (const statement of conflictDomainSchemaStatements()) {
        await pool.execute(statement);
      }
    },

    async listConflicts(filters = {}, scope = {}) {
      const type = filters.type || '';
      if (type === 'field') {
        const fieldFilter = filterClause('fc', 'field', filters, scope);
        const values=(await rows(
          pool,
          `SELECT fc.*, ${fieldCasts('fc')}, ${timestampColumns('fc',['created_at','updated_at'])}, UNIX_TIMESTAMP(fc.resolved_at) AS resolved_at_epoch, fc.field_id_a AS field_entry_a_id, fc.field_id_b AS field_entry_b_id,
                  'field' AS conflict_type,
                  NULL AS field_name_a,
                  NULL AS field_name_b
           FROM mdm_field_conflicts fc
                   WHERE ${fieldFilter.sql}
           ORDER BY CASE fc.severity WHEN 'blocking' THEN 0 WHEN 'error' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'warn' THEN 4 ELSE 5 END,
                    fc.created_at DESC, fc.id DESC`,
          fieldFilter.params
        )).map(publicFieldConflict);
        if(scope.actor_session)return (await Promise.all(values.map(value=>this.getConflict(value.id,'field',scope)))).filter(Boolean);
        return Promise.all(values.map(async value=>({...value,...await require('./dataMapHandoffCompatibility').relatedHistoryContext(pool,'field_conflict',value.id)})));
      }
      if (type === 'term') {
        const termFilter = filterClause('tc', 'term', filters, scope);
        const values=(await rows(
          pool,
          `SELECT tc.*, ${termCasts('tc')}, ${timestampColumns('tc',['created_at','updated_at'])}, UNIX_TIMESTAMP(tc.resolved_at) AS resolved_at_epoch, 'term' AS conflict_type,
                  da.name AS dept_a_name, db.name AS dept_b_name
           FROM mdm_term_conflicts tc
           LEFT JOIN departments da ON da.id=tc.dept_a
           LEFT JOIN departments db ON db.id=tc.dept_b
           WHERE ${termFilter.sql}
           ORDER BY CASE tc.severity WHEN 'blocking' THEN 0 WHEN 'error' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'warn' THEN 4 ELSE 5 END,
                    tc.created_at DESC, tc.id DESC`,
          termFilter.params
        )).map(publicTermConflict);
        return scope.actor_session?(await Promise.all(values.map(value=>this.getConflict(value.id,'term',scope)))).filter(Boolean):values;
      }
      const fieldRows = await this.listConflicts({ ...filters, type: 'field' }, scope);
      const termRows = await this.listConflicts({ ...filters, type: 'term' }, scope);
      return [...fieldRows, ...termRows].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    },

    async conflictStats(scope = {}) {
      const conflicts = await this.listConflicts({}, scope);
      const byStatus = {};
      for (const conflict of conflicts) {
        byStatus[conflict.status] = (byStatus[conflict.status] || 0) + 1;
      }
      const thisMonth = new Date().toISOString().slice(0, 7);
      const resolvedThisMonth = conflicts.filter(row => row.status === 'resolved' && String(row.resolved_at || '').startsWith(thisMonth)).length;
      return {
        coordinating: byStatus.coordinating || 0,
        escalated: byStatus.escalated || 0,
        silenced: byStatus.silenced || 0,
        resolved: byStatus.resolved || 0,
        resolvedThisMonth,
        byStatus
      };
    },

    async getConflict(conflictId, conflictType = 'field', scope = {}) {
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return null;
      if (!scope.canViewAll && !scope.status && ['archived', 'silenced'].includes(conflict.status)) return null;
      const assignments = await conflictAssignments(conflictId, conflictType);
      const mode = scope.mode || (scope.canViewAll ? 'global' : 'none');
      const allows=value=>value==='global'||value==='department'&&[conflict.dept_a,conflict.dept_b].some(id=>same(id,scope.departmentId))||
        value==='assigned'&&same(assignments[0]?.assignee_person_id,scope.userId)||value==='escalated'&&(conflict.status==='escalated'||Boolean(conflict.escalated));
      if(!(mode==='combined'?(scope.modes||[]).some(allows):allows(mode)))return null;
      const history = await coordinationHistory(conflictId, conflictType);
      const revision = await first(pool,"SELECT CAST(COALESCE(MAX(id),0) AS CHAR) AS revision FROM mdm_version_log WHERE entity_type=? AND entity_id=?",['conflict_'+conflictType,conflictId]);
      const submitted = new Set(history.map(row => identityInteger(row.assignee_person_id)).filter(Boolean).map(String));
      const assigned = new Set(assignments.map(row => identityInteger(row.assignee_person_id)).filter(Boolean).map(String));
      const detail = {
        ...conflict,
        currentAssignee: assignments[0] || null,
        coordinationHistory: history,
        assignmentHistory: assignments,
        sideA: null,
        sideB: null,
        bothSubmitted: assigned.size > 0 && Array.from(assigned).every(id => submitted.has(id)),
        deadline: conflict.deadline || null,
        resolution_type: conflict.resolution_type || null,
        write_revision: revision?.revision || '0'
      };
      const {write_revision,...visible}=detail;
      const workflow=scope.actor_session||typeof pool.getConnection==='function'?recheck.publicProjection(await recheck.project(pool,detail,{session:scope.actor_session})):{};
      const names=scope.actor_session||typeof pool.getConnection==='function'?await recheck.historicalNames(pool,detail,assignments,history):{};
      return {...visible,...workflow,...names,resolved_by_name:workflow.workflow_state==='resolved'?workflow.workflow_history.at(-1)?.actor_snapshot?.person_name||null:null,write_token:writes.conflictToken(detail)};
    },

    async detectConflicts(filters = {}, actor = {}) {
      if(actor.actor_session||typeof pool.getConnection==='function')return writes.transaction(pool,async db=>{
        const current=await writes.actor(db,actor.actor_session,null);
        if(!['governance:quality-audit','governance:structure-gate'].some(code=>current.effects.get(code)==='allow'))throw writes.fail(403,'LEGACY_WRITE_FORBIDDEN','当前身份无冲突检查权限');
        return makeConflictMysqlRepository(db).detectConflicts(filters,{...actor,actor_session:undefined});
      });
      let detected = 0;
      // Semantic similarity is a suggestion in the unified dictionary. Existing
      // conflict records remain actionable, but detection never creates new term
      // conflicts or todos from approximate wording after this explicit cutover.
      const termGovernanceEnabled = require('./terminologyGovernanceCompatibility').enabled();
      const termRows = termGovernanceEnabled ? [] : await rows(
        pool,
        `SELECT t.id, t.term, t.definition, t.scope, t.process_mapping_record_id,
                d.id AS process_owner_dept_id
         FROM terminology_terms t
         LEFT JOIN process_mapping_records r ON r.id = t.process_mapping_record_id
         LEFT JOIN departments d ON d.name = r.dept_name
         WHERE t.status='approved'`
      );
      for (let i = 0; i < termRows.length; i += 1) {
        for (let j = i + 1; j < termRows.length; j += 1) {
          const a = termRows[i];
          const b = termRows[j];
          const sameOrSimilar = a.term === b.term || (String(a.term || '').includes(String(b.term || '')) && String(a.term || '').length - String(b.term || '').length < 3);
          if (!sameOrSimilar) continue;
          if ((a.definition || '') === (b.definition || '') && (a.scope || '') === (b.scope || '')) continue;
          if (await termConflictExists(a.term, a.definition || null, b.definition || null)) continue;
          const severity = a.term === b.term && (a.definition || '') !== (b.definition || '') ? 'error' : 'warn';
          const status = severity === 'warn' ? 'silenced' : 'coordinating';
          const result = await pool.execute(
            `INSERT INTO mdm_term_conflicts
              (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status, resolution_type, term_a_id, term_b_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              a.term,
              a.process_owner_dept_id || null,
              a.definition || null,
              b.process_owner_dept_id || null,
              b.definition || null,
              severity,
              status,
              severity === 'warn' ? 'auto_silenced' : null,
              a.id,
              b.id
            ]
          );
          detected += 1;
          if (severity === 'error') {
            await createConflictTodoForDepartments({
              id: insertId(result),
              term: a.term,
              dept_a: a.process_owner_dept_id || null,
              dept_b: b.process_owner_dept_id || null
            }, 'term', actor.actor_user_id || null);
          }
        }
      }

      const fieldName = nullableText(filters.field_name_cn);
      const params = [];
      const where = [];
      if (fieldName) {
        where.push('a.field_name_cn=?');
        params.push(fieldName);
      }
      const fieldPairs = await rows(
        pool,
        `SELECT a.id AS a_id,
                b.id AS b_id,
                a.field_name_cn,
                a.field_name_en,
                a.business_definition AS definition_a,
                b.business_definition AS definition_b,
                a.data_type AS data_type_a,
                b.data_type AS data_type_b,
                ia.authoritative_system_name AS authoritative_a,
                ib.authoritative_system_name AS authoritative_b,
                a.submitted_by AS submitter_a,
                b.submitted_by AS submitter_b,
                ca.dept_id AS dept_a,
                cb.dept_id AS dept_b
         FROM data_map_fields a
         JOIN data_map_fields b
           ON a.id < b.id
          AND COALESCE(a.field_name_cn, '') = COALESCE(b.field_name_cn, '')
          AND COALESCE(a.field_name_en, '') = COALESCE(b.field_name_en, '')
         JOIN data_map_contexts ca ON ca.id = a.context_id
         JOIN data_map_contexts cb ON cb.id = b.context_id
         LEFT JOIN data_map_field_identities ia ON ia.field_id = a.id
         LEFT JOIN data_map_field_identities ib ON ib.field_id = b.id
         WHERE ca.id <> cb.id
           AND COALESCE(ca.dept_id, 0) <> COALESCE(cb.dept_id, 0)
           ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
        params
      );
      for (const pair of fieldPairs) {
        const conflictValue = conflictValueFromPair(pair);
        if (!conflictValue || conflictValue.valueA === conflictValue.valueB) continue;
        if (await conflictExists(pair, conflictValue.conflictField)) continue;
        const status = conflictValue.severity === 'warn' ? 'silenced' : 'coordinating';
        const result = await pool.execute(
          `INSERT INTO mdm_field_conflicts
            (field_id_a, field_id_b, conflict_field, submitter_a, value_a, submitter_b, value_b,
             dept_a, dept_b, severity, status, resolution_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            pair.a_id,
            pair.b_id,
            conflictValue.conflictField,
            pair.submitter_a || null,
            conflictValue.valueA || null,
            pair.submitter_b || null,
            conflictValue.valueB || null,
            pair.dept_a || null,
            pair.dept_b || null,
            conflictValue.severity,
            status,
            conflictValue.severity === 'warn' ? 'auto_silenced' : null
          ]
        );
        detected += 1;
        if (conflictValue.severity === 'error') {
          await createConflictTodoForDepartments({
            id: insertId(result),
            dept_a: pair.dept_a || null,
            dept_b: pair.dept_b || null
          }, 'field', actor.actor_user_id || null);
        }
      }
      return termGovernanceEnabled ? { detected, terminology_mode: 'suggestions_only', terminology_notice: '术语近似匹配仅供人工核对，不自动建立冲突或待办。' } : { detected };
    },

    async assignConflict(conflictId, conflictType = 'field', payload = {}) {
      if (payload.actor_session || typeof pool.getConnection==='function') return await mutate('assignConflict',conflictId,conflictType,payload);
      const assigneePersonId = assigneePersonIdFromPayload(payload);
      const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (!['pending', 'coordinating'].includes(conflict.status)) {
        return resultError(409, '仅待处理或协调中状态可指定责任人');
      }
      await pool.execute(
        `INSERT INTO mdm_conflict_assignments (conflict_id, conflict_type, assignee_user_id, assignee_person_id, assigned_by, assigned_by_person_id)
         VALUES (CAST(? AS SIGNED), ?, CAST(? AS SIGNED), CAST(? AS SIGNED), CAST(? AS SIGNED), CAST(? AS SIGNED))`,
        [conflictId, conflictType, payload.assignee_user_id, assigneePersonId, payload.actor_user_id || null, actorPersonId]
      );
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(`UPDATE ${table} SET status='coordinating', updated_at=CURRENT_TIMESTAMP WHERE id=?`, [conflictId]);
      await insertTodo({
        from_dept_id: payload.actor_dept_id || null,
        to_dept_id: payload.assignee_dept_id || null,
        type: 'conflict_resolution',
        related_field_id: conflictType === 'field' ? conflict.field_entry_a_id : null,
        content: conflictType === 'term' ? `Term conflict: ${conflict.term}` : `Field conflict #${conflict.id}`,
        urgency: 'high'
      }, payload.actor_user_id || null);
      return { ok: true };
    },

    async reassignConflict(conflictId, conflictType = 'field', payload = {}) {
      if (payload.actor_session || typeof pool.getConnection==='function') return await mutate('reassignConflict',conflictId,conflictType,payload);
      const assigneePersonId = assigneePersonIdFromPayload(payload);
      const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'coordinating') return resultError(409, '仅协调中状态可改派');
      await pool.execute(
        `INSERT INTO mdm_conflict_assignments (conflict_id, conflict_type, assignee_user_id, assignee_person_id, assigned_by, assigned_by_person_id)
         VALUES (CAST(? AS SIGNED), ?, CAST(? AS SIGNED), CAST(? AS SIGNED), CAST(? AS SIGNED), CAST(? AS SIGNED))`,
        [conflictId, conflictType, payload.assignee_user_id, assigneePersonId, payload.actor_user_id || null, actorPersonId]
      );
      return { ok: true };
    },

    async submitCoordination(conflictId, conflictType = 'field', payload = {}) {
      if (payload.actor_session || typeof pool.getConnection==='function') return await mutate('submitCoordination',conflictId,conflictType,payload);
      const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
      if (!['A', 'B', 'compromise'].includes(payload.result)) return resultError(422, 'result 必须为 A, B, 或 compromise');
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (!['coordinating','escalated'].includes(conflict.status)) return resultError(409, '当前冲突状态不能提交协调说明');
      const assignments = await conflictAssignments(conflictId, conflictType);
      const currentAssignment = assignments[0];
      if (
        !payload.canManageAll &&
        (!currentAssignment || !same(currentAssignment.assignee_person_id,actorPersonId))
      ) {
        return resultError(403, '仅已指派协调人可提交协调结果');
      }
      await pool.execute(
        `INSERT INTO mdm_conflict_coordination_history (conflict_id, conflict_type, assignee_user_id, assignee_person_id, result, note)
         VALUES (CAST(? AS SIGNED), ?, CAST(? AS SIGNED), CAST(? AS SIGNED), ?, ?)`,
        [conflictId, conflictType, payload.actor_user_id || null, actorPersonId, payload.result, payload.note || null]
      );
      return { ok: true };
    },

    async finalDecideConflict(conflictId, conflictType = 'field', payload = {}) {
      if (payload.actor_session || typeof pool.getConnection==='function') return await mutate('finalDecideConflict',conflictId,conflictType,payload);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (!['coordinating', 'escalated', 'resolved'].includes(conflict.status)) {
        return resultError(409, '仅协调中或已升级状态可终裁');
      }
      if (payload.requireAssignment) {
        const assignments = await conflictAssignments(conflictId, conflictType);
        const currentAssignment = assignments[0];
        const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
        if (!currentAssignment || !same(currentAssignment.assignee_person_id,actorPersonId)) {
          return resultError(403, '只能处理本人当前被分派的冲突');
        }
      }
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      const result = await pool.execute(
        `UPDATE ${table}
         SET status='resolved', resolution=?, resolved_by=?, resolved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [nullableText(payload.resolution), payload.actor_user_id || null, conflictId]
      );
      if (affectedRows(result) === 0) return resultError(404, '冲突不存在');
      return { ok: true };
    },

    async escalateConflict(conflictId, conflictType = 'field', payload = {}) {
      if (payload.actor_session || typeof pool.getConnection === 'function') return await mutate('escalateConflict',conflictId,conflictType,payload);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'coordinating') return resultError(409, '仅协调中的冲突可升级');
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(`UPDATE ${table} SET status='escalated', escalated=1, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [conflictId]);
      await insertTodo({
        from_dept_id: payload.actor_dept_id || null,
        to_dept_id: null,
        type: 'conflict_resolution',
        content: `Conflict #${conflictId} escalated for final decision`,
        urgency: 'high'
      }, payload.actor_user_id || null);
      return { ok: true };
    },

    async reopenConflict(conflictId, conflictType = 'field', payload = {}) {
      if (payload.actor_session || typeof pool.getConnection==='function') return await mutate('reopenConflict',conflictId,conflictType,payload);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'resolved') return resultError(409, '仅已解决状态可重开');
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(
        `UPDATE ${table}
         SET status='pending', resolution=NULL, resolved_by=NULL, resolved_at=NULL, escalated=0, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [conflictId]
      );
      return { ok: true };
    },

    async archiveConflict(conflictId, conflictType = 'field', payload = {}) {
      if (payload.actor_session || typeof pool.getConnection==='function') return await mutate('archiveConflict',conflictId,conflictType,payload);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'resolved') return resultError(409, '仅已解决状态可归档');
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(`UPDATE ${table} SET status='archived', updated_at=CURRENT_TIMESTAMP WHERE id=?`, [conflictId]);
      return { ok: true };
    },

    async resolveFieldConflict(conflictId, payload = {}) {
      return await this.finalDecideConflict(conflictId, 'field', payload);
    },

    async resolveTermConflict(conflictId, payload = {}) {
      return await this.finalDecideConflict(conflictId, 'term', payload);
    },
    async departmentRecheck(conflictId,conflictType='field',payload={}) {return mutate('departmentRecheck',conflictId,conflictType,payload);},
    async listRecheckWorkItems(session){
      const current=await recheck.authority(pool,session);if(current.admin)return {items:[],managed_conflicts:[],truncated:false};
      const modes=recheck.scopeModes(current),mode=modes.includes('global')?'global':modes.length>1?'combined':modes[0]||'none',scope={mode,modes,canViewAll:mode==='global',userId:current.person_id,departmentId:current.current_department_id};
      const candidates=[],params=[];
      for(const type of ['field','term']){const table=type==='field'?'mdm_field_conflicts':'mdm_term_conflicts',filter=filterClause('c',type,{},scope);candidates.push(`SELECT ? entity_type,CAST(c.id AS CHAR) conflict_id,c.updated_at ordering_time,c.id ordering_id FROM ${table} c WHERE c.status IN ('pending','coordinating','escalated') AND ${filter.sql}`);params.push('conflict_'+type,...filter.params);}
      const [events]=await pool.execute('SELECT entity_type,conflict_id FROM ('+candidates.join(' UNION ALL ')+') scoped ORDER BY ordering_time DESC,ordering_id DESC,entity_type DESC LIMIT 201',params);
      const items=[],managed_conflicts=[];
      for(const candidate of events.slice(0,200)){
        const type=candidate.entity_type==='conflict_term'?'term':'field';
        const detail=await this.getConflict(candidate.conflict_id,type,{mode,modes,userId:current.person_id,departmentId:current.current_department_id,actor_session:session});
        if(!detail||detail.workflow_state==='legacy_resolved')continue;managed_conflicts.push({conflict_id:candidate.conflict_id,conflict_type:type});
        const allowed=detail.allowed_actions||[],head=allowed.includes('department-recheck'),proposal=allowed.includes('final-decide'),revise=['recheck_returned','source_changed'].includes(detail.workflow_state);
        let assignment=allowed.includes('assign');
        if(!head&&!proposal&&!assignment&&allowed.includes('reassign')){
          const personId=identityInteger(detail.currentAssignee?.assignee_person_id),qualification=personId?await require('./identityMysqlRepository').readPersonQualification(pool,personId):null;
          assignment=!qualification?.valid||qualification.readOnly||!qualification.roleCodes.has('data_conflict_handler')||!qualification.permissions.has('governance:handle-assigned-conflict');
        }
        const coordination=!head&&!proposal&&!assignment&&detail.status==='coordinating'&&allowed.includes('coordination');
        if(!head&&!proposal&&!assignment&&!coordination)continue;
        const major=detail.status==='escalated'||Boolean(detail.escalated),roleHint=head?'department_mdm_reviewer':proposal&&major?'decision_group':assignment?'mdm_lead':'data_conflict_handler';
        const actionLabel=head?'本人重核冲突处理结果':assignment?(detail.currentAssignee?'重新明确本冲突处理人':'分派本冲突处理人'):coordination?'补充本冲突协调说明':major?(revise?'修订重大争议决定':'记录重大争议决定并交部门重核'):(revise?'修订冲突协调方案':'记录处理方案并交部门重核');
        const name=type==='term'?detail.term||'术语冲突':[...new Set([detail.field_name_a,detail.field_name_b].filter(Boolean))].join(' / ')||'字段冲突处理';
        const operation=head?'阅读已保存方案或重大决定及本部门事实，填写本人核对依据，选择确认或退回修改。':assignment?'核对本冲突对象及责任范围，明确选择当前有效的数据冲突处理人并保存分派；交受派人员办理。':coordination?'核对已存立场及依据，记录本人协调说明；部门等必要信息缺失时按页面提示核对，不猜补或代为确认。':revise?'阅读各部门退回依据及当前事实，修订方案或重大决定后重新交各部门本人核对。':'核对各方已存事实、立场及协调依据，明确记录本次处理方案或重大决定，再交所列部门负责人分别本人重核。';
        items.push({id:'legacy-conflict:'+type+':'+candidate.conflict_id,type:'legacy_conflict_recheck',governanceType:'legacy_conflict_recheck',title:actionLabel+'：'+name,target:'/app/conflicts?type='+type+'&id='+candidate.conflict_id,conflict_id:candidate.conflict_id,conflict_type:type,canAct:true,sourceRoles:[roleHint],roleHint,requiredPermissions:[head?'governance:record-department-decision':assignment?'governance:assign-work':roleHint==='decision_group'?'governance:decide-escalation':'governance:handle-assigned-conflict'],actionLabel,nextStep:operation,handlingGuide:{actor:head?'本部门当前有效负责人':assignment?'MDM工作组组长':roleHint==='decision_group'?'项目决策组':'本人已受派的冲突处理人',operation,result:assignment?'在本冲突的当前责任人及分派历史核对结果，由受派人员继续办理。':'在同一冲突的重核历史核对结果；全部相关部门有效确认后才关闭。'}});
      }
      return {items,managed_conflicts,truncated:events.length>200};
    }
  };
}

async function conflictRepository() {
  if (conflictRepositoryFactory) return await conflictRepositoryFactory();
  if (!conflictRepoPromise) {
    conflictRepoPromise = (async () => {
      const pool = createRegisteredPool(process.env, 'conflict');
      const repo = makeConflictMysqlRepository(pool);
      await checkRuntimeSchema(pool, 'conflict');
      return repo;
    })();
  }
  try {
    return await conflictRepoPromise;
  } catch (error) {
    conflictRepoPromise = null;
    throw error;
  }
}

function setConflictRepositoryFactory(factory) {
  conflictRepositoryFactory = factory;
  conflictRepoPromise = null;
}

function resetConflictRepositoryFactory() {
  conflictRepositoryFactory = null;
  conflictRepoPromise = null;
}

module.exports = {
  makeConflictMysqlRepository,
  conflictRepository,
  setConflictRepositoryFactory,
  resetConflictRepositoryFactory
};
