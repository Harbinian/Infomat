#!/usr/bin/env node
/**
 * Extract review-only process review items from traceable evidence chunks.
 */
import {
  evidenceFromChunk,
  parseArgs,
  requireArg,
  readJsonl,
  writeJson,
} from './review-item-utils.mjs';

const ACTION_RE = /编制|制定|建立|维护|审核|审批|批准|发放|下发|提交|接收|反馈|更改|变更|确认|评审|会签|归档|保存|记录|统计|分析|策划|验证|发布|关闭|申请|处理/g;
const APPROVAL_RE = /审核|审批|批准|评审|会签|签批|复核/;
const TRANSFER_RE = /提交|发放|下发|反馈|传递|移交|通知|接收|提供|报送|流转|发送/;
const ARCHIVE_RE = /归档|保存|留存|保存期限|保存年限|保管期限|保管年限/;
const OBJECT_RE = /([\u4e00-\u9fffA-Za-z0-9（）()《》“”_\-]{2,42}(?:文件|方案|计划|清单|大纲|指令|需求|报告|记录|申请单|更改单|数据库|BOM|工艺规程|控制卡|流程图|PFMEA|作业指导书|说明|规程|图纸|表|卡|单))/g;
const FORM_TITLE_RE = /(?:^FM|附件|申请单|更改单|记录表|清单|首页|续页|封面|表$|卡$|单$)/i;
const ACTION_SPLIT_RE = /编制|制定|建立|维护|审核|审批|批准|发放|下发|提交|接收|反馈|更改|变更|确认|评审|会签|归档|保存|记录|统计|分析|策划|验证|发布|关闭|申请|处理/;

function reviewItem(name, chunk, extra = {}) {
  return {
    name,
    ...evidenceFromChunk(chunk),
    ...extra,
  };
}

function reviewItemWithContent(content, chunk, extra = {}) {
  return {
    content,
    ...evidenceFromChunk(chunk),
    ...extra,
  };
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
      capabilities.set(name, reviewItem(name, chunk, {
        rationale: '来源目录显示该资料归属的能力/业务域；正式入库前仍需结合部门确认。',
      }));
    }
  }

  const processReviewItems = representativeChunks
    .map((chunk) => ({ chunk, title: sourceTitle(chunk) }))
    .filter(({ title }) => isProcessDocumentTitle(title))
    .slice(0, 240)
    .map(({ chunk, title }) => reviewItem(title, chunk, {
      current_mapping_hint: '由制度/标准/程序标题形成的L3待确认，需回到原文职责和工作程序确认。',
    }));

  const behaviorReviewItems = takeInterestingChunks(chunks, ACTION_RE, 3, 240)
    .map((chunk) => {
      const title = sourceTitle(chunk);
      const actions = uniqueActions(chunk.raw_text).slice(0, 4);
      const object = firstObject(chunk.raw_text, title);
      const name = object && actions.length
        ? `${actions.join('、')}${object}`
        : `${title || '未命名资料'}相关业务行为`;
      return reviewItem(name, chunk, {
        object_review_item: object,
        review_note: `由原文动作词抽取：${actions.join('、') || '未识别明确动作'}。正式A1需人工确认名称和边界。`,
      });
    });

  const approvalReviewItems = takeInterestingChunks(chunks, APPROVAL_RE, 2, 120)
    .map((chunk) => reviewItemWithContent(shortText(chunk.raw_text, 180), chunk, {
      review_note: '原文包含审核/批准/评审等词，先作为审批链待确认；不得直接写入正式审批结论。',
    }));

  const transferReviewItems = takeInterestingChunks(chunks, TRANSFER_RE, 2, 120)
    .map((chunk) => reviewItemWithContent(shortText(chunk.raw_text, 180), chunk, {
      review_note: '原文包含提交/发放/反馈/提供等交接动作，先作为受控传递待确认。',
    }));

  const archiveReviewItems = takeInterestingChunks(chunks, ARCHIVE_RE, 2, 80)
    .map((chunk) => reviewItemWithContent(shortText(chunk.raw_text, 160), chunk, {
      review_note: '原文包含归档/保存/保管要求，需确认是否补入A1验收或归档要求。',
    }));

  return {
    department: args.department,
    source_file: representativeChunks[0]?.source_file || args.input || '',
    generated_at: new Date().toISOString(),
    policy: {
      evidence_status: 'pending_review',
      verification_status: 'unverified',
      allowed_downstream_use: 'review_only',
      similarity_is_ranking_only: true,
      formal_mapping_requires_source_verification: true,
    },
    capability_review_items: dedupeByName([...capabilities.values()]),
    process_review_items: dedupeByName(processReviewItems),
    behavior_review_items: dedupeByName(behaviorReviewItems),
    approval_chain_reviews: dedupeByName(approvalReviewItems),
    controlled_transfer_reviews: dedupeByName(transferReviewItems),
    archive_review_items: dedupeByName(archiveReviewItems),
    acceptance_gap_review_items: [],
  };
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'department');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
  const output = genericOutput(args, chunks);

  writeJson(args.out, output);
  console.error(`process_review_items=${output.process_review_items.length} out=${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
