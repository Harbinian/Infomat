const {
  V2,
  contentHash,
  normalizeProcessGovernanceDocument
} = require('./processGovernanceV2');

const MIGRATION_KEY = '2026-07-31-process-governance-unified-entry';

const HANDOFF_STATUSES = Object.freeze([
  'pending_assignment',
  'pending_origin_review',
  'pending_counterparty_scope',
  'pending_counterparty_detail',
  'pending_counterparty_review',
  'pending_structure_gate',
  'conflict_open',
  'confirmed',
  'closed_not_required',
  'returned',
  'rejected',
  'escalated'
]);

const DRAFT_COLUMNS = Object.freeze([
  ['schema_version', "VARCHAR(64) NOT NULL DEFAULT 'process-governance-v2'"],
  ['process_content_json', 'MEDIUMTEXT NULL'],
  ['content_hash', 'CHAR(64) NULL'],
  ['revision_no', 'INT NOT NULL DEFAULT 0'],
  ['content_updated_by', 'BIGINT NULL'],
  ['content_updated_at', 'TIMESTAMP NULL']
]);

const VERSION_COLUMNS = Object.freeze([
  ['schema_version', "VARCHAR(64) NOT NULL DEFAULT 'process-governance-v2'"],
  ['process_content_json', 'MEDIUMTEXT NULL'],
  ['content_hash', 'CHAR(64) NULL'],
  ['source_revision_no', 'INT NULL']
]);

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function runIgnoring(pool, sql, ignoredCodes) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && ignoredCodes.includes(error.code)) return;
    throw error;
  }
}

async function tableExists(pool, tableName) {
  const result = await rows(pool, `
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
  `, [tableName]);
  return Number(result[0] && result[0].count || 0) > 0;
}

async function columnNames(pool, tableName) {
  if (!await tableExists(pool, tableName)) return new Set();
  const result = await rows(pool, `
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
  `, [tableName]);
  return new Set(result.map(row => row.COLUMN_NAME));
}

async function indexNames(pool, tableName) {
  if (!await tableExists(pool, tableName)) return new Set();
  const result = await rows(pool, `
    SELECT DISTINCT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
  `, [tableName]);
  return new Set(result.map(row => row.INDEX_NAME));
}

async function migrationApplied(pool) {
  const result = await rows(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return Boolean(result[0]);
}

async function dropMatchingChecks(pool, tableName, marker) {
  const checks = await rows(pool, `
    SELECT tc.CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
     AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE()
      AND tc.TABLE_NAME=?
      AND tc.CONSTRAINT_TYPE='CHECK'
      AND LOWER(cc.CHECK_CLAUSE) LIKE ?
  `, [tableName, `%${String(marker).toLowerCase()}%`]);
  for (const check of checks) {
    await pool.execute(`ALTER TABLE \`${tableName}\` DROP CHECK \`${check.CONSTRAINT_NAME}\``);
  }
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function nullableText(value) {
  const cleaned = text(value);
  return cleaned || null;
}

function publicJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableTechnicalRef(prefix, id, preferred) {
  const raw = text(preferred);
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(raw)) return raw;
  const cleaned = raw.replace(/[^A-Za-z0-9._:-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 120);
  return `${prefix}_${cleaned || id}`.slice(0, 160);
}

function dateTimeValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '1970-01-01T00:00:00.000Z';
}

function legacySnapshotMaterial(legacy, draft) {
  const snapshot = publicJson(legacy);
  const readableText = JSON.stringify(snapshot);
  const asOfDate = dateTimeValue(draft.updated_at || draft.created_at).slice(0, 10);
  return {
    material_ref: stableTechnicalRef('legacy_snapshot', draft.id),
    material_type: '其他参考材料',
    material_name: 'MDM迁移前完整结构快照',
    document_no: nullableText(draft.document_no),
    version: nullableText(draft.planned_edition),
    file_sha256: contentHash(snapshot),
    readable_text: readableText,
    provider_department: text(draft.department_name),
    provider_name: '',
    as_of_date: asOfDate
  };
}

function convertLegacyProcessDesignContent(legacyInput) {
  const legacy = publicJson(legacyInput || {});
  const draft = legacy.draft || {};
  const profile = legacy.documentProfile || legacy.document_profile || {};
  const processes = list(legacy.processes);
  const activeSteps = list(legacy.steps).filter(step => text(step.status || 'active') !== 'voided');
  const transitions = list(legacy.stepTransitions || legacy.step_transitions);
  const forms = list(legacy.forms);
  const terms = list(legacy.terms);
  const firstProcess = processes[0] || {};
  const processRef = stableTechnicalRef(
    'draft',
    draft.id,
    firstProcess.source_process_ref || `draft_${draft.id}`
  );
  const stepRefs = new Map(activeSteps.map(step => [
    Number(step.id),
    stableTechnicalRef('step', step.id, step.source_behavior_ref || `step_${step.id}`)
  ]));
  const behaviors = activeSteps.map(step => {
    const detail = step.behaviorDetail || step.behavior_detail || {};
    return {
      behavior_ref: stepRefs.get(Number(step.id)),
      node_type: ['action', 'decision'].includes(text(step.step_type)) ? text(step.step_type) : 'action',
      behavior_name: text(step.step_name),
      behavior_description: '',
      current_actor_role: text(step.actor_role),
      trigger: text(detail.trigger_scene),
      precondition: text(detail.precondition),
      input_description: text(step.input_materials),
      timing: nullableText(step.timing),
      completion_standard: text(detail.execution_standard),
      output_description: text(step.output_result),
      input_data_refs: [],
      output_data_refs: [],
      work_role: null,
      countersign_all_required: false,
      countersign_target_departments: []
    };
  });

  const relationKeys = new Set();
  const flowRelations = [];
  function appendRelation(relation) {
    const key = `${relation.from_behavior_ref || ''}|${relation.to_behavior_ref || ''}|${relation.condition}|${relation.relation_type}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    flowRelations.push(relation);
  }
  transitions.forEach(transition => {
    const fromRef = stepRefs.get(Number(transition.from_step_id)) || null;
    const toRef = stepRefs.get(Number(transition.to_step_id)) || null;
    if (!fromRef) return;
    appendRelation({
      relation_ref: stableTechnicalRef('transition', transition.id),
      relation_type: text(transition.condition_text) ? 'condition' : 'sequence',
      from_behavior_ref: fromRef,
      to_behavior_ref: toRef,
      condition: text(transition.condition_text),
      join_mode: ''
    });
  });
  const stepsByProcess = new Map();
  activeSteps.forEach(step => {
    const key = Number(step.process_id || 0);
    if (!stepsByProcess.has(key)) stepsByProcess.set(key, []);
    stepsByProcess.get(key).push(step);
  });
  for (const processSteps of stepsByProcess.values()) {
    processSteps.sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) || Number(left.id) - Number(right.id));
    for (let index = 0; index < processSteps.length - 1; index += 1) {
      const from = processSteps[index];
      const to = processSteps[index + 1];
      const fromRef = stepRefs.get(Number(from.id));
      const toRef = stepRefs.get(Number(to.id));
      const hasExplicitOutgoing = flowRelations.some(relation => relation.from_behavior_ref === fromRef);
      if (!hasExplicitOutgoing) {
        appendRelation({
          relation_ref: stableTechnicalRef('sequence', `${from.id}_${to.id}`),
          relation_type: 'sequence',
          from_behavior_ref: fromRef,
          to_behavior_ref: toRef,
          condition: '',
          join_mode: ''
        });
      }
    }
  }

  const handoffs = activeSteps.flatMap(step => list(step.handoffs).map(handoff => ({ ...handoff, __step_id: step.id })));
  const dataObjectsByRef = new Map();
  handoffs.forEach(handoff => {
    [
      [handoff.transfer_data_ref, handoff.transfer_data_name],
      [handoff.returned_data_ref, handoff.returned_data_name]
    ].forEach(([rawRef, rawName]) => {
      if (!text(rawRef)) return;
      const ref = stableTechnicalRef('data', handoff.id, rawRef);
      if (!dataObjectsByRef.has(ref)) {
        dataObjectsByRef.set(ref, {
          data_ref: ref,
          data_name: text(rawName),
          description: '',
          governance_status: 'candidate',
          produced_by_behavior_ref: null,
          consumed_by_behavior_refs: []
        });
      }
    });
  });
  const crossDepartmentHandoffs = handoffs.map(handoff => {
    const direction = ['inbound_prerequisite', 'outbound_followup'].includes(text(handoff.handoff_direction))
      ? text(handoff.handoff_direction)
      : 'outbound_followup';
    const sourceDepartment = text(handoff.source_department)
      || (direction === 'outbound_followup' ? text(draft.department_name) : '');
    const targetDepartment = text(handoff.target_department)
      || (direction === 'inbound_prerequisite' ? text(draft.department_name) : '');
    const externalDepartment = direction === 'inbound_prerequisite' ? sourceDepartment : targetDepartment;
    const transferRef = nullableText(handoff.transfer_data_ref)
      ? stableTechnicalRef('data', handoff.id, handoff.transfer_data_ref)
      : null;
    const returnedRef = nullableText(handoff.returned_data_ref)
      ? stableTechnicalRef('data', handoff.id, handoff.returned_data_ref)
      : null;
    const mappedResumeRef = stepRefs.get(Number(handoff.resume_step_id)) || null;
    return {
      handoff_ref: stableTechnicalRef('handoff', handoff.id, handoff.handoff_ref),
      handoff_direction: direction,
      anchor_behavior_ref: stepRefs.get(Number(handoff.__step_id)) || null,
      counterparty_resolution: text(handoff.counterparty_resolution) === 'needs_identification' || !externalDepartment
        ? 'needs_identification'
        : 'identified',
      source_department: sourceDepartment,
      target_department: targetDepartment,
      transfer_data_ref: transferRef,
      requested_matter: text(handoff.requested_matter),
      trigger_condition: text(handoff.trigger_condition),
      completion_standard: text(handoff.completion_standard || handoff.handoff_standard),
      counterparty_process_ref: nullableText(handoff.counterparty_process_ref || handoff.target_process_code)
        ? stableTechnicalRef('counterparty_process', handoff.id, handoff.counterparty_process_ref || handoff.target_process_code)
        : null,
      counterparty_process_name: text(handoff.counterparty_process_name || handoff.target_process_name),
      counterparty_behavior_ref: nullableText(handoff.counterparty_behavior_ref || handoff.target_behavior_code)
        ? stableTechnicalRef('counterparty_behavior', handoff.id, handoff.counterparty_behavior_ref || handoff.target_behavior_code)
        : null,
      counterparty_behavior_name: text(handoff.counterparty_behavior_name || handoff.target_behavior_name),
      requires_return: Boolean(handoff.requires_return || returnedRef || handoff.resume_behavior_ref),
      returned_data_ref: returnedRef,
      resume_behavior_ref: mappedResumeRef ||
        (nullableText(handoff.resume_behavior_ref) && Array.from(stepRefs.values()).includes(text(handoff.resume_behavior_ref))
          ? text(handoff.resume_behavior_ref)
          : null)
    };
  });

  const normalizedForms = forms.map(form => {
    const areas = [];
    const mainFields = list(form.main_fields || form.fields);
    if (mainFields.length || text(form.main_table_name)) {
      areas.push({
        area_ref: stableTechnicalRef('form_main', form.id),
        area_type: '基本信息',
        area_title: text(form.main_table_name) || '基本信息',
        items: mainFields.map(field => ({
          item_ref: stableTechnicalRef('field', field.id, field.field_code || field.field_no),
          item_name: text(field.field_name || field.field_name_cn),
          item_type: text(field.field_type),
          required: Boolean(field.is_required),
          instructions: text(field.description || field.evidence_note)
        }))
      });
    }
    list(form.tables).forEach(table => {
      areas.push({
        area_ref: stableTechnicalRef('form_detail', table.id, table.table_code || table.table_no),
        area_type: '明细清单',
        area_title: text(table.table_name),
        items: list(table.fields).map(field => ({
          item_ref: stableTechnicalRef('field', field.id, field.field_code || field.field_no),
          item_name: text(field.field_name || field.field_name_cn),
          item_type: text(field.field_type),
          required: Boolean(field.is_required),
          instructions: text(field.description || field.evidence_note)
        }))
      });
    });
    return {
      form_ref: stableTechnicalRef('form', form.id, form.form_code),
      behavior_ref: stepRefs.get(Number(form.step_id)) || null,
      form_name: text(form.form_name),
      form_no: nullableText(form.form_code),
      areas
    };
  });

  const document = {
    schema_version: V2,
    export_meta: {
      package_ref: stableTechnicalRef('migration_package', draft.id),
      exported_at: dateTimeValue(draft.updated_at || draft.created_at),
      initiating_department: text(draft.department_name),
      compiler: 'MDM历史结构迁移'
    },
    process: {
      process_ref: processRef,
      process_name: text(draft.process_name || profile.document_title),
      owning_department: text(draft.department_name),
      purpose: text(profile.purpose),
      scope: text(profile.scope),
      capability_domain: nullableText(draft.l1_name || firstProcess.l1_name),
      business_capability: nullableText(draft.l2_name || firstProcess.l2_name),
      classification_status: ['unclassified', 'needs_review', 'confirmed'].includes(text(draft.l2_status))
        ? text(draft.l2_status)
        : 'unclassified'
    },
    reference_materials: [legacySnapshotMaterial(legacy, draft)],
    behaviors,
    flow_relations: flowRelations,
    data_objects: Array.from(dataObjectsByRef.values()),
    cross_department_handoffs: crossDepartmentHandoffs,
    internal_process_calls: [],
    forms: normalizedForms,
    terms: terms.map(term => ({
      term_ref: stableTechnicalRef('term', term.id),
      term_name: text(term.term_name),
      definition: text(term.definition)
    })),
    migration: {
      source_schema_version: 'mdm-process-design-legacy',
      source_process_ref: nullableText(processRef),
      source_process_count: Math.max(processes.length, 1)
    }
  };
  return normalizeProcessGovernanceDocument(document);
}

async function loadLegacyStructuredContent(pool, draftId) {
  const [draft] = await rows(pool, `
    SELECT d.*, dept.name AS department_name
    FROM process_design_drafts d
    LEFT JOIN departments dept ON dept.id=d.department_id
    WHERE d.id=?
  `, [draftId]);
  if (!draft) return null;
  const [profileRows, terms, processes, steps, transitions, handoffs, forms, tables, fields, legacyFields, evidence, risks] = await Promise.all([
    rows(pool, 'SELECT * FROM process_design_document_profiles WHERE draft_id=?', [draftId]),
    rows(pool, 'SELECT * FROM process_design_terms WHERE draft_id=? ORDER BY sort_order,id', [draftId]),
    rows(pool, 'SELECT * FROM process_design_processes WHERE draft_id=? ORDER BY sort_order,id', [draftId]),
    rows(pool, `
      SELECT step.*, detail.precondition, detail.trigger_scene, detail.execution_standard,
             detail.delivery_object, detail.requires_approval, detail.approval_note,
             detail.is_cross_department
      FROM process_design_steps step
      LEFT JOIN process_design_behavior_details detail ON detail.step_id=step.id
      WHERE step.draft_id=?
      ORDER BY step.process_id,step.sort_order,step.id
    `, [draftId]),
    rows(pool, 'SELECT * FROM process_design_step_transitions WHERE draft_id=? ORDER BY process_id,sort_order,id', [draftId]),
    rows(pool, 'SELECT * FROM process_design_cross_dept_handoffs WHERE draft_id=? ORDER BY id', [draftId]),
    rows(pool, 'SELECT * FROM process_design_forms WHERE draft_id=? ORDER BY id', [draftId]),
    rows(pool, `
      SELECT table_row.*
      FROM process_design_form_tables table_row
      JOIN process_design_forms form_row ON form_row.id=table_row.form_id
      WHERE form_row.draft_id=?
      ORDER BY table_row.form_id,table_row.sort_order,table_row.id
    `, [draftId]),
    rows(pool, `
      SELECT field_row.*, table_row.form_id
      FROM process_design_form_table_fields field_row
      JOIN process_design_form_tables table_row ON table_row.id=field_row.form_table_id
      JOIN process_design_forms form_row ON form_row.id=table_row.form_id
      WHERE form_row.draft_id=?
      ORDER BY table_row.form_id,table_row.sort_order,field_row.sort_order,field_row.id
    `, [draftId]),
    rows(pool, `
      SELECT field_row.*
      FROM process_design_form_fields field_row
      JOIN process_design_forms form_row ON form_row.id=field_row.form_id
      WHERE form_row.draft_id=?
      ORDER BY field_row.form_id,field_row.sort_order,field_row.id
    `, [draftId]),
    rows(pool, 'SELECT * FROM process_design_evidence WHERE draft_id=? ORDER BY id', [draftId]),
    rows(pool, 'SELECT * FROM process_design_risks WHERE draft_id=? ORDER BY id', [draftId])
  ]);
  const stepRows = steps.map(step => ({
    ...step,
    behaviorDetail: {
      precondition: step.precondition,
      trigger_scene: step.trigger_scene,
      execution_standard: step.execution_standard,
      delivery_object: step.delivery_object,
      requires_approval: step.requires_approval,
      approval_note: step.approval_note,
      is_cross_department: step.is_cross_department
    },
    handoffs: handoffs.filter(handoff => Number(handoff.step_id) === Number(step.id))
  }));
  const formRows = forms.map(form => {
    const formTables = tables.filter(table => Number(table.form_id) === Number(form.id));
    const mainTableIds = new Set(formTables.filter(table => text(table.table_kind) === 'main').map(table => Number(table.id)));
    return {
      ...form,
      main_fields: fields.filter(field => mainTableIds.has(Number(field.form_table_id))),
      legacy_fields: legacyFields.filter(field => Number(field.form_id) === Number(form.id)),
      tables: formTables.filter(table => text(table.table_kind) === 'detail').map(table => ({
        ...table,
        fields: fields.filter(field => Number(field.form_table_id) === Number(table.id))
      }))
    };
  });
  return {
    draft,
    documentProfile: profileRows[0] || null,
    terms,
    processes,
    steps: stepRows,
    stepTransitions: transitions,
    forms: formRows,
    evidence,
    risks
  };
}

async function buildConversionPlan(pool, draftColumns, versionColumns) {
  const draftSelect = [
    'id',
    draftColumns.has('process_content_json') ? 'process_content_json' : 'NULL AS process_content_json'
  ].join(', ');
  const draftRows = await rows(pool, `SELECT ${draftSelect} FROM process_design_drafts ORDER BY id`);
  const importRows = await tableExists(pool, 'process_design_structured_imports')
    ? await rows(pool, `
        SELECT source.draft_id, source.normalized_json
        FROM process_design_structured_imports source
        JOIN (
          SELECT draft_id, MAX(import_id) AS import_id
          FROM process_design_structured_imports
          GROUP BY draft_id
        ) latest ON latest.import_id=source.import_id
      `)
    : [];
  const versionRows = await tableExists(pool, 'process_design_versions')
    ? await rows(pool, `
        SELECT version.draft_id,
               ${versionColumns.has('process_content_json') ? 'version.process_content_json' : 'NULL AS process_content_json'},
               version.content_json
        FROM process_design_versions version
        JOIN (
          SELECT draft_id, MAX(id) AS id
          FROM process_design_versions
          GROUP BY draft_id
        ) latest ON latest.id=version.id
      `)
    : [];
  const importsByDraft = new Map(importRows.map(row => [Number(row.draft_id), row.normalized_json]));
  const versionsByDraft = new Map(versionRows.map(row => [Number(row.draft_id), row]));
  const convertible = [];
  const manual = [];
  for (const draft of draftRows) {
    const draftId = Number(draft.id);
    const version = versionsByDraft.get(draftId);
    const candidates = [
      ['draft_canonical_json', draft.process_content_json],
      ['structured_import', importsByDraft.get(draftId)],
      ['published_canonical_json', version && version.process_content_json],
      ['published_version_conversion', version && version.content_json]
    ];
    let assessed = false;
    for (const [source, rawValue] of candidates) {
      if (!rawValue) continue;
      assessed = true;
      const parsed = parseJsonValue(rawValue);
      if (!parsed) {
        manual.push({
          object_id: draftId,
          source,
          missing_fields: ['有效JSON对象'],
          handling: '修复该对象的JSON后重新执行迁移dry-run'
        });
        break;
      }
      let normalized = normalizeProcessGovernanceDocument(parsed);
      let resolvedSource = source;
      if (normalized.errors.length && source === 'published_version_conversion') {
        normalized = convertLegacyProcessDesignContent(parsed);
        resolvedSource = 'published_version_conversion';
      }
      if (!normalized.errors.length) {
        convertible.push({
          object_id: draftId,
          source: resolvedSource,
          document: normalized.document,
          content_hash: normalized.content_hash
        });
      } else {
        manual.push({
          object_id: draftId,
          source,
          missing_fields: normalized.errors.map(error => error.field).slice(0, 20),
          handling: '按列出的结构字段人工补齐为process-governance-v2后重新执行迁移dry-run'
        });
      }
      break;
    }
    if (!assessed) {
      const structuredContent = await loadLegacyStructuredContent(pool, draftId);
      const normalized = structuredContent
        ? convertLegacyProcessDesignContent(structuredContent)
        : { errors: [{ field: 'draft', message: '草稿结构不存在' }] };
      if (!normalized.errors.length) {
        convertible.push({
          object_id: draftId,
          source: 'structured_tables',
          document: normalized.document,
          content_hash: normalized.content_hash
        });
      } else {
        manual.push({
          object_id: draftId,
          source: 'structured_tables',
          missing_fields: normalized.errors.map(error => error.field).slice(0, 20),
          handling: '按列出的结构字段人工补齐后重新执行迁移dry-run；迁移不会生成默认业务事实'
        });
      }
    }
  }
  return { convertible, manual };
}

async function inspectProcessGovernanceUnified(pool) {
  const draftColumns = await columnNames(pool, 'process_design_drafts');
  const versionColumns = await columnNames(pool, 'process_design_versions');
  const conflictColumns = await columnNames(pool, 'process_design_handoff_conflicts');
  const conflictIndexes = await indexNames(pool, 'process_design_handoff_conflicts');
  const hasHandoffs = await tableExists(pool, 'process_design_cross_dept_handoffs');
  const hasStructuredImports = await tableExists(pool, 'process_design_structured_imports');
  const hasVersions = await tableExists(pool, 'process_design_versions');
  const conversionAssessment = await buildConversionPlan(pool, draftColumns, versionColumns);
  const [draftCount, canonicalCount, structuredImportCoverage, versionCoverage, handoffStatuses, conflictCount] = await Promise.all([
    rows(pool, 'SELECT COUNT(*) AS count FROM process_design_drafts'),
    draftColumns.has('process_content_json')
      ? rows(pool, "SELECT COUNT(*) AS count FROM process_design_drafts WHERE process_content_json IS NOT NULL AND process_content_json<>''")
      : Promise.resolve([{ count: 0 }]),
    hasStructuredImports
      ? rows(pool, "SELECT COUNT(DISTINCT draft_id) AS count FROM process_design_structured_imports WHERE normalized_json IS NOT NULL AND normalized_json<>''")
      : Promise.resolve([{ count: 0 }]),
    hasVersions
      ? rows(pool, 'SELECT COUNT(DISTINCT draft_id) AS count FROM process_design_versions')
      : Promise.resolve([{ count: 0 }]),
    hasHandoffs
      ? rows(pool, 'SELECT status, COUNT(*) AS count FROM process_design_cross_dept_handoffs GROUP BY status ORDER BY status')
      : Promise.resolve([]),
    tableExists(pool, 'process_design_handoff_conflicts').then(exists => exists
      ? rows(pool, 'SELECT COUNT(*) AS count FROM process_design_handoff_conflicts')
      : [{ count: 0 }])
  ]);
  return {
    migration_key: MIGRATION_KEY,
    applied: await migrationApplied(pool),
    draft_count: Number(draftCount[0] && draftCount[0].count || 0),
    canonical_draft_count: Number(canonicalCount[0] && canonicalCount[0].count || 0),
    structured_import_draft_count: Number(structuredImportCoverage[0] && structuredImportCoverage[0].count || 0),
    published_version_draft_count: Number(versionCoverage[0] && versionCoverage[0].count || 0),
    convertible_draft_count: conversionAssessment.convertible.length,
    conversion_sources: conversionAssessment.convertible.reduce((result, item) => {
      result[item.source] = (result[item.source] || 0) + 1;
      return result;
    }, {}),
    manual_objects: conversionAssessment.manual,
    conflict_count: Number(conflictCount[0] && conflictCount[0].count || 0),
    conflict_open_marker_present: conflictColumns.has('open_conflict_marker'),
    conflict_open_unique_index_present: conflictIndexes.has('uq_process_design_handoff_open_conflict_v2'),
    missing_draft_columns: DRAFT_COLUMNS.map(([name]) => name).filter(name => !draftColumns.has(name)),
    missing_version_columns: VERSION_COLUMNS.map(([name]) => name).filter(name => !versionColumns.has(name)),
    handoff_statuses: handoffStatuses.map(row => ({ status: row.status, count: Number(row.count || 0) })),
    conversion_priority: [
      'process_design_drafts.process_content_json',
      'process_design_structured_imports.normalized_json',
      'process_design_versions.process_content_json',
      'process_design_versions.content_json'
    ],
    manual_handling_rule: '无法规范化为process-governance-v2时停止对象迁移，并输出对象编号和缺失字段；不得填默认业务事实。'
  };
}

async function createMigrationTables(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_governance_migration_backups (
      backup_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      batch_key VARCHAR(128) NOT NULL,
      object_type VARCHAR(64) NOT NULL,
      object_id BIGINT NOT NULL,
      row_json JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_governance_migration_backup (batch_key, object_type, object_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function createGovernanceTables(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_handoff_conflicts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      handoff_id BIGINT NOT NULL,
      status VARCHAR(48) NOT NULL DEFAULT 'pending_assignment',
      opened_reason TEXT NOT NULL,
      origin_position TEXT NULL,
      counterparty_position TEXT NULL,
      evidence_json JSON NULL,
      proposal_text TEXT NULL,
      assigned_handler_person_id BIGINT NULL,
      origin_confirmation VARCHAR(32) NULL,
      counterparty_confirmation VARCHAR(32) NULL,
      escalated_at TIMESTAMP NULL,
      decision VARCHAR(48) NULL,
      decision_basis TEXT NULL,
      closed_at TIMESTAMP NULL,
      migration_batch_key VARCHAR(128) NULL,
      created_by_user_id BIGINT NULL,
      created_by_person_id BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      open_conflict_marker TINYINT GENERATED ALWAYS AS (
        CASE
          WHEN status IN ('pending_assignment','coordinating','pending_department_confirmation','pending_decision')
          THEN 1
          ELSE NULL
        END
      ) STORED,
      UNIQUE KEY uq_process_design_handoff_open_conflict_v2 (handoff_id, open_conflict_marker),
      INDEX idx_process_design_handoff_conflict_queue (status, assigned_handler_person_id, updated_at),
      CONSTRAINT fk_process_design_handoff_conflict_handoff FOREIGN KEY (handoff_id)
        REFERENCES process_design_cross_dept_handoffs(id) ON DELETE RESTRICT,
      CHECK (status IN (
        'pending_assignment','coordinating','pending_department_confirmation',
        'pending_decision','closed','returned_for_revision'
      )),
      CHECK (decision IS NULL OR decision IN ('continue_handoff','not_required','return_revision'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_handoff_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      handoff_id BIGINT NOT NULL,
      conflict_id BIGINT NULL,
      event_type VARCHAR(64) NOT NULL,
      stage_code VARCHAR(64) NULL,
      actor_user_id BIGINT NULL,
      actor_person_id BIGINT NULL,
      actor_department_id BIGINT NULL,
      actor_department_name VARCHAR(255) NULL,
      actor_role_code VARCHAR(64) NULL,
      basis_text TEXT NULL,
      payload_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_process_design_handoff_events_story (handoff_id, id),
      INDEX idx_process_design_handoff_events_conflict (conflict_id, id),
      CONSTRAINT fk_process_design_handoff_event_handoff FOREIGN KEY (handoff_id)
        REFERENCES process_design_cross_dept_handoffs(id) ON DELETE RESTRICT,
      CONSTRAINT fk_process_design_handoff_event_conflict FOREIGN KEY (conflict_id)
        REFERENCES process_design_handoff_conflicts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureConflictOpenUniqueness(pool) {
  const columns = await columnNames(pool, 'process_design_handoff_conflicts');
  if (!columns.has('open_conflict_marker')) {
    await runIgnoring(
      pool,
      `ALTER TABLE process_design_handoff_conflicts
       ADD COLUMN open_conflict_marker TINYINT GENERATED ALWAYS AS (
         CASE
           WHEN status IN ('pending_assignment','coordinating','pending_department_confirmation','pending_decision')
           THEN 1
           ELSE NULL
         END
       ) STORED`,
      ['ER_DUP_FIELDNAME']
    );
  }
  const indexes = await indexNames(pool, 'process_design_handoff_conflicts');
  if (!indexes.has('uq_process_design_handoff_open_conflict_v2')) {
    await runIgnoring(
      pool,
      `ALTER TABLE process_design_handoff_conflicts
       ADD UNIQUE KEY uq_process_design_handoff_open_conflict_v2 (handoff_id, open_conflict_marker)`,
      ['ER_DUP_KEYNAME', 'ER_DUP_INDEX']
    );
  }
  if (indexes.has('uq_process_design_handoff_open_conflict')) {
    await pool.execute(
      'ALTER TABLE process_design_handoff_conflicts DROP INDEX uq_process_design_handoff_open_conflict'
    );
  }
}

async function backUpRows(pool, batchKey) {
  await createMigrationTables(pool);
  await pool.execute(`
    INSERT IGNORE INTO process_design_governance_migration_backups
      (batch_key, object_type, object_id, row_json)
    SELECT ?, 'draft', id, JSON_OBJECT(
      'id', id,
      'status', status,
      'schema_version', schema_version,
      'process_content_json', process_content_json,
      'content_hash', content_hash,
      'revision_no', revision_no
    )
    FROM process_design_drafts
  `, [batchKey]);
  await pool.execute(`
    INSERT IGNORE INTO process_design_governance_migration_backups
      (batch_key, object_type, object_id, row_json)
    SELECT ?, 'version', id, JSON_OBJECT(
      'id', id,
      'schema_version', schema_version,
      'process_content_json', process_content_json,
      'content_hash', content_hash,
      'source_revision_no', source_revision_no
    )
    FROM process_design_versions
  `, [batchKey]);
  await pool.execute(`
    INSERT IGNORE INTO process_design_governance_migration_backups
      (batch_key, object_type, object_id, row_json)
    SELECT ?, 'handoff', id, JSON_OBJECT('id', id, 'status', status)
    FROM process_design_cross_dept_handoffs
  `, [batchKey]);
}

async function addColumns(pool, tableName, definitions) {
  for (const [columnName, definition] of definitions) {
    await runIgnoring(
      pool,
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`,
      ['ER_DUP_FIELDNAME']
    );
  }
}

async function migrateCanonicalContentFromPlan(pool, conversionPlan) {
  for (const item of conversionPlan) {
    const contentJson = JSON.stringify(item.document);
    await pool.execute(`
      UPDATE process_design_drafts
      SET schema_version=?,
          process_content_json=?,
          content_hash=?,
          revision_no=CASE WHEN revision_no < 1 THEN 1 ELSE revision_no END,
          content_updated_at=COALESCE(content_updated_at, updated_at)
      WHERE id=?
        AND (process_content_json IS NULL OR process_content_json='')
    `, [V2, contentJson, item.content_hash, item.object_id]);
    await pool.execute(`
      UPDATE process_design_versions
      SET schema_version=?,
          process_content_json=COALESCE(process_content_json, ?),
          content_hash=COALESCE(content_hash, ?),
          source_revision_no=COALESCE(source_revision_no, 1)
      WHERE draft_id=?
    `, [V2, contentJson, item.content_hash, item.object_id]);
  }
}

async function migrateLegacyConflictStates(pool, batchKey) {
  await pool.execute(`
    INSERT INTO process_design_handoff_conflicts
      (handoff_id, status, opened_reason, migration_batch_key, created_at, updated_at)
    SELECT handoff.id,
           CASE WHEN handoff.status='escalated' THEN 'pending_decision' ELSE 'pending_assignment' END,
           CASE
             WHEN handoff.status='escalated' THEN '历史承接已升级，迁移后等待项目决策组处理'
             ELSE '历史承接已被明确拒绝，迁移后等待分派冲突处理人'
           END,
           ?,
           handoff.updated_at,
           handoff.updated_at
    FROM process_design_cross_dept_handoffs handoff
    LEFT JOIN process_design_handoff_conflicts conflict ON conflict.handoff_id=handoff.id
    WHERE handoff.status IN ('rejected','escalated')
      AND conflict.id IS NULL
  `, [batchKey]);
  await pool.execute(`
    INSERT INTO process_design_handoff_events
      (handoff_id, conflict_id, event_type, stage_code, basis_text, payload_json, created_at)
    SELECT conflict.handoff_id, conflict.id, 'legacy_conflict_migrated', 'conflict_open',
           conflict.opened_reason,
           JSON_OBJECT('migration_batch_key', ?, 'conflict_status', conflict.status),
           conflict.created_at
    FROM process_design_handoff_conflicts conflict
    WHERE conflict.migration_batch_key=?
      AND NOT EXISTS (
        SELECT 1
        FROM process_design_handoff_events event
        WHERE event.conflict_id=conflict.id AND event.event_type='legacy_conflict_migrated'
      )
  `, [batchKey, batchKey]);
  await pool.execute(`
    UPDATE process_design_cross_dept_handoffs
    SET status='conflict_open', updated_at=updated_at
    WHERE status IN ('rejected','escalated')
  `);
}

async function applyProcessGovernanceUnified(pool, options = {}) {
  if (await migrationApplied(pool)) {
    await createGovernanceTables(pool);
    await ensureConflictOpenUniqueness(pool);
    return { ...(await inspectProcessGovernanceUnified(pool)), changed: false };
  }
  const initialDraftColumns = await columnNames(pool, 'process_design_drafts');
  const initialVersionColumns = await columnNames(pool, 'process_design_versions');
  const preflight = await buildConversionPlan(pool, initialDraftColumns, initialVersionColumns);
  if (preflight.manual.length) {
    const error = new Error('存在不能无损转换为process-governance-v2的对象，迁移已在写入前停止');
    error.code = 'PROCESS_GOVERNANCE_MANUAL_CONVERSION_REQUIRED';
    error.manual_objects = preflight.manual;
    throw error;
  }
  const batchKey = String(options.batchKey || `${MIGRATION_KEY}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`);
  await addColumns(pool, 'process_design_drafts', DRAFT_COLUMNS);
  await addColumns(pool, 'process_design_versions', VERSION_COLUMNS);
  await createGovernanceTables(pool);
  await ensureConflictOpenUniqueness(pool);
  await dropMatchingChecks(pool, 'process_design_cross_dept_handoffs', 'status');
  const allowedStatusesSql = HANDOFF_STATUSES.map(status => `'${status}'`).join(',');
  await pool.execute(`
    ALTER TABLE process_design_cross_dept_handoffs
    ADD CONSTRAINT chk_process_design_handoffs_status_v3
    CHECK (status IN (${allowedStatusesSql}))
  `);
  await backUpRows(pool, batchKey);
  await migrateCanonicalContentFromPlan(pool, preflight.convertible);
  await migrateLegacyConflictStates(pool, batchKey);
  await pool.execute(`
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [MIGRATION_KEY]);
  return { ...(await inspectProcessGovernanceUnified(pool)), changed: true, backup_batch: batchKey };
}

async function rollbackProcessGovernanceUnified(pool, batchKey) {
  const backups = await rows(pool, `
    SELECT object_type, object_id, row_json
    FROM process_design_governance_migration_backups
    WHERE batch_key=?
    ORDER BY backup_id DESC
  `, [batchKey]);
  if (!backups.length) {
    const error = new Error('找不到指定迁移批次的备份');
    error.code = 'MIGRATION_BACKUP_NOT_FOUND';
    throw error;
  }
  const postMigrationEvents = await rows(pool, `
    SELECT COUNT(*) AS count
    FROM process_design_handoff_events
    WHERE (
        JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.migration_batch_key')) IS NULL
        OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.migration_batch_key'))<>?
      )
      AND created_at>(SELECT MIN(created_at) FROM process_design_governance_migration_backups WHERE batch_key=?)
  `, [batchKey, batchKey]);
  if (Number(postMigrationEvents[0] && postMigrationEvents[0].count || 0) > 0) {
    const error = new Error('迁移后已产生承接业务写入，不能整批回滚，请执行补偿');
    error.code = 'POST_MIGRATION_WRITES_EXIST';
    throw error;
  }
  for (const backup of backups) {
    const row = typeof backup.row_json === 'string' ? JSON.parse(backup.row_json) : backup.row_json;
    if (backup.object_type === 'handoff') {
      await pool.execute('UPDATE process_design_cross_dept_handoffs SET status=? WHERE id=?', [row.status, backup.object_id]);
    } else if (backup.object_type === 'draft') {
      await pool.execute(`
        UPDATE process_design_drafts
        SET schema_version=?, process_content_json=?, content_hash=?, revision_no=?
        WHERE id=?
      `, [
        row.schema_version || 'process-governance-v2',
        row.process_content_json || null,
        row.content_hash || null,
        Number(row.revision_no || 0),
        backup.object_id
      ]);
    } else if (backup.object_type === 'version') {
      await pool.execute(`
        UPDATE process_design_versions
        SET schema_version=?, process_content_json=?, content_hash=?, source_revision_no=?
        WHERE id=?
      `, [
        row.schema_version || 'process-governance-v2',
        row.process_content_json || null,
        row.content_hash || null,
        row.source_revision_no == null ? null : Number(row.source_revision_no),
        backup.object_id
      ]);
    }
  }
  await pool.execute(`
    DELETE FROM process_design_handoff_events
    WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.migration_batch_key'))=?
  `, [batchKey]);
  await pool.execute('DELETE FROM process_design_handoff_conflicts WHERE migration_batch_key=?', [batchKey]);
  await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  return { batch_key: batchKey, restored_rows: backups.length };
}

async function compensateProcessGovernanceUnified(pool, batchKey) {
  const backups = await rows(pool, `
    SELECT object_type, object_id, row_json
    FROM process_design_governance_migration_backups
    WHERE batch_key=?
    ORDER BY backup_id DESC
  `, [batchKey]);
  for (const backup of backups) {
    const row = typeof backup.row_json === 'string' ? JSON.parse(backup.row_json) : backup.row_json;
    if (backup.object_type === 'handoff' && ['rejected', 'escalated'].includes(row.status)) {
      await pool.execute('UPDATE process_design_cross_dept_handoffs SET status=? WHERE id=?', [row.status, backup.object_id]);
    }
  }
  await pool.execute(`
    UPDATE process_design_handoff_conflicts
    SET status='returned_for_revision',
        decision='return_revision',
        decision_basis='迁移补偿：恢复历史承接状态，由人工复核后重新处理',
        updated_at=CURRENT_TIMESTAMP
    WHERE migration_batch_key=? AND status<>'closed'
  `, [batchKey]);
  return { batch_key: batchKey, compensated_rows: backups.length };
}

module.exports = {
  MIGRATION_KEY,
  HANDOFF_STATUSES,
  DRAFT_COLUMNS,
  VERSION_COLUMNS,
  convertLegacyProcessDesignContent,
  inspectProcessGovernanceUnified,
  applyProcessGovernanceUnified,
  rollbackProcessGovernanceUnified,
  compensateProcessGovernanceUnified
};
