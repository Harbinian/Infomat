#!/usr/bin/env node
/**
 * Compile traceable process candidates into document-structured-output-v2.
 *
 * The result is a review draft. It never writes docs/norms or publishes a
 * structure block.
 */
import path from 'node:path';
import {
  parseArgs,
  readJson,
  readJsonl,
  requireArg,
  sha1Text,
  writeJson,
} from './review-item-utils.mjs';

const LEGACY_ISSUE_MAP = {
  待确认L3: {
    issueType: 'L3 结构待确认',
    objectType: 'process',
    targetBlock: 'l3_catalog',
    targetField: 'l3_name',
  },
  待确认A1: {
    issueType: 'A1 行为待确认',
    objectType: 'step',
    targetBlock: 'a1_catalog',
    targetField: 'step_name',
  },
  角色待确认: {
    issueType: '角色责任待确认',
    objectType: 'step',
    targetBlock: 'work_role_bindings',
    targetField: 'work_role_code',
  },
  审批链待确认: {
    issueType: '原文定义不足',
    objectType: 'behavior_detail',
    targetBlock: 'behavior_details',
    targetField: 'approval_note',
  },
  受控传递待确认: {
    issueType: '跨部门承接待确认',
    objectType: 'handoff',
    targetBlock: 'cross_dept_handoffs',
    targetField: 'target_department',
  },
  验收标准待补: {
    issueType: '原文定义不足',
    objectType: 'behavior_detail',
    targetBlock: 'behavior_details',
    targetField: 'execution_standard',
  },
  归档要求待补: {
    issueType: '原文定义不足',
    objectType: 'form',
    targetBlock: 'forms',
    targetField: 'retention_period',
  },
  系统落位待确认: {
    issueType: '系统落位待确认',
    objectType: 'step',
    targetBlock: 'a1_catalog',
    targetField: 'system',
  },
};

const PARTICIPATION_LABELS = {
  主责部门: 'owner',
  发起角色: 'initiator',
  执行角色: 'executor',
  审核角色: 'reviewer',
  批准角色: 'approver',
  协同角色: 'collaborator',
  数据提供角色: 'provider',
  数据接收角色: 'receiver',
};

function text(value) {
  return String(value ?? '').trim();
}

function stableRef(prefix, ...parts) {
  return `${prefix}_${sha1Text(parts.map(text).join('|')).slice(0, 12)}`;
}

function fileTitle(filePath) {
  const name = path.basename(text(filePath)).replace(/\.[^.]+$/u, '').trim();
  return name || '待确认制度';
}

function evidenceType(item) {
  const artifactType = text(item?.artifact_type);
  if (artifactType === 'form' || artifactType === 'table') return '表单样例';
  if (artifactType === 'flow') return '流程图';
  if (artifactType === 'ledger') return '台账记录';
  return '制度条款';
}

function sourceAnchor(item) {
  return text(item?.source_anchor)
    || [item?.doc_no, item?.clause ? `§${item.clause}` : '', item?.table_id, item?.paragraph_id]
      .map(text)
      .filter(Boolean)
      .join(' ');
}

function sourceExcerpt(item) {
  return text(item?.source_excerpt) || text(item?.raw_text) || text(item?.content) || text(item?.name);
}

function issueRecord({
  department,
  documentName,
  objectType,
  objectKey,
  targetBlock,
  targetField,
  issueType,
  question,
  currentValue = null,
  sourceFile = null,
  anchor = null,
  excerpt = null,
  handler = '流程责任部门',
  nextStep = '回到可直接读取的源文件核对，确认后再更新结构化字段。',
}) {
  const stableKey = sha1Text([
    department,
    documentName,
    objectType,
    objectKey,
    targetBlock,
    targetField,
    issueType,
    sourceFile,
    anchor,
    currentValue,
  ].join('|')).slice(0, 16);
  return {
    stable_key: stableKey,
    department: department || null,
    document_name: documentName || null,
    structured_object_type: objectType,
    structured_object_key: String(objectKey),
    target_block: targetBlock,
    target_field: targetField,
    current_value: currentValue === null ? null : text(currentValue),
    source_file: sourceFile || null,
    source_anchor: anchor || null,
    source_excerpt: excerpt || null,
    evidence_status: 'pending_review',
    issue_type: issueType,
    question_for_user: question,
    suggested_handler: handler,
    allowed_actions: ['修改源文件后重新导入', '不是问题', '专项确认'],
    user_decision: null,
    user_reason: null,
    user_note: null,
    next_step: nextStep,
  };
}

function addIssue(issueMap, record) {
  issueMap.set(record.stable_key, record);
}

function findProfileText(chunks, labels) {
  const match = chunks.find((chunk) => {
    const heading = `${text(chunk.clause_title)} ${text(chunk.raw_text).slice(0, 40)}`;
    return labels.some((label) => heading.includes(label));
  });
  return match ? sourceExcerpt(match) : '';
}

function main() {
  const args = parseArgs(process.argv);
  for (const name of ['document', 'roles', 'objects', 'issues', 'chunks', 'out']) requireArg(args, name);

  const documentCandidates = readJson(args.document);
  const roleBook = readJson(args.roles);
  const objectChains = readJson(args.objects);
  const legacyIssues = readJson(args.issues);
  const chunks = readJsonl(args.chunks);
  const department = text(documentCandidates.department || roleBook.department || args.department);
  const sourceFile = text(documentCandidates.source_file || chunks[0]?.source_file);
  const documentTitle = fileTitle(sourceFile);
  const documentNo = text(chunks.find((chunk) => text(chunk.doc_no))?.doc_no);
  const sourceEdition = text(chunks.find((chunk) => /^[A-Z]+$/.test(text(chunk.version)))?.version);
  const purpose = findProfileText(chunks, ['目的', '目标']);
  const scope = findProfileText(chunks, ['范围', '适用']);
  const draftRef = stableRef('draft', department, sourceFile || documentTitle);
  const profileRef = stableRef('profile', draftRef);
  const issueMap = new Map();
  const evidenceMap = new Map();

  function addEvidence(item, objectType, objectRef, description) {
    const file = text(item?.source_file || sourceFile);
    const anchor = sourceAnchor(item);
    const excerpt = sourceExcerpt(item);
    if (!file || !excerpt) return null;
    const key = [objectType, objectRef, file, anchor, excerpt].join('|');
    if (evidenceMap.has(key)) return evidenceMap.get(key).evidence_ref;
    const evidenceRef = stableRef('evidence', key);
    evidenceMap.set(key, {
      evidence_ref: evidenceRef,
      draft_ref: draftRef,
      object_type: objectType,
      object_ref: objectRef,
      evidence_type: evidenceType(item),
      description: text(description) || excerpt.slice(0, 180),
      source_name: path.basename(file),
      source_anchor: anchor || null,
      source_file: file,
      source_excerpt: excerpt,
      locator: anchor || file,
      locate_method: '直接读取源文件',
      confirmer: null,
      record_time: null,
      missing_reason: null,
      expected_provider: null,
      expected_at: null,
      maturity: '可保存草稿',
      status: 'pending_review',
    });
    return evidenceRef;
  }

  const capabilityName = text(documentCandidates.capability_review_items?.[0]?.name) || '待确认';
  const processCandidates = (documentCandidates.process_review_items || []).length
    ? documentCandidates.process_review_items
    : [{ name: documentTitle, source_file: sourceFile, source_excerpt: documentTitle }];
  const processes = processCandidates.map((item, index) => {
    const processRef = stableRef('process', item.source_file, item.source_anchor, item.name, index);
    const evidenceRef = addEvidence(item, 'process', processRef, `L3候选：${text(item.name)}`);
    const record = {
      process_ref: processRef,
      draft_ref: draftRef,
      process_code: null,
      l3_key: null,
      process_type: 'new',
      l1_name: '待确认',
      l2_name: capabilityName,
      l3_name: text(item.name) || documentTitle,
      description: text(item.current_mapping_hint) || null,
      owner: null,
      system: '',
      evidence_refs: evidenceRef ? [evidenceRef] : [],
    };
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'process',
      objectKey: processRef,
      targetBlock: 'l3_catalog',
      targetField: 'l3_name',
      issueType: 'L3 结构待确认',
      question: `请确认“${record.l3_name}”是否是一项边界完整、可独立管理的 L3 流程。`,
      currentValue: record.l3_name,
      sourceFile: text(item.source_file) || null,
      anchor: sourceAnchor(item) || null,
      excerpt: sourceExcerpt(item) || null,
    }));
    if (record.l1_name === '待确认') {
      addIssue(issueMap, issueRecord({
        department,
        documentName: documentTitle,
        objectType: 'process',
        objectKey: processRef,
        targetBlock: 'l3_catalog',
        targetField: 'l1_name',
        issueType: 'L3 结构待确认',
        question: `请由流程审核人确认“${record.l3_name}”所属的能力域。`,
        sourceFile: text(item.source_file) || null,
        anchor: sourceAnchor(item) || null,
        excerpt: sourceExcerpt(item) || null,
      }));
    }
    return record;
  });

  const processBySource = new Map(processes.map((process, index) => [
    text(processCandidates[index]?.source_file),
    process.process_ref,
  ]));
  const defaultProcessRef = processes[0].process_ref;
  const roles = roleBook.roles || [];
  const behaviorCandidates = documentCandidates.behavior_review_items || [];
  const behaviorDetails = [];

  const steps = behaviorCandidates.map((item, index) => {
    const processRef = processBySource.get(text(item.source_file)) || defaultProcessRef;
    const stepRef = stableRef('step', processRef, item.source_file, item.source_anchor, item.name, index);
    const excerpt = sourceExcerpt(item);
    const matchingRoles = roles
      .filter((role) => role.name !== department && excerpt.includes(text(role.name)))
      .map((role) => text(role.name))
      .filter(Boolean);
    const actorRole = matchingRoles.length === 1 ? matchingRoles[0] : null;
    const evidenceRef = addEvidence(item, 'step', stepRef, `A1候选：${text(item.name)}`);
    const record = {
      step_ref: stepRef,
      draft_ref: draftRef,
      process_ref: processRef,
      step_type: 'action',
      a1_code: null,
      step_name: text(item.name) || `待确认业务行为${index + 1}`,
      actor_role: actorRole,
      timing: null,
      input_materials: null,
      output_result: null,
      entry: null,
      system: '',
      status: 'active',
      evidence_refs: evidenceRef ? [evidenceRef] : [],
    };
    const matchingChain = (objectChains.chains || []).find((chain) => (
      text(chain.source_file) === text(item.source_file)
      && sourceAnchor(chain) === sourceAnchor(item)
    ));
    behaviorDetails.push({
      detail_ref: stableRef('detail', stepRef),
      step_ref: stepRef,
      precondition: null,
      trigger_scene: null,
      execution_standard: null,
      delivery_object: text(item.object_review_item || matchingChain?.object_name) || null,
      requires_approval: false,
      approval_note: null,
      is_cross_department: false,
    });
    const missing = [
      !record.actor_role && '执行角色',
      '触发场景',
      '前置条件',
      '输入材料',
      '输出结果',
      '执行标准',
    ].filter(Boolean);
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'step',
      objectKey: stepRef,
      targetBlock: 'a1_catalog',
      targetField: 'actor_role,trigger_scene,precondition,input_materials,output_result,execution_standard',
      issueType: 'A1 行为待确认',
      question: `请确认“${record.step_name}”是否为独立 A1，并补齐：${missing.join('、')}。`,
      currentValue: record.step_name,
      sourceFile: text(item.source_file) || null,
      anchor: sourceAnchor(item) || null,
      excerpt: excerpt || null,
    }));
    return record;
  });

  function targetStep(item) {
    const anchor = sourceAnchor(item);
    const source = text(item.source_file);
    return steps.find((step, index) => (
      text(behaviorCandidates[index]?.source_file) === source
      && sourceAnchor(behaviorCandidates[index]) === anchor
    )) || steps.find((step, index) => text(behaviorCandidates[index]?.source_file) === source) || steps[0];
  }

  for (const item of documentCandidates.approval_chain_reviews || []) {
    const step = targetStep(item);
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'behavior_detail',
      objectKey: step?.step_ref || defaultProcessRef,
      targetBlock: 'behavior_details',
      targetField: 'approval_note',
      issueType: '原文定义不足',
      question: '请确认该原文是否构成同一交付对象的审批链，并说明审核、批准顺序。',
      currentValue: text(item.content) || null,
      sourceFile: text(item.source_file) || null,
      anchor: sourceAnchor(item) || null,
      excerpt: sourceExcerpt(item) || null,
    }));
  }

  for (const item of documentCandidates.controlled_transfer_reviews || []) {
    const step = targetStep(item);
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'handoff',
      objectKey: step?.step_ref || defaultProcessRef,
      targetBlock: 'cross_dept_handoffs',
      targetField: 'target_department',
      issueType: '跨部门承接待确认',
      question: '请确认是否存在具体交付物、接收部门、交接动作和承接标准；未确认前不创建跨部门承接关系。',
      currentValue: text(item.content) || null,
      sourceFile: text(item.source_file) || null,
      anchor: sourceAnchor(item) || null,
      excerpt: sourceExcerpt(item) || null,
      handler: '发起部门与接收部门',
    }));
  }

  for (const item of documentCandidates.archive_review_items || []) {
    const step = targetStep(item);
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'form',
      objectKey: step?.step_ref || defaultProcessRef,
      targetBlock: 'forms',
      targetField: 'archive_location,retention_period,responsible_department_name,responsible_role',
      issueType: '原文定义不足',
      question: '请确认该记录或表单的归档位置、留存周期、责任部门和责任角色。',
      currentValue: text(item.content) || null,
      sourceFile: text(item.source_file) || null,
      anchor: sourceAnchor(item) || null,
      excerpt: sourceExcerpt(item) || null,
    }));
  }

  for (const role of roles) {
    if (!text(role.name) || text(role.name) === department) continue;
    const step = targetStep(role);
    const participationType = (role.role_types || []).map((type) => PARTICIPATION_LABELS[type]).find(Boolean);
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'step',
      objectKey: step?.step_ref || defaultProcessRef,
      targetBlock: 'work_role_bindings',
      targetField: 'work_role_code',
      issueType: '角色责任待确认',
      question: `请确认原文角色“${role.name}”在该流程中的实际参与方式${participationType ? `（候选：${participationType}）` : ''}，再决定是否绑定正式工作角色。`,
      currentValue: role.name,
      sourceFile: text(role.source_file) || null,
      anchor: sourceAnchor(role) || null,
      excerpt: sourceExcerpt(role) || null,
      handler: '流程责任部门与行政人事部',
    }));
  }

  for (const item of Array.isArray(legacyIssues) ? legacyIssues : []) {
    const mapping = LEGACY_ISSUE_MAP[item.issue_type];
    if (!mapping) continue;
    const process = processes.find((record, index) => text(processCandidates[index]?.source_file) === text(item.source_file));
    const step = steps.find((record, index) => text(behaviorCandidates[index]?.source_file) === text(item.source_file));
    const objectKey = mapping.objectType === 'process'
      ? process?.process_ref || defaultProcessRef
      : step?.step_ref || defaultProcessRef;
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: mapping.objectType,
      objectKey,
      targetBlock: mapping.targetBlock,
      targetField: mapping.targetField,
      issueType: mapping.issueType,
      question: text(item.suggested_action) || '请回到源文件确认该结构化字段。',
      currentValue: text(item.content) || null,
      sourceFile: text(item.source_file) || null,
      anchor: text(item.source_anchor) || null,
      excerpt: text(item.source_excerpt || item.content) || null,
      handler: text(item.owner) || '流程责任部门',
    }));
  }

  if (!documentNo) {
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'document_profile',
      objectKey: profileRef,
      targetBlock: 'document_profile',
      targetField: 'document_no',
      issueType: '原文定义不足',
      question: '请从可直接读取的封面、页眉或正文确认制度编号。',
      sourceFile: sourceFile || null,
    }));
  }
  if (!purpose) {
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'document_profile',
      objectKey: profileRef,
      targetBlock: 'document_profile',
      targetField: 'purpose',
      issueType: '原文定义不足',
      question: '请确认制度目的；源文件未提供可直接定位的目的说明。',
      sourceFile: sourceFile || null,
    }));
  }
  if (!scope) {
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'document_profile',
      objectKey: profileRef,
      targetBlock: 'document_profile',
      targetField: 'scope',
      issueType: '原文定义不足',
      question: '请确认制度适用范围；源文件未提供可直接定位的范围说明。',
      sourceFile: sourceFile || null,
    }));
  }
  if (!sourceEdition) {
    addIssue(issueMap, issueRecord({
      department,
      documentName: documentTitle,
      objectType: 'draft',
      objectKey: draftRef,
      targetBlock: 'meta',
      targetField: 'planned_edition',
      issueType: '原文定义不足',
      question: '请确认拟发布版次；当前 A 仅为草稿占位。',
      currentValue: 'A',
      sourceFile: sourceFile || null,
    }));
  }

  const output = {
    schema_version: 'document-structured-output-v2',
    generated_at: new Date().toISOString(),
    draft: {
      draft_ref: draftRef,
      document_no: documentNo || `PENDING-${sha1Text(sourceFile || documentTitle).slice(0, 8).toUpperCase()}`,
      document_title: documentTitle,
      planned_edition: sourceEdition || 'A',
      current_edition: sourceEdition || null,
      process_name: processes[0]?.l3_name || documentTitle,
      basis_type: '制度 / 规程',
      basis_description: '只依据可直接读取的源文件生成候选结构。',
      involves_other_departments: false,
      related_departments: [],
      department: {
        department_name: department || '待确认部门',
      },
      l1_name: null,
      l1_status: 'needs_review',
      l2_name: capabilityName === '待确认' ? null : capabilityName,
      l2_status: 'needs_review',
      l3_name: processes[0]?.l3_name || null,
      status: 'draft',
    },
    document_profile: {
      profile_ref: profileRef,
      draft_ref: draftRef,
      document_no: documentNo || `PENDING-${sha1Text(sourceFile || documentTitle).slice(0, 8).toUpperCase()}`,
      document_title: documentTitle,
      purpose: purpose || '待确认',
      scope: scope || '待确认',
      inheritance_relation: null,
    },
    terms: [],
    processes,
    steps,
    work_role_bindings: [],
    behavior_details: behaviorDetails,
    step_transitions: [],
    cross_dept_handoffs: [],
    forms: [],
    form_tables: [],
    form_table_fields: [],
    form_fields: [],
    evidence_catalog: [...evidenceMap.values()],
    mdm_requirement_catalog: [],
    pending_issues: [...issueMap.values()],
  };

  writeJson(args.out, output);
  console.error(`structured_output_v2=${args.out} processes=${processes.length} steps=${steps.length} pending_issues=${output.pending_issues.length}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
