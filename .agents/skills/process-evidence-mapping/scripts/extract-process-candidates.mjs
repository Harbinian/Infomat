#!/usr/bin/env node
/**
 * Extract review-only process candidates from traceable evidence chunks.
 */
import {
  evidenceFromChunk,
  findChunk,
  parseArgs,
  requireArg,
  readJsonl,
  writeJson,
} from './candidate-utils.mjs';

function candidate(name, chunk, extra = {}) {
  return {
    name,
    ...evidenceFromChunk(chunk),
    ...extra,
  };
}

function candidateWithContent(content, chunk, extra = {}) {
  return {
    content,
    ...evidenceFromChunk(chunk),
    ...extra,
  };
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'department');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
  const sourceFile = chunks.find((chunk) => chunk.source_file)?.source_file || args.input || '';

  const chunk511 = findChunk(chunks, ['5.1.1', '工时定额'], { all: true });
  const chunk512 = findChunk(chunks, ['情况说明', '经营发展部长'], { all: true });
  const chunk522 = findChunk(chunks, ['行政人事部', '发至财务部门'], { all: true });
  const chunk541 = findChunk(chunks, ['确定成本核算对象']) || findChunk(chunks, ['成本核算对象']);
  const chunk543Material = findChunk(chunks, ['全月平均法']) || findChunk(chunks, ['材料采用实际成本核算']);
  const chunk544 = findChunk(chunks, ['具体产品的成本核算']) || findChunk(chunks, ['生产订单']);
  const chunkGainLoss = findChunk(chunks, ['盈亏处理']) || findChunk(chunks, ['必须查明原因', '审批权限'], { all: true });
  const chunkScrap = findChunk(chunks, ['废品损失']);
  const chunkArchive = findChunk(chunks, ['保存年限30年']) || findChunk(chunks, ['存档']);
  const chunkAnalysis = findChunk(chunks, ['成本费用分析']);

  const output = {
    department: args.department,
    source_file: sourceFile,
    generated_at: new Date().toISOString(),
    policy: {
      evidence_status: 'candidate',
      verification_status: 'unverified',
      allowed_downstream_use: 'review_only',
      similarity_is_ranking_only: true,
      formal_mapping_requires_source_verification: true,
    },
    capability_candidates: [
      candidate('成本核算管理', chunk511 || chunk544, {
        rationale: '制度名称、目的和5.x条款集中指向生产成本管理和产品成本核算。',
      }),
    ],
    process_candidates: [
      candidate('生产成本定额管理与指标分解', chunk511, {
        current_mapping_hint: '可能已覆盖为现有L3，需与当前映射比对。',
      }),
      candidate('生产成本事中控制', chunk512, {
        current_mapping_hint: '工时调整链需单独复核是否只是协同审批，不宜直接当作财务输出部门结论。',
      }),
      candidate('产品成本核算基础管理', chunk522, {
        current_mapping_hint: '工资明细传递是受控传递候选，应保留源锚。',
      }),
      candidate('月度产品成本核算与成本结转', chunk541 || chunk544, {
        current_mapping_hint: '当前财务部映射中已有相近L3，候选用于校验A1完整性。',
      }),
      candidate('成本费用核算分析', chunkAnalysis, {
        current_mapping_hint: '当前财务部映射中已有相近L3，候选用于校验分析行为和验收标准。',
      }),
    ],
    behavior_candidates: [
      candidate('接收行政人事部工资总额及明细费用', chunk522, {
        object_candidate: '人工工时统计、工资总额及明细费用',
        review_note: '只能作为受控传递候选，不能直接输出正式来源/目标部门字段。',
      }),
      candidate('归集直接材料成本（全月平均法）', chunk543Material, {
        object_candidate: '材料出库单列表、直接材料成本',
      }),
      candidate('归集直接人工成本并按工时分摊', findChunk(chunks, ['生产成本-直接人工', '分配率'], { all: true }) || chunk522, {
        object_candidate: '人工工时、工资明细、直接人工成本分摊表',
      }),
      candidate('归集制造费用并按工时分摊', findChunk(chunks, ['制造费用', '人工工时'], { all: true }) || chunk544, {
        object_candidate: '制造费用明细、制造费用分摊表',
      }),
      candidate('处理盘盈盘亏', chunkGainLoss, {
        object_candidate: '原材料、燃料、备品备件、半成品等盈亏处理',
        review_note: '原文为“盈亏处理”，候选名称按财务核算语言暂归并为盘盈盘亏，需人工确认。',
      }),
      candidate('处理废品损失', chunkScrap, {
        object_candidate: '废品损失',
      }),
      candidate('归档成本核算报表', chunkArchive, {
        object_candidate: '相关报表',
      }),
    ],
    approval_chain_candidates: [
      candidateWithContent(
        '工时调整链：车间工人填写情况说明 → 车间主任审核 → 定额员审核 → 经营发展部长审核后修改',
        chunk512,
        {
          chain_roles: ['车间工人', '车间主任', '定额员', '经营发展部长'],
          review_note: '候选审批链不得直接写为财务部A1审批类型，需确认财务部是否参与该节点。',
        },
      ),
      candidateWithContent(
        '盈亏处理需查明原因，按照规定审批权限报有关部门审核批准',
        chunkGainLoss,
        {
          chain_roles: ['有关部门'],
          review_note: '原文未展开部门和权限层级，只能形成审批链待确认。',
        },
      ),
    ],
    controlled_transfer_candidates: [
      candidateWithContent(
        '行政人事部将各车间生产工人工资总额及其明细费用发至财务部门',
        chunk522,
        {
          transfer_object: '工资总额及明细费用',
          review_note: '这是受控传递候选；正式字段需回源核验后再填写。',
        },
      ),
      candidateWithContent(
        '工程技术部提供技术方案、BOM单；经营发展部制定工时定额用于订单成本预测',
        chunk511,
        {
          transfer_object: '技术方案、BOM单、工时定额',
          review_note: '存在跨部门输入候选，但不能凭相似度或上下文直接写入正式部门字段。',
        },
      ),
    ],
    archive_candidates: [
      candidateWithContent('相关报表由财务部负责存档，保存年限30年。', chunkArchive, {
        retention_period: '30年',
        review_note: '归档要求需补入对应A1验收/归档字段前先核验原文位置。',
      }),
    ],
    acceptance_gap_candidates: [
      candidateWithContent('成本核算报表、成本分摊表、废品损失处理等最终成果缺少可验收标准拆解。', chunkArchive || chunkScrap, {
        review_note: '候选缺口，不等于正式验收标准。',
      }),
    ],
  };

  writeJson(args.out, output);
  console.error(`process_candidates=${output.process_candidates.length} out=${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
