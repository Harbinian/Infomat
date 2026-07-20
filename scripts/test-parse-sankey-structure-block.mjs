/**
 * 校验流程治理结构块 v1 的解析契约。
 *
 * 用法: node scripts/test-parse-sankey-structure-block.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertNoWorkRoleBindingErrors,
  buildNodeMetadata,
  buildParserMeta,
  buildProcessRoleBindings,
  parseProcessGovernanceDocument,
  validateStructuredGlobalRecords,
} from './parse-sankey-data.mjs';

const SOURCE_FILE = 'docs/norms/质量管理部部门-能力-流程-系统映射关系.md';
const STRUCTURED_BASELINE = readFileSync(
  new URL('./fixtures/parse-sankey-structure-block/structured-dept.md', import.meta.url),
  'utf8'
);
const LEGACY_BASELINE = readFileSync(
  new URL('./fixtures/parse-sankey-structure-block/legacy-dept.md', import.meta.url),
  'utf8'
);
const HYBRID_BASELINE = readFileSync(
  new URL('./fixtures/parse-sankey-structure-block/hybrid-dept.md', import.meta.url),
  'utf8'
);

function parse(text) {
  return parseProcessGovernanceDocument({
    text,
    sourceFile: SOURCE_FILE,
    fallbackDeptName: '质量管理部',
  });
}

{
  const parsed = parse(STRUCTURED_BASELINE);
  assert.equal(parsed.sourceMode, 'structure-block-v1');
  assert.deepEqual(
    parsed.mappings.map(item => ({
      dept: item.dept,
      l1: item.l1,
      l2: item.l2,
      l3Key: item.l3Key,
      l3: item.l3,
      systems: item.systems,
      evidenceRefs: item.evidenceRefs,
    })),
    [
      {
        dept: '质量管理部',
        l1: '质量管理',
        l2: '质量策划',
        l3Key: 'QM.PLAN.001',
        l3: '质量目标制定与分解',
        systems: ['OA'],
        evidenceRefs: ['EV-QM-001'],
      },
      {
        dept: '质量管理部',
        l1: '质量管理',
        l2: '过程控制',
        l3Key: 'QM.CTRL.001',
        l3: '首件检验',
        systems: ['MES'],
        evidenceRefs: ['EV-QM-002', 'EV-QM-003'],
      },
    ]
  );

  assert.deepEqual(
    parsed.a1Entries.map(item => ({
      l3Key: item.l3Key,
      l3Name: item.l3Name,
      a1Code: item.a1Code,
      a1Name: item.a1Name,
      role: item.role,
      entry: item.entry,
      systems: item.systems,
      evidenceRefs: item.evidenceRefs,
    })),
    [
      {
        l3Key: 'QM.CTRL.001',
        l3Name: '首件检验',
        a1Code: 'A1-QM-CTRL-001-01',
        a1Name: '提交首件检验申请',
        role: '操作工',
        entry: 'MES-首件申请单',
        systems: ['MES'],
        evidenceRefs: ['EV-QM-002'],
      },
      {
        l3Key: 'QM.CTRL.001',
        l3Name: '首件检验',
        a1Code: 'A1-QM-CTRL-001-02',
        a1Name: '执行首件检验并判定',
        role: '检验员',
        entry: 'MES-首件检验记录',
        systems: ['MES'],
        evidenceRefs: ['EV-QM-003'],
      },
    ]
  );

  assert.deepEqual(parsed.mdmRequirements, []);
  assert.deepEqual(parsed.processRoleBindings, []);
  assert.equal(parsed.evidenceCatalog[2].status, 'pending_review');
  assert.doesNotThrow(() => validateStructuredGlobalRecords({
    allMappings: parsed.mappings,
    allA1: parsed.a1Entries,
  }));

  const nodeMetadata = buildNodeMetadata(parsed.mappings, parsed.a1Entries);
  assert.deepEqual(nodeMetadata.get('首件检验'), {
    evidenceRefs: ['EV-QM-002', 'EV-QM-003'],
    evidenceStatuses: ['verified', 'pending_review'],
    hasUnverifiedEvidence: true,
    processRefs: [
      {
        type: 'L3',
        dept: '质量管理部',
        l3Key: 'QM.CTRL.001',
        source: 'structured',
      },
    ],
  });
  assert.deepEqual(buildParserMeta([
    {
      dept: '质量管理部',
      deptCode: 'QM',
      source: 'structured',
      parserSchemaVersion: 1,
      sourceFile: SOURCE_FILE,
    },
    {
      dept: '财务部',
      source: 'legacy',
      sourceFile: 'docs/norms/财务部部门-能力-流程-系统映射关系.md',
    },
  ]), {
    parser_schema_version: 1,
    structured_departments: 1,
    hybrid_departments: 0,
    legacy_departments: 1,
    departments: [
      {
        dept: '质量管理部',
        dept_code: 'QM',
        source: 'structured',
        parser_schema_version: 1,
        sourceFile: SOURCE_FILE,
      },
      {
        dept: '财务部',
        dept_code: '',
        source: 'legacy',
        parser_schema_version: null,
        sourceFile: 'docs/norms/财务部部门-能力-流程-系统映射关系.md',
      },
    ],
  });
}

{
  const structuredWithBindings = STRUCTURED_BASELINE.replace(
    'evidence_catalog:',
    `work_role_bindings:
  - binding_ref: WRB-QM-OWNER
    process_ref: QM.CTRL.001
    step_ref: null
    participant_department:
      department_name: 质量管理部
    source_role_text: 质量负责人
    work_role_code: WR-0001
    participation_type: owner
    status: confirmed
    evidence_refs: [EV-QM-002]
    confirmation_basis: 行政人事确认单 HR-001
  - binding_ref: WRB-QM-PROPOSED
    process_ref: QM.CTRL.001
    step_ref: A1-QM-CTRL-001-01
    participant_department: {department_name: 质量管理部}
    source_role_text: 操作工
    work_role_code: WR-0003
    participation_type: executor
    status: proposed
    evidence_refs: [EV-QM-002]
    confirmation_basis:
  - binding_ref: WRB-QM-NO-EVIDENCE
    process_ref: QM.CTRL.001
    step_ref: A1-QM-CTRL-001-01
    participant_department: {department_name: 质量管理部}
    source_role_text: 操作工
    work_role_code: WR-0003
    participation_type: executor
    status: confirmed
    evidence_refs: []
    confirmation_basis: 行政人事确认单 HR-002
  - binding_ref: WRB-QM-BAD-PROCESS
    process_ref: QM.MISSING.001
    step_ref: null
    participant_department: {department_name: 质量管理部}
    source_role_text: 质量负责人
    work_role_code: WR-0001
    participation_type: owner
    status: confirmed
    evidence_refs: [EV-QM-002]
    confirmation_basis: 行政人事确认单 HR-003
  - binding_ref: WRB-QM-BAD-EVIDENCE
    process_ref: QM.CTRL.001
    step_ref: A1-QM-CTRL-001-01
    participant_department: {department_name: 质量管理部}
    source_role_text: 操作工
    work_role_code: WR-0003
    participation_type: executor
    status: confirmed
    evidence_refs: [EV-MISSING]
    confirmation_basis: 行政人事确认单 HR-004
  - binding_ref: WRB-QM-PENDING-EVIDENCE
    process_ref: QM.CTRL.001
    step_ref: A1-QM-CTRL-001-01
    participant_department: {department_name: 质量管理部}
    source_role_text: 操作工
    work_role_code: WR-0003
    participation_type: executor
    status: confirmed
    evidence_refs: [EV-QM-003]
    confirmation_basis: 行政人事确认单 HR-004A
  - binding_ref: WRB-QM-OCR-EVIDENCE
    process_ref: QM.CTRL.001
    step_ref: A1-QM-CTRL-001-01
    participant_department: {department_name: 质量管理部}
    source_role_text: 操作工
    work_role_code: WR-0003
    participation_type: executor
    status: confirmed
    evidence_refs: [EV-QM-OCR]
    confirmation_basis: 行政人事确认单 HR-004B
  - binding_ref: WRB-QM-MISSING-SOURCE-ROLE
    process_ref: QM.CTRL.001
    step_ref: A1-QM-CTRL-001-01
    participant_department: {department_name: 质量管理部}
    source_role_text:
    work_role_code: WR-0003
    participation_type: executor
    status: confirmed
    evidence_refs: [EV-QM-002]
    confirmation_basis: 行政人事确认单 HR-004C

evidence_catalog:`
  ).replace(
    '\nmdm_requirement_catalog: []',
    `
  - id: EV-QM-OCR
    source_type: institution
    source_file: QM-OCR-001.pdf
    locator: "第2页 OCR 摘录"
    locate_method: ocr
    status: verified

mdm_requirement_catalog: []`
  ) + `

## 工作角色绑定

| binding_ref | process_ref | step_ref | participant_department | source_role_text | work_role_code | participation_type | status | evidence_refs | confirmation_basis |
|---|---|---|---|---|---|---|---|---|---|
| WRB-QM-INSPECTOR | QM.CTRL.001 | A1-QM-CTRL-001-02 | 质量管理部 | 检验员 | WR-0002 | executor | confirmed | EV-QM-TABLE-001 | 行政人事确认单 HR-005 |
| WRB-QM-TABLE-PROPOSED | QM.CTRL.001 | A1-QM-CTRL-001-02 | 质量管理部 | 检验员 | WR-0002 | executor | proposed | EV-QM-TABLE-001 | - |
| WRB-QM-UNKNOWN-ROLE | QM.CTRL.001 | A1-QM-CTRL-001-01 | 质量管理部 | 操作工 | WR-9999 | executor | confirmed | EV-QM-TABLE-001 | 行政人事确认单 HR-006 |
| WRB-QM-RETIRED-ROLE | QM.CTRL.001 | A1-QM-CTRL-001-01 | 质量管理部 | 历史操作工 | WR-0003 | executor | confirmed | EV-QM-TABLE-001 | 行政人事确认单 HR-007 |
| WRB-QM-NO-MAPPING | QM.CTRL.001 | A1-QM-CTRL-001-01 | 质量管理部 | 临时操作工 | WR-0004 | executor | confirmed | EV-QM-TABLE-001 | 行政人事确认单 HR-008 |
| WRB-QM-FUTURE | QM.CTRL.001 | A1-QM-CTRL-001-01 | 质量管理部 | 后续操作工 | WR-0005 | executor | confirmed | EV-QM-TABLE-001 | 行政人事确认单 HR-009 |
| WRB-QM-RETIRED-MAPPING | QM.CTRL.001 | A1-QM-CTRL-001-01 | 质量管理部 | 历史检验员 | WR-0006 | executor | confirmed | EV-QM-TABLE-001 | 行政人事确认单 HR-010 |
| WRB-QM-TABLE-STRUCTURE-EVIDENCE | QM.CTRL.001 | A1-QM-CTRL-001-01 | 质量管理部 | 操作工 | WR-0003 | executor | confirmed | EV-QM-002 | 行政人事确认单 HR-011 |

### 工作角色绑定证据

| evidence_ref | source_file | locator | source_excerpt | locate_method | status |
|---|---|---|---|---|---|
| EV-QM-TABLE-001 | QM-BD-034 首件检验申请单.xlsx | 表头签批栏 | 检验员执行检验并填写判定结果 | table_cell | verified |
`;

  const parsed = parse(structuredWithBindings);
  assert.deepEqual(
    parsed.processRoleBindings.map(item => item.binding_ref),
    [
      'WRB-QM-OWNER',
      'WRB-QM-INSPECTOR',
      'WRB-QM-UNKNOWN-ROLE',
      'WRB-QM-RETIRED-ROLE',
      'WRB-QM-NO-MAPPING',
      'WRB-QM-FUTURE',
      'WRB-QM-RETIRED-MAPPING',
    ]
  );
  assert.deepEqual(parsed.processRoleBindings[0], {
    binding_ref: 'WRB-QM-OWNER',
    process_ref: 'QM.CTRL.001',
    step_ref: null,
    participant_department: { department_name: '质量管理部' },
    source_role_text: '质量负责人',
    work_role_code: 'WR-0001',
    participation_type: 'owner',
    status: 'confirmed',
    evidence_refs: ['EV-QM-002'],
    confirmation_basis: '行政人事确认单 HR-001',
    sourceFile: SOURCE_FILE,
    processKey: '质量管理部\nQM.CTRL.001',
  });
  assert.match(parsed.workRoleBindingWarnings.join('\n'), /WRB-QM-PROPOSED[\s\S]*WRB-QM-TABLE-PROPOSED/);
  assert.match(
    parsed.workRoleBindingErrors.join('\n'),
    /NO-EVIDENCE[\s\S]*BAD-PROCESS[\s\S]*BAD-EVIDENCE[\s\S]*PENDING-EVIDENCE[\s\S]*OCR-EVIDENCE[\s\S]*MISSING-SOURCE-ROLE[\s\S]*TABLE-STRUCTURE-EVIDENCE/,
  );
  assert.throws(
    () => assertNoWorkRoleBindingErrors(parsed.workRoleBindingErrors),
    /工作角色绑定校验失败（7 项）/,
    'invalid confirmed bindings must make the parser main path fail instead of being silently omitted',
  );

  const duplicateOwnerFromAnotherSource = {
    ...parsed.processRoleBindings[0],
    binding_ref: 'WRB-QM-OWNER-OTHER-SOURCE',
    sourceFile: 'docs/norms/另一部门-能力-流程-系统映射关系.md',
  };
  const processRoleBindingResult = buildProcessRoleBindings([
    ...parsed.processRoleBindings,
    duplicateOwnerFromAnotherSource,
  ], {
    schemaVersion: 'work-role-data-v1',
    workRoles: [
      { work_role_code: 'WR-0001', work_role_name: '质量流程负责人', status: 'active', effective_from: '2026-01-01', effective_to: null },
      { work_role_code: 'WR-0002', work_role_name: '质量检验执行人', status: 'active', effective_from: '2026-01-01', effective_to: null },
      { work_role_code: 'WR-0003', work_role_name: '历史生产操作执行人', status: 'retired', effective_from: '2025-01-01', effective_to: '2026-06-30' },
      { work_role_code: 'WR-0004', work_role_name: '无岗位映射角色', status: 'active', effective_from: '2026-01-01', effective_to: null },
      { work_role_code: 'WR-0005', work_role_name: '未来生效角色', status: 'active', effective_from: '2027-01-01', effective_to: null },
      { work_role_code: 'WR-0006', work_role_name: '历史岗位映射角色', status: 'active', effective_from: '2025-01-01', effective_to: null },
    ],
    workRolePositionMappings: [
      { work_role_code: 'WR-0001', department_name: '质量管理部', position_name: '质量主管', status: 'active', effective_from: '2026-01-01', effective_to: null },
      { work_role_code: 'WR-0002', department_name: '质量管理部', position_name: '检验员', status: 'active', effective_from: '2026-01-01', effective_to: null },
      { work_role_code: 'WR-0003', department_name: '质量管理部', position_name: '历史操作工', status: 'retired', effective_from: '2025-01-01', effective_to: '2026-06-30' },
      { work_role_code: 'WR-0005', department_name: '质量管理部', position_name: '后续操作工', status: 'active', effective_from: '2027-01-01', effective_to: null },
      { work_role_code: 'WR-0006', department_name: '质量管理部', position_name: '历史检验员', status: 'retired', effective_from: '2025-06-01', effective_to: '2026-06-30' },
    ],
  }, {
    asOfDate: '2026-07-16',
  });
  assert.deepEqual(
    processRoleBindingResult.bindings.map(item => item.binding_ref).sort(),
    ['WRB-QM-OWNER', 'WRB-QM-INSPECTOR', 'WRB-QM-RETIRED-ROLE', 'WRB-QM-RETIRED-MAPPING'].sort(),
    'company snapshot should keep current confirmed bindings and valid retired history only',
  );
  assert.match(processRoleBindingResult.warnings.join('\n'), /RETIRED-ROLE[\s\S]*RETIRED-MAPPING/);
  assert.match(
    processRoleBindingResult.errors.join('\n'),
    /UNKNOWN-ROLE[\s\S]*NO-MAPPING[\s\S]*FUTURE[\s\S]*OWNER-OTHER-SOURCE/,
  );
  assert.throws(() => assertNoWorkRoleBindingErrors(processRoleBindingResult.errors), /工作角色绑定校验失败（4 项）/);
}

assert.throws(
  () => parse(STRUCTURED_BASELINE.replace('system: OA', 'system: MDM')),
  /MDM|系统/
);

{
  const parsed = parse(STRUCTURED_BASELINE.replace(
    'mdm_requirement_catalog: []',
    `mdm_requirement_catalog:
  - object: 检验项目主数据
    key_fields: [检验项目编码, 检验方法, 判定标准]
    owner_dept: 质量管理部
    requirement: 统一检验项目编码，消除车间自定义口径
    evidence_refs: [EV-QM-003]`
  ));
  assert.deepEqual(parsed.mdmRequirements, [
    {
      dept: '质量管理部',
      masterDataObject: '检验项目主数据',
      sourceL2: '',
      keyFields: '检验项目编码、检验方法、判定标准',
      responsibleDept: '质量管理部',
      systemBoundary: '',
      governanceRequirement: '统一检验项目编码，消除车间自定义口径',
      evidenceRefs: ['EV-QM-003'],
      evidenceItems: [
        {
          id: 'EV-QM-003',
          sourceType: 'institution',
          sourceFile: 'QM-GC-008 首件检验规程.pdf',
          locator: '待定位到具体条款',
          locateMethod: 'clause',
          status: 'pending_review',
        },
      ],
      sourceFile: SOURCE_FILE,
      structureBlockVersion: 1,
    },
  ]);
}

assert.throws(
  () => parse(STRUCTURED_BASELINE.replace('status: pending_review', 'status: unclear')),
  /status|五状态/
);

assert.throws(
  () => parse(STRUCTURED_BASELINE.replace('l3_key: QM.CTRL.001', 'l3_key: QM.MISSING.001')),
  /悬空 A1|QM\.MISSING\.001/
);

assert.throws(
  () => parse(STRUCTURED_BASELINE.replace('evidence_refs: [EV-QM-001]', 'evidence_refs: [EV-MISSING]')),
  /悬空证据引用|EV-MISSING/
);

{
  const parsed = parse(STRUCTURED_BASELINE);
  const duplicate = parse(STRUCTURED_BASELINE.replace('dept_name: 质量管理部', 'dept_name: 工程技术部'));
  assert.throws(
    () => validateStructuredGlobalRecords({
      allMappings: [...parsed.mappings, ...duplicate.mappings],
      allA1: [...parsed.a1Entries, ...duplicate.a1Entries],
    }),
    /l3_key 全域重复|a1_code 全域重复/
  );
}

{
  const parsed = parse(STRUCTURED_BASELINE.replace('A1-QM-CTRL-001-01', 'BAD-A1'));
  assert.throws(
    () => validateStructuredGlobalRecords({
      allMappings: parsed.mappings,
      allA1: parsed.a1Entries,
    }),
    /a1_code 不符合全域规则|BAD-A1/
  );
}

{
  const legacy = parseProcessGovernanceDocument({
    sourceFile: SOURCE_FILE,
    fallbackDeptName: '质量管理部',
    text: LEGACY_BASELINE,
  });
  assert.equal(legacy.sourceMode, 'legacy-markdown');
  assert.equal(legacy.mappings.length, 1);
  assert.deepEqual(legacy.mappings[0].systems, ['OA']);
  assert.deepEqual(legacy.processRoleBindings, []);
}

{
  const legacyWithBindingTable = `${LEGACY_BASELINE}

## 工作角色绑定

| binding_ref | process_ref | step_ref | participant_department | source_role_text | work_role_code | participation_type | status | evidence_refs | confirmation_basis |
|---|---|---|---|---|---|---|---|---|---|
| WRB-QM-LEGACY-OWNER | 质量目标制定与分解 | - | 质量管理部 | 质量负责人 | WR-0001 | owner | confirmed | QM-ZD-012#4.2 | 行政人事确认单 HR-007 |

### 工作角色绑定证据

| evidence_ref | source_file | locator | source_excerpt | locate_method | status |
|---|---|---|---|---|---|
| QM-ZD-012#4.2 | QM-ZD-012 质量目标管理制度.pdf | 第4.2条 / 第3页 | 质量负责人组织制定并分解质量目标 | manual_clause | verified |
`;
  const parsed = parse(legacyWithBindingTable);
  assert.deepEqual(parsed.processRoleBindings.map(item => ({
    binding_ref: item.binding_ref,
    process_ref: item.process_ref,
    step_ref: item.step_ref,
    evidence_refs: item.evidence_refs,
  })), [
    {
      binding_ref: 'WRB-QM-LEGACY-OWNER',
      process_ref: '质量目标制定与分解',
      step_ref: null,
      evidence_refs: ['QM-ZD-012#4.2'],
    },
  ]);
  assert.deepEqual(parsed.workRoleBindingErrors, []);

  const withoutBindingEvidence = parse(legacyWithBindingTable.replace(
    /\n### 工作角色绑定证据[\s\S]*$/,
    '',
  ));
  assert.deepEqual(withoutBindingEvidence.processRoleBindings, []);
  assert.match(
    withoutBindingEvidence.workRoleBindingErrors.join('\n'),
    /WRB-QM-LEGACY-OWNER[\s\S]*evidence_refs 存在悬空引用/,
  );
}

{
  const parsed = parse(HYBRID_BASELINE);
  assert.equal(parsed.sourceMode, 'hybrid');
  assert.deepEqual(
    parsed.mappings.map(item => ({
      l3Key: item.l3Key || '',
      l3: item.l3,
      systems: item.systems,
      structured: Boolean(item.structureBlockVersion),
    })),
    [
      {
        l3Key: 'QM.CTRL.001',
        l3: '首件检验',
        systems: ['MES'],
        structured: true,
      },
      {
        l3Key: '',
        l3: '不合格品评审处置',
        systems: ['OA'],
        structured: false,
      },
    ]
  );
  assert.deepEqual(
    parsed.a1Entries.map(item => ({
      a1Code: item.a1Code,
      a1Name: item.a1Name,
      systems: item.systems,
      structured: Boolean(item.structureBlockVersion),
    })),
    [
      {
        a1Code: 'A1-QM-CTRL-001-01',
        a1Name: '提交首件检验申请',
        systems: ['MES'],
        structured: true,
      },
      {
        a1Code: 'A1-QM-NC-001-01',
        a1Name: '发起不合格品评审',
        systems: ['OA'],
        structured: false,
      },
    ]
  );
  assert.match(parsed.hybridWarnings.join('\n'), /首件检验/);
  assert.match(parsed.hybridWarnings.join('\n'), /A1-QM-CTRL-001-01/);
  assert.deepEqual(buildParserMeta([
    {
      dept: '质量管理部',
      deptCode: 'QM',
      source: 'hybrid',
      parserSchemaVersion: 1,
      sourceFile: SOURCE_FILE,
    },
  ]), {
    parser_schema_version: 1,
    structured_departments: 0,
    hybrid_departments: 1,
    legacy_departments: 0,
    departments: [
      {
        dept: '质量管理部',
        dept_code: 'QM',
        source: 'hybrid',
        parser_schema_version: 1,
        sourceFile: SOURCE_FILE,
      },
    ],
  });
}

{
  const parsed = parse(STRUCTURED_BASELINE.replace('system: OA', 'system: OA、PLM'));
  assert.deepEqual(parsed.mappings[0].systems, ['OA', 'PLM']);
}

{
  const parsed = parse(STRUCTURED_BASELINE.replace('system: OA', 'system: '));
  assert.deepEqual(parsed.mappings[0].systems, []);
}

assert.throws(
  () => parse(STRUCTURED_BASELINE.replace('system: OA', 'system: CRM')),
  /CRM|系统/
);

console.log('parse-sankey structure block checks passed');
