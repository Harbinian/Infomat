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

const ACTION_RE = /编制|制定|建立|维护|审核|审批|批准|发放|下发|提交|接收|反馈|更改|变更|确认|评审|会签|归档|保存|记录|统计|分析|策划|验证|发布|关闭|申请|处理/g;
const OBJECT_RE = /([\u4e00-\u9fffA-Za-z0-9（）()《》“”_\-]{2,42}(?:文件|方案|计划|清单|大纲|指令|需求|报告|记录|申请单|更改单|数据库|BOM|工艺规程|控制卡|流程图|PFMEA|作业指导书|说明|规程|图纸|表|卡|单))/g;
const APPROVAL_RE = /审核|审批|批准|评审|会签|签批|复核/;
const TRANSFER_RE = /提交|发放|下发|反馈|传递|移交|通知|接收|提供|报送|流转|发送/;
const ARCHIVE_RE = /归档|保存|留存|保存期限|保存年限|保管期限|保管年限/;
const ACTION_SPLIT_RE = /编制|制定|建立|维护|审核|审批|批准|发放|下发|提交|接收|反馈|更改|变更|确认|评审|会签|归档|保存|记录|统计|分析|策划|验证|发布|关闭|申请|处理/;

function chain(objectName, actions, chunk, extra = {}) {
  return {
    object_name: objectName,
    actions,
    ...evidenceFromChunk(chunk),
    ...extra,
  };
}

function hasFinanceSignal(roleBook, chunks) {
  if (roleBook.department === '财务部') return true;
  return chunks.some((chunk) => /GLTX-CW-01|财务成本核算管理程序/.test(`${chunk.source_file || ''}\n${chunk.source_file_name || ''}`));
}

function financeChains(chunks) {
  const chunkWorkHour = findChunk(chunks, ['情况说明', '经营发展部长'], { all: true });
  const chunkPayroll = findChunk(chunks, ['行政人事部', '发至财务部门'], { all: true });
  const chunkGainLoss = findChunk(chunks, ['盈亏处理']) || findChunk(chunks, ['审批权限', '审核批准'], { all: true });
  const chunkScrap = findChunk(chunks, ['废品损失']);
  const chunkArchive = findChunk(chunks, ['保存年限30年']) || findChunk(chunks, ['存档']);
  const chunkMaterial = findChunk(chunks, ['材料出库单列表']) || findChunk(chunks, ['全月平均']);

  return [
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
}

function uniqueActions(text) {
  return [...new Set(String(text || '').match(ACTION_RE) || [])];
}

function objectNames(text) {
  return [...String(text || '').matchAll(OBJECT_RE)]
    .map((match) => normalizeObjectName(match[1]))
    .filter((item) => item.length >= 3 && item.length <= 48);
}

function normalizeObjectName(value) {
  let name = String(value || '').replace(/[，。；：、]+$/g, '').trim();
  const split = name.split(ACTION_SPLIT_RE).filter(Boolean);
  if (split.length > 1) name = split.at(-1).trim();
  name = name
    .replace(/^(?:工程技术部|质量管理部|财务部|经营发展部|项目管理部|物资保障部|复材车间|运维安环部|行政人事部)(?:负责|提供|接收)?/, '')
    .replace(/^[\u4e00-\u9fff]{2,16}(?:人员|负责人|责任人|部门|单位|主任|部长|经理|主管|工程师|工艺员|技术员|审核人|批准人|编制人|申请人|管理员|操作者|检验员|协调员|会签人)/, '')
    .replace(/^(?:负责|提供|接收|形成|生成|完成)/, '')
    .trim();
  return name;
}

function chainType(actions, text) {
  const joined = `${actions.join(' ')} ${text}`;
  if (ARCHIVE_RE.test(joined)) return 'archive_candidate';
  if (APPROVAL_RE.test(joined)) return 'approval_candidate';
  if (TRANSFER_RE.test(joined)) return 'controlled_transfer_candidate';
  return 'object_action_candidate';
}

function genericChains(chunks, roleBook) {
  const byObject = new Map();
  for (const chunk of chunks) {
    const text = String(chunk.raw_text || '');
    const actions = uniqueActions(text);
    if (!actions.length) continue;
    for (const objectName of objectNames(text).slice(0, 4)) {
      if (!byObject.has(objectName)) {
        byObject.set(objectName, {
          objectName,
          actions: [],
          chunk,
          text,
        });
      }
      const record = byObject.get(objectName);
      for (const action of actions) {
        if (!record.actions.includes(action)) record.actions.push(action);
      }
      if (record.text.length < text.length) {
        record.chunk = chunk;
        record.text = text;
      }
    }
    if (byObject.size >= 160) break;
  }

  const roleNames = roleBook.roles?.map((role) => role.name) || [];
  return [...byObject.values()]
    .slice(0, 160)
    .map((record) => chain(record.objectName, record.actions, record.chunk, {
      chain_type: chainType(record.actions, record.text),
      role_candidates: roleNames.filter((name) => record.text.includes(name)).slice(0, 12),
      review_note: '由原文对象词和动作词串联的候选对象链；正式入库前必须回源核验。',
    }));
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'roles');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
  const roleBook = readJson(args.roles);
  const chains = hasFinanceSignal(roleBook, chunks)
    ? financeChains(chunks)
    : genericChains(chunks, roleBook);

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
