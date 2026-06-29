const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

let dataMapRepoPromise = null;
let dataMapRepositoryFactory = null;

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

function stableKey(prefix, parts) {
  const source = parts.map(part => cleanText(part)).join('|');
  const hash = crypto.createHash('sha1').update(source || prefix).digest('hex').slice(0, 16);
  return `${prefix}-${hash}`;
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(cleanText).filter(Boolean);
    } catch {
      // Fall through to comma-separated parsing.
    }
    return value.split(/[,\uFF0C;；、]/).map(cleanText).filter(Boolean);
  }
  return [];
}

function jsonOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function boolInt(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  return value ? 1 : 0;
}

function publicContext(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    context_id: Number(row.id),
    mapping_id: Number(row.id)
  };
}

function consumerSystemsFromLinks(links) {
  return links
    .filter(link => link.relation_type === 'consumer')
    .map(link => link.system_name)
    .filter(Boolean);
}

function publicField(row, links = []) {
  if (!row) return null;
  const consumers = consumerSystemsFromLinks(links);
  const primaryLink = links.find(link => link.is_primary) || links[0] || {};
  return {
    ...row,
    id: Number(row.id),
    context_id: Number(row.context_id),
    mapping_id: Number(row.context_id),
    object_id: row.object_id ? Number(row.object_id) : null,
    data_object: row.data_object || row.object_name_cn || null,
    field_type: row.data_type || null,
    note: row.business_definition || null,
    consume_systems: JSON.stringify(consumers),
    sync_mode: row.sync_mode || primaryLink.sync_mode || null,
    system_name: primaryLink.system_name || null,
    system_links: links
  };
}

function publicIdentity(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    field_id: Number(row.field_id),
    authoritative_system: row.authoritative_system_name || null,
    confirmed: row.confirmed ? 1 : 0
  };
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeContextPayload(payload = {}, actorUserId) {
  const title = cleanText(payload.title || payload.l3_name || payload.context_key);
  if (!title) throw httpError(400, '数据地图上下文标题不能为空');
  const actorPersonId = payload.actor_person_id || payload.actorPersonId || actorUserId || payload.updated_by || payload.created_by || null;
  return {
    context_key: cleanText(payload.context_key) || stableKey('ctx', [title, payload.dept_id, payload.a1_code, payload.source_file]),
    context_type: cleanText(payload.context_type) || 'process',
    title,
    dept_id: payload.dept_id ? Number(payload.dept_id) : null,
    dept_name: nullableText(payload.dept_name),
    owner_user_id: payload.owner_user_id ? Number(payload.owner_user_id) : null,
    owner_person_id: payload.owner_person_id ? Number(payload.owner_person_id) : (payload.owner_user_id ? Number(payload.owner_user_id) : null),
    process_snapshot_id: payload.process_snapshot_id ? Number(payload.process_snapshot_id) : null,
    process_mapping_record_id: payload.process_mapping_record_id ? Number(payload.process_mapping_record_id) : null,
    process_node_key: nullableText(payload.process_node_key),
    a1_code: nullableText(payload.a1_code),
    l3_name: nullableText(payload.l3_name),
    source_file: nullableText(payload.source_file),
    source_anchor: nullableText(payload.source_anchor),
    source_excerpt: nullableText(payload.source_excerpt),
    status: cleanText(payload.status) || 'active',
    actor_user_id: actorUserId || payload.updated_by || payload.created_by || null,
    actor_person_id: actorPersonId
  };
}

function normalizeObjectPayload(payload = {}, actorUserId) {
  const objectName = cleanText(payload.data_object || payload.object_name_cn || payload.object_name);
  if (!objectName) return null;
  const actorPersonId = payload.actor_person_id || payload.actorPersonId || actorUserId || payload.created_by || null;
  return {
    object_key: cleanText(payload.object_key) || stableKey('obj', [objectName]),
    object_name_cn: objectName,
    object_name_en: nullableText(payload.object_name_en),
    object_type: cleanText(payload.object_type) || 'master_data_reviewItem',
    owner_dept_id: payload.owner_dept_id ? Number(payload.owner_dept_id) : null,
    steward_user_id: payload.steward_user_id ? Number(payload.steward_user_id) : null,
    steward_person_id: payload.steward_person_id ? Number(payload.steward_person_id) : (payload.steward_user_id ? Number(payload.steward_user_id) : null),
    description: nullableText(payload.object_description || payload.description),
    status: cleanText(payload.object_status) || 'active',
    source_type: cleanText(payload.source_type) || 'field_ledger',
    source_ref: nullableText(payload.source_ref),
    actor_user_id: actorUserId || payload.created_by || null,
    actor_person_id: actorPersonId
  };
}

function normalizeFieldPayload(payload = {}, actorUserId, existing = {}) {
  const contextId = Number(payload.context_id || payload.mapping_id || existing.context_id || 0);
  if (!contextId) throw httpError(400, '缺少 context_id');
  const fieldNameCn = nullableText(payload.field_name_cn ?? existing.field_name_cn);
  const fieldNameEn = nullableText(payload.field_name_en ?? existing.field_name_en);
  const fieldKey = cleanText(payload.field_key) || existing.field_key || stableKey('field', [contextId, fieldNameCn, fieldNameEn, payload.data_object || existing.data_object]);
  const actorPersonId = payload.actor_person_id || payload.actorPersonId || actorUserId || payload.updated_by || payload.created_by || null;
  return {
    context_id: contextId,
    field_key: fieldKey,
    field_name_cn: fieldNameCn,
    field_name_en: fieldNameEn,
    business_definition: nullableText(payload.business_definition ?? payload.note ?? existing.business_definition),
    data_type: nullableText(payload.data_type ?? payload.field_type ?? existing.data_type),
    data_format: nullableText(payload.data_format ?? existing.data_format),
    length_precision: nullableText(payload.length_precision ?? existing.length_precision),
    nullable: boolInt(payload.nullable, existing.nullable === undefined ? 1 : Number(existing.nullable)),
    enum_values_json: jsonOrNull(payload.enum_values_json ?? payload.enum_values ?? existing.enum_values_json),
    sensitivity_level: cleanText(payload.sensitivity_level || existing.sensitivity_level) || 'internal',
    master_data_level: cleanText(payload.master_data_level || existing.master_data_level) || 'needs_review',
    process_governance_node_key: nullableText(payload.process_governance_node_key ?? existing.process_governance_node_key),
    process_governance_a1_code: nullableText(payload.process_governance_a1_code ?? existing.process_governance_a1_code),
    source_file: nullableText(payload.source_file ?? existing.source_file),
    source_anchor: nullableText(payload.source_anchor ?? existing.source_anchor),
    source_excerpt: nullableText(payload.source_excerpt ?? existing.source_excerpt),
    status: cleanText(payload.status || existing.status) || 'draft',
    quality_status: cleanText(payload.quality_status || existing.quality_status) || 'unchecked',
    submitted_by: payload.submitted_by ? Number(payload.submitted_by) : (existing.submitted_by || actorUserId || null),
    submitted_by_person_id: payload.submitted_by_person_id ? Number(payload.submitted_by_person_id) : (existing.submitted_by_person_id || payload.submitted_by || actorUserId || null),
    actor_user_id: actorUserId || payload.updated_by || payload.created_by || null,
    actor_person_id: actorPersonId
  };
}

function fieldSystemLinks(payload = {}) {
  if (Array.isArray(payload.system_links)) {
    return payload.system_links
      .map(link => ({
        system_name: cleanText(link.system_name || link.name),
        system_code: nullableText(link.system_code || link.code),
        relation_type: cleanText(link.relation_type) || 'consumer',
        sync_mode: nullableText(link.sync_mode || payload.sync_mode),
        interface_note: nullableText(link.interface_note),
        is_primary: link.is_primary ? 1 : 0,
        status: cleanText(link.status) || 'active'
      }))
      .filter(link => link.system_name);
  }

  return parseList(payload.consume_systems).map((systemName, index) => ({
    system_name: systemName,
    system_code: null,
    relation_type: 'consumer',
    sync_mode: nullableText(payload.sync_mode),
    interface_note: nullableText(payload.interface_note),
    is_primary: index === 0 ? 1 : 0,
    status: 'active'
  }));
}

function normalizeIdentityPayload(payload = {}) {
  return {
    authoritative_system_name: nullableText(payload.authoritative_system_name || payload.authoritative_system),
    authoritative_system_code: nullableText(payload.authoritative_system_code),
    maintain_dept_id: payload.maintain_dept_id ? Number(payload.maintain_dept_id) : null,
    owner_user_id: payload.owner_user_id ? Number(payload.owner_user_id) : null,
    owner_person_id: payload.owner_person_id ? Number(payload.owner_person_id) : (payload.owner_user_id ? Number(payload.owner_user_id) : null),
    confidence_level: cleanText(payload.confidence_level) || 'medium',
    confirmed: payload.confirmed ? 1 : 0,
    note: nullableText(payload.note),
    status: cleanText(payload.status) || (payload.confirmed ? 'confirmed' : 'needs_review')
  };
}

function issueFromTerm(fieldName, term) {
  const forbidden = cleanText(term.forbidden_term);
  if (!forbidden || !fieldName.includes(forbidden)) return null;
  const preferred = cleanText(term.preferred_term || term.term);
  return {
    severity: cleanText(term.severity) || 'warn',
    issue_type: 'naming_term',
    message: `字段名命中禁用词：${forbidden}${preferred ? `，请使用 ${preferred}` : ''}`,
    suggestion: preferred ? `建议改为 ${preferred}` : null
  };
}

function issueFromRule(fieldName, rule) {
  const matchValue = cleanText(rule.match_value);
  if (!matchValue || !fieldName.includes(matchValue)) return null;
  const replacement = cleanText(rule.replacement_value);
  return {
    severity: cleanText(rule.severity) || 'warn',
    issue_type: 'naming_warn',
    message: `字段名命中命名规则：${matchValue}${replacement ? `，建议使用 ${replacement}` : ''}`,
    suggestion: replacement || null
  };
}

function makeDataMapMysqlRepository(pool) {
  async function ensureObject(payload, actorUserId) {
    const normalized = normalizeObjectPayload(payload, actorUserId);
    if (!normalized) return null;
    await pool.execute(
      `INSERT INTO data_map_objects
        (object_key, object_name_cn, object_name_en, object_type, owner_dept_id, steward_user_id, steward_person_id,
         description, status, source_type, source_ref, created_by, created_by_person_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        object_name_cn=VALUES(object_name_cn),
        object_name_en=VALUES(object_name_en),
        object_type=VALUES(object_type),
        owner_dept_id=VALUES(owner_dept_id),
        steward_user_id=VALUES(steward_user_id),
        steward_person_id=VALUES(steward_person_id),
        description=VALUES(description),
        status=VALUES(status),
        source_type=VALUES(source_type),
        source_ref=VALUES(source_ref),
        updated_by=VALUES(created_by),
        updated_by_person_id=VALUES(created_by_person_id),
        updated_at=CURRENT_TIMESTAMP`,
      [
        normalized.object_key,
        normalized.object_name_cn,
        normalized.object_name_en,
        normalized.object_type,
        normalized.owner_dept_id,
        normalized.steward_user_id,
        normalized.steward_person_id,
        normalized.description,
        normalized.status,
        normalized.source_type,
        normalized.source_ref,
        normalized.actor_user_id,
        normalized.actor_person_id
      ]
    );
    return await first(pool, 'SELECT * FROM data_map_objects WHERE object_key=?', [normalized.object_key]);
  }

  async function getLinksForFields(fieldIds) {
    const ids = fieldIds.map(Number).filter(id => Number.isInteger(id) && id > 0);
    if (!ids.length) return new Map();
    const linkRows = await rows(
      pool,
      `SELECT *
       FROM data_map_field_system_links
       WHERE field_id IN (${ids.map(() => '?').join(', ')})
       ORDER BY field_id, is_primary DESC, id`,
      ids
    );
    const byField = new Map();
    for (const link of linkRows) {
      const key = Number(link.field_id);
      if (!byField.has(key)) byField.set(key, []);
      byField.get(key).push(link);
    }
    return byField;
  }

  async function replaceFieldLinks(fieldId, payload) {
    await pool.execute('DELETE FROM data_map_field_system_links WHERE field_id=?', [fieldId]);
    for (const link of fieldSystemLinks(payload)) {
      await pool.execute(
        `INSERT INTO data_map_field_system_links
          (field_id, system_name, system_code, relation_type, sync_mode, interface_note, is_primary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fieldId,
          link.system_name,
          link.system_code,
          link.relation_type,
          link.sync_mode,
          link.interface_note,
          link.is_primary,
          link.status
        ]
      );
    }
  }

  async function getFieldWithLinks(fieldId) {
    const row = await first(
      pool,
      `SELECT f.*, o.object_name_cn AS data_object, o.object_key
       FROM data_map_fields f
       LEFT JOIN data_map_objects o ON f.object_id = o.id
       WHERE f.id=?
       LIMIT 1`,
      [fieldId]
    );
    if (!row) return null;
    const links = await getLinksForFields([row.id]);
    return publicField(row, links.get(Number(row.id)) || []);
  }

  async function createQualityIssue(fieldId, contextId, issue, actorUserId) {
    await pool.execute(
      `INSERT INTO data_map_quality_issues
        (field_id, context_id, issue_type, severity, message, suggestion, status, created_by, created_by_person_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fieldId || null,
        contextId || null,
        issue.issue_type || 'naming_warn',
        issue.severity || 'warn',
        issue.message,
        issue.suggestion || null,
        'open',
        actorUserId || null,
        actorUserId || null
      ]
    );
  }

  async function auditUpdate(entityType, entityId, actorUserId, description, changes) {
    if (!changes.length) return;
    const result = await pool.execute(
      `INSERT INTO data_map_change_sets (entity_type, entity_id, operated_by, operated_by_person_id, description)
       VALUES (?, ?, ?, ?, ?)`,
      [entityType, entityId, actorUserId || null, actorUserId || null, description]
    );
    const changeSetId = insertId(result);
    for (const change of changes) {
      await pool.execute(
        `INSERT INTO data_map_version_log
          (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by, operated_by_person_id, change_set_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entityType,
          entityId,
          change.field_name,
          change.old_value == null ? null : String(change.old_value),
          change.new_value == null ? null : String(change.new_value),
          change.operation || 'update',
          actorUserId || null,
          actorUserId || null,
          changeSetId || null
        ]
      );
    }
  }

  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async createContext(payload = {}, actorUserId = null) {
      const normalized = normalizeContextPayload(payload, actorUserId);
      const result = await pool.execute(
        `INSERT INTO data_map_contexts
          (context_key, context_type, title, dept_id, dept_name, owner_user_id, owner_person_id, process_snapshot_id,
           process_mapping_record_id, process_node_key, a1_code, l3_name, source_file, source_anchor,
           source_excerpt, status, created_by, created_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized.context_key,
          normalized.context_type,
          normalized.title,
          normalized.dept_id,
          normalized.dept_name,
          normalized.owner_user_id,
          normalized.owner_person_id,
          normalized.process_snapshot_id,
          normalized.process_mapping_record_id,
          normalized.process_node_key,
          normalized.a1_code,
          normalized.l3_name,
          normalized.source_file,
          normalized.source_anchor,
          normalized.source_excerpt,
          normalized.status,
          normalized.actor_user_id,
          normalized.actor_person_id
        ]
      );
      return await this.getContext(insertId(result));
    },

    async listContexts() {
      return (await rows(
        pool,
        `SELECT *
         FROM data_map_contexts
         ORDER BY updated_at DESC, id DESC`
      )).map(publicContext);
    },

    async getContext(contextId) {
      return publicContext(await first(pool, 'SELECT * FROM data_map_contexts WHERE id=? LIMIT 1', [contextId]));
    },

    async updateContext(contextId, payload = {}, actorUserId = null) {
      const existing = await this.getContext(contextId);
      if (!existing) return null;
      const normalized = normalizeContextPayload({ ...existing, ...payload }, actorUserId);
      const result = await pool.execute(
        `UPDATE data_map_contexts
         SET context_key=?, context_type=?, title=?, dept_id=?, dept_name=?, owner_user_id=?, owner_person_id=?,
             process_snapshot_id=?, process_mapping_record_id=?, process_node_key=?, a1_code=?, l3_name=?,
             source_file=?, source_anchor=?, source_excerpt=?, status=?, updated_by=?, updated_by_person_id=?
         WHERE id=?`,
        [
          normalized.context_key,
          normalized.context_type,
          normalized.title,
          normalized.dept_id,
          normalized.dept_name,
          normalized.owner_user_id,
          normalized.owner_person_id,
          normalized.process_snapshot_id,
          normalized.process_mapping_record_id,
          normalized.process_node_key,
          normalized.a1_code,
          normalized.l3_name,
          normalized.source_file,
          normalized.source_anchor,
          normalized.source_excerpt,
          normalized.status,
          normalized.actor_user_id,
          normalized.actor_person_id,
          contextId
        ]
      );
      return affectedRows(result) > 0 ? await this.getContext(contextId) : null;
    },

    async validateFieldName(fieldName) {
      const name = cleanText(fieldName);
      const termRows = await rows(
        pool,
        `SELECT term, term_type_code, preferred_term, forbidden_term, definition, scope_type, severity, status
         FROM data_map_terms
         WHERE status='active'`
      );
      const ruleRows = await rows(
        pool,
        `SELECT id, rule_type, match_value, replacement_value, severity, status
         FROM data_map_naming_rules
         WHERE status='active'`
      );
      const issues = [
        ...termRows.map(term => issueFromTerm(name, term)).filter(Boolean),
        ...ruleRows.map(rule => issueFromRule(name, rule)).filter(Boolean)
      ];
      return {
        allowed: !issues.some(issue => issue.severity === 'block'),
        issues
      };
    },

    async createField(payload = {}, actorUserId = null) {
      const normalized = normalizeFieldPayload(payload, actorUserId);
      const context = await this.getContext(normalized.context_id);
      if (!context) throw httpError(404, '数据地图上下文不存在');
      const validation = await this.validateFieldName(normalized.field_name_cn || '');
      if (!validation.allowed) {
        throw httpError(400, validation.issues.find(issue => issue.severity === 'block').message);
      }
      const object = await ensureObject(payload, actorUserId);
      const result = await pool.execute(
        `INSERT INTO data_map_fields
          (context_id, object_id, field_key, field_name_cn, field_name_en, business_definition,
           data_type, data_format, length_precision, nullable, enum_values_json, sensitivity_level,
           master_data_level, process_governance_node_key, process_governance_a1_code, source_file,
           source_anchor, source_excerpt, status, quality_status, submitted_by, submitted_by_person_id, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          normalized.context_id,
          object ? object.id : null,
          normalized.field_key,
          normalized.field_name_cn,
          normalized.field_name_en,
          normalized.business_definition,
          normalized.data_type,
          normalized.data_format,
          normalized.length_precision,
          normalized.nullable,
          normalized.enum_values_json,
          normalized.sensitivity_level,
          normalized.master_data_level,
          normalized.process_governance_node_key,
          normalized.process_governance_a1_code,
          normalized.source_file,
          normalized.source_anchor,
          normalized.source_excerpt,
          normalized.status,
          validation.issues.length ? 'warn' : normalized.quality_status,
          normalized.submitted_by,
          normalized.submitted_by_person_id
        ]
      );
      const fieldId = insertId(result);
      await replaceFieldLinks(fieldId, payload);
      for (const issue of validation.issues.filter(item => item.severity !== 'block')) {
        await createQualityIssue(fieldId, normalized.context_id, issue, actorUserId);
      }
      return await getFieldWithLinks(fieldId);
    },

    async getFieldsByContext(contextId) {
      const fieldRows = await rows(
        pool,
        `SELECT f.*, o.object_name_cn AS data_object, o.object_key
         FROM data_map_fields f
         LEFT JOIN data_map_objects o ON f.object_id = o.id
         WHERE f.context_id=?
         ORDER BY f.id`,
        [contextId]
      );
      const links = await getLinksForFields(fieldRows.map(row => row.id));
      return fieldRows.map(row => publicField(row, links.get(Number(row.id)) || []));
    },

    async getField(fieldId) {
      return await getFieldWithLinks(fieldId);
    },

    async updateField(fieldId, payload = {}, actorUserId = null) {
      const existing = await getFieldWithLinks(fieldId);
      if (!existing) return null;
      const normalized = normalizeFieldPayload({ ...existing, ...payload, context_id: existing.context_id }, actorUserId, existing);
      const validation = await this.validateFieldName(normalized.field_name_cn || '');
      if (!validation.allowed) {
        throw httpError(400, validation.issues.find(issue => issue.severity === 'block').message);
      }
      const object = await ensureObject({ ...payload, data_object: payload.data_object || existing.data_object }, actorUserId);
      const comparable = {
        object_id: object ? object.id : null,
        field_key: normalized.field_key,
        field_name_cn: normalized.field_name_cn,
        field_name_en: normalized.field_name_en,
        business_definition: normalized.business_definition,
        data_type: normalized.data_type,
        data_format: normalized.data_format,
        length_precision: normalized.length_precision,
        nullable: normalized.nullable,
        enum_values_json: normalized.enum_values_json,
        sensitivity_level: normalized.sensitivity_level,
        master_data_level: normalized.master_data_level,
        process_governance_node_key: normalized.process_governance_node_key,
        process_governance_a1_code: normalized.process_governance_a1_code,
        source_file: normalized.source_file,
        source_anchor: normalized.source_anchor,
        source_excerpt: normalized.source_excerpt,
        status: normalized.status,
        quality_status: validation.issues.length ? 'warn' : normalized.quality_status
      };
      const changes = Object.entries(comparable)
        .filter(([key, value]) => String(existing[key] ?? '') !== String(value ?? ''))
        .map(([key, value]) => ({ field_name: key, old_value: existing[key], new_value: value }));
      await auditUpdate('data_map_field', fieldId, actorUserId, '更新字段', changes);
      const result = await pool.execute(
        `UPDATE data_map_fields
         SET object_id=?, field_key=?, field_name_cn=?, field_name_en=?, business_definition=?,
             data_type=?, data_format=?, length_precision=?, nullable=?, enum_values_json=?,
             sensitivity_level=?, master_data_level=?, process_governance_node_key=?, process_governance_a1_code=?,
             source_file=?, source_anchor=?, source_excerpt=?, status=?, quality_status=?, reviewed_by=?,
             reviewed_by_person_id=?,
             reviewed_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [
          comparable.object_id,
          comparable.field_key,
          comparable.field_name_cn,
          comparable.field_name_en,
          comparable.business_definition,
          comparable.data_type,
          comparable.data_format,
          comparable.length_precision,
          comparable.nullable,
          comparable.enum_values_json,
          comparable.sensitivity_level,
          comparable.master_data_level,
          comparable.process_governance_node_key,
          comparable.process_governance_a1_code,
          comparable.source_file,
          comparable.source_anchor,
          comparable.source_excerpt,
          comparable.status,
          comparable.quality_status,
          actorUserId || null,
          actorUserId || null,
          fieldId
        ]
      );
      if (affectedRows(result) === 0) return null;
      await replaceFieldLinks(fieldId, payload);
      for (const issue of validation.issues.filter(item => item.severity !== 'block')) {
        await createQualityIssue(fieldId, normalized.context_id, issue, actorUserId);
      }
      return await getFieldWithLinks(fieldId);
    },

    async deleteField(fieldId, actorUserId = null) {
      await auditUpdate('data_map_field', fieldId, actorUserId, '删除字段', [
        { field_name: 'id', old_value: fieldId, new_value: null, operation: 'delete' }
      ]);
      const result = await pool.execute('DELETE FROM data_map_fields WHERE id=?', [fieldId]);
      return affectedRows(result) > 0;
    },

    async getFieldIdentity(fieldId) {
      return publicIdentity(await first(pool, 'SELECT * FROM data_map_field_identities WHERE field_id=? LIMIT 1', [fieldId]));
    },

    async upsertFieldIdentity(fieldId, payload = {}) {
      const normalized = normalizeIdentityPayload(payload);
      await pool.execute(
        `INSERT INTO data_map_field_identities
          (field_id, authoritative_system_name, authoritative_system_code, maintain_dept_id, owner_user_id, owner_person_id,
           confidence_level, confirmed, note, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          authoritative_system_name=VALUES(authoritative_system_name),
          authoritative_system_code=VALUES(authoritative_system_code),
          maintain_dept_id=VALUES(maintain_dept_id),
          owner_user_id=VALUES(owner_user_id),
          owner_person_id=VALUES(owner_person_id),
          confidence_level=VALUES(confidence_level),
          confirmed=VALUES(confirmed),
          note=VALUES(note),
          status=VALUES(status),
          updated_at=CURRENT_TIMESTAMP`,
        [
          fieldId,
          normalized.authoritative_system_name,
          normalized.authoritative_system_code,
          normalized.maintain_dept_id,
          normalized.owner_user_id,
          normalized.owner_person_id,
          normalized.confidence_level,
          normalized.confirmed,
          normalized.note,
          normalized.status
        ]
      );
      return await this.getFieldIdentity(fieldId);
    },

    async confirmFieldIdentity(fieldId, payload = {}, actorUserId = null) {
      const normalized = normalizeIdentityPayload({ ...payload, confirmed: true, status: 'confirmed' });
      const result = await pool.execute(
        `UPDATE data_map_field_identities
         SET authoritative_system_name=?,
             authoritative_system_code=?,
             confirmed=1,
             confirmed_by=?,
             confirmed_by_person_id=?,
             status=?,
             confirmed_at=CURRENT_TIMESTAMP,
             updated_at=CURRENT_TIMESTAMP
         WHERE field_id=?`,
        [
          normalized.authoritative_system_name,
          normalized.authoritative_system_code,
          actorUserId || null,
          actorUserId || null,
          'confirmed',
          fieldId
        ]
      );
      return affectedRows(result) > 0 ? await this.getFieldIdentity(fieldId) : null;
    },

    async fieldIdentityProgress() {
      const overall = await first(
        pool,
        `SELECT COUNT(*) AS total, SUM(CASE WHEN confirmed=1 THEN 1 ELSE 0 END) AS confirmed
         FROM data_map_field_identities`
      ) || { total: 0, confirmed: 0 };
      const byDomain = await rows(
        pool,
        `SELECT COALESCE(o.object_name_cn, '未归类') AS domain,
                COUNT(fi.id) AS total,
                SUM(CASE WHEN fi.confirmed=1 THEN 1 ELSE 0 END) AS confirmed
         FROM data_map_field_identities fi
         JOIN data_map_fields f ON fi.field_id = f.id
         LEFT JOIN data_map_objects o ON f.object_id = o.id
         GROUP BY o.object_name_cn
         ORDER BY o.object_name_cn`
      );
      const total = Number(overall.total || 0);
      const confirmed = Number(overall.confirmed || 0);
      return {
        overall: { total, confirmed, pct: total > 0 ? Math.round((confirmed / total) * 100) : 0 },
        by_domain: byDomain.map(row => {
          const rowTotal = Number(row.total || 0);
          const rowConfirmed = Number(row.confirmed || 0);
          return {
            domain: row.domain,
            total: rowTotal,
            confirmed: rowConfirmed,
            pct: rowTotal > 0 ? Math.round((rowConfirmed / rowTotal) * 100) : 0
          };
        })
      };
    },

    async recordImportBatch(payload = {}) {
      const result = await pool.execute(
        `INSERT INTO data_map_import_batches
          (source_type, file_name, context_id, imported_by, row_count, status, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.source_type || 'excel',
          payload.file_name || null,
          payload.context_id || null,
          payload.imported_by || null,
          Number(payload.row_count || 0),
          payload.status || 'imported',
          payload.note || null
        ]
      );
      return { id: insertId(result) };
    },

    async exportFieldLedger() {
      const contexts = await this.listContexts();
      const fields = [];
      for (const context of contexts) {
        const contextFields = await this.getFieldsByContext(context.id);
        for (const field of contextFields) {
          const identity = await this.getFieldIdentity(field.id);
          fields.push({
            ...field,
            process_name: context.title,
            l3_name: context.l3_name,
            system_name: field.system_name || consumerSystemsFromLinks(field.system_links || [])[0] || '',
            authoritative_system: identity ? identity.authoritative_system : '',
            maintain_dept: '',
            confirmed: identity ? identity.confirmed : 0,
            confirmer: '',
            confirmed_at: identity ? identity.confirmed_at : null
          });
        }
      }
      return { fields, identities: fields };
    }
  };
}

async function dataMapRepository() {
  if (dataMapRepositoryFactory) return await dataMapRepositoryFactory();
  if (!dataMapRepoPromise) {
    dataMapRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeDataMapMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await dataMapRepoPromise;
  } catch (error) {
    dataMapRepoPromise = null;
    throw error;
  }
}

function setDataMapRepositoryFactory(factory) {
  dataMapRepositoryFactory = factory;
  dataMapRepoPromise = null;
}

function resetDataMapRepositoryFactory() {
  dataMapRepositoryFactory = null;
  dataMapRepoPromise = null;
}

module.exports = {
  dataMapRepository,
  makeDataMapMysqlRepository,
  resetDataMapRepositoryFactory,
  setDataMapRepositoryFactory
};
