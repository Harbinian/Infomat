#!/usr/bin/env node
/**
 * Rebuild one department Sankey HTML from the controlled DCM/BBM Markdown.
 *
 * Usage:
 *   node scripts/rebuild-department-sankey-page.mjs 工程技术部
 *
 * Input:
 *   docs/norms/{部门}部门-能力-流程-系统映射关系.md
 *
 * Output:
 *   docs/norms/{部门}部门能力流程系统桑基图.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceBoundaryFromCitation } from './source-boundary-rules.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const NORMS = resolve(ROOT, 'docs', 'norms');
const dept = process.argv[2] || '工程技术部';
const inputPath = resolve(NORMS, `${dept}部门-能力-流程-系统映射关系.md`);
const outputPath = resolve(NORMS, `${dept}部门能力流程系统桑基图.html`);

function cleanCell(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMarkdownRow(line) {
  const cells = line.trim().split('|');
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells.map(cleanCell);
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function parseTables(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  let heading = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^#{1,6}\s+/.test(line)) heading = line.replace(/^#{1,6}\s+/, '').trim();
    if (!line.startsWith('|')) continue;

    const header = splitMarkdownRow(line);
    const sep = splitMarkdownRow(lines[i + 1] || '');
    if (!isSeparator(sep)) continue;

    const rows = [];
    i += 2;
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      const cells = splitMarkdownRow(lines[i]);
      if (!isSeparator(cells)) rows.push(cells);
      i += 1;
    }
    i -= 1;
    tables.push({ heading, header, rows });
  }

  return tables;
}

function tableRows(table) {
  return table.rows.map(cells =>
    Object.fromEntries(table.header.map((header, index) => [header, cells[index] || ''])),
  );
}

function splitSystems(value) {
  const text = String(value || '').trim();
  if (!text || /^[-—–]+$/.test(text)) return [];
  return text.split(/[、，,]/).map(item => item.trim()).filter(Boolean);
}

function customerEvidenceLabel(boundary) {
  if (!boundary.customer_acceptance_required) return '';
  if (boundary.acceptance_status === '已形成昌兴承接流程') return '客户要求-已承接';
  return '客户要求-待承接';
}

function sourceBoundaryFields(evidence) {
  const boundary = sourceBoundaryFromCitation(evidence);
  return {
    source_boundary_flag: boundary.source_boundary_flag,
    source_boundary_label: boundary.source_boundary_label,
    acceptance_status: boundary.acceptance_status,
    customer_acceptance_required: boundary.customer_acceptance_required,
    customer_evidence_label: customerEvidenceLabel(boundary),
  };
}

function parseMappingRows(tables) {
  const table = tables.find(item =>
    item.header.includes('部门（D1）') &&
    item.header.includes('能力域（L1）') &&
    item.header.includes('业务能力（L2）') &&
    item.header.includes('业务流程（L3）'),
  );
  if (!table) return [];

  return tableRows(table).map((row, index) => {
    const evidence = row['制度依据（文件号/条款）'] || '';
    return {
      dept: row['部门（D1）'] || dept,
      domain: row['能力域（L1）'] || '未标注能力域',
      capability: row['业务能力（L2）'] || '未标注业务能力',
      process: row['业务流程（L3）'] || '未标注业务流程',
      evidence,
      ...sourceBoundaryFields(evidence),
      system: row['应用系统（S1）'] || '',
      basis: row['系统设计依据'] || '',
      order: index + 1,
    };
  });
}

function parseL3CodeMap(tables) {
  const table = tables.find(item =>
    item.header.includes('业务流程（L3）标识符') &&
    item.header.includes('业务流程（L3）'),
  );
  const map = new Map();
  if (!table) return map;
  for (const row of tableRows(table)) {
    const code = row['业务流程（L3）标识符'];
    const process = row['业务流程（L3）'];
    if (code && process) map.set(process, code);
  }
  return map;
}

function l3CodeFromA1(id) {
  const match = String(id || '').match(/^(.+?-L3-\d{2})-A\d{2}$/);
  return match ? match[1] : '';
}

function parseA1Rows(tables, l3Rows) {
  const l3ByCode = new Map(l3Rows.map(row => [row.code, row]));
  const a1Tables = tables.filter(item =>
    item.header.includes('业务行为（A1）编号') &&
    item.header.includes('业务行为（A1）'),
  );

  return a1Tables.flatMap(table => tableRows(table).map(row => {
    const id = row['业务行为（A1）编号'] || '';
    const l3 = l3ByCode.get(l3CodeFromA1(id)) || {};
    const process = l3.process || table.heading.replace(/^[A-Z]+-L3-\d{2}\s*/, '') || '';
    const alert = row['核验提醒'] || row['备注'] || '';
    const system = row['应用系统（S1）'] || '—';
    const evidence = row['制度依据'] || '';
    const boundary = sourceBoundaryFields(evidence);

    return [
      id,
      row['业务行为（A1）'] || '',
      row['执行角色'] || '',
      row['触发情景'] || '',
      row['前置条件'] || '',
      row['审批类型'] || '',
      system,
      evidence,
      row['证据类型'] || '',
      l3.domain || '',
      l3.capability || '',
      process,
      alert,
      row['数据输出'] || '',
      process,
      row['数据输入'] || '',
      row['输入来源部门'] || '',
      row['输出目标部门'] || '',
      row['验收标准'] || '',
      row['部门确认意见'] || '',
      row['是否调整'] || '',
      row['调整建议'] || '',
      row['应用模块（S2）'] || '',
      boundary.source_boundary_flag,
      boundary.source_boundary_label,
      boundary.acceptance_status,
      boundary.customer_acceptance_required,
      boundary.customer_evidence_label,
    ];
  })).filter(row => row[0] && row[1]);
}

function attachL3Codes(rows, l3CodeMap) {
  return rows.map((row, index) => ({
    ...row,
    code: l3CodeMap.get(row.process) || `GC-L3-${String(index + 1).padStart(2, '0')}`,
  }));
}

function countUnique(rows, key) {
  return new Set(rows.map(row => row[key]).filter(Boolean)).size;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function toJson(value) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

function renderHtml(l3Rows, a1Rows) {
  const domains = [...new Set(l3Rows.map(row => row.domain))];
  const pendingSystems = l3Rows.filter(row => splitSystems(row.system).length === 0).length;
  const a1PendingSystems = a1Rows.filter(row => !row[6] || /^[-—–]+$/.test(row[6])).length;
  const confirmedSystems = [...new Set(l3Rows.flatMap(row => splitSystems(row.system)))].filter(Boolean);
  const domainCounts = [...l3Rows.reduce((map, row) => {
    map.set(row.domain, (map.get(row.domain) || 0) + 1);
    return map;
  }, new Map()).entries()];
  const a1Counts = [...a1Rows.reduce((map, row) => {
    map.set(row[9] || '未标注能力域', (map.get(row[9] || '未标注能力域') || 0) + 1);
    return map;
  }, new Map()).entries()];
  const systemCounts = [...l3Rows.reduce((map, row) => {
    const systems = splitSystems(row.system);
    for (const system of systems) map.set(system, (map.get(system) || 0) + 1);
    return map;
  }, new Map()).entries()];
  const maxDomainCount = Math.max(1, ...a1Counts.map(([, count]) => count), ...systemCounts.map(([, count]) => count));
  const chainText = `部门（D1）→ 能力域（层级范围 L1-L3）→ 业务能力（L2）→ 应用系统（S1）[全域]；能力域（层级范围 L1-A1）：业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）[域详情]`;
  const sourcePath = `docs/norms/${dept}部门-能力-流程-系统映射关系.md`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <script defer src="echarts.min.js"></script>
    <title>${escapeHtml(dept)} · 部门能力流程系统桑基图</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      :root {
        --blue: #1a56db;
        --teal: #0891b2;
        --bg: #f5f7fb;
        --ink: #10233f;
        --muted: #64748b;
        --border: #d9e2ef;
      }
      body { font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.55; }
      .page { max-width: 1600px; margin: 0 auto; padding: 30px 38px 46px; }
      .hero { position: relative; margin-bottom: 18px; }
      .hero h1 { font-size: 30px; font-weight: 800; letter-spacing: 0; color: #0b2755; }
      .hero p { font-size: 14px; color: #475569; margin-top: 6px; max-width: 920px; }
      .badge { position: absolute; right: 0; top: 6px; border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 6px 12px; font-size: 12px; }
      .read-guide { background: #eef6ff; border-left: 4px solid var(--blue); border-radius: 8px; padding: 12px 14px; margin: 14px 0 18px; color: #29415f; font-size: 14px; }
      .stat-row { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
      .stat-box { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
      .stat-box .num { font-size: 28px; font-weight: 800; color: #0f766e; line-height: 1; }
      .stat-box .lbl { font-size: 13px; color: var(--muted); margin-top: 8px; }
      .modebar { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .mode-label { font-size: 13px; color: #475569; margin-right: 4px; }
      .mode-btn { height: 34px; border: 1px solid #cbd5e1; background: #fff; color: #29415f; border-radius: 7px; padding: 0 12px; font-size: 13px; cursor: pointer; transition: 0.16s; white-space: nowrap; }
      .mode-btn:hover { border-color: var(--blue); color: var(--blue); }
      .mode-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 700; }
      .sankey-wrap { width: 100%; background: #0f172a; border-radius: 12px; padding: 24px 20px; margin-bottom: 18px; overflow: hidden; }
      .sankey-title { text-align: center; font-size: 20px; font-weight: 800; color: #f8fafc; margin-bottom: 4px; letter-spacing: 0; }
      .sankey-sub { text-align: center; font-size: 12px; color: #94a3b8; margin-bottom: 14px; }
      .sankey-chart { width: 100%; max-width: 100%; min-width: 0; height: 1120px; }
      .legend-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
      .legend { display: inline-flex; align-items: center; gap: 5px; }
      .legend { color: #cbd5e1; font-size: 12px; }
      .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
      .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
      .note { background: #fff; border: 1px solid var(--border); border-left: 4px solid var(--teal); border-radius: 8px; padding: 14px 16px; color: #334155; font-size: 14px; }
      .note strong { color: #0b2755; }
      .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
      .panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
      .panel h3 { font-size: 16px; margin-bottom: 10px; color: #0b2755; }
      .bar-list { display: grid; gap: 8px; }
      .bar-line { display: grid; grid-template-columns: 190px 1fr 36px; gap: 10px; align-items: center; font-size: 13px; color: #334155; }
      .bar-track { height: 10px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
      .bar-fill { height: 100%; border-radius: 999px; background: var(--blue); }
      .table-wrap { overflow-x: hidden; background: #fff; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .table-l3 { table-layout: fixed; }
      .table-a1 { table-layout: fixed; min-width: 0; }
      th, td { padding: 7px 6px; border-bottom: 1px solid #e5ebf3; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
      th { background: #f1f5f9; color: #334155; font-weight: 700; position: sticky; top: 0; z-index: 1; }
      th.col-seq, td.col-seq { width: 32px; text-align: center; }
      th.col-a1id, td.col-a1id { width: 70px; white-space: normal; }
      th.col-dept, td.col-dept { width: 70px; white-space: nowrap; }
      th.col-domain, td.col-domain { width: 90px; }
      th.col-cap, td.col-cap { width: 92px; }
      th.col-proc, td.col-proc { width: 116px; }
      th.col-a1name, td.col-a1name { width: 136px; }
      th.col-role, td.col-role { width: 88px; }
      th.col-trigger, td.col-trigger { width: 102px; }
      th.col-precond, td.col-precond { width: 96px; }
      th.col-appr, td.col-appr { width: 58px; white-space: nowrap; }
      th.col-accept, td.col-accept { width: 104px; }
      th.col-evidence, td.col-evidence { width: 110px; }
      th.col-evidtype, td.col-evidtype { width: 100px; white-space: normal; }
      th.col-system, td.col-system { width: 72px; }
      th.col-alert, td.col-alert { width: 116px; }
      th.col-feedback, td.col-feedback { width: 78px; }
      th.col-adjust, td.col-adjust { width: 54px; }
      th.col-suggestion, td.col-suggestion { width: 78px; }
      tr:last-child td { border-bottom: none; }
      .domain-pill { display: inline-flex; align-items: center; min-height: 24px; padding: 2px 8px; border-radius: 7px; color: #fff; font-size: 12px; white-space: normal; }
      .evidence-tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; }
      .evidence-tag.explicit { background: #dcfce7; color: #166534; }
      .evidence-tag.inferred { background: #fef3c7; color: #92400e; }
      .evidence-tag.gap { background: #fee2e2; color: #991b1b; border: 1px solid #dc2626; }
      .customer-evidence-tag { display: inline-block; margin-top: 4px; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 800; line-height: 1.35; white-space: nowrap; }
      .customer-evidence-tag.pending { background: #ccfbf1; color: #0f766e; border: 1px solid #14b8a6; }
      .customer-evidence-tag.accepted { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
      .appr-tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; }
      .appr-tag.none { background: #e2e8f0; color: #475569; }
      .appr-tag.single { background: #dbeafe; color: #1e40af; }
      .appr-tag.multi { background: #fce7f3; color: #9d174d; }
      .appr-tag.cosign { background: #e0e7ff; color: #3730a3; }
      .warn-tag { display: inline-block; margin: 0 4px 4px 0; padding: 2px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 700; line-height: 1.35; }
      .soft-warn-tag { display: inline-block; margin: 0 4px 4px 0; padding: 2px 6px; border-radius: 4px; background: #e0f2fe; color: #075985; font-size: 11px; font-weight: 700; line-height: 1.35; }
      .feedback-cell { color: #64748b; font-size: 11px; }
      .foot { margin-top: 14px; font-size: 12px; color: #64748b; }
      @media (max-width: 900px) {
        .page { padding: 20px 14px 34px; }
        .badge { position: static; display: inline-block; margin-top: 10px; }
        .stat-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .g2, .summary-grid { grid-template-columns: 1fr; }
        .sankey-chart { height: 1120px; }
        .bar-line { grid-template-columns: 160px 1fr 34px; }
        .table-a1 { min-width: 0; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <h1>${escapeHtml(dept)} · 部门能力流程系统桑基图</h1>
        <p>${escapeHtml(chainText)}。含${a1Rows.length}条业务行为（A1），覆盖${domains.length}大能力域${l3Rows.length}条业务流程（L3）。</p>
        <div class="badge">部门审核稿 · 待反馈</div>
      </section>
      <div class="read-guide">
        <strong>读图方法：</strong>"全域总览"看${escapeHtml(dept)}覆盖哪些领域和系统；切换到具体能力域（层级范围 L1-A1），看 能力域（层级范围 L1-A1）：业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1） 的四层细节。悬停连线可见制度依据和系统设计依据。业务行为（A1）节点显示A1序号、行为名称和执行角色，业务行为（A1）编号保留在悬停提示和明细表中用于追溯。下方明细表在"全域总览"显示业务流程（L3）行，在能力域视图显示业务行为（A1）行。本页由正式映射 Markdown 生成；全域视图仅展示已沉淀的 DCM 主映射，能力域视图展示已受控入库的 BBM/A1 明细。
      </div>
      <section class="stat-row">
        <div class="stat-box"><div class="num">1</div><div class="lbl">部门（D1）</div></div>
        <div class="stat-box"><div class="num">${countUnique(l3Rows, 'domain')}</div><div class="lbl">能力域（L1）</div></div>
        <div class="stat-box"><div class="num">${countUnique(l3Rows, 'capability')}</div><div class="lbl">业务能力（L2）</div></div>
        <div class="stat-box"><div class="num">${l3Rows.length}</div><div class="lbl">业务流程（L3）</div></div>
        <div class="stat-box"><div class="num">${a1Rows.length}</div><div class="lbl">业务行为（A1）</div></div>
        <div class="stat-box"><div class="num">${confirmedSystems.length}</div><div class="lbl">应用系统（S1）</div></div>
      </section>
      <section class="modebar" id="modebar">
        <span class="mode-label">视图（层级范围 L1-L3 / L1-A1）</span>
      </section>
      <section class="sankey-wrap">
        <div class="sankey-title" id="chartTitle">${escapeHtml(dept)}全域总览</div>
        <div class="sankey-sub" id="chartSub">部门（D1）→ 能力域（层级范围 L1-L3）→ 业务能力（L2）→ 应用系统（S1）</div>
        <div id="chart" class="sankey-chart"></div>
        <div class="legend-row" id="legendRow"></div>
      </section>
      <section class="g2">
        <div class="note">
          <strong>应用系统（S1）口径：</strong>只展示OA、MES、PLM、ERP四类面向员工使用的信息化系统；无明确系统证据的流程显示为“应用承接待确认”，不代表流程没有入口，也不代表已完成系统落位。
        </div>
        <div class="note">
          <strong>部门审核口径：</strong>本页用于部门逐条确认业务行为（A1）。证据类型需区分“原文明确-正文”“原文明确-流程图”“原文明确-表单”“上下文推断”或“分析拆分”；执行角色、触发情景、前置条件可由部门补充或修正。验收标准只检查业务流程（L3）最终环节或跨部门交接前的最后环节；跟踪类任务优先由系统待办提醒、到期预警和进度展示承载。
        </div>
      </section>
      <section class="summary-grid">
        <div class="panel">
          <h3>能力域（层级范围 L1-A1）规模（业务行为（A1）数）</h3>
          <div class="bar-list">
            ${a1Counts.length ? a1Counts.map(([name, count]) => `<div class="bar-line"><span>${escapeHtml(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round((count / maxDomainCount) * 100))}%"></div></div><b>${count}</b></div>`).join('\n') : '<div class="foot">暂无 A1 入库记录。</div>'}
          </div>
        </div>
        <div class="panel">
          <h3>系统承载分布（L3参与次数）</h3>
          <div class="bar-list">
            ${systemCounts.length ? systemCounts.map(([name, count]) => `<div class="bar-line"><span>${escapeHtml(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round((count / maxDomainCount) * 100))}%"></div></div><b>${count}</b></div>`).join('\n') : '<div class="foot">暂无已确认应用系统（S1）。</div>'}
          </div>
        </div>
      </section>
      <section class="table-wrap">
        <table id="detailTable">
          <thead id="tableHead"></thead>
          <tbody id="mappingBody"></tbody>
        </table>
      </section>
      <div class="foot">数据来源：${escapeHtml(sourcePath)}。应用系统（S1）口径限定为OA、MES、PLM、ERP；未见明确系统证据的流程显示为应用承接待确认。业务行为（A1）分解基于正式映射文档和已回源的工程技术部资料包。</div>
    </main>
    <script>
      var departmentName = ${toJson(dept)};
      var activeMode = "全域总览";
      var l3Rows = ${toJson(l3Rows)};
      var a1Rows = ${toJson(a1Rows)};
      var domains = ${toJson(domains)};
      var l3NameMap = {};
      l3Rows.forEach(function(row) { l3NameMap[row.code] = row.process; });
      var chart = null;

      function esc(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch) {
          return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[ch];
        });
      }

      function shortText(value, len) {
        var text = String(value || "");
        return text.length > len ? text.slice(0, len - 1) + "…" : text;
      }

      function normalizeSystem(value) {
        var text = String(value || "").trim();
        return text && !/^[-—–]+$/.test(text) ? text : "应用承接待确认";
      }

      function splitSystems(value) {
        var text = normalizeSystem(value);
        return text === "应用承接待确认" ? [text] : text.split(/[、，,]/).map(function(item) { return item.trim(); }).filter(Boolean);
      }

      var palette = ["#0891b2", "#4f46e5", "#0f766e", "#ea580c", "#7c3aed", "#dc2626", "#64748b"];

      function colorFor(name) {
        var text = String(name || "");
        if (text === departmentName) return "#2563eb";
        if (text === "应用承接待确认") return "#ef4444";
        var hash = 0;
        for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
        return palette[hash % palette.length];
      }

      function addLink(links, source, target, value) {
        var key = source + "\\u0000" + target;
        if (!links[key]) links[key] = { source: source, target: target, value: 0 };
        links[key].value += value || 1;
      }

      function addNode(nodes, name, type, color, id) {
        if (!nodes[name]) {
          var node = { name: name, itemStyle: { color: color }, _type: type, _meta: { id: id || name } };
          if (type === "A1") node.label = { width: 150, overflow: "truncate", fontSize: 11 };
          if (type === "L3") node.label = { width: 260, overflow: "truncate", fontSize: 11 };
          if (type === "S1") node.label = { width: 130, overflow: "truncate", fontSize: 12, fontWeight: 800 };
          nodes[name] = node;
        }
      }

      function filteredL3() {
        return activeMode === "全域总览" ? l3Rows : l3Rows.filter(function(row) { return row.domain === activeMode; });
      }

      function filteredA1() {
        return activeMode === "全域总览" ? a1Rows : a1Rows.filter(function(row) { return row[9] === activeMode; });
      }

      function roleWarning(a1) {
        var text = Array.isArray(a1) ? a1.join(" ") : String(a1 || "");
        return /待确认|未见|缺少|证据不足|各专业负责人|制造等相关部门/.test(text);
      }

      function a1ShortCode(a1) {
        var id = Array.isArray(a1) ? a1[0] : a1;
        var m = String(id || "").match(/A\\d+$/);
        return m ? m[0] : String(id || "");
      }

      function a1JoinedText(a1) {
        return Array.isArray(a1) ? a1.join(" ") : String(a1 || "");
      }

      function isInferenceEvidence(a1) {
        return /上下文推断|分析拆分/.test(String((Array.isArray(a1) ? a1[8] : a1) || ""));
      }

      function hasEvidenceGap(a1) {
        return /待补|未见|缺少|证据不足/.test(a1JoinedText(a1));
      }

      function customerEvidenceLabel(flag, status) {
        if (!flag || flag === "changxing_owned" || flag === "internal_or_unknown") return "";
        return status === "已形成昌兴承接流程" ? "客户要求-已承接" : "客户要求-待承接";
      }

      function customerEvidenceClass(flag, status) {
        return customerEvidenceLabel(flag, status)
          ? "customer-evidence-tag " + (status === "已形成昌兴承接流程" ? "accepted" : "pending")
          : "";
      }

      function a1CustomerLabel(a1) {
        return Array.isArray(a1) ? (a1[27] || customerEvidenceLabel(a1[23], a1[25])) : "";
      }

      function customerEvidenceTagHtml(flag, status, label) {
        var text = label || customerEvidenceLabel(flag, status);
        if (!text) return "";
        return '<span class="' + customerEvidenceClass(flag, status) + '">' + esc(text) + '</span>';
      }

      function a1NodeColor(a1) {
        if (a1CustomerLabel(a1)) return "#0f766e";
        if (roleWarning(a1) || hasEvidenceGap(a1)) return "#dc2626";
        if (isInferenceEvidence(a1)) return "#f59e0b";
        return "#64748b";
      }

      function processName(rowOrProc) {
        if (rowOrProc && typeof rowOrProc === "object" && !Array.isArray(rowOrProc)) {
          return rowOrProc.process || rowOrProc.proc || rowOrProc.l3 || "";
        }
        var raw = String(rowOrProc || "");
        if (typeof l3NameMap !== "undefined" && l3NameMap && l3NameMap[raw]) return l3NameMap[raw];
        return raw;
      }

      function l3CodeFromText(value) {
        var m = String(value || "").match(/L3[-_ ]?(\\d+)/i);
        return m ? "L3-" + String(m[1]).padStart(2, "0") : "";
      }

      function processCode(rowOrProc) {
        var raw = rowOrProc && typeof rowOrProc === "object" && !Array.isArray(rowOrProc)
          ? String(rowOrProc.code || rowOrProc.id || rowOrProc.process || rowOrProc.proc || "")
          : String(rowOrProc || "");
        var name = processName(rowOrProc);
        var directCode = l3CodeFromText(raw) || l3CodeFromText(name);
        if (directCode) return directCode;
        for (var i = 0; i < a1Rows.length; i++) {
          if (String(a1Rows[i][14] || "") === name || String(a1Rows[i][11] || "") === name) {
            var fromA1 = l3CodeFromText(a1Rows[i][0]);
            if (fromA1) return fromA1;
          }
        }
        var idx = l3Rows.findIndex(function(row) { return processName(row) === name; });
        return idx >= 0 ? "L3-" + String(idx + 1).padStart(2, "0") : "L3";
      }

      function processDisplayLabel(rowOrProc) {
        return processCode(rowOrProc) + " " + processName(rowOrProc);
      }

      function processChartLabel(rowOrProc) {
        return processCode(rowOrProc) + " " + shortText(processName(rowOrProc), 24);
      }

      function isProcessNode(name) {
        var text = String(name || "");
        if (l3Rows.some(function(row) { return processName(row) === text; })) return true;
        return a1Rows.some(function(row) { return String(row[14] || "") === text || String(row[11] || "") === text; });
      }

      function modeDisplayLabel(name) {
        return name === "全域总览" ? "全域总览（层级范围 L1-L3）" : name + "（层级范围 L1-A1）";
      }

      function evidenceLegendHtml() {
        return '<span class="legend"><i style="background:#64748b"></i>原文明确</span>' +
          '<span class="legend"><i style="background:#f59e0b"></i>上下文推断/分析拆分</span>' +
          '<span class="legend"><i style="background:#dc2626"></i>待补证据/需确认</span>' +
          '<span class="legend"><i style="background:#0f766e"></i>客户要求-待承接</span>';
      }

      function evidenceClass(type) {
        var text = String(type || "");
        if (/待补|未见|缺少|证据不足/.test(text)) return "gap";
        return /^原文明确-(正文|流程图|表单)$/.test(text) ? "explicit" : "inferred";
      }

      function approvalClass(type) {
        var text = String(type || "");
        if (/会签/.test(text)) return "cosign";
        if (/多级|分级|逐级/.test(text)) return "multi";
        if (/单人|审批/.test(text)) return "single";
        return "none";
      }

      function processFill(value) {
        var text = processName(value);
        var color = colorFor(text);
        return "linear-gradient(90deg, " + color + "18, transparent 45%)";
      }

      function safeText(value, fallback) {
        var text = String(value || "").trim();
        return text ? text : fallback;
      }

      function a1DisplayLabel(a1) {
        return a1ShortCode(a1) + " " + shortText(a1[1], 10);
      }

      function a1NodeName(a1) {
        return String(a1[0] || "") + " " + String(a1[1] || "");
      }

      function a1EntryName(a1) {
        var system = normalizeSystem(a1[6]);
        var module = String(a1[22] || "").trim();
        if (!module || system === "应用承接待确认") return system;
        return system + "/" + module;
      }

      function findA1ByNode(params) {
        var id = params && params.data && params.data._meta && params.data._meta.id;
        return a1Rows.find(function(row) { return row[0] === id || row[0] === params.name; });
      }

      function buildGraph() {
        var nodes = {};
        var links = {};
        var colors = { dept: "#2563eb", capability: "#334155", process: "#64748b", system: "#f97316", pending: "#ef4444" };

        if (activeMode === "全域总览") {
          addNode(nodes, departmentName, "D1", colors.dept);
          l3Rows.forEach(function(row) {
            addNode(nodes, row.domain, "L1", colorFor(row.domain));
            addNode(nodes, row.capability, "L2", colors.capability);
            addLink(links, departmentName, row.domain);
            addLink(links, row.domain, row.capability);
            splitSystems(row.system).forEach(function(system) {
              addNode(nodes, system, "S1", system === "应用承接待确认" ? colors.pending : colors.system);
              addLink(links, row.capability, system);
            });
          });
        } else {
          var activeA1Rows = filteredA1();
          var hasA1Rows = activeA1Rows.length > 0;
          var a1ProcessSet = activeA1Rows.reduce(function(set, a1) {
            set[String(a1[11] || "")] = true;
            return set;
          }, {});
          filteredL3().filter(function(row) {
            return !hasA1Rows || a1ProcessSet[row.process];
          }).forEach(function(row) {
            addNode(nodes, row.capability, "L2", colors.capability);
            addNode(nodes, row.process, "L3", row.customer_evidence_label ? "#0f766e" : colors.process, row.code);
            addLink(links, row.capability, row.process);
            if (!hasA1Rows) {
              splitSystems(row.system).forEach(function(system) {
                addNode(nodes, system, "S1", system === "应用承接待确认" ? colors.pending : colors.system);
                addLink(links, row.process, system);
              });
            }
          });
          activeA1Rows.forEach(function(a1) {
            var systemList = splitSystems(a1[6]);
            var a1Name = a1NodeName(a1);
            addNode(nodes, a1Name, "A1", a1NodeColor(a1), a1[0]);
            addLink(links, a1[11], a1Name);
            systemList.forEach(function() {
              var entry = a1EntryName(a1);
              addNode(nodes, entry, "S1", entry === "应用承接待确认" ? colors.pending : colors.system);
              addLink(links, a1Name, entry);
            });
          });
        }

        return {
          nodes: Object.keys(nodes).map(function(key) { return nodes[key]; }),
          links: Object.keys(links).map(function(key) { return links[key]; }),
        };
      }

      function renderChart() {
        var graph = buildGraph();
        var isGlobal = activeMode === "全域总览";
        var chartEl = document.getElementById("chart");
        var chartHeight = isGlobal
          ? 920
          : Math.max(1120, 220 + filteredL3().length * 44 + filteredA1().length * 32);
        chartEl.style.height = chartHeight + "px";
        if (chart) chart.resize();
        document.getElementById("chartTitle").textContent = isGlobal ? departmentName + "全域总览" : activeMode;
        document.getElementById("chartSub").textContent = isGlobal
          ? "部门（D1）→ 能力域（层级范围 L1-L3）→ 业务能力（L2）→ 应用系统（S1）"
          : "能力域（层级范围 L1-A1）：业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）";
        document.getElementById("legendRow").innerHTML =
          '<span class="legend"><i style="background:#2563eb"></i>部门</span>' +
          '<span class="legend"><i style="background:#0891b2"></i>能力域</span>' +
          '<span class="legend"><i style="background:#334155"></i>业务能力</span>' +
          '<span class="legend"><i style="background:#f97316"></i>应用系统</span>' +
          (isGlobal ? '' : evidenceLegendHtml());

        chart.setOption({
          backgroundColor: "#0f172a",
          animation: false,
          tooltip: {
            trigger: "item",
            triggerOn: "mousemove",
            confine: true,
            backgroundColor: "rgba(15,23,42,.96)",
            borderColor: "#334155",
            textStyle: { color: "#e5e7eb", fontSize: 12 },
            formatter: function(params) {
              if (!params.data) return "";
              if (!isGlobal && params.data._type === "A1") {
                var a1 = findA1ByNode(params);
              if (!a1) return params.name;
                return esc(a1[0] + " " + a1[1]) + "<br/>执行角色：" + esc(a1[2]) + "<br/>审批类型：" + esc(a1[5]) + "<br/>处理入口：" + esc(a1EntryName(a1)) + (a1CustomerLabel(a1) ? "<br/>来源边界：" + esc(a1CustomerLabel(a1)) : "");
              }
              if (!isGlobal && isProcessNode(params.name)) return esc(processDisplayLabel(params.name));
              return esc(params.name);
            },
          },
          series: [{
            type: "sankey",
            data: graph.nodes,
            links: graph.links,
            left: 40,
            right: isGlobal ? 120 : 180,
            top: 30,
            bottom: 30,
            nodeWidth: 18,
            nodeGap: isGlobal ? 18 : 12,
            layoutIterations: isGlobal ? 32 : 0,
            draggable: false,
            emphasis: { focus: "adjacency" },
            lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.42 },
            label: {
              color: "#e5edf5",
              fontSize: 12,
              formatter: function(params) {
                if (!isGlobal) {
                  var a1 = findA1ByNode(params);
                  if (a1) return a1DisplayLabel(a1);
                  if (isProcessNode(params.name)) return processChartLabel(params.name);
                }
                return params.name;
              },
            },
            itemStyle: { borderColor: "#0f172a", borderWidth: 1 },
          }],
        }, true);
      }

      function renderModebar() {
        var bar = document.getElementById("modebar");
        bar.innerHTML = '<span class="mode-label">视图（层级范围 L1-L3 / L1-A1）</span>';
        ["全域总览"].concat(domains).forEach(function(name) {
          var btn = document.createElement("button");
          btn.className = "mode-btn" + (name === activeMode ? " active" : "");
          btn.textContent = modeDisplayLabel(name);
          btn.dataset.mode = name;
          btn.addEventListener("click", function() {
            activeMode = name;
            renderAll();
          });
          bar.appendChild(btn);
        });
      }

      function renderTable() {
        var table = document.getElementById("detailTable");
        var head = document.getElementById("tableHead");
        var body = document.getElementById("mappingBody");
        var isGlobal = activeMode === "全域总览";
        var tableTitle = document.getElementById("tableTitle");
        if (tableTitle) tableTitle.textContent = isGlobal ? "正式映射明细" : activeMode + " A1 明细";
        if (isGlobal) {
          table.className = "table-l3";
          head.innerHTML = '<tr><th class="col-seq">序号</th><th class="col-dept">部门（D1）</th><th class="col-domain">能力域（L1）</th><th class="col-cap">业务能力（L2）</th><th class="col-proc">业务流程（L3）</th><th class="col-evidence">制度依据</th><th class="col-evidtype">来源边界</th><th class="col-system">应用系统（S1）</th><th class="col-evidence">系统设计依据</th></tr>';
          body.innerHTML = filteredL3().map(function(row, i) {
            var customerTag = customerEvidenceTagHtml(row.source_boundary_flag, row.acceptance_status, row.customer_evidence_label);
            return '<tr><td class="col-seq">' + (i + 1) + '</td><td class="col-dept">' + esc(departmentName) + '</td><td class="col-domain"><span class="domain-pill" style="background:' + colorFor(row.domain) + '">' + esc(row.domain) + '</span></td><td class="col-cap">' + esc(row.capability) + '</td><td class="col-proc">' + esc(processDisplayLabel(row)) + '</td><td class="col-evidence">' + esc(row.evidence) + '</td><td class="col-evidtype">' + (customerTag || esc(row.source_boundary_label || "")) + '</td><td class="col-system">' + esc(normalizeSystem(row.system)) + '</td><td class="col-evidence">' + esc(row.basis) + '</td></tr>';
          }).join("");
        } else {
          table.className = "table-a1";
          head.innerHTML = '<tr><th class="col-seq">序号</th><th class="col-a1id">业务行为（A1）编号</th><th class="col-cap">业务能力（L2）</th><th class="col-proc">业务流程（L3）</th><th class="col-a1name">业务行为（A1）</th><th class="col-role">执行角色</th><th class="col-trigger">触发情景</th><th class="col-precond">前置条件</th><th class="col-appr">审批类型</th><th class="col-accept">验收标准</th><th class="col-evidence">制度依据</th><th class="col-evidtype">证据类型</th><th class="col-evidtype">来源边界</th><th class="col-system">处理入口（S1/S2）</th><th class="col-alert">请部门确认</th><th class="col-feedback">部门确认意见</th><th class="col-adjust">是否调整</th><th class="col-suggestion">调整建议</th></tr>';
          body.innerHTML = filteredA1().map(function(a1, i) {
            var fill = processFill(a1[14]);
            var roleCell = esc(a1[2]) + (roleWarning(a1) ? '<br><span class="warn-tag">请确认岗位</span>' : '');
            var approval = '<span class="appr-tag ' + approvalClass(a1[5]) + '">' + esc(a1[5]) + '</span>';
            var evidence = '<span class="evidence-tag ' + evidenceClass(a1[8]) + '">' + esc(a1[8]) + '</span>';
            var customerTag = customerEvidenceTagHtml(a1[23], a1[25], a1[27]);
            return '<tr style="background:' + fill + '">' +
              '<td class="col-seq">' + (i + 1) + '</td>' +
              '<td class="col-a1id">' + esc(a1[0]) + '</td>' +
              '<td class="col-cap">' + esc(a1[10]) + '</td>' +
              '<td class="col-proc">' + esc(processDisplayLabel(a1[14])) + '</td>' +
              '<td class="col-a1name">' + esc(a1ShortCode(a1) + " " + a1[1]) + '</td>' +
              '<td class="col-role">' + roleCell + '</td>' +
              '<td class="col-trigger">' + esc(a1[3]) + '</td>' +
              '<td class="col-precond">' + esc(a1[4]) + '</td>' +
              '<td class="col-appr">' + approval + '</td>' +
              '<td class="col-accept"><span class="soft-warn-tag">' + esc(safeText(a1[18], "待确认")) + '</span></td>' +
              '<td class="col-evidence">' + esc(a1[7]) + '</td>' +
              '<td class="col-evidtype">' + evidence + '</td>' +
              '<td class="col-evidtype">' + (customerTag || esc(a1[24] || "")) + '</td>' +
              '<td class="col-system">' + esc(a1EntryName(a1)) + '</td>' +
              '<td class="col-alert">' + esc(a1[12]) + '</td>' +
              '<td class="col-feedback">' + esc(safeText(a1[19], "待确认")) + '</td>' +
              '<td class="col-adjust">' + esc(safeText(a1[20], "待确认")) + '</td>' +
              '<td class="col-suggestion">' + esc(a1[21]) + '</td>' +
              '</tr>';
          }).join("");
        }
      }

      function renderAll() {
        renderModebar();
        renderChart();
        renderTable();
      }

      window.addEventListener("DOMContentLoaded", function() {
        chart = echarts.init(document.getElementById("chart"));
        renderAll();
        window.addEventListener("resize", function() { chart.resize(); });
      });
    </script>
  </body>
</html>
`;
}

const markdown = readFileSync(inputPath, 'utf8');
const tables = parseTables(markdown);
const l3CodeMap = parseL3CodeMap(tables);
const l3Rows = attachL3Codes(parseMappingRows(tables), l3CodeMap);
const a1Rows = parseA1Rows(tables, l3Rows);

if (!l3Rows.length) {
  throw new Error(`No formal DCM rows parsed from ${inputPath}`);
}

writeFileSync(outputPath, renderHtml(l3Rows, a1Rows), 'utf8');
console.log(`rebuilt_department_sankey=${outputPath}`);
console.log(`l3_rows=${l3Rows.length}`);
console.log(`a1_rows=${a1Rows.length}`);
