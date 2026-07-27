#!/usr/bin/env node
/**
 * Build review-only object/action chains from evidence chunks and role reviewItems.
 */
import {
  evidenceFromChunk,
  parseArgs,
  readJson,
  readJsonl,
  requireArg,
  writeJson,
} from './review-item-utils.mjs';

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
  if (TRANSFER_RE.test(joined)) return 'controlled_transfer_review';
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
      role_review_items: roleNames.filter((name) => record.text.includes(name)).slice(0, 12),
      review_note: '由原文对象词和动作词串联的待确认对象链；正式入库前必须回源核验。',
    }));
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'chunks');
  requireArg(args, 'roles');
  requireArg(args, 'out');

  const chunks = readJsonl(args.chunks);
  const roleBook = readJson(args.roles);
  const chains = genericChains(chunks, roleBook);

  const output = {
    department: roleBook.department || args.department || '',
    generated_at: new Date().toISOString(),
    policy: {
      evidence_status: 'pending_review',
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
