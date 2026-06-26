const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

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

function defaultGuidanceActions() {
  return {
    canCreate: false,
    canRespond: false,
    canClarify: false,
    canObject: false,
    canDelegate: false,
    canFinalConfirm: false,
    disabledReasons: {}
  };
}

function normalizeGuidance(row = {}, guidanceActions = defaultGuidanceActions()) {
  return {
    guidance_id: row.guidance_id,
    guidance_code: row.guidance_code,
    related_entity_type: row.related_entity_type,
    related_entity_id: row.related_entity_id,
    related_department_id: row.related_department_id,
    related_department_name: row.related_department_name || null,
    created_by_person_id: row.created_by_person_id,
    guidance_type: row.guidance_type,
    content: row.content,
    final_responsible_person_id: row.final_responsible_person_id,
    finalResponsiblePerson: row.final_responsible_person_name || null,
    current_handler_person_id: row.current_handler_person_id,
    currentHandlerPerson: row.current_handler_person_name || null,
    delegatePerson: row.delegate_person_name || null,
    executorPerson: row.executor_person_name || null,
    is_major: Boolean(row.is_major),
    visibility_scope: row.visibility_scope,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    guidanceActions
  };
}

function makeGuidanceCode(now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const suffix = `${Date.now()}`.slice(-6);
  return `GUID-${date}-${suffix}`;
}

function permissionsHas(permissions, permCode) {
  const permSet = permissions instanceof Set ? permissions : new Set(permissions || []);
  return permSet.has('*:*') || permSet.has(permCode);
}

function makeGovernanceGuidanceMysqlRepository(pool) {
  async function initSchema() {
    for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
      await pool.execute(statement);
    }
  }

  async function resolveDepartmentResponsibility(departmentId) {
    if (!departmentId) return null;
    return await first(pool, `
      SELECT final_responsible_person_id
      FROM departments
      WHERE id=?
    `, [departmentId]);
  }

  async function recordGuidanceEvent(guidanceId, eventType, actorPersonId, fromStatus, toStatus, note, payload = {}) {
    await pool.execute(`
      INSERT INTO process_governance_guidance_events
        (guidance_id, event_type, actor_person_id, from_status, to_status, note, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      guidanceId,
      eventType,
      actorPersonId || null,
      fromStatus || null,
      toStatus || null,
      note || null,
      JSON.stringify(payload || {})
    ]);
  }

  async function findActiveDelegation(guidance, personId, options = {}) {
    if (!guidance || !personId || !guidance.related_department_id || !guidance.final_responsible_person_id) return null;
    const params = [
      guidance.related_department_id,
      guidance.final_responsible_person_id,
      personId,
      guidance.related_entity_type,
      guidance.related_entity_id
    ];
    const rowsFound = await rows(pool, `
      SELECT *
      FROM department_responsibility_delegations
      WHERE department_id=?
        AND final_responsible_person_id=?
        AND delegate_person_id=?
        AND status='active'
        AND (start_at IS NULL OR start_at <= CURRENT_TIMESTAMP)
        AND (end_at IS NULL OR end_at >= CURRENT_TIMESTAMP)
        AND (
          scope_type='全部'
          OR (scope_type='指定业务对象' AND scope_ref_type=? AND scope_ref_id=?)
          OR (scope_type='指定问题类型' AND scope_ref_type=?)
        )
        ${options.requireFinalConfirm ? 'AND can_final_confirm=1' : ''}
      ORDER BY can_final_confirm DESC, delegation_id DESC
      LIMIT 1
    `, [...params, guidance.related_entity_type]);
    return rowsFound[0] || null;
  }

  async function canHandleGuidance(guidance, personId, options = {}) {
    if (Number(guidance.current_handler_person_id) === Number(personId)) return { allowed: true, via: 'current_handler' };
    if (Number(guidance.final_responsible_person_id) === Number(personId)) return { allowed: true, via: 'final_responsible' };
    const delegation = await findActiveDelegation(guidance, personId, options);
    if (delegation) return { allowed: true, via: 'delegation', delegation };
    return { allowed: false };
  }

  async function computeGuidanceActions(guidance, personId, permissions = new Set()) {
    const actions = defaultGuidanceActions();
    const disabledReasons = actions.disabledReasons;
    const responseStatuses = new Set(['pending_response', 'in_progress', 'clarification_requested', 'objected']);
    const disputeStatuses = new Set(['pending_response', 'in_progress']);
    const finalConfirmStatuses = new Set(['pending_final_confirm', 'responded']);
    const isFinalResponsible = Number(guidance.final_responsible_person_id) === Number(personId);
    const isCurrentHandler = Number(guidance.current_handler_person_id) === Number(personId);

    actions.canCreate = permissionsHas(permissions, 'guidance:create');

    const canRespondByPermission = permissionsHas(permissions, 'guidance:respond');
    const responseStatusAllowed = responseStatuses.has(guidance.status);
    let responseDelegation = null;
    if (canRespondByPermission && responseStatusAllowed && !isFinalResponsible && !isCurrentHandler) {
      responseDelegation = await findActiveDelegation(guidance, personId);
    }
    const canHandleResponse = isFinalResponsible || isCurrentHandler || Boolean(responseDelegation);
    actions.canRespond = canRespondByPermission && responseStatusAllowed && canHandleResponse;
    actions.canClarify = canRespondByPermission && disputeStatuses.has(guidance.status) && canHandleResponse;
    actions.canObject = actions.canClarify;
    if (!canRespondByPermission) disabledReasons.canRespond = '缺少响应指导意见权限';
    else if (!responseStatusAllowed) disabledReasons.canRespond = '当前状态不需要响应';
    else if (!canHandleResponse) disabledReasons.canRespond = '不是当前责任人或授权处理人';
    if (!canRespondByPermission) disabledReasons.canClarify = '缺少响应指导意见权限';
    else if (!disputeStatuses.has(guidance.status)) disabledReasons.canClarify = '当前状态不允许再次申请澄清';
    else if (!canHandleResponse) disabledReasons.canClarify = '不是当前责任人或授权处理人';
    if (!canRespondByPermission) disabledReasons.canObject = '缺少响应指导意见权限';
    else if (!disputeStatuses.has(guidance.status)) disabledReasons.canObject = '当前状态不允许再次提出异议';
    else if (!canHandleResponse) disabledReasons.canObject = '不是当前责任人或授权处理人';

    const canDelegateByPermission = permissionsHas(permissions, 'guidance:delegate');
    actions.canDelegate = canDelegateByPermission && isFinalResponsible && guidance.status !== 'closed';
    if (!canDelegateByPermission) disabledReasons.canDelegate = '缺少代理授权权限';
    else if (!isFinalResponsible) disabledReasons.canDelegate = '只有最终响应责任人可授权代理';
    else if (guidance.status === 'closed') disabledReasons.canDelegate = '已闭环事项不能再授权代理';

    const canFinalConfirmByPermission = permissionsHas(permissions, 'guidance:final_confirm');
    const finalStatusAllowed = finalConfirmStatuses.has(guidance.status);
    let finalConfirmDelegation = null;
    if (canFinalConfirmByPermission && finalStatusAllowed && !isFinalResponsible) {
      finalConfirmDelegation = await findActiveDelegation(guidance, personId, { requireFinalConfirm: true });
    }
    const canConfirmAsDelegate = Boolean(finalConfirmDelegation && Number(finalConfirmDelegation.can_final_confirm) === 1);
    actions.canFinalConfirm = canFinalConfirmByPermission && finalStatusAllowed && (isFinalResponsible || canConfirmAsDelegate);
    if (!canFinalConfirmByPermission) disabledReasons.canFinalConfirm = '缺少重大事项闭环确认权限';
    else if (!finalStatusAllowed) disabledReasons.canFinalConfirm = '事项尚未进入闭环确认';
    else if (!isFinalResponsible && !canConfirmAsDelegate) disabledReasons.canFinalConfirm = '重大闭环需要最终响应责任人确认';

    return actions;
  }

  async function updateGuidanceStatus(guidance, status, actorPersonId, eventType, payload = {}) {
    const result = await pool.execute(
      'UPDATE process_governance_guidance SET status=?, current_handler_person_id=?, updated_at=CURRENT_TIMESTAMP WHERE guidance_id=?',
      [status, guidance.final_responsible_person_id || actorPersonId || null, guidance.guidance_id]
    );
    if (affectedRows(result) > 0) {
      await recordGuidanceEvent(
        guidance.guidance_id,
        eventType,
        actorPersonId,
        guidance.status,
        status,
        payload.note || payload.response_content || payload.content || null,
        payload
      );
    }
    return { updated: affectedRows(result) > 0, status };
  }

  return {
    initSchema,

    async createGuidance(payload = {}) {
      const responsibility = await resolveDepartmentResponsibility(payload.related_department_id);
      const finalResponsiblePersonId = payload.final_responsible_person_id ||
        responsibility && responsibility.final_responsible_person_id ||
        null;
      const currentHandlerPersonId = payload.current_handler_person_id || finalResponsiblePersonId;
      const status = payload.status || (currentHandlerPersonId ? 'pending_response' : 'submitted');
      const guidanceCode = payload.guidance_code || makeGuidanceCode();

      const result = await pool.execute(
        `INSERT INTO process_governance_guidance (
          guidance_code, related_entity_type, related_entity_id, related_department_id,
          created_by_person_id, guidance_type, content, final_responsible_person_id,
          current_handler_person_id, is_major, visibility_scope, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guidanceCode,
          payload.related_entity_type,
          payload.related_entity_id,
          payload.related_department_id || null,
          payload.created_by_person_id,
          payload.guidance_type || '指导',
          payload.content,
          finalResponsiblePersonId,
          currentHandlerPersonId,
          payload.is_major ? 1 : 0,
          payload.visibility_scope || 'department',
          status
        ]
      );
      const guidanceId = insertId(result);
      await recordGuidanceEvent(guidanceId, 'created', payload.created_by_person_id, null, status, payload.content, payload);
      return await this.getGuidanceById(guidanceId);
    },

    async getGuidanceById(guidanceId) {
      const row = await first(pool, `
        SELECT g.*, d.name AS related_department_name,
               fp.person_name AS final_responsible_person_name,
               hp.person_name AS current_handler_person_name
        FROM process_governance_guidance g
        LEFT JOIN departments d ON g.related_department_id = d.id
        LEFT JOIN person fp ON g.final_responsible_person_id = fp.person_id
        LEFT JOIN person hp ON g.current_handler_person_id = hp.person_id
        WHERE g.guidance_id=?
      `, [guidanceId]);
      return row ? normalizeGuidance(row) : null;
    },

    async listGuidanceForPerson(personId, permissions = new Set()) {
      const canViewGlobal = permissions.has('*:*') ||
        permissions.has('process_governance:view_global') ||
        permissions.has('admin:access');
      const params = [];
      let where = '';
      if (!canViewGlobal) {
        where = 'WHERE g.current_handler_person_id=? OR g.final_responsible_person_id=? OR g.created_by_person_id=?';
        params.push(personId, personId, personId);
      }
      const result = await rows(pool, `
        SELECT g.*, d.name AS related_department_name,
               fp.person_name AS final_responsible_person_name,
               hp.person_name AS current_handler_person_name
        FROM process_governance_guidance g
        LEFT JOIN departments d ON g.related_department_id = d.id
        LEFT JOIN person fp ON g.final_responsible_person_id = fp.person_id
        LEFT JOIN person hp ON g.current_handler_person_id = hp.person_id
        ${where}
        ORDER BY g.updated_at DESC, g.guidance_id DESC
      `, params);
      return await Promise.all(result.map(async row => {
        const guidance = normalizeGuidance(row);
        const guidanceActions = await computeGuidanceActions(guidance, personId, permissions);
        return normalizeGuidance(row, guidanceActions);
      }));
    },

    async respondGuidance(guidanceId, personId, payload = {}) {
      const guidance = await this.getGuidanceById(guidanceId);
      if (!guidance) return { updated: false, reason: 'missing' };
      const allowedStatuses = new Set(['pending_response', 'in_progress', 'clarification_requested', 'objected']);
      if (!allowedStatuses.has(guidance.status)) return { updated: false, reason: 'invalid_status' };
      const access = await canHandleGuidance(guidance, personId);
      if (!access.allowed) return { updated: false, reason: 'not_responsible' };
      const nextStatus = guidance.is_major ? 'pending_final_confirm' : 'responded';
      return await updateGuidanceStatus(guidance, nextStatus, personId, 'responded', payload);
    },

    async clarifyGuidance(guidanceId, personId, payload = {}) {
      const guidance = await this.getGuidanceById(guidanceId);
      if (!guidance) return { updated: false, reason: 'missing' };
      if (!['pending_response', 'in_progress'].includes(guidance.status)) return { updated: false, reason: 'invalid_status' };
      const access = await canHandleGuidance(guidance, personId);
      if (!access.allowed) return { updated: false, reason: 'not_responsible' };
      return await updateGuidanceStatus(guidance, 'clarification_requested', personId, 'clarification_requested', payload);
    },

    async objectGuidance(guidanceId, personId, payload = {}) {
      const guidance = await this.getGuidanceById(guidanceId);
      if (!guidance) return { updated: false, reason: 'missing' };
      if (!['pending_response', 'in_progress'].includes(guidance.status)) return { updated: false, reason: 'invalid_status' };
      const access = await canHandleGuidance(guidance, personId);
      if (!access.allowed) return { updated: false, reason: 'not_responsible' };
      return await updateGuidanceStatus(guidance, 'objected', personId, 'objected', payload);
    },

    async delegateGuidance(guidanceId, personId, payload = {}) {
      const guidance = await this.getGuidanceById(guidanceId);
      if (!guidance) return { updated: false, reason: 'missing' };
      if (Number(guidance.final_responsible_person_id) !== Number(personId)) return { updated: false, reason: 'not_responsible' };
      if (!payload.delegate_person_id) return { updated: false, reason: 'missing_delegate' };
      await pool.execute(`
        INSERT INTO department_responsibility_delegations (
          department_id, final_responsible_person_id, delegate_person_id,
          delegation_type, scope_type, scope_ref_type, scope_ref_id,
          can_final_confirm, reason, start_at, end_at, status, created_by_person_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `, [
        guidance.related_department_id,
        guidance.final_responsible_person_id,
        payload.delegate_person_id,
        payload.delegation_type || '指导意见响应',
        payload.scope_type || '指定业务对象',
        payload.scope_ref_type || guidance.related_entity_type,
        payload.scope_ref_id || guidance.related_entity_id,
        payload.can_final_confirm ? 1 : 0,
        payload.reason || null,
        payload.start_at || null,
        payload.end_at || null,
        personId
      ]);
      await recordGuidanceEvent(guidanceId, 'delegated', personId, guidance.status, guidance.status, payload.reason || null, payload);
      return { updated: true, status: guidance.status };
    },

    async finalConfirmGuidance(guidanceId, personId, payload = {}) {
      const guidance = await this.getGuidanceById(guidanceId);
      if (!guidance) return { updated: false, reason: 'missing' };
      if (!['pending_final_confirm', 'responded'].includes(guidance.status)) return { updated: false, reason: 'invalid_status' };
      const access = await canHandleGuidance(guidance, personId, { requireFinalConfirm: true });
      if (!access.allowed) return { updated: false, reason: 'not_responsible' };
      if (access.via === 'delegation' && !access.delegation.can_final_confirm) {
        return { updated: false, reason: 'final_confirm_denied' };
      }
      return await updateGuidanceStatus(guidance, 'closed', personId, 'final_confirmed', payload);
    }
  };
}

module.exports = {
  makeGovernanceGuidanceMysqlRepository
};
