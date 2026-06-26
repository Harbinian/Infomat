const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

const QUEUE_DEFINITIONS = [
  ['waiting_my_action', '需要我确认'],
  ['waiting_department_review', '需要我审核'],
  ['pending_collaboration', '需要我协同'],
  ['waiting_others', '等待别人'],
  ['waiting_mdm_decision', '待最终裁决'],
  ['completed', '已完成']
];

const POINT_OPTIONS = {
  owner_role: ['已有具体岗位', '只能确认到部门', '制度未写清，需补依据', '不适用'],
  completion_standard: ['已有完成标准', '需要补完成标准', '该行为不需要完成标准', '制度未写清'],
  controlled_transfer: ['有受控传递证据', '没有受控传递证据', '需要对方部门确认', '不涉及跨部门传递'],
  cross_department: ['本部门可以确认', '需要对方部门确认', '需要工作室协调', '提交 MDM 工作组裁决'],
  process_structure: ['当前流程结构合理', '流程结构需调整', '需要补 L1/L2 口径', '提交 MDM 工作组裁决'],
  system_landing: ['当前应用落位合理', '应用落位需调整', '暂不落位系统', '需要信息化工作组判断'],
  data_object: ['数据对象已明确', '字段口径需补充', '黄金源需确认', '提交 MDM 工作组裁决'],
  evidence_gap: ['证据链充分', '需要补证据', '证据不匹配', '制度未写清'],
  terminology: ['采用推荐术语', '保留原表达并说明原因', '需要多部门统一', '提交 MDM 工作组裁决']
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function positiveInteger(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function sourceLayer(sourceFile) {
  const text = String(sourceFile || '');
  if (/总则|规章/.test(text)) return 'rule';
  if (/表单|台账|模板/.test(text)) return 'form';
  if (/标准|作业/.test(text)) return 'standard';
  if (!text) return 'unknown';
  return 'procedure';
}

function displayStatusForSource(row) {
  const status = String(row.todo_status || row.status || '').trim();
  if (['closed', 'accepted'].includes(status)) return 'completed';
  if (status === 'source_resolved') return 'completed';
  if (status === 'submitted') return 'waiting_department_review';
  if (row.todo_type === 'cross_dept' && row.target_dept_name && row.target_dept_name !== row.dept_name) return 'waiting_my_action';
  return 'waiting_my_action';
}

function priorityScore(row) {
  const priority = String(row.priority || '').trim();
  if (priority === 'high') return 90;
  if (priority === 'medium') return 60;
  if (priority === 'low') return 30;
  return row.todo_id ? 50 : 20;
}

function pointTypeForSource(row) {
  const todoType = String(row.todo_type || '').trim();
  const message = `${row.message || ''} ${row.suggestion || ''} ${row.verification_note || ''}`;
  if (todoType === 'cross_dept') return 'cross_department';
  if (todoType === 'evidence' || /证据/.test(message)) return 'evidence_gap';
  if (todoType === 'adjustment' || /结构|L1|L2|流程/.test(message)) return 'process_structure';
  if (/系统|落位|应用/.test(message)) return 'system_landing';
  if (/字段|数据对象|主数据|黄金源/.test(message)) return 'data_object';
  if (/术语|表达|名称/.test(message)) return 'terminology';
  if (/责任|岗位|角色/.test(message)) return 'owner_role';
  return 'completion_standard';
}

function pointTitle(pointType) {
  const labels = {
    owner_role: '责任人不具体',
    completion_standard: '完成标准待确认',
    controlled_transfer: '受控传递待确认',
    cross_department: '跨部门协同确认',
    process_structure: '流程结构待裁决',
    system_landing: '系统落位待裁决',
    data_object: '数据对象或字段待裁决',
    evidence_gap: '证据链待补',
    terminology: '术语统一'
  };
  return labels[pointType] || '待确认问题';
}

function issueKeyForSource(row) {
  if (row.todo_key) return `todo:${row.todo_key}`;
  if (row.mapping_key) return `record:${row.mapping_key}`;
  return `record-id:${row.record_id || row.id}`;
}

function pointKeyForSource(row, pointType) {
  return `${issueKeyForSource(row)}:${pointType}`;
}

function issueShape(row, batchId) {
  const deptName = row.dept_name || row.primary_dept_name || '未标注部门';
  const a1Name = row.behavior || row.a1_name || row.message || row.l3_name || '待确认业务行为';
  const a1Code = row.a1_code || '';
  const l3Name = row.l3_name || '未标注流程';
  const sourceFile = row.source_file || '';
  const targetDept = row.target_dept_name || row.output_target_dept || '';
  const what = row.message || `${a1Name}需要补充确认`;
  const why = '不确认会影响流程结构、责任边界、证据链和后续 MDM 承接。';
  return {
    issue_key: issueKeyForSource(row),
    batch_id: batchId || null,
    primary_dept_name: deptName,
    owner_dept_name: row.owner_dept_name || deptName,
    source_layer: sourceLayer(sourceFile),
    source_type: row.todo_id ? 'mapping_todo' : 'mapping_record',
    source_ref_table: row.todo_id ? 'process_mapping_todos' : 'process_mapping_records',
    source_ref_id: String(row.todo_id || row.record_id || row.id || ''),
    l1_name: row.l1_name || null,
    l2_name: row.l2_name || null,
    l3_name: l3Name,
    a1_code: a1Code,
    a1_name: a1Name,
    title: `${a1Name}需要确认`,
    what_text: what,
    why_text: why,
    where_text: `${deptName}流程映射表\n业务流程：${l3Name}\n业务行为：${a1Code ? `${a1Code} ` : ''}${a1Name}\n来源：${sourceFile || '来源文件待补'}`,
    who_text: `主责部门：${deptName}${targetDept ? `；协同部门：${targetDept}` : ''}；审核人：部门长或授权账户；裁决人：按问题类型进入工作室或 MDM 工作组。`,
    when_text: row.due_date ? `本轮治理，建议在 ${row.due_date} 前处理。` : '本轮流程治理中处理，按优先级排序。',
    how_text: row.suggestion || '请选择结构化处理结论，必要时补充依据、证据或说明。',
    how_much_text: `影响 1 个 A1 业务行为${targetDept ? `，涉及 ${targetDept} 协同确认` : ''}。`,
    display_status: displayStatusForSource(row),
    priority_score: priorityScore(row),
    due_at: row.due_date || null
  };
}

function pointShape(row, issueId) {
  const pointType = pointTypeForSource(row);
  return {
    issue_id: issueId,
    point_key: pointKeyForSource(row, pointType),
    point_type: pointType,
    title: pointTitle(pointType),
    prompt_text: row.suggestion || row.message || '请确认这个问题点的处理结论。',
    enum_options_json: json(POINT_OPTIONS[pointType] || POINT_OPTIONS.completion_standard),
    evidence_json: json({
      source_file: row.source_file || '',
      l3_name: row.l3_name || '',
      a1_code: row.a1_code || '',
      source_ref_id: row.todo_id || row.record_id || row.id || null
    }),
    requires_mdm_decision: ['process_structure', 'system_landing', 'data_object', 'terminology'].includes(pointType) ? 1 : 0,
    requires_studio_review: ['cross_department', 'system_landing'].includes(pointType) ? 1 : 0
  };
}

function eventPayload(row) {
  return {
    source_type: row.todo_id ? 'mapping_todo' : 'mapping_record',
    source_ref_id: row.todo_id || row.record_id || row.id || null
  };
}

function mapIssueRow(row) {
  return row ? { ...row } : null;
}

function mapPointRow(row) {
  return row ? {
    ...row,
    enum_options: parseJsonArray(row.enum_options_json),
    evidence: parseJsonObject(row.evidence_json, {})
  } : null;
}

function mapParticipantRow(row) {
  return row ? { ...row } : null;
}

function mapEventRow(row) {
  return row ? {
    ...row,
    payload: parseJsonObject(row.payload_json, null)
  } : null;
}

function mapTermTaskRow(row) {
  return row ? {
    ...row,
    selected_departments: parseJsonArray(row.selected_departments_json),
    decision: parseJsonObject(row.decision_json, null)
  } : null;
}

function normalizeAction(action) {
  const key = String(action || '').trim();
  const map = {
    confirm: ['business_confirmed', 'department_review', 'pending_department_review'],
    review: ['department_reviewed', 'mdm_decision', 'pending_mdm_decision'],
    collaborate: ['collaboration_answered', 'studio_review', 'pending_studio_review'],
    'studio-review': ['studio_reviewed', 'mdm_decision', 'pending_mdm_decision'],
    'mdm-decision': ['mdm_decided', 'closed', 'accepted']
  };
  return map[key] || map.confirm;
}

function sqliteRun(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function makeSqliteProcessGovernanceIssuePoolRepository(db) {
  function issueByKey(issueKey) {
    return db.prepare('SELECT * FROM process_governance_issues WHERE issue_key=?').get(issueKey);
  }

  function addEvent(issueId, pointId, eventType, actor = {}, note = '', payload = null) {
    sqliteRun(db, `
      INSERT INTO process_governance_issue_events
        (issue_id, point_id, event_type, actor_user_id, actor_dept_name, actor_role_code, note, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      issueId,
      pointId || null,
      eventType,
      actor.actorUserId || actor.actor_user_id || null,
      actor.actorDeptName || actor.actor_dept_name || null,
      actor.actorRoleCode || actor.actor_role_code || null,
      note || null,
      payload == null ? null : json(payload)
    ]);
  }

  function upsertIssue(row, batchId) {
    const issue = issueShape(row, batchId);
    sqliteRun(db, `
      INSERT INTO process_governance_issues (
        issue_key, batch_id, primary_dept_name, owner_dept_name, source_layer, source_type,
        source_ref_table, source_ref_id, l1_name, l2_name, l3_name, a1_code, a1_name,
        title, what_text, why_text, where_text, who_text, when_text, how_text, how_much_text,
        display_status, priority_score, due_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_key) DO UPDATE SET
        batch_id=excluded.batch_id,
        primary_dept_name=excluded.primary_dept_name,
        owner_dept_name=excluded.owner_dept_name,
        source_layer=excluded.source_layer,
        source_type=excluded.source_type,
        source_ref_table=excluded.source_ref_table,
        source_ref_id=excluded.source_ref_id,
        l2_name=excluded.l2_name,
        l3_name=excluded.l3_name,
        a1_code=excluded.a1_code,
        a1_name=excluded.a1_name,
        title=excluded.title,
        what_text=excluded.what_text,
        why_text=excluded.why_text,
        where_text=excluded.where_text,
        who_text=excluded.who_text,
        when_text=excluded.when_text,
        how_text=excluded.how_text,
        how_much_text=excluded.how_much_text,
        display_status=excluded.display_status,
        priority_score=excluded.priority_score,
        due_at=excluded.due_at,
        updated_at=CURRENT_TIMESTAMP
    `, [
      issue.issue_key, issue.batch_id, issue.primary_dept_name, issue.owner_dept_name,
      issue.source_layer, issue.source_type, issue.source_ref_table, issue.source_ref_id,
      issue.l1_name, issue.l2_name, issue.l3_name, issue.a1_code, issue.a1_name,
      issue.title, issue.what_text, issue.why_text, issue.where_text, issue.who_text,
      issue.when_text, issue.how_text, issue.how_much_text, issue.display_status,
      issue.priority_score, issue.due_at
    ]);
    const saved = issueByKey(issue.issue_key);
    const created = db.prepare(`
      SELECT COUNT(*) AS count
      FROM process_governance_issue_events
      WHERE issue_id=? AND event_type='created'
    `).get(saved.issue_id);
    if (!created.count) addEvent(saved.issue_id, null, 'created', {}, '问题卡已从现有流程治理来源生成', eventPayload(row));
    return saved;
  }

  function upsertPoint(row, issueId) {
    const point = pointShape(row, issueId);
    sqliteRun(db, `
      INSERT INTO process_governance_issue_points (
        issue_id, point_key, point_type, title, prompt_text, enum_options_json,
        evidence_json, requires_mdm_decision, requires_studio_review
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(point_key) DO UPDATE SET
        issue_id=excluded.issue_id,
        point_type=excluded.point_type,
        title=excluded.title,
        prompt_text=excluded.prompt_text,
        enum_options_json=excluded.enum_options_json,
        evidence_json=excluded.evidence_json,
        requires_mdm_decision=excluded.requires_mdm_decision,
        requires_studio_review=excluded.requires_studio_review,
        updated_at=CURRENT_TIMESTAMP
    `, [
      point.issue_id, point.point_key, point.point_type, point.title, point.prompt_text,
      point.enum_options_json, point.evidence_json, point.requires_mdm_decision,
      point.requires_studio_review
    ]);
    return db.prepare('SELECT * FROM process_governance_issue_points WHERE point_key=?').get(point.point_key);
  }

  function resetParticipants(issueId) {
    sqliteRun(db, 'DELETE FROM process_governance_issue_participants WHERE issue_id=?', [issueId]);
  }

  function addParticipants(row, issueId, pointId) {
    resetParticipants(issueId);
    const deptName = row.dept_name || row.primary_dept_name || '';
    const targetDept = row.target_dept_name || row.output_target_dept || '';
    const rows = [
      ['business_owner', deptName, 'business_contact', 1, '确认业务事实'],
      ['department_reviewer', deptName, 'project_lead', 0, '审核确认意见'],
      ['mdm_decider', null, 'decision_group', 0, '最终裁决']
    ];
    if (targetDept) rows.splice(1, 0, ['collaborator', targetDept, 'business_contact', 1, '协同确认']);
    rows.forEach(([participantType, participantDept, roleCode, canAct, actionLabel]) => {
      sqliteRun(db, `
        INSERT INTO process_governance_issue_participants
          (issue_id, point_id, participant_type, dept_name, role_code, can_view, can_act, action_label)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `, [issueId, pointId, participantType, participantDept, roleCode, canAct, actionLabel]);
    });
  }

  function listSourceRows(departmentName) {
    const params = [];
    let where = "WHERE r.record_type='a1'";
    if (departmentName) {
      where += ' AND (r.dept_name=? OR t.dept_name=? OR t.target_dept_name=?)';
      params.push(departmentName, departmentName, departmentName);
    }
    return db.prepare(`
      SELECT
        r.id AS record_id,
        r.mapping_key,
        r.dept_name,
        r.domain_name,
        r.l2_name,
        r.l3_name,
        r.a1_code,
        r.behavior,
        r.execution_role,
        r.approval_type,
        r.output_target_dept,
        r.suggested_systems,
        r.verification_note,
        r.source_file AS record_source_file,
        t.id AS todo_id,
        t.todo_key,
        t.todo_type,
        t.target_dept_name,
        COALESCE(t.source_file, r.source_file) AS source_file,
        t.message,
        t.suggestion,
        t.status AS todo_status,
        t.priority,
        t.due_date
      FROM process_mapping_records r
      LEFT JOIN process_mapping_todos t ON t.mapping_record_id=r.id
      ${where}
      ORDER BY t.id IS NULL, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.dept_name, r.l3_name, r.a1_code, r.id
      LIMIT 1000
    `).all(...params);
  }

  return {
    async initSchema() {
      return true;
    },

    async generateIssuePool(options = {}) {
      const snapshot = db.prepare(`
        SELECT id
        FROM process_governance_snapshots
        WHERE status='active'
        ORDER BY imported_at DESC, id DESC
        LIMIT 1
      `).get();
      const batchKey = options.batchKey || `issue-pool-${Date.now()}`;
      const batchResult = sqliteRun(db, `
        INSERT INTO process_governance_issue_batches
          (batch_key, source_type, source_snapshot_id, department_name, status, generated_by, summary_json)
        VALUES (?, ?, ?, ?, 'preparing', ?, ?)
      `, [
        batchKey,
        options.sourceType || 'process_mapping',
        snapshot && snapshot.id || null,
        options.departmentName || null,
        options.generatedBy || null,
        json({})
      ]);
      const batchId = batchResult.lastInsertRowid;
      let issueCount = 0;
      let pointCount = 0;
      const rows = listSourceRows(options.departmentName || '');
      rows.forEach(sourceRow => {
        const row = { ...sourceRow, source_file: sourceRow.source_file || sourceRow.record_source_file };
        const issue = upsertIssue(row, batchId);
        const point = upsertPoint(row, issue.issue_id);
        addParticipants(row, issue.issue_id, point.point_id);
        issueCount += 1;
        pointCount += 1;
      });
      const summary = { issue_count: issueCount, point_count: pointCount };
      sqliteRun(db, `
        UPDATE process_governance_issue_batches
        SET status='ready', summary_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE batch_id=?
      `, [json(summary), batchId]);
      return { batch: mapTermTaskRow({ batch_id: batchId, batch_key: batchKey, status: 'ready' }), summary };
    },

    async listQueues({ departmentName } = {}) {
      const queues = QUEUE_DEFINITIONS.map(([key, label]) => {
        const params = [];
        let countSql = 'SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i';
        let where = ' WHERE 1=1';
        if (key === 'pending_collaboration') {
          countSql += ' JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
          where += " AND p.point_status='pending_collaboration'";
        } else {
          where += ' AND i.display_status=?';
          params.push(key);
        }
        if (departmentName) {
          where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
          params.push(departmentName, departmentName, departmentName);
        }
        const count = db.prepare(`${countSql}${where}`).get(...params).count;
        const preview = db.prepare(`
          SELECT i.issue_id, i.title, i.a1_code, i.a1_name, i.primary_dept_name, i.priority_score
          FROM process_governance_issues i
          WHERE i.issue_id IN (
            SELECT DISTINCT i2.issue_id
            FROM process_governance_issues i2
            ${key === 'pending_collaboration' ? "JOIN process_governance_issue_points p2 ON p2.issue_id=i2.issue_id AND p2.point_status='pending_collaboration'" : ''}
            WHERE ${key === 'pending_collaboration' ? '1=1' : 'i2.display_status=?'}
            ${departmentName ? 'AND (i2.primary_dept_name=? OR i2.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i2.issue_id AND pp.dept_name=?))' : ''}
          )
          ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
          LIMIT 5
        `).all(...params);
        return { display_status: key, key, label, count: Number(count || 0), preview };
      });
      return { items: queues };
    },

    async listIssues({ departmentName, queue, limit, offset } = {}) {
      const params = [];
      let join = '';
      let where = 'WHERE 1=1';
      if (queue === 'pending_collaboration') {
        join = 'JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
        where += " AND p.point_status='pending_collaboration'";
      } else if (queue) {
        where += ' AND i.display_status=?';
        params.push(queue);
      }
      if (departmentName) {
        where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
        params.push(departmentName, departmentName, departmentName);
      }
      const safeLimit = positiveInteger(limit, 20, 20) || 20;
      const safeOffset = positiveInteger(offset, 0, 100000);
      const total = db.prepare(`SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i ${join} ${where}`).get(...params).count;
      const items = db.prepare(`
        SELECT DISTINCT i.*
        FROM process_governance_issues i
        ${join}
        ${where}
        ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
        LIMIT ? OFFSET ?
      `).all(...params, safeLimit, safeOffset).map(mapIssueRow);
      return { items, pagination: { total: Number(total || 0), limit: safeLimit, offset: safeOffset } };
    },

    async getIssueDetail(issueId) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return { issue: null, points: [], participants: [], events: [], termTasks: [] };
      return {
        issue: mapIssueRow(issue),
        points: db.prepare('SELECT * FROM process_governance_issue_points WHERE issue_id=? ORDER BY point_id').all(issueId).map(mapPointRow),
        participants: db.prepare('SELECT * FROM process_governance_issue_participants WHERE issue_id=? ORDER BY participant_id').all(issueId).map(mapParticipantRow),
        events: db.prepare('SELECT * FROM process_governance_issue_events WHERE issue_id=? ORDER BY event_id').all(issueId).map(mapEventRow),
        termTasks: db.prepare('SELECT * FROM process_governance_term_tasks WHERE issue_id=? ORDER BY term_task_id').all(issueId).map(mapTermTaskRow)
      };
    },

    async applyPointAction(pointId, options = {}) {
      const point = db.prepare('SELECT * FROM process_governance_issue_points WHERE point_id=?').get(pointId);
      if (!point) return null;
      const [eventType, nextStep, nextStatus] = normalizeAction(options.action);
      sqliteRun(db, `
        UPDATE process_governance_issue_points
        SET selected_option=?, note=?, current_step=?, point_status=?, updated_at=CURRENT_TIMESTAMP
        WHERE point_id=?
      `, [options.selectedOption || options.selected_option || null, options.note || null, nextStep, nextStatus, pointId]);
      const issueStatus = nextStatus === 'accepted'
        ? 'completed'
        : nextStatus === 'pending_mdm_decision'
          ? 'waiting_mdm_decision'
          : nextStatus === 'pending_studio_review'
            ? 'waiting_studio_review'
            : nextStatus === 'pending_department_review'
              ? 'waiting_department_review'
              : 'waiting_my_action';
      sqliteRun(db, 'UPDATE process_governance_issues SET display_status=?, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?', [issueStatus, point.issue_id]);
      addEvent(point.issue_id, pointId, eventType, options, options.note || null, {
        selected_option: options.selectedOption || options.selected_option || null,
        next_status: nextStatus
      });
      const detail = await this.getIssueDetail(point.issue_id);
      return { point: detail.points.find(item => Number(item.point_id) === Number(pointId)), events: detail.events, issue: detail.issue };
    },

    async addIssueComment(issueId, options = {}) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return null;
      addEvent(issueId, null, 'commented', options, options.note || null, null);
      return await this.getIssueDetail(issueId);
    },

    async closeIssue(issueId, options = {}) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return null;
      sqliteRun(db, "UPDATE process_governance_issues SET display_status='closed', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      addEvent(issueId, null, 'closed', options, options.note || '已关闭问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async reopenIssue(issueId, options = {}) {
      const issue = db.prepare('SELECT * FROM process_governance_issues WHERE issue_id=?').get(issueId);
      if (!issue) return null;
      sqliteRun(db, "UPDATE process_governance_issues SET display_status='waiting_my_action', closed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      addEvent(issueId, null, 'reopened', options, options.note || '已重新打开问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async createTermTask(options = {}) {
      const selectedDepartments = asArray(options.selectedDepartments || options.selected_departments);
      const result = sqliteRun(db, `
        INSERT INTO process_governance_term_tasks
          (issue_id, point_id, term_text, context_text, selected_departments_json, status, decision_json, created_by)
        VALUES (?, ?, ?, ?, ?, 'pending_departments', ?, ?)
      `, [
        options.issueId || options.issue_id,
        options.pointId || options.point_id || null,
        options.termText || options.term_text,
        options.contextText || options.context_text || '',
        json(selectedDepartments),
        json({ answers: [] }),
        options.createdBy || options.created_by || null
      ]);
      const task = db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(result.lastInsertRowid);
      addEvent(task.issue_id, task.point_id, 'terminology_task_created', { actorUserId: options.createdBy || options.created_by || null }, `已创建术语统一待办：${task.term_text}`, {
        selected_departments: selectedDepartments
      });
      return { task: mapTermTaskRow(task) };
    },

    async answerTermTask(termTaskId, options = {}) {
      const task = db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId);
      if (!task) return { success: false };
      const decision = parseJsonObject(task.decision_json, { answers: [] });
      const answers = asArray(decision.answers);
      answers.push({
        department_name: options.departmentName || options.department_name || '',
        answer: options.answer || '',
        note: options.note || '',
        actor_user_id: options.actorUserId || options.actor_user_id || null,
        answered_at: new Date().toISOString()
      });
      decision.answers = answers;
      sqliteRun(db, `
        UPDATE process_governance_term_tasks
        SET status='pending_mdm_decision', decision_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), termTaskId]);
      addEvent(task.issue_id, task.point_id, 'terminology_answered', { actorUserId: options.actorUserId || options.actor_user_id || null, actorDeptName: options.departmentName || options.department_name || '' }, options.note || options.answer || '已回复术语统一待办', {
        answer: options.answer || ''
      });
      return { success: true, task: mapTermTaskRow(db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId)) };
    },

    async decideTermTask(termTaskId, options = {}) {
      const task = db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId);
      if (!task) return { success: false };
      const existing = parseJsonObject(task.decision_json, { answers: [] });
      const decision = {
        ...existing,
        decision: options.decision || {},
        decided_at: new Date().toISOString()
      };
      sqliteRun(db, `
        UPDATE process_governance_term_tasks
        SET status='decided', decision_json=?, decided_by=?, decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), options.decidedBy || options.decided_by || null, termTaskId]);
      addEvent(task.issue_id, task.point_id, 'terminology_decided', { actorUserId: options.decidedBy || options.decided_by || null, actorRoleCode: 'decision_group' }, '术语裁决结果将进入术语真源', options.decision || {});
      return {
        success: true,
        decision: options.decision || {},
        task: mapTermTaskRow(db.prepare('SELECT * FROM process_governance_term_tasks WHERE term_task_id=?').get(termTaskId))
      };
    }
  };
}

async function mysqlQuery(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function mysqlRun(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

function makeProcessGovernanceIssuePoolRepository(pool) {
  async function addEvent(issueId, pointId, eventType, actor = {}, note = '', payload = null) {
    await mysqlRun(pool, `
      INSERT INTO process_governance_issue_events
        (issue_id, point_id, event_type, actor_user_id, actor_dept_name, actor_role_code, note, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      issueId,
      pointId || null,
      eventType,
      actor.actorUserId || actor.actor_user_id || null,
      actor.actorDeptName || actor.actor_dept_name || null,
      actor.actorRoleCode || actor.actor_role_code || null,
      note || null,
      payload == null ? null : json(payload)
    ]);
  }

  async function upsertIssue(row, batchId) {
    const issue = issueShape(row, batchId);
    await mysqlRun(pool, `
      INSERT INTO process_governance_issues (
        issue_key, batch_id, primary_dept_name, owner_dept_name, source_layer, source_type,
        source_ref_table, source_ref_id, l1_name, l2_name, l3_name, a1_code, a1_name,
        title, what_text, why_text, where_text, who_text, when_text, how_text, how_much_text,
        display_status, priority_score, due_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        batch_id=VALUES(batch_id),
        primary_dept_name=VALUES(primary_dept_name),
        owner_dept_name=VALUES(owner_dept_name),
        source_layer=VALUES(source_layer),
        source_type=VALUES(source_type),
        source_ref_table=VALUES(source_ref_table),
        source_ref_id=VALUES(source_ref_id),
        l2_name=VALUES(l2_name),
        l3_name=VALUES(l3_name),
        a1_code=VALUES(a1_code),
        a1_name=VALUES(a1_name),
        title=VALUES(title),
        what_text=VALUES(what_text),
        why_text=VALUES(why_text),
        where_text=VALUES(where_text),
        who_text=VALUES(who_text),
        when_text=VALUES(when_text),
        how_text=VALUES(how_text),
        how_much_text=VALUES(how_much_text),
        display_status=VALUES(display_status),
        priority_score=VALUES(priority_score),
        due_at=VALUES(due_at),
        updated_at=CURRENT_TIMESTAMP
    `, [
      issue.issue_key, issue.batch_id, issue.primary_dept_name, issue.owner_dept_name,
      issue.source_layer, issue.source_type, issue.source_ref_table, issue.source_ref_id,
      issue.l1_name, issue.l2_name, issue.l3_name, issue.a1_code, issue.a1_name,
      issue.title, issue.what_text, issue.why_text, issue.where_text, issue.who_text,
      issue.when_text, issue.how_text, issue.how_much_text, issue.display_status,
      issue.priority_score, issue.due_at
    ]);
    const [saved] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_key=?', [issue.issue_key]);
    const [created] = await mysqlQuery(pool, `
      SELECT COUNT(*) AS count
      FROM process_governance_issue_events
      WHERE issue_id=? AND event_type='created'
    `, [saved.issue_id]);
    if (!Number(created.count || 0)) await addEvent(saved.issue_id, null, 'created', {}, '问题卡已从现有流程治理来源生成', eventPayload(row));
    return saved;
  }

  async function upsertPoint(row, issueId) {
    const point = pointShape(row, issueId);
    await mysqlRun(pool, `
      INSERT INTO process_governance_issue_points (
        issue_id, point_key, point_type, title, prompt_text, enum_options_json,
        evidence_json, requires_mdm_decision, requires_studio_review
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        issue_id=VALUES(issue_id),
        point_type=VALUES(point_type),
        title=VALUES(title),
        prompt_text=VALUES(prompt_text),
        enum_options_json=VALUES(enum_options_json),
        evidence_json=VALUES(evidence_json),
        requires_mdm_decision=VALUES(requires_mdm_decision),
        requires_studio_review=VALUES(requires_studio_review),
        updated_at=CURRENT_TIMESTAMP
    `, [
      point.issue_id, point.point_key, point.point_type, point.title, point.prompt_text,
      point.enum_options_json, point.evidence_json, point.requires_mdm_decision,
      point.requires_studio_review
    ]);
    const [saved] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_points WHERE point_key=?', [point.point_key]);
    return saved;
  }

  async function addParticipants(row, issueId, pointId) {
    await mysqlRun(pool, 'DELETE FROM process_governance_issue_participants WHERE issue_id=?', [issueId]);
    const deptName = row.dept_name || row.primary_dept_name || '';
    const targetDept = row.target_dept_name || row.output_target_dept || '';
    const rows = [
      ['business_owner', deptName, 'business_contact', 1, '确认业务事实'],
      ['department_reviewer', deptName, 'project_lead', 0, '审核确认意见'],
      ['mdm_decider', null, 'decision_group', 0, '最终裁决']
    ];
    if (targetDept) rows.splice(1, 0, ['collaborator', targetDept, 'business_contact', 1, '协同确认']);
    for (const [participantType, participantDept, roleCode, canAct, actionLabel] of rows) {
      await mysqlRun(pool, `
        INSERT INTO process_governance_issue_participants
          (issue_id, point_id, participant_type, dept_name, role_code, can_view, can_act, action_label)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `, [issueId, pointId, participantType, participantDept, roleCode, canAct, actionLabel]);
    }
  }

  async function sourceRows(departmentName) {
    const params = [];
    let where = "WHERE r.record_type='a1'";
    if (departmentName) {
      where += ' AND (r.dept_name=? OR t.dept_name=? OR t.target_dept_name=?)';
      params.push(departmentName, departmentName, departmentName);
    }
    return await mysqlQuery(pool, `
      SELECT
        r.id AS record_id,
        r.mapping_key,
        r.dept_name,
        r.domain_name,
        r.l2_name,
        r.l3_name,
        r.a1_code,
        r.behavior,
        r.execution_role,
        r.approval_type,
        r.output_target_dept,
        r.suggested_systems,
        r.verification_note,
        r.source_file AS record_source_file,
        t.id AS todo_id,
        t.todo_key,
        t.todo_type,
        t.target_dept_name,
        COALESCE(t.source_file, r.source_file) AS source_file,
        t.message,
        t.suggestion,
        t.status AS todo_status,
        t.priority,
        t.due_date
      FROM process_mapping_records r
      LEFT JOIN process_mapping_todos t ON t.mapping_record_id=r.id
      ${where}
      ORDER BY t.id IS NULL, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.dept_name, r.l3_name, r.a1_code, r.id
      LIMIT 1000
    `, params);
  }

  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async generateIssuePool(options = {}) {
      const [snapshot] = await mysqlQuery(pool, `
        SELECT id
        FROM process_governance_snapshots
        WHERE status='active'
        ORDER BY imported_at DESC, id DESC
        LIMIT 1
      `);
      const batchKey = options.batchKey || `issue-pool-${Date.now()}`;
      const result = await mysqlRun(pool, `
        INSERT INTO process_governance_issue_batches
          (batch_key, source_type, source_snapshot_id, department_name, status, generated_by, summary_json)
        VALUES (?, ?, ?, ?, 'preparing', ?, ?)
      `, [
        batchKey,
        options.sourceType || 'process_mapping',
        snapshot && snapshot.id || null,
        options.departmentName || null,
        options.generatedBy || null,
        json({})
      ]);
      const batchId = result.insertId;
      let issueCount = 0;
      let pointCount = 0;
      for (const sourceRow of await sourceRows(options.departmentName || '')) {
        const row = { ...sourceRow, source_file: sourceRow.source_file || sourceRow.record_source_file };
        const issue = await upsertIssue(row, batchId);
        const point = await upsertPoint(row, issue.issue_id);
        await addParticipants(row, issue.issue_id, point.point_id);
        issueCount += 1;
        pointCount += 1;
      }
      const summary = { issue_count: issueCount, point_count: pointCount };
      await mysqlRun(pool, `
        UPDATE process_governance_issue_batches
        SET status='ready', summary_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE batch_id=?
      `, [json(summary), batchId]);
      return { batch: { batch_id: batchId, batch_key: batchKey, status: 'ready' }, summary };
    },

    async listQueues({ departmentName } = {}) {
      const queues = [];
      for (const [key, label] of QUEUE_DEFINITIONS) {
        const params = [];
        let countSql = 'SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i';
        let where = ' WHERE 1=1';
        if (key === 'pending_collaboration') {
          countSql += ' JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
          where += " AND p.point_status='pending_collaboration'";
        } else {
          where += ' AND i.display_status=?';
          params.push(key);
        }
        if (departmentName) {
          where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
          params.push(departmentName, departmentName, departmentName);
        }
        const [countRow] = await mysqlQuery(pool, `${countSql}${where}`, params);
        const preview = await mysqlQuery(pool, `
          SELECT i.issue_id, i.title, i.a1_code, i.a1_name, i.primary_dept_name, i.priority_score
          FROM process_governance_issues i
          WHERE i.issue_id IN (
            SELECT DISTINCT i2.issue_id
            FROM process_governance_issues i2
            ${key === 'pending_collaboration' ? "JOIN process_governance_issue_points p2 ON p2.issue_id=i2.issue_id AND p2.point_status='pending_collaboration'" : ''}
            WHERE ${key === 'pending_collaboration' ? '1=1' : 'i2.display_status=?'}
            ${departmentName ? 'AND (i2.primary_dept_name=? OR i2.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i2.issue_id AND pp.dept_name=?))' : ''}
          )
          ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
          LIMIT 5
        `, params);
        queues.push({ display_status: key, key, label, count: Number(countRow.count || 0), preview });
      }
      return { items: queues };
    },

    async listIssues({ departmentName, queue, limit, offset } = {}) {
      const params = [];
      let join = '';
      let where = 'WHERE 1=1';
      if (queue === 'pending_collaboration') {
        join = 'JOIN process_governance_issue_points p ON p.issue_id=i.issue_id';
        where += " AND p.point_status='pending_collaboration'";
      } else if (queue) {
        where += ' AND i.display_status=?';
        params.push(queue);
      }
      if (departmentName) {
        where += ' AND (i.primary_dept_name=? OR i.owner_dept_name=? OR EXISTS (SELECT 1 FROM process_governance_issue_participants pp WHERE pp.issue_id=i.issue_id AND pp.dept_name=?))';
        params.push(departmentName, departmentName, departmentName);
      }
      const safeLimit = positiveInteger(limit, 20, 20) || 20;
      const safeOffset = positiveInteger(offset, 0, 100000);
      const [count] = await mysqlQuery(pool, `SELECT COUNT(DISTINCT i.issue_id) AS count FROM process_governance_issues i ${join} ${where}`, params);
      const items = await mysqlQuery(pool, `
        SELECT DISTINCT i.*
        FROM process_governance_issues i
        ${join}
        ${where}
        ORDER BY i.priority_score DESC, i.updated_at DESC, i.issue_id
        LIMIT ? OFFSET ?
      `, [...params, safeLimit, safeOffset]);
      return { items: items.map(mapIssueRow), pagination: { total: Number(count.count || 0), limit: safeLimit, offset: safeOffset } };
    },

    async getIssueDetail(issueId) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return { issue: null, points: [], participants: [], events: [], termTasks: [] };
      const points = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_points WHERE issue_id=? ORDER BY point_id', [issueId]);
      const participants = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_participants WHERE issue_id=? ORDER BY participant_id', [issueId]);
      const events = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_events WHERE issue_id=? ORDER BY event_id', [issueId]);
      const termTasks = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE issue_id=? ORDER BY term_task_id', [issueId]);
      return {
        issue: mapIssueRow(issue),
        points: points.map(mapPointRow),
        participants: participants.map(mapParticipantRow),
        events: events.map(mapEventRow),
        termTasks: termTasks.map(mapTermTaskRow)
      };
    },

    async applyPointAction(pointId, options = {}) {
      const [point] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issue_points WHERE point_id=?', [pointId]);
      if (!point) return null;
      const [eventType, nextStep, nextStatus] = normalizeAction(options.action);
      await mysqlRun(pool, `
        UPDATE process_governance_issue_points
        SET selected_option=?, note=?, current_step=?, point_status=?, updated_at=CURRENT_TIMESTAMP
        WHERE point_id=?
      `, [options.selectedOption || options.selected_option || null, options.note || null, nextStep, nextStatus, pointId]);
      const issueStatus = nextStatus === 'accepted'
        ? 'completed'
        : nextStatus === 'pending_mdm_decision'
          ? 'waiting_mdm_decision'
          : nextStatus === 'pending_studio_review'
            ? 'waiting_studio_review'
            : nextStatus === 'pending_department_review'
              ? 'waiting_department_review'
              : 'waiting_my_action';
      await mysqlRun(pool, 'UPDATE process_governance_issues SET display_status=?, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?', [issueStatus, point.issue_id]);
      await addEvent(point.issue_id, pointId, eventType, options, options.note || null, {
        selected_option: options.selectedOption || options.selected_option || null,
        next_status: nextStatus
      });
      const detail = await this.getIssueDetail(point.issue_id);
      return { point: detail.points.find(item => Number(item.point_id) === Number(pointId)), events: detail.events, issue: detail.issue };
    },

    async addIssueComment(issueId, options = {}) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return null;
      await addEvent(issueId, null, 'commented', options, options.note || null, null);
      return await this.getIssueDetail(issueId);
    },

    async closeIssue(issueId, options = {}) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return null;
      await mysqlRun(pool, "UPDATE process_governance_issues SET display_status='closed', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      await addEvent(issueId, null, 'closed', options, options.note || '已关闭问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async reopenIssue(issueId, options = {}) {
      const [issue] = await mysqlQuery(pool, 'SELECT * FROM process_governance_issues WHERE issue_id=?', [issueId]);
      if (!issue) return null;
      await mysqlRun(pool, "UPDATE process_governance_issues SET display_status='waiting_my_action', closed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE issue_id=?", [issueId]);
      await addEvent(issueId, null, 'reopened', options, options.note || '已重新打开问题卡', null);
      return await this.getIssueDetail(issueId);
    },

    async createTermTask(options = {}) {
      const selectedDepartments = asArray(options.selectedDepartments || options.selected_departments);
      const result = await mysqlRun(pool, `
        INSERT INTO process_governance_term_tasks
          (issue_id, point_id, term_text, context_text, selected_departments_json, status, decision_json, created_by)
        VALUES (?, ?, ?, ?, ?, 'pending_departments', ?, ?)
      `, [
        options.issueId || options.issue_id,
        options.pointId || options.point_id || null,
        options.termText || options.term_text,
        options.contextText || options.context_text || '',
        json(selectedDepartments),
        json({ answers: [] }),
        options.createdBy || options.created_by || null
      ]);
      const [task] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [result.insertId]);
      await addEvent(task.issue_id, task.point_id, 'terminology_task_created', { actorUserId: options.createdBy || options.created_by || null }, `已创建术语统一待办：${task.term_text}`, {
        selected_departments: selectedDepartments
      });
      return { task: mapTermTaskRow(task) };
    },

    async answerTermTask(termTaskId, options = {}) {
      const [task] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      if (!task) return { success: false };
      const decision = parseJsonObject(task.decision_json, { answers: [] });
      const answers = asArray(decision.answers);
      answers.push({
        department_name: options.departmentName || options.department_name || '',
        answer: options.answer || '',
        note: options.note || '',
        actor_user_id: options.actorUserId || options.actor_user_id || null,
        answered_at: new Date().toISOString()
      });
      decision.answers = answers;
      await mysqlRun(pool, `
        UPDATE process_governance_term_tasks
        SET status='pending_mdm_decision', decision_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), termTaskId]);
      await addEvent(task.issue_id, task.point_id, 'terminology_answered', { actorUserId: options.actorUserId || options.actor_user_id || null, actorDeptName: options.departmentName || options.department_name || '' }, options.note || options.answer || '已回复术语统一待办', {
        answer: options.answer || ''
      });
      const [updated] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      return { success: true, task: mapTermTaskRow(updated) };
    },

    async decideTermTask(termTaskId, options = {}) {
      const [task] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      if (!task) return { success: false };
      const existing = parseJsonObject(task.decision_json, { answers: [] });
      const decision = { ...existing, decision: options.decision || {}, decided_at: new Date().toISOString() };
      await mysqlRun(pool, `
        UPDATE process_governance_term_tasks
        SET status='decided', decision_json=?, decided_by=?, decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE term_task_id=?
      `, [json(decision), options.decidedBy || options.decided_by || null, termTaskId]);
      await addEvent(task.issue_id, task.point_id, 'terminology_decided', { actorUserId: options.decidedBy || options.decided_by || null, actorRoleCode: 'decision_group' }, '术语裁决结果将进入术语真源', options.decision || {});
      const [updated] = await mysqlQuery(pool, 'SELECT * FROM process_governance_term_tasks WHERE term_task_id=?', [termTaskId]);
      return { success: true, decision: options.decision || {}, task: mapTermTaskRow(updated) };
    }
  };
}

module.exports = {
  QUEUE_DEFINITIONS,
  makeProcessGovernanceIssuePoolRepository,
  makeSqliteProcessGovernanceIssuePoolRepository
};
