#!/usr/bin/env node
/**
 * Extract review-only role review items from evidence chunks.
 */
import {
  evidenceFromChunk,
  findChunk,
  parseArgs,
  requireArg,
  readJsonl,
  writeJson,
} from './review-item-utils.mjs';

const DEPARTMENT_NAMES = [
  '工程技术部',
  '质量管理部',
  '财务部',
  '经营发展部',
  '项目管理部',
  '物资保障部',
  '复材车间',
  '运维安环部',
  '行政人事部',
  '办公室',
  '综合办公室',
  '总经理办公室',
];
const LEADER_ROLE_EXCEPTIONS = new Set(['总经理', '经营副总', '生产副总']);
const DEPARTMENT_RE = new RegExp(DEPARTMENT_NAMES.slice(0, 9).join('|'), 'g');
const ROLE_RE = /([\u4e00-\u9fff]{2,18}(?:人员|负责人|责任人|部门|单位|主任|部长|经理|副总|主管|工程师|工艺员|技术员|审核人|批准人|编制人|申请人|管理员|操作者|检验员|协调员|会签人))/g;
const ACTION_CONTEXT = {
  发起角色: /申请|提出|填写|提交|发起/,
  执行角色: /编制|制定|建立|维护|处理|实施|执行|统计|分析|记录/,
  审核角色: /审核|复核|校对|评审|会签/,
  批准角色: /批准|审批|签批/,
  数据提供角色: /提供|发送|报送|提交|反馈|移交/,
  数据接收角色: /接收|收到|获取/,
  协同角色: /配合|参与|协调|会签/,
};

function roleDefinitionStatus(name, text) {
  const roleName = String(name || '').trim();
  const sourceText = String(text || '');
  if (!roleName) return '待回源确认';
  if (LEADER_ROLE_EXCEPTIONS.has(roleName)) return '原文明确';
  if (DEPARTMENT_NAMES.includes(roleName)) return '原文明确';
  if (DEPARTMENT_NAMES.some((prefix) => roleName.startsWith(prefix) && roleName.length > prefix.length)) {
    return '原文明确';
  }
  if (DEPARTMENT_NAMES.some((prefix) => sourceText.includes(`${prefix}${roleName}`))) {
    return '原文明确';
  }
  return '原文定义不足';
}

function roleRecord(name, roleTypes, chunk, basis, confidence = 'needs_review') {
  return {
    name,
    role_types: roleTypes,
    definition_status: roleDefinitionStatus(name, chunk?.raw_text || basis),
    basis,
    confidence,
    ...evidenceFromChunk(chunk),
  };
}

function addRole(roles, record) {
  if (!record.name || roles.some((role) => role.name === record.name)) return;
  roles.push(record);
}

function hasFinanceSignal(args, chunks) {
  if (args.department === '财务部') return true;
  return chunks.some((chunk) => /GLTX-CW-01|财务成本核算管理程序/.test(`${chunk.source_file || ''}\n${chunk.source_file_name || ''}`));
}

function outputFor(args, chunks, roles) {
  return {
    department: args.department,
    generated_at: new Date().toISOString(),
    source_files: [...new Set(chunks.map((chunk) => chunk.source_file).filter(Boolean))],
    policy: {
      evidence_status: 'needs_review',
      allowed_downstream_use: 'review_only',
      formal_mapping_requires_source_verification: true,
    },
    roles,
  };
}

function financeRoles(args, chunks) {
  const roles = [];

  addRole(roles, roleRecord(
    args.department,
    ['主责部门'],
    findChunk(chunks, [args.department, /成本核算|成本管理/]),
    '来源部门与制度主题共同指向主责部门，仍需在正式入库前回到原文核验。',
  ));

  addRole(roles, roleRecord(
    '财务部成本会计',
    ['执行角色'],
    findChunk(chunks, ['财务部成本会计']) || findChunk(chunks, ['财务部每月末']) || findChunk(chunks, ['成本核算']),
    '制度在成本费用分析条款中出现“财务部成本会计”；部分成本核算环节为上下文待确认。',
  ));

  addRole(roles, roleRecord(
    '车间工人',
    ['发起角色', '执行角色'],
    findChunk(chunks, ['车间工人', '情况说明'], { all: true }),
    '工时调整条款写明由车间工人填写情况说明。',
  ));

  addRole(roles, roleRecord(
    '车间主任',
    ['审核角色'],
    findChunk(chunks, ['车间主任', '审核'], { all: true }),
    '工时调整条款写明车间主任审核。',
  ));

  addRole(roles, roleRecord(
    '定额员',
    ['执行角色', '审核角色'],
    findChunk(chunks, ['定额员', '审核'], { all: true }) || findChunk(chunks, ['定额员']),
    '制度出现定额员设定工时、审核工时调整、统计人工工时。',
  ));

  addRole(roles, roleRecord(
    '经营发展部长',
    ['批准角色'],
    findChunk(chunks, ['经营发展部长', '审核'], { all: true }),
    '工时调整条款写明最后经营发展部长审核后修改。',
  ));

  addRole(roles, roleRecord(
    '行政人事部',
    ['数据提供角色'],
    findChunk(chunks, ['行政人事部', '发至财务部门'], { all: true }),
    '人工工时与工资数据条款写明行政人事部将工资总额及明细费用发至财务部门。',
  ));

  addRole(roles, roleRecord(
    '经营发展部',
    ['数据提供角色', '协同角色'],
    findChunk(chunks, ['经营发展部', '工时定额'], { all: true }),
    '经营发展部/定额员在工时定额和人工工时统计中出现。',
  ));

  addRole(roles, roleRecord(
    '工程技术部',
    ['数据提供角色'],
    findChunk(chunks, ['工程技术部', 'BOM'], { all: true }),
    '生产成本定额管理条款写明工程技术部提供技术方案、BOM单。',
  ));

  addRole(roles, roleRecord(
    '质量安环部',
    ['协同角色'],
    findChunk(chunks, ['质量安环部']) || findChunk(chunks, ['质量成本']),
    '质量成本统计与质量缺陷损失相关条款出现质量安环部。',
  ));

  return outputFor(args, chunks, roles);
}

function contextWindow(text, name) {
  const index = text.indexOf(name);
  if (index < 0) return text.slice(0, 120);
  return text.slice(Math.max(0, index - 32), Math.min(text.length, index + name.length + 32));
}

function classifyRoleTypes(context, roleName, department) {
  const types = [];
  if (roleName === department) types.push('主责部门');
  for (const [type, pattern] of Object.entries(ACTION_CONTEXT)) {
    if (pattern.test(context)) types.push(type);
  }
  if (!types.length && /部门|单位/.test(roleName)) types.push('协同角色');
  if (!types.length) types.push('角色待确认');
  return [...new Set(types)];
}

function genericRoles(args, chunks) {
  const roles = [];
  addRole(roles, roleRecord(
    args.department,
    ['主责部门'],
    findChunk(chunks, [args.department]) || chunks[0],
    '当前处理范围为该部门业务资料；正式主责仍以组织职责和制度条款核验。',
  ));

  for (const chunk of chunks) {
    const text = String(chunk.raw_text || '');
    if (!text) continue;
    const names = [
      ...[...text.matchAll(DEPARTMENT_RE)].map((match) => match[0]),
      ...[...text.matchAll(ROLE_RE)].map((match) => match[1]),
    ]
      .map((name) => name.replace(/^(由|经|至|向|给)/, '').trim())
      .filter((name) => name.length >= 2 && name.length <= 18);

    for (const name of [...new Set(names)]) {
      const context = contextWindow(text, name);
      addRole(roles, roleRecord(
        name,
        classifyRoleTypes(context, name, args.department),
        chunk,
        `原文片段出现“${name}”，上下文为：${context}`,
      ));
      if (roles.length >= 140) break;
    }
    if (roles.length >= 140) break;
  }

  return outputFor(args, chunks, roles);
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'department');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
  const output = hasFinanceSignal(args, chunks)
    ? financeRoles(args, chunks)
    : genericRoles(args, chunks);

  writeJson(args.out, output);
  console.error(`roles=${output.roles.length} out=${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
