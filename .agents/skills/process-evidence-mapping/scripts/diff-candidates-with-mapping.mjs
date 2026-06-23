#!/usr/bin/env node
/**
 * Compare review-only candidates with the current department mapping.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  escapeMarkdownCell,
  makeCandidateItem,
  mappingCovers,
  parseArgs,
  readJson,
  requireArg,
  shorten,
  writeJson,
} from './candidate-utils.mjs';

const TYPE_ORDER = new Map([
  ['候选L3', 1],
  ['候选A1', 2],
  ['角色待确认', 3],
  ['审批链待确认', 4],
  ['受控传递待确认', 5],
  ['OCR待复核', 6],
  ['验收标准待补', 7],
  ['归档要求待补', 8],
  ['系统落位待确认', 9],
]);

function itemFromCandidate({ department, type, candidate, content, action, mappingText, owner }) {
  const sourceFile = candidate.source_file || '';
  const sourceAnchor = candidate.source_anchor || '';
  const candidateContent = content || candidate.content || candidate.name || '';
  if (mappingCovers(mappingText, candidateContent)) return null;
  const item = makeCandidateItem({
    department,
    sourceFile,
    sourceAnchor,
    candidateType: type,
    content: candidateContent,
    mappingLocation: '当前正式映射未见同名受控覆盖',
    suggestedAction: action,
    owner,
  });
  return {
    ...item,
    evidence_status: candidate.evidence_status || 'candidate',
    verification_status: candidate.verification_status || 'unverified',
    allowed_downstream_use: 'review_only',
    source_boundary_flag: candidate.source_boundary_flag || '',
    source_boundary_label: candidate.source_boundary_label || '',
    source_acceptance_status: candidate.source_acceptance_status || '',
    source_boundary_allowed_downstream_use: candidate.source_boundary_allowed_downstream_use || '',
    customer_acceptance_required: Boolean(candidate.customer_acceptance_required),
  };
}

function acceptanceGapCovered(mappingText, content) {
  if (mappingCovers(mappingText, content)) return true;
  const normalizedMapping = mappingText.replace(/\s+/g, '');
  const normalizedContent = String(content ?? '').replace(/\s+/g, '');
  if (!normalizedContent.includes('验收标准') && !normalizedContent.includes('缺少可验收标准')) return false;
  const terms = ['成本核算报表', '成本分摊表', '废品损失'];
  const matchedTerms = terms.filter((term) => normalizedContent.includes(term) && normalizedMapping.includes(term));
  return matchedTerms.length >= 2
    && normalizedMapping.includes('验收标准')
    && normalizedMapping.includes('保存年限30年');
}

function loadEmbeddingStatus(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      status: 'missing',
      model: 'qwen3-embedding:latest',
      dimensions: 1024,
    };
  }
  return readJson(filePath);
}

function buildItems(documentCandidate, roleBook, objectChains, mappingText) {
  const department = documentCandidate.department || roleBook.department || '';
  const items = [];

  for (const candidate of documentCandidate.process_candidates || []) {
    const item = itemFromCandidate({
      department,
      type: '候选L3',
      candidate,
      action: '确认是否需要新增或调整L3；若当前映射已覆盖，则不入库。',
      mappingText,
      owner: '流程治理负责人/部门确认人',
    });
    if (item) items.push(item);
  }

  for (const candidate of documentCandidate.behavior_candidates || []) {
    const item = itemFromCandidate({
      department,
      type: '候选A1',
      candidate,
      action: '核验原文后判断是否新增A1、补充现有A1，或并入备注待补。',
      mappingText,
      owner: '部门流程确认人',
    });
    if (item) items.push(item);
  }

  for (const candidate of documentCandidate.approval_chain_candidates || []) {
    const item = itemFromCandidate({
      department,
      type: '审批链待确认',
      candidate,
      action: '回到原文条款/签批栏确认审批链；不得直接写入正式审批结论。',
      mappingText,
      owner: '制度责任部门/流程治理负责人',
    });
    if (item) items.push(item);
  }

  for (const candidate of documentCandidate.controlled_transfer_candidates || []) {
    const item = itemFromCandidate({
      department,
      type: '受控传递待确认',
      candidate,
      action: '确认是否存在受控交接证据；正式字段需以源条款为准。',
      mappingText,
      owner: '输入/接收双方部门确认人',
    });
    if (item) items.push(item);
  }

  for (const candidate of documentCandidate.archive_candidates || []) {
    const item = itemFromCandidate({
      department,
      type: '归档要求待补',
      candidate,
      action: '补充到相关A1验收标准、归档要求或核验提醒前先核验源条款。',
      mappingText,
      owner: '制度责任部门/流程治理负责人',
    });
    if (item) items.push(item);
  }

  for (const candidate of documentCandidate.acceptance_gap_candidates || []) {
    if (acceptanceGapCovered(mappingText, candidate.content)) continue;
    const item = itemFromCandidate({
      department,
      type: '验收标准待补',
      candidate,
      action: '确认最终成果和验收标准是否能由制度条款支撑。',
      mappingText,
      owner: '部门流程确认人',
    });
    if (item) items.push(item);
  }

  for (const role of roleBook.roles || []) {
    if (mappingCovers(mappingText, role.name)) continue;
    if (role.name === department) continue;
    if (['财务部成本会计', '有关部门'].includes(role.name) || ['candidate', 'context_inferred'].includes(role.confidence)) {
      const item = itemFromCandidate({
        department,
        type: '角色待确认',
        candidate: role,
        content: `${role.name}：${(role.role_types || []).join('、')}`,
        action: '确认角色名称是否为正式岗位、部门或审批身份。',
        mappingText,
        owner: '部门确认人',
      });
      if (item) items.push(item);
    }
  }

  for (const chain of objectChains.chains || []) {
    if (chain.chain_type === 'approval_candidate' && /审核|审批|批准/.test((chain.actions || []).join(' '))) {
      const item = itemFromCandidate({
        department,
        type: '审批链待确认',
        candidate: chain,
        content: `${chain.object_name}：${(chain.actions || []).join(' → ')}`,
        action: '对照制度条款确认对象链是否应进入审批流或只作为协同证据。',
        mappingText,
        owner: '流程治理负责人',
      });
      if (item) items.push(item);
    }
  }

  const byKey = new Map();
  for (const item of items) byKey.set(item.stable_key, item);
  return [...byKey.values()].sort((a, b) => {
    const typeDiff = (TYPE_ORDER.get(a.candidate_type) || 99) - (TYPE_ORDER.get(b.candidate_type) || 99);
    if (typeDiff) return typeDiff;
    return `${a.source_file}${a.content}`.localeCompare(`${b.source_file}${b.content}`, 'zh-Hans-CN');
  });
}

function writeReport(filePath, items, embeddingManifest, mappingPath) {
  const embeddingUsed = embeddingManifest.status === 'embedded';
  const lines = [
    '# 候选映射差异审计报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    `当前映射：${mappingPath}`,
    '',
    '## 边界',
    '',
    '- 候选结果只用于发现缺口，不能替代正式映射。',
    '- 相似度仅用于候选排序，不是证据强度。',
    `- ${embeddingUsed ? '本轮已使用向量检索召回候选证据，但仍需回源核验。' : '本轮未使用向量检索，已降级为关键词/规则抽取。'}`,
    '- 所有候选默认 `evidence_status=candidate`、`allowed_downstream_use=review_only`。',
    '',
    '## Embedding Manifest',
    '',
    `- status: ${embeddingManifest.status || 'unknown'}`,
    `- model: ${embeddingManifest.model || 'qwen3-embedding:latest'}`,
    `- dimensions: ${embeddingManifest.dimensions || 1024}`,
    `- source_hash: ${embeddingManifest.source_hash || '未记录'}`,
    '',
    '## 未覆盖候选',
    '',
  ];

  if (items.length === 0) {
    lines.push('当前未发现需要进入候选待办的未覆盖项。', '');
  } else {
    lines.push('| 编号 | 候选类型 | 来源 | 候选内容 | 建议动作 |');
    lines.push('|---|---|---|---|---|');
    for (const item of items) {
      lines.push([
        item.id,
        item.candidate_type,
        `${item.source_file} ${item.source_anchor}`.trim(),
        shorten(item.content),
        item.suggested_action,
      ].map(escapeMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    lines.push('');
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'document');
  requireArg(args, 'roles');
  requireArg(args, 'objects');
  requireArg(args, 'mapping');
  requireArg(args, 'out');
  requireArg(args, 'items');

  const documentCandidate = readJson(args.document);
  const roleBook = readJson(args.roles);
  const objectChains = readJson(args.objects);
  const mappingText = fs.existsSync(args.mapping) ? fs.readFileSync(args.mapping, 'utf8') : '';
  const embeddingManifest = loadEmbeddingStatus(args.embeddingManifest);
  const items = buildItems(documentCandidate, roleBook, objectChains, mappingText);

  writeJson(args.items, items);
  writeReport(args.out, items, embeddingManifest, args.mapping);
  console.error(`diff_items=${items.length} out=${args.out}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
