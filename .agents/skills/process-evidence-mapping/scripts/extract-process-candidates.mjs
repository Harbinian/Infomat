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

const ACTION_RE = /编制|制定|建立|维护|审核|审批|批准|发放|下发|提交|接收|反馈|更改|变更|确认|评审|会签|归档|保存|记录|统计|分析|策划|验证|发布|关闭|申请|处理/g;
const APPROVAL_RE = /审核|审批|批准|评审|会签|签批|复核/;
const TRANSFER_RE = /提交|发放|下发|反馈|传递|移交|通知|接收|提供|报送|流转|发送/;
const ARCHIVE_RE = /归档|保存|留存|保存期限|保存年限|保管期限|保管年限/;
const OBJECT_RE = /([\u4e00-\u9fffA-Za-z0-9（）()《》“”_\-]{2,42}(?:文件|方案|计划|清单|大纲|指令|需求|报告|记录|申请单|更改单|数据库|BOM|工艺规程|控制卡|流程图|PFMEA|作业指导书|说明|规程|图纸|表|卡|单))/g;
const FORM_TITLE_RE = /(?:^FM|附件|申请单|更改单|记录表|清单|首页|续页|封面|表$|卡$|单$)/i;
const ACTION_SPLIT_RE = /编制|制定|建立|维护|审核|审批|批准|发放|下发|提交|接收|反馈|更改|变更|确认|评审|会签|归档|保存|记录|统计|分析|策划|验证|发布|关闭|申请|处理/;

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

function financeOutput(args, chunks) {
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
  const sourceFile = chunks.find((chunk) => chunk.source_file)?.source_file || args.input || '';

  return {
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
}

function hasFinanceSignal(args, chunks) {
  if (args.department === '财务部') return true;
  return chunks.some((chunk) => /GLTX-CW-01|财务成本核算管理程序/.test(`${chunk.source_file || ''}\n${chunk.source_file_name || ''}`));
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\.[^.]+$/u, '')
    .replace(/^[A-Z]{2,}\d+(?:-\d+)*(?:-[A-Z])?[-_ ]*/i, '')
    .replace(/^[A-Z]{2,}\d+/i, '')
    .replace(/(?:管理)?(?:程序|标准|规定|办法)?ENG$/i, '')
    .replace(/[\s_]+/g, '')
    .replace(/-英文版?$/i, '')
    .trim();
}

function sourceTitle(chunk) {
  const name = cleanTitle(chunk.source_file_name || String(chunk.source_file || '').split(/[\\/]/).pop());
  if (name) return name;
  const parts = String(chunk.source_file || '').split(/[\\/]/).filter(Boolean);
  return cleanTitle(parts.at(-2) || parts.at(-1) || '');
}

function capabilityName(chunk) {
  const parts = String(chunk.leaf_dir || chunk.source_file || '')
    .split(/[\\/]/)
    .filter(Boolean);
  const businessRoot = parts.findIndex((part) => part.includes('业务资料'));
  const scope = businessRoot >= 0 ? parts.slice(businessRoot + 1, -1) : parts.slice(0, -1);
  const category = [...scope].reverse().find((part) => /^\d+(?:\.\d+)?-/.test(part)) || scope[0] || '';
  return category.replace(/^\d+(?:\.\d+)?-/, '').trim();
}

function isProcessDocumentTitle(title) {
  if (!title || FORM_TITLE_RE.test(title)) return false;
  return /程序|标准|规定|办法|流程|管理/.test(title);
}

function uniqueActions(text) {
  return [...new Set(String(text || '').match(ACTION_RE) || [])];
}

function firstObject(text, fallbackTitle = '') {
  const matches = [...String(text || '').matchAll(OBJECT_RE)]
    .map((match) => normalizeObjectName(match[1]))
    .filter((item) => item.length >= 3);
  if (matches.length) return matches.sort((a, b) => a.length - b.length)[0];
  const title = cleanTitle(fallbackTitle);
  return title && !FORM_TITLE_RE.test(title) ? title : '';
}

function normalizeObjectName(value) {
  let name = String(value || '').replace(/[，。；：、]+$/g, '').trim();
  const split = name.split(ACTION_SPLIT_RE).filter(Boolean);
  if (split.length > 1) name = split.at(-1).trim();
  return name
    .replace(/^(?:工程技术部|质量管理部|财务部|经营发展部|项目管理部|物资保障部|复材车间|运维安环部|行政人事部)(?:负责|提供|接收)?/, '')
    .replace(/^[\u4e00-\u9fff]{2,16}(?:人员|负责人|责任人|部门|单位|主任|部长|经理|主管|工程师|工艺员|技术员|审核人|批准人|编制人|申请人|管理员|操作者|检验员|协调员|会签人)/, '')
    .replace(/^(?:负责|提供|接收|形成|生成|完成)/, '')
    .trim();
}

function shortText(value, max = 96) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function dedupeByName(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = [record.name || record.content, record.source_file, record.source_anchor].join('|');
    if (!byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function takeInterestingChunks(chunks, pattern, maxPerSource = 2, maxTotal = 160) {
  const perSource = new Map();
  const selected = [];
  for (const chunk of chunks) {
    const text = chunk.raw_text || '';
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    const source = chunk.source_file || '';
    const count = perSource.get(source) || 0;
    if (count >= maxPerSource) continue;
    perSource.set(source, count + 1);
    selected.push(chunk);
    if (selected.length >= maxTotal) break;
  }
  return selected;
}

function genericOutput(args, chunks) {
  const chunksBySource = new Map();
  for (const chunk of chunks) {
    if (!chunk.source_file) continue;
    if (!chunksBySource.has(chunk.source_file)) chunksBySource.set(chunk.source_file, []);
    chunksBySource.get(chunk.source_file).push(chunk);
  }

  const representativeChunks = [...chunksBySource.values()]
    .map((items) => items.find((chunk) => String(chunk.raw_text || '').trim().length >= 10) || items[0])
    .filter(Boolean);

  const capabilities = new Map();
  for (const chunk of representativeChunks) {
    const name = capabilityName(chunk);
    if (name && !capabilities.has(name)) {
      capabilities.set(name, candidate(name, chunk, {
        rationale: '来源目录显示该资料归属的能力/业务域；正式入库前仍需结合部门确认。',
      }));
    }
  }

  const processCandidates = representativeChunks
    .map((chunk) => ({ chunk, title: sourceTitle(chunk) }))
    .filter(({ title }) => isProcessDocumentTitle(title))
    .slice(0, 240)
    .map(({ chunk, title }) => candidate(title, chunk, {
      current_mapping_hint: '由制度/标准/程序标题形成的L3候选，需回到原文职责和工作程序确认。',
    }));

  const behaviorCandidates = takeInterestingChunks(chunks, ACTION_RE, 3, 240)
    .map((chunk) => {
      const title = sourceTitle(chunk);
      const actions = uniqueActions(chunk.raw_text).slice(0, 4);
      const object = firstObject(chunk.raw_text, title);
      const name = object && actions.length
        ? `${actions.join('、')}${object}`
        : `${title || '未命名资料'}相关业务行为`;
      return candidate(name, chunk, {
        object_candidate: object,
        review_note: `由原文动作词抽取：${actions.join('、') || '未识别明确动作'}。正式A1需人工确认名称和边界。`,
      });
    });

  const approvalCandidates = takeInterestingChunks(chunks, APPROVAL_RE, 2, 120)
    .map((chunk) => candidateWithContent(shortText(chunk.raw_text, 180), chunk, {
      review_note: '原文包含审核/批准/评审等词，先作为审批链候选；不得直接写入正式审批结论。',
    }));

  const transferCandidates = takeInterestingChunks(chunks, TRANSFER_RE, 2, 120)
    .map((chunk) => candidateWithContent(shortText(chunk.raw_text, 180), chunk, {
      review_note: '原文包含提交/发放/反馈/提供等交接动作，先作为受控传递候选。',
    }));

  const archiveCandidates = takeInterestingChunks(chunks, ARCHIVE_RE, 2, 80)
    .map((chunk) => candidateWithContent(shortText(chunk.raw_text, 160), chunk, {
      review_note: '原文包含归档/保存/保管要求，需确认是否补入A1验收或归档要求。',
    }));

  return {
    department: args.department,
    source_file: representativeChunks[0]?.source_file || args.input || '',
    generated_at: new Date().toISOString(),
    policy: {
      evidence_status: 'candidate',
      verification_status: 'unverified',
      allowed_downstream_use: 'review_only',
      similarity_is_ranking_only: true,
      formal_mapping_requires_source_verification: true,
    },
    capability_candidates: dedupeByName([...capabilities.values()]),
    process_candidates: dedupeByName(processCandidates),
    behavior_candidates: dedupeByName(behaviorCandidates),
    approval_chain_candidates: dedupeByName(approvalCandidates),
    controlled_transfer_candidates: dedupeByName(transferCandidates),
    archive_candidates: dedupeByName(archiveCandidates),
    acceptance_gap_candidates: [],
  };
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'department');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
  const output = hasFinanceSignal(args, chunks)
    ? financeOutput(args, chunks)
    : genericOutput(args, chunks);

  writeJson(args.out, output);
  console.error(`process_candidates=${output.process_candidates.length} out=${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
