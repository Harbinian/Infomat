#!/usr/bin/env node
/**
 * Extract review-only role candidates from evidence chunks.
 */
import {
  evidenceFromChunk,
  findChunk,
  parseArgs,
  requireArg,
  readJsonl,
  writeJson,
} from './candidate-utils.mjs';

function roleRecord(name, roleTypes, chunk, basis, confidence = 'candidate') {
  return {
    name,
    role_types: roleTypes,
    basis,
    confidence,
    ...evidenceFromChunk(chunk),
  };
}

function addRole(roles, record) {
  if (!record.name || roles.some((role) => role.name === record.name)) return;
  roles.push(record);
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'department');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
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
    '制度在成本费用分析条款中出现“财务部成本会计”；部分成本核算环节为上下文候选。',
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

  const output = {
    department: args.department,
    generated_at: new Date().toISOString(),
    source_files: [...new Set(chunks.map((chunk) => chunk.source_file).filter(Boolean))],
    policy: {
      evidence_status: 'candidate',
      allowed_downstream_use: 'review_only',
      formal_mapping_requires_source_verification: true,
    },
    roles,
  };

  writeJson(args.out, output);
  console.error(`roles=${roles.length} out=${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
