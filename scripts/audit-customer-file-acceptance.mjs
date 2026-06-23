#!/usr/bin/env node
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sourceBoundaryFromCitation } from './source-boundary-rules.mjs';

const CUSTOMER_TASK_FLAGS = new Set([
  'customer_requirement',
  'customer_form',
  'source_boundary_review',
  'mixed_boundary',
]);

function parseArgs(argv) {
  const root = resolve(import.meta.dirname, '..');
  const args = {
    input: resolve(root, 'docs', 'company-sankey-data.json'),
    out: resolve(root, 'artifacts', 'customer-file-acceptance', 'impact-list.json'),
    report: resolve(root, 'docs', 'reports', 'customer-file-acceptance-impact.md'),
  };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--input') { args.input = value; index += 1; }
    else if (key === '--out') { args.out = value; index += 1; }
    else if (key === '--report') { args.report = value; index += 1; }
    else if (key === '--help' || key === '-h') {
      console.log('Usage: node scripts/audit-customer-file-acceptance.mjs --input docs/company-sankey-data.json --out artifacts/customer-file-acceptance/impact-list.json --report docs/reports/customer-file-acceptance-impact.md');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }
  return args;
}

function sha1(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || '未标注';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function boundaryForRef(ref) {
  if (ref.source_boundary_flag) return ref;
  return {
    ...ref,
    ...sourceBoundaryFromCitation(ref.citation || ref.sourceFile || ''),
  };
}

function quotedNames(text) {
  return [...String(text || '').matchAll(/《([^》]+)》/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function requirementObjectChain(ref) {
  const names = quotedNames(ref.citation);
  if (ref.masterDataObject) return ref.masterDataObject;
  if (names.length) return names.slice(0, 3).join(' / ');
  if (ref.refType === 'A1' && ref.a1Code) return `${ref.l3Name || '未标注L3'} / ${ref.a1Code}`;
  if (ref.l3Name) return ref.l3Name;
  return ref.citation || ref.sourceFile || '未识别要求对象';
}

function currentMappingLocation(ref) {
  const parts = [ref.refType, ref.dept, ref.l3Name, ref.a1Code, ref.masterDataObject]
    .filter(Boolean);
  return parts.join(' / ');
}

function sourceRef(ref) {
  return {
    ref_type: ref.refType || '',
    source_file: ref.sourceFile || '',
    citation: ref.citation || '',
    evidence_type: ref.evidenceType || '',
    note: ref.note || '',
  };
}

function suggestedAction(flag) {
  if (flag === 'customer_form') {
    return '确认该客户表单在昌兴内部由哪个流程、角色和输出物承接；补充昌兴表单、执行记录或部门确认后，再判断是否进入正式字段。';
  }
  if (flag === 'source_boundary_review') {
    return '先回源确认该资料是否属于客户要求、客户表单或昌兴自有文件；未确认前只作为待复核线索。';
  }
  if (flag === 'mixed_boundary') {
    return '拆分昌兴自有证据和客户要求证据，明确哪些结论已由昌兴流程承接，哪些仍需补证。';
  }
  return '确认昌兴责任部门、责任角色、执行动作和输出物；需要 GLTX、部门确认、实际执行记录或受控流程补证后再进入正式结论。';
}

function gapSummary(flag) {
  if (flag === 'customer_form') {
    return '当前证据为客户体系表单，不能单独证明昌兴责任部门、审批链、输入输出部门或系统落位。';
  }
  if (flag === 'source_boundary_review') {
    return '当前资料来源边界待确认，不能作为正式映射依据。';
  }
  if (flag === 'mixed_boundary') {
    return '当前引用混合了昌兴文件和客户要求，需要拆分证据责任。';
  }
  return '当前证据为客户要求文件，不能单独支撑昌兴正式流程责任或系统落位。';
}

function buildTasks(data) {
  const refs = (data.evidenceRefs || [])
    .map(boundaryForRef)
    .filter((ref) => ref.customer_acceptance_required || CUSTOMER_TASK_FLAGS.has(ref.source_boundary_flag));

  const grouped = new Map();
  for (const ref of refs) {
    const objectChain = requirementObjectChain(ref);
    const key = [ref.dept || '流程治理负责人', objectChain, ref.source_boundary_flag].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `CFA-${sha1(key).slice(0, 10).toUpperCase()}`,
        acceptance_task_type: '客户文件承接',
        department: ref.dept || '流程治理负责人',
        requirement_object_chain: objectChain,
        source_boundary_flag: ref.source_boundary_flag,
        source_boundary_label: ref.source_boundary_label || '',
        acceptance_status: ref.acceptance_status || '未识别承接',
        customer_acceptance_required: true,
        gap_summary: gapSummary(ref.source_boundary_flag),
        suggested_action: suggestedAction(ref.source_boundary_flag),
        owner: ref.dept ? `${ref.dept}确认人` : '流程治理负责人',
        current_mapping_locations: [],
        source_refs: [],
      });
    }
    const task = grouped.get(key);
    const location = currentMappingLocation(ref);
    if (location && !task.current_mapping_locations.includes(location)) task.current_mapping_locations.push(location);
    const refRecord = sourceRef(ref);
    const refKey = JSON.stringify(refRecord);
    if (!task.source_refs.some((item) => JSON.stringify(item) === refKey)) task.source_refs.push(refRecord);
  }

  return [...grouped.values()]
    .sort((a, b) => {
      const dept = a.department.localeCompare(b.department, 'zh-Hans-CN');
      if (dept) return dept;
      return a.requirement_object_chain.localeCompare(b.requirement_object_chain, 'zh-Hans-CN');
    });
}

function customerSourceFiles(data) {
  return (data.sourceManifest?.files || [])
    .filter((file) => file.customer_acceptance_required || CUSTOMER_TASK_FLAGS.has(file.source_boundary_flag))
    .map((file) => ({
      path: file.path,
      dept: file.dept || '',
      source_boundary_flag: file.source_boundary_flag,
      source_boundary_label: file.source_boundary_label || '',
      acceptance_status: file.acceptance_status || '未识别承接',
      customer_acceptance_required: true,
    }))
    .sort((a, b) => `${a.dept}${a.path}`.localeCompare(`${b.dept}${b.path}`, 'zh-Hans-CN'));
}

function buildAudit(data) {
  const tasks = buildTasks(data);
  const files = customerSourceFiles(data);
  return {
    generated_at: new Date().toISOString(),
    policy: {
      formal_mapping_write: false,
      task_type: '客户文件承接',
      downstream_rule: '客户文件只能证明客户要求、客户表单或客户流程约束，不能单独证明昌兴责任、审批链、输入输出部门或系统落位。',
    },
    summary: {
      total_tasks: tasks.length,
      source_files_requiring_acceptance: files.length,
      evidence_refs_requiring_acceptance: tasks.reduce((sum, task) => sum + task.source_refs.length, 0),
      by_boundary: countBy(tasks, (task) => task.source_boundary_flag),
      by_department: countBy(tasks, (task) => task.department),
    },
    tasks,
    customer_source_files: files,
  };
}

function mdCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

function shorten(value, max = 72) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function writeReport(filePath, audit) {
  const lines = [
    '# 客户文件承接影响清单',
    '',
    `生成时间：${audit.generated_at}`,
    '',
    '## 边界说明',
    '',
    '- 本清单不改写正式映射，只列出需要补充昌兴承接证据的客户文件影响项。',
    '- 客户文件或客户表单只能作为客户要求依据，不能单独证明昌兴责任部门、审批链、输入输出部门或系统落位。',
    '- 同一要求对象链会合并多个来源引用，保留回源位置。',
    '',
    '## 汇总',
    '',
    `- 承接任务：${audit.summary.total_tasks}`,
    `- 需承接源文件：${audit.summary.source_files_requiring_acceptance}`,
    `- 需承接证据引用：${audit.summary.evidence_refs_requiring_acceptance}`,
    '',
    '## 部门分布',
    '',
    '| 部门 | 任务数 |',
    '|---|---:|',
  ];

  for (const [dept, count] of Object.entries(audit.summary.by_department).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${mdCell(dept)} | ${count} |`);
  }

  lines.push(
    '',
    '## 任务样例',
    '',
    '| 编号 | 部门 | 来源边界 | 要求对象链 | 当前映射位置 | 建议动作 |',
    '|---|---|---|---|---|---|',
  );

  for (const task of audit.tasks.slice(0, 80)) {
    lines.push([
      task.id,
      task.department,
      task.source_boundary_label || task.source_boundary_flag,
      shorten(task.requirement_object_chain, 80),
      shorten(task.current_mapping_locations[0] || '', 80),
      shorten(task.suggested_action, 96),
    ].map(mdCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  if (audit.tasks.length > 80) {
    lines.push('', `> 仅展示前 80 条；完整清单见 JSON 输出。`);
  }

  ensureParent(filePath);
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(readFileSync(args.input, 'utf8'));
  const audit = buildAudit(data);

  ensureParent(args.out);
  writeFileSync(args.out, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  writeReport(args.report, audit);
  console.error(`customer_file_acceptance_tasks=${audit.summary.total_tasks} out=${args.out} report=${args.report}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
