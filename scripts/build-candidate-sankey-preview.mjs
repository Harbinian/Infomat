import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_RUN = resolve(
  ROOT,
  'artifacts',
  'process-candidates',
  'engineering-technology-2026-06-15T11-45-00',
);

const TYPE_ORDER = new Map([
  ['候选L3', 1],
  ['候选A1', 2],
  ['角色待确认', 3],
  ['角色候选', 3],
  ['审批链待确认', 4],
  ['审批链候选', 4],
  ['受控传递待确认', 5],
  ['传递关系候选', 5],
  ['归档要求待补', 6],
  ['归档/输出候选', 6],
  ['OCR待复核', 7],
]);

const TYPE_COLOR = {
  候选L3: '#3b6f88',
  候选A1: '#6f8f5f',
  角色待确认: '#b7791f',
  角色候选: '#b7791f',
  审批链待确认: '#9b4d4d',
  审批链候选: '#9b4d4d',
  受控传递待确认: '#55708d',
  传递关系候选: '#55708d',
  归档要求待补: '#7a5f91',
  '归档/输出候选': '#7a5f91',
  OCR待复核: '#a23d3d',
};

const APPROVAL_LIKE_TYPES = new Set([
  '审批链待确认',
  '审批链候选',
  '受控传递待确认',
  '传递关系候选',
  '归档要求待补',
  '归档/输出候选',
]);

function argValue(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  return process.argv[idx + 1] || fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function stripExtension(value) {
  return String(value || '').replace(/\.(docx?|pdf|xlsx?|xlsm|pptx?|txt|md)$/i, '');
}

function sourceLabel(sourceFile) {
  const path = toPosixPath(sourceFile);
  return basename(path) || '来源未标注';
}

function stripCodePrefix(value) {
  return String(value || '')
    .replace(/^\d+(?:\.\d+)?[-_ ]*/, '')
    .replace(/^[A-Z]{2,}\d{4,}[-_ ]*/, '')
    .trim();
}

function sourceDomain(sourceFile) {
  const parts = toPosixPath(sourceFile).split('/').filter(Boolean);
  const marker = parts.indexOf('工程技术部业务资料');
  const folders = marker >= 0 ? parts.slice(marker + 1, -1) : parts.slice(0, -1);
  const numbered = folders.find(part => /^\d+(?:\.\d+)?[-_ ]/.test(part));
  const candidate = numbered || folders[0] || '未识别资料方向';
  return stripCodePrefix(candidate) || candidate;
}

function humanizeAnchor(anchor) {
  let text = String(anchor || '').trim();
  if (!text) return '未标注位置';
  const hasInternalAnchor = /\bP\s*\d+\b/i.test(text);
  const hasOriginalLocator = /§\s*[0-9]|page\s*=?\s*\d+|第?\d+页|\bT\s*\d+/i.test(text);
  text = text.replace(/\bP\s*(\d+)\b/gi, '内部锚点P$1');
  text = text.replace(/\bR\s*(\d+)\b/gi, '第$1行');
  text = text.replace(/\s+/g, '');
  if (hasInternalAnchor && !hasOriginalLocator) return `${text} · 原文定位不足`;
  return text;
}

function typeRank(type) {
  return TYPE_ORDER.get(type) || 99;
}

function relationDescription(item) {
  const domain = sourceDomain(item.source_file);
  const type = item.candidate_type || '候选项';
  const content = String(item.content || '未命名候选').trim();
  if (type === '候选L3') return `${domain} 方向下，当前模型识别到一个可能的业务流程：${content}`;
  if (type === '候选A1') return `${domain} 方向下，当前模型识别到一个可能的业务行为：${content}`;
  if (['角色待确认', '角色候选'].includes(type)) return `${domain} 方向下，当前模型识别到一个可能需要确认的执行角色：${content}`;
  if (['审批链待确认', '审批链候选'].includes(type)) return `${domain} 方向下，当前模型识别到一个可能的审批或确认环节：${content}`;
  if (['受控传递待确认', '传递关系候选'].includes(type)) return `${domain} 方向下，当前模型识别到一个可能的资料、表单或结果传递关系：${content}`;
  if (['归档要求待补', '归档/输出候选'].includes(type)) return `${domain} 方向下，当前模型识别到一个可能的输出物或归档要求：${content}`;
  if (type === 'OCR待复核') return `${domain} 方向下，有材料需要先补 OCR 或人工回源后再判断：${content}`;
  return `${domain} 方向下，当前模型识别到一个待确认候选：${content}`;
}

function reviewerPrompt(item) {
  const type = item.candidate_type || '';
  if (type === '候选L3') return '请确认它是否应作为业务流程纳入，或已被现有流程覆盖。';
  if (type === '候选A1') return '请确认它是否是独立业务行为，还是只属于某个流程的描述片段。';
  if (['角色待确认', '角色候选'].includes(type)) return '请确认该角色是否真实负责，后续角色编号暂缓处理。';
  if (['审批链待确认', '审批链候选'].includes(type)) return '请回到原文确认审批、审核、会签关系是否真实受控。';
  if (['受控传递待确认', '传递关系候选'].includes(type)) return '请确认传递双方、传递物和完成标准是否说得通。';
  if (['归档要求待补', '归档/输出候选'].includes(type)) return '请确认输出物名称、保存位置和归档责任。';
  if (type === 'OCR待复核') return '请先补原文识别或人工摘录，再决定是否纳入映射。';
  return '请回到原文确认后再决定是否纳入。';
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function addNode(nodes, name, type, color) {
  if (nodes.has(name)) return;
  nodes.set(name, { name, itemStyle: { color }, _type: type });
}

function addLink(links, source, target, value = 1) {
  const key = `${source}\u0000${target}`;
  const old = links.get(key);
  if (old) {
    old.value += value;
    return;
  }
  links.set(key, { source, target, value });
}

function buildGraph(items) {
  const nodes = new Map();
  const links = new Map();
  const root = `${items[0]?.department || '工程技术部'}（模型预览）`;

  addNode(nodes, root, 'dept', '#8a3f2a');

  for (const item of items) {
    const domain = sourceDomain(item.source_file);
    const type = item.candidate_type || '其他候选';
    const domainNode = `资料方向：${domain}`;
    const typeNode = `候选类型：${type}`;

    addNode(nodes, domainNode, 'domain', '#b85c38');
    addNode(nodes, typeNode, 'type', TYPE_COLOR[type] || '#71717a');
    addLink(links, root, domainNode);
    addLink(links, domainNode, typeNode);
  }

  return { nodes: [...nodes.values()], links: [...links.values()], root };
}

function buildTypeStats(items) {
  return [...countBy(items, item => item.candidate_type || '其他候选').entries()]
    .sort((a, b) => typeRank(a[0]) - typeRank(b[0]) || b[1] - a[1])
    .map(([type, count]) => ({ type, count, color: TYPE_COLOR[type] || '#71717a' }));
}

function buildDomainStats(items) {
  return [...countBy(items, item => sourceDomain(item.source_file)).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([domain, count]) => ({ domain, count }));
}

function buildHtml({ department, items, graph, typeStats, domainStats, runDir }) {
  const sourceCount = new Set(items.map(item => sourceLabel(item.source_file))).size;
  const l3Count = items.filter(item => item.candidate_type === '候选L3').length;
  const a1Count = items.filter(item => item.candidate_type === '候选A1').length;
  const approvalLikeCount = items.filter(item => APPROVAL_LIKE_TYPES.has(item.candidate_type)).length;
  const ocrCount = items.filter(item => item.candidate_type === 'OCR待复核').length;

  const rowHtml = items
    .slice()
    .sort((a, b) => {
      return (
        sourceDomain(a.source_file).localeCompare(sourceDomain(b.source_file), 'zh-Hans-CN') ||
        typeRank(a.candidate_type) - typeRank(b.candidate_type) ||
        String(a.content || '').localeCompare(String(b.content || ''), 'zh-Hans-CN')
      );
    })
    .map(
      item => `<tr>
        <td><span class="type-pill" style="--pill:${htmlEscape(TYPE_COLOR[item.candidate_type] || '#71717a')}">${htmlEscape(item.candidate_type || '其他候选')}</span></td>
        <td>${htmlEscape(relationDescription(item))}</td>
        <td>${htmlEscape(sourceLabel(item.source_file))}</td>
        <td>${htmlEscape(humanizeAnchor(item.source_anchor))}</td>
        <td>${htmlEscape(reviewerPrompt(item))}</td>
      </tr>`,
    )
    .join('\n');

  const typeHtml = typeStats
    .map(
      stat => `<span class="legend-item"><i style="background:${htmlEscape(stat.color)}"></i>${htmlEscape(stat.type)} ${stat.count}</span>`,
    )
    .join('');

  const domainHtml = domainStats
    .slice(0, 12)
    .map(
      stat => `<div class="bar-line"><span>${htmlEscape(stat.domain)}</span><b style="width:${Math.max(4, Math.round((stat.count / items.length) * 100))}%"></b><em>${stat.count}</em></div>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script defer src="echarts.min.js"></script>
    <title>${htmlEscape(department)} · 部门能力流程系统桑基图</title>
    <style>
      * { box-sizing: border-box; }
      :root {
        --paper: #f7f1e4;
        --paper-2: #fffaf0;
        --ink: #22313f;
        --muted: #667085;
        --line: #dfd2bd;
        --red: #8a3f2a;
        --sage: #6f8f5f;
        --blue: #3b6f88;
        --gold: #b7791f;
      }
      body {
        margin: 0;
        font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
        color: var(--ink);
        background: var(--paper);
        line-height: 1.55;
      }
      .page { max-width: 1680px; margin: 0 auto; padding: 30px 34px 44px; }
      .hero { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 14px; }
      h1 { margin: 0; font-size: 30px; letter-spacing: 0; color: #2a211a; }
      .subtitle { margin: 8px 0 0; max-width: 920px; color: #5f594f; font-size: 14px; }
      .badge { border: 1px solid #caa970; color: #7a3a22; background: #fff7df; border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 800; white-space: nowrap; }
      .notice { border: 1px solid #d4b08b; border-left: 5px solid var(--red); background: #fff8e8; border-radius: 8px; padding: 12px 14px; margin: 14px 0 18px; color: #473a2c; font-size: 14px; }
      .notice strong { color: #7a2e20; }
      .stat-row { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
      .stat-box { background: var(--paper-2); border: 1px solid var(--line); border-radius: 8px; padding: 14px 15px; }
      .stat-box .num { display: block; font-size: 27px; font-weight: 800; color: var(--red); line-height: 1; }
      .stat-box .lbl { margin-top: 7px; color: var(--muted); font-size: 13px; }
      .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: stretch; }
      .panel { background: var(--paper-2); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
      .chart-panel { background: #172033; border-color: #172033; padding: 18px; }
      .chart-title { color: #f8fafc; text-align: center; font-weight: 800; font-size: 19px; }
      .chart-sub { color: #b9c2d0; text-align: center; font-size: 12px; margin: 4px 0 10px; }
      #chart { width: 100%; height: 1040px; }
      .legend-row { display: flex; flex-wrap: wrap; gap: 8px 12px; justify-content: center; margin-top: 8px; color: #d9e2ea; font-size: 12px; }
      .legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
      .legend-item i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
      .side h2, .table-wrap h2 { margin: 0 0 12px; font-size: 16px; letter-spacing: 0; color: #2a211a; }
      .bar-line { display: grid; grid-template-columns: 124px minmax(0, 1fr) 40px; gap: 8px; align-items: center; font-size: 13px; margin-bottom: 10px; }
      .bar-line span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #4a4138; }
      .bar-line b { display: block; height: 9px; background: var(--sage); border-radius: 999px; min-width: 4px; }
      .bar-line em { color: #7a3a22; font-style: normal; font-weight: 800; text-align: right; }
      .table-wrap { margin-top: 16px; overflow: hidden; }
      .table-scroll { overflow: auto; max-height: 780px; border: 1px solid var(--line); border-radius: 8px; }
      table { width: 100%; border-collapse: collapse; background: #fffdf7; min-width: 1080px; }
      th, td { border-bottom: 1px solid #eadcc7; padding: 10px 12px; text-align: left; vertical-align: top; font-size: 13px; }
      th { position: sticky; top: 0; z-index: 1; background: #efe3d0; color: #3d3026; font-weight: 800; }
      .type-pill { display: inline-block; border-radius: 6px; background: color-mix(in srgb, var(--pill) 18%, white); border: 1px solid color-mix(in srgb, var(--pill) 45%, white); color: #2c332b; padding: 2px 7px; font-weight: 800; white-space: nowrap; }
      .source-note { margin-top: 10px; color: #74695d; font-size: 12px; }
      @media (max-width: 1100px) {
        .layout, .stat-row { grid-template-columns: 1fr; }
        .hero { display: block; }
        .badge { display: inline-block; margin-top: 10px; }
        #chart { height: 980px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div>
          <h1>${htmlEscape(department)} · 部门能力流程系统桑基图</h1>
          <p class="subtitle">基于当前候选识别结果生成，用来帮助业务部门看清资料方向、候选类型和需要回源确认的内容。</p>
        </div>
        <div class="badge">模型预览</div>
      </section>
      <div class="notice"><strong>口径说明：</strong>本页未经过映射复核，不作为正式结论；每条候选都需要回到原文确认后，才能进入后续映射沉淀。</div>

      <section class="stat-row">
        <div class="stat-box"><span class="num">${items.length}</span><div class="lbl">候选条目</div></div>
        <div class="stat-box"><span class="num">${sourceCount}</span><div class="lbl">来源文件</div></div>
        <div class="stat-box"><span class="num">${l3Count}</span><div class="lbl">可能的业务流程</div></div>
        <div class="stat-box"><span class="num">${a1Count}</span><div class="lbl">可能的业务行为</div></div>
        <div class="stat-box"><span class="num">${approvalLikeCount}</span><div class="lbl">审批/传递/归档线索</div></div>
        <div class="stat-box"><span class="num">${ocrCount}</span><div class="lbl">需先补原文识别</div></div>
      </section>

      <section class="layout">
        <div class="panel chart-panel">
          <div class="chart-title">${htmlEscape(department)}候选映射预览</div>
          <div class="chart-sub">部门 → 资料方向 → 候选类型（未复核，明细见下方表格）</div>
          <div id="chart"></div>
          <div class="legend-row">${typeHtml}</div>
        </div>
        <aside class="panel side">
          <h2>资料方向分布</h2>
          ${domainHtml}
          <div class="source-note">来源位置只显示文件名和原文锚点，避免把上级目录当成业务信息。</div>
          <div class="source-note">候选内容保留文字说明，不只显示关系编号。</div>
        </aside>
      </section>

      <section class="panel table-wrap">
        <h2>候选映射说明</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>候选类型</th>
                <th>关系说明</th>
                <th>来源</th>
                <th>位置</th>
                <th>需要确认的问题</th>
              </tr>
            </thead>
            <tbody>
              ${rowHtml}
            </tbody>
          </table>
        </div>
        <div class="source-note">数据来源：${htmlEscape(sourceLabel(resolve(runDir, 'mapping_diff_items.json')))}，本页只展示模型候选，不自动写入映射文件。</div>
      </section>
    </main>
    <script>
      window.addEventListener('DOMContentLoaded', function () {
        var chart = echarts.init(document.getElementById('chart'));
        var graph = ${safeJson(graph)};
        chart.setOption({
          tooltip: {
            trigger: 'item',
            triggerOn: 'mousemove',
            formatter: function (params) {
              if (params.dataType === 'edge') {
                return params.data.source + '<br/>→ ' + params.data.target + '<br/>候选数：' + params.data.value;
              }
              return params.name;
            }
          },
          series: [{
            type: 'sankey',
            layout: 'none',
            layoutIterations: 24,
            nodeAlign: 'left',
            draggable: true,
            emphasis: { focus: 'adjacency' },
            data: graph.nodes,
            links: graph.links,
            label: { color: '#e7edf4', fontSize: 12, fontWeight: 600 },
            lineStyle: { color: 'gradient', curveness: 0.48, opacity: 0.28 }
          }]
        });
        window.addEventListener('resize', function () { chart.resize(); });
      });
    </script>
  </body>
</html>
`;
}

const runDir = resolve(ROOT, argValue('--candidate-run', DEFAULT_RUN));
const itemsPath = resolve(runDir, 'mapping_diff_items.json');
if (!existsSync(itemsPath)) fail(`missing ${itemsPath}`);

const items = JSON.parse(readFileSync(itemsPath, 'utf8'));
if (!Array.isArray(items) || items.length === 0) fail(`${itemsPath} has no candidate items`);

const department = argValue('--department', items[0]?.department || '工程技术部');
const outPath = resolve(
  ROOT,
  argValue('--out', resolve(runDir, 'preview.html')),
);
const graph = buildGraph(items);
const typeStats = buildTypeStats(items);
const domainStats = buildDomainStats(items);
const html = buildHtml({ department, items, graph, typeStats, domainStats, runDir });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath}`);
