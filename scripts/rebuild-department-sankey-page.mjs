#!/usr/bin/env node
/**
 * Rebuild one formal department Sankey HTML from the department mapping Markdown.
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

function parseMappingRows(text) {
  const rows = [];
  let headers = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      if (headers && rows.length) break;
      continue;
    }
    const cells = splitMarkdownRow(line);
    if (isSeparator(cells)) continue;
    if (!headers) {
      if (cells.some(cell => cell.includes('能力域')) && cells.some(cell => cell.includes('业务流程'))) {
        headers = cells;
      }
      continue;
    }
    if (cells.length < headers.length || cells[0] === '部门（D1）') continue;
    rows.push(Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));
  }
  return rows.map((row, index) => ({
    dept: row['部门（D1）'] || dept,
    l1: row['能力域（L1）'] || '未标注能力域',
    l2: row['业务能力（L2）'] || '未标注业务能力',
    l3: row['业务流程（L3）'] || '未标注业务流程',
    evidence: row['制度依据（文件号/条款）'] || '',
    systems: splitSystems(row['应用系统（S1）']),
    systemNote: row['系统设计依据'] || '',
    order: index + 1,
  }));
}

function splitSystems(value) {
  const text = String(value || '').trim();
  if (!text || /^[-—–]+$/.test(text)) return [];
  return text.split(/[、，,]/).map(item => item.trim()).filter(Boolean);
}

function countUnique(rows, key) {
  return new Set(rows.map(row => row[key]).filter(Boolean)).size;
}

function addLink(map, source, target, value = 1) {
  const key = `${source}\u0000${target}`;
  const existing = map.get(key);
  if (existing) {
    existing.value += value;
  } else {
    map.set(key, { source, target, value });
  }
}

function buildGraph(rows) {
  const links = new Map();
  const nodes = new Set([dept]);
  for (const row of rows) {
    const targetSystems = row.systems.length ? row.systems : ['处理入口待确认'];
    for (const name of [row.l1, row.l2, row.l3, ...targetSystems]) nodes.add(name);
    addLink(links, dept, row.l1);
    addLink(links, row.l1, row.l2);
    addLink(links, row.l2, row.l3);
    for (const system of targetSystems) addLink(links, row.l3, system);
  }
  return {
    nodes: [...nodes].map(name => ({ name })),
    links: [...links.values()],
  };
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

function renderHtml(rows) {
  const graph = buildGraph(rows);
  const systems = [...new Set(rows.flatMap(row => row.systems))].filter(Boolean);
  const pendingSystems = rows.filter(row => row.systems.length === 0).length;
  const domainCounts = [...rows.reduce((map, row) => {
    map.set(row.l1, (map.get(row.l1) || 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1]);
  const maxDomainCount = Math.max(1, ...domainCounts.map(([, count]) => count));

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script defer src="echarts.min.js"></script>
    <title>${escapeHtml(dept)} · 部门能力流程系统桑基图</title>
    <style>
      * { box-sizing: border-box; }
      :root { --paper:#f7f1e4; --panel:#fffaf0; --ink:#22313f; --muted:#667085; --line:#dfd2bd; --red:#8a3f2a; --sage:#6f8f5f; --blue:#3b6f88; --gold:#b7791f; }
      body { margin:0; font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif; color:var(--ink); background:var(--paper); line-height:1.55; }
      .page { max-width:1680px; margin:0 auto; padding:30px 34px 44px; }
      .hero { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:14px; }
      h1 { margin:0; font-size:30px; letter-spacing:0; color:#2a211a; }
      .subtitle { margin:8px 0 0; max-width:960px; color:#5f594f; font-size:14px; }
      .badge { border:1px solid #caa970; color:#7a3a22; background:#fff7df; border-radius:8px; padding:7px 12px; font-size:13px; font-weight:800; white-space:nowrap; }
      .notice { border:1px solid #d4b08b; border-left:5px solid var(--sage); background:#fff8e8; border-radius:8px; padding:12px 14px; margin:14px 0 18px; color:#473a2c; font-size:14px; }
      .stat-row { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-bottom:16px; }
      .stat-box { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px 15px; }
      .stat-box .num { display:block; font-size:27px; font-weight:800; color:var(--red); line-height:1; }
      .stat-box .lbl { margin-top:7px; color:var(--muted); font-size:13px; }
      .layout { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:16px; align-items:stretch; }
      .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
      .chart-panel { background:#172033; border-color:#172033; padding:18px; }
      .chart-title { color:#f8fafc; text-align:center; font-weight:800; font-size:19px; }
      .chart-sub { color:#b9c2d0; text-align:center; font-size:12px; margin:4px 0 10px; }
      #chart { width:100%; height:920px; }
      .side h2, .table-wrap h2 { margin:0 0 12px; font-size:16px; letter-spacing:0; color:#2a211a; }
      .bar-line { display:grid; grid-template-columns:124px minmax(0,1fr) 40px; gap:8px; align-items:center; font-size:13px; margin-bottom:10px; }
      .bar-line span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#4a4138; }
      .bar-line b { display:block; height:9px; background:var(--sage); border-radius:999px; min-width:4px; }
      .bar-line em { color:#7a3a22; font-style:normal; font-weight:800; text-align:right; }
      .table-wrap { margin-top:16px; overflow:hidden; }
      .table-scroll { overflow:auto; max-height:780px; border:1px solid var(--line); border-radius:8px; }
      table { width:100%; border-collapse:collapse; background:#fffdf7; min-width:1080px; }
      th,td { border-bottom:1px solid #eadcc7; padding:10px 12px; text-align:left; vertical-align:top; font-size:13px; }
      th { position:sticky; top:0; z-index:1; background:#efe3d0; color:#3d3026; font-weight:800; }
      .source-note { margin-top:10px; color:#74695d; font-size:12px; }
      @media (max-width:1100px) { .layout,.stat-row { grid-template-columns:1fr; } .hero { display:block; } .badge { display:inline-block; margin-top:10px; } #chart { height:780px; } }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div>
          <h1>${escapeHtml(dept)} · 部门能力流程系统桑基图</h1>
          <p class="subtitle">基于 ${escapeHtml(dept)} 部门正式映射 Markdown 生成，用于查看部门、能力域、业务能力、业务流程和处理入口的当前关系。</p>
        </div>
        <div class="badge">正式映射</div>
      </section>
      <div class="notice"><strong>口径说明：</strong>本页从部门正式映射表派生，仅展示已沉淀的 DCM 主映射；业务行为、审批链和跨部门输入输出仍以映射 Markdown 的回源核验记录为准。</div>
      <section class="stat-row">
        <div class="stat-box"><span class="num">1</span><div class="lbl">部门</div></div>
        <div class="stat-box"><span class="num">${countUnique(rows, 'l1')}</span><div class="lbl">能力域</div></div>
        <div class="stat-box"><span class="num">${countUnique(rows, 'l2')}</span><div class="lbl">业务能力</div></div>
        <div class="stat-box"><span class="num">${rows.length}</span><div class="lbl">业务流程</div></div>
        <div class="stat-box"><span class="num">${pendingSystems}</span><div class="lbl">处理入口待确认</div></div>
      </section>
      <section class="layout">
        <div class="panel chart-panel">
          <div class="chart-title">${escapeHtml(dept)}正式能力流程图</div>
          <div class="chart-sub">部门 → 能力域 → 业务能力 → 业务流程 → 处理入口</div>
          <div id="chart"></div>
        </div>
        <aside class="panel side">
          <h2>能力域分布</h2>
          ${domainCounts.map(([name, count]) => `<div class="bar-line"><span>${escapeHtml(name)}</span><b style="width:${Math.max(4, Math.round((count / maxDomainCount) * 100))}%"></b><em>${count}</em></div>`).join('\n')}
          <div class="source-note">应用系统（S1）为空时显示为“处理入口待确认”，不代表已完成系统落位。</div>
          <div class="source-note">数据来源：${escapeHtml(`docs/norms/${dept}部门-能力-流程-系统映射关系.md`)}</div>
        </aside>
      </section>
      <section class="panel table-wrap">
        <h2>正式映射明细</h2>
        <div class="table-scroll">
          <table>
            <thead><tr><th>能力域（L1）</th><th>业务能力（L2）</th><th>业务流程（L3）</th><th>制度依据</th><th>处理入口</th><th>说明</th></tr></thead>
            <tbody>
              ${rows.map(row => `<tr><td>${escapeHtml(row.l1)}</td><td>${escapeHtml(row.l2)}</td><td>${escapeHtml(row.l3)}</td><td>${escapeHtml(row.evidence)}</td><td>${escapeHtml(row.systems.join('、') || '处理入口待确认')}</td><td>${escapeHtml(row.systemNote)}</td></tr>`).join('\n')}
            </tbody>
          </table>
        </div>
      </section>
    </main>
    <script>
      window.addEventListener('DOMContentLoaded', function() {
        var graph = ${JSON.stringify(graph)};
        var chart = echarts.init(document.getElementById('chart'));
        chart.setOption({
          tooltip: { trigger: 'item', triggerOn: 'mousemove' },
          series: [{
            type: 'sankey',
            data: graph.nodes,
            links: graph.links,
            left: 20,
            right: 220,
            top: 18,
            bottom: 18,
            nodeWidth: 18,
            nodeGap: 10,
            draggable: false,
            emphasis: { focus: 'adjacency' },
            lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.42 },
            label: { color: '#e5edf5', fontSize: 12 },
            itemStyle: { borderColor: '#0f172a', borderWidth: 1 }
          }]
        });
        window.addEventListener('resize', function() { chart.resize(); });
      });
    </script>
  </body>
</html>
`;
}

const markdown = readFileSync(inputPath, 'utf8');
const rows = parseMappingRows(markdown);
if (!rows.length) {
  throw new Error(`No formal mapping rows parsed from ${inputPath}`);
}
writeFileSync(outputPath, renderHtml(rows), 'utf8');
console.log(`rebuilt_department_sankey=${outputPath}`);
