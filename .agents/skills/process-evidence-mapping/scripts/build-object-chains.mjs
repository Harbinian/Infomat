#!/usr/bin/env node
/**
 * Build review-only object/action chains from evidence chunks and role candidates.
 */
import {
  evidenceFromChunk,
  findChunk,
  parseArgs,
  readJson,
  readJsonl,
  requireArg,
  writeJson,
} from './candidate-utils.mjs';

function chain(objectName, actions, chunk, extra = {}) {
  return {
    object_name: objectName,
    actions,
    ...evidenceFromChunk(chunk),
    ...extra,
  };
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'roles');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
  const roleBook = readJson(args.roles);
  const chunkWorkHour = findChunk(chunks, ['情况说明', '经营发展部长'], { all: true });
  const chunkPayroll = findChunk(chunks, ['行政人事部', '发至财务部门'], { all: true });
  const chunkGainLoss = findChunk(chunks, ['盈亏处理']) || findChunk(chunks, ['审批权限', '审核批准'], { all: true });
  const chunkScrap = findChunk(chunks, ['废品损失']);
  const chunkArchive = findChunk(chunks, ['保存年限30年']) || findChunk(chunks, ['存档']);
  const chunkMaterial = findChunk(chunks, ['材料出库单列表']) || findChunk(chunks, ['全月平均']);

  const chains = [
    chain('工时调整申请/情况说明', [
      '车间工人填写情况说明',
      '车间主任审核',
      '提交至定额员审核',
      '经营发展部长审核后修改',
    ], chunkWorkHour, {
      chain_type: 'approval_candidate',
      role_candidates: ['车间工人', '车间主任', '定额员', '经营发展部长'],
    }),
    chain('工资总额及明细费用', [
      '经营发展部定额员统计人工工时',
      '提交行政人事部门计算工时工资及其他薪金',
      '行政人事部发送工资总额及明细费用至财务部门',
      '财务部候选接收并用于直接人工成本归集',
    ], chunkPayroll, {
      chain_type: 'controlled_transfer_candidate',
      role_candidates: ['经营发展部', '定额员', '行政人事部', '财务部'],
    }),
    chain('材料出库单列表/直接材料成本', [
      '财务部从供应链系统导出材料出库单列表',
      '按全月平均单价和领用数量核算材料成本',
      '记入生产成本-原材料',
    ], chunkMaterial, {
      chain_type: 'cost_collection_candidate',
      role_candidates: ['财务部成本会计'],
    }),
    chain('盘盈盘亏/盈亏处理事项', [
      '查明盈亏原因',
      '按照规定审批权限报有关部门审核批准',
      '扣除责任者赔偿后按权责划分计入或冲减相关科目',
      '按规定调整消耗量或产量',
    ], chunkGainLoss, {
      chain_type: 'approval_candidate',
      role_candidates: ['有关部门'],
      review_note: '原文为“盈亏处理”，候选链名称需人工确认是否映射为盘盈盘亏。',
    }),
    chain('废品损失', [
      '生产中的废品扣除可回收价值后在原成本项目中反映',
      '销售后退回废品退回原复材车间',
      '废品损失计入该产品生产成本',
      '废品修复后入库则增加车间当月产量',
    ], chunkScrap, {
      chain_type: 'cost_exception_candidate',
      role_candidates: ['复材车间', '财务部成本会计'],
    }),
    chain('成本核算报表', [
      '形成相关成本核算报表',
      '财务部负责归档',
      '保存年限30年',
    ], chunkArchive, {
      chain_type: 'archive_candidate',
      role_candidates: ['财务部'],
    }),
  ];

  const output = {
    department: roleBook.department || args.department || '',
    generated_at: new Date().toISOString(),
    policy: {
      evidence_status: 'candidate',
      allowed_downstream_use: 'review_only',
      object_chain_requires_original_source_verification: true,
    },
    roles_used: roleBook.roles?.map((role) => role.name) || [],
    chains,
  };

  writeJson(args.out, output);
  console.error(`object_chains=${chains.length} out=${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
