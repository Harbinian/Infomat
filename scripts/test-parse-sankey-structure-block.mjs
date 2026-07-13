/**
 * 校验流程治理结构块 v1 的解析契约。
 *
 * 用法: node scripts/test-parse-sankey-structure-block.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildNodeMetadata,
  buildParserMeta,
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
