import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'candidate-sankey-preview-'));

try {
  const runDir = join(tmp, 'candidate-run');
  mkdirSync(runDir, { recursive: true });

  const items = [
    {
      id: 'CAND-L3-001',
      department: '工程技术部',
      source_file:
        'docs/norms/工程技术部业务资料/12.0-集成研发/GLB120107-01工程数据集审签和发放管理标准/工程数据集审签和发放管理标准.docx',
      source_anchor: 'P14',
      candidate_type: '候选L3',
      content: '工程数据集审签和发放管理标准',
      mapping_location: '当前模型映射未见同名覆盖',
      suggested_action: '请回到原文确认是否纳入流程地图。',
      status: '待处理',
    },
    {
      id: 'CAND-A1-001',
      department: '工程技术部',
      source_file:
        'docs/norms/工程技术部业务资料/12.0-集成研发/GLB120107-01工程数据集审签和发放管理标准/工程数据集审签和发放管理标准.docx',
      source_anchor: 'P14',
      candidate_type: '候选A1',
      content: '组织工程数据集审签',
      mapping_location: '当前模型映射未见同名覆盖',
      suggested_action: '请确认是否拆为业务行为。',
      status: '待处理',
    },
    {
      id: 'CAND-APPROVAL-001',
      department: '工程技术部',
      source_file:
        'docs/norms/工程技术部业务资料/14.1-生产计划管理/计划管理程序/计划管理程序.docx',
      source_anchor: '表01 R2',
      candidate_type: '审批链待确认',
      content: '计划编制后由部门负责人审核',
      mapping_location: '当前模型映射未见同名覆盖',
      suggested_action: '请确认是否属于受控审批。',
      status: '待处理',
    },
    {
      id: 'CAND-TRANSFER-001',
      department: '工程技术部',
      source_file:
        'docs/norms/工程技术部业务资料/14.1-生产计划管理/计划管理程序/计划管理程序.docx',
      source_anchor: '表01 R3',
      candidate_type: '受控传递待确认',
      content: '计划表传递至生产单位',
      mapping_location: '当前模型映射未见同名覆盖',
      suggested_action: '请确认是否属于受控传递。',
      status: '待处理',
    },
    {
      id: 'CAND-ARCHIVE-001',
      department: '工程技术部',
      source_file:
        'docs/norms/工程技术部业务资料/14.1-生产计划管理/计划管理程序/计划管理程序.docx',
      source_anchor: '表01 R4',
      candidate_type: '归档要求待补',
      content: '计划批准记录归档',
      mapping_location: '当前模型映射未见同名覆盖',
      suggested_action: '请确认归档责任。',
      status: '待处理',
    },
    {
      id: 'CAND-ROLE-001',
      department: '工程技术部',
      source_file:
        'docs/norms/工程技术部业务资料/14.1-生产计划管理/计划管理程序/计划管理程序.docx',
      source_anchor: '表01 R5',
      candidate_type: '角色待确认',
      content: '计划管理员',
      mapping_location: '当前模型映射未见同名覆盖',
      suggested_action: '请确认角色归属。',
      status: '待处理',
    },
  ];

  writeFileSync(join(runDir, 'mapping_diff_items.json'), JSON.stringify(items, null, 2), 'utf8');

  const defaultResult = spawnSync(
    process.execPath,
    [
      resolve(ROOT, 'scripts', 'build-candidate-sankey-preview.mjs'),
      '--candidate-run',
      runDir,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );

  const defaultOut = join(runDir, 'preview.html');
  assert.equal(defaultResult.status, 0, defaultResult.stderr || defaultResult.stdout);
  assert.equal(existsSync(defaultOut), true, 'default preview HTML should be written next to the candidate run');
  assert.match(defaultResult.stdout, /artifacts|candidate-run|preview\.html/);
  assert.doesNotMatch(defaultResult.stdout.replace(/\\/g, '/'), /docs\/norms/, 'default preview output must not target docs/norms');

  const out = join(tmp, '工程技术部部门能力流程系统桑基图.html');
  const result = spawnSync(
    process.execPath,
    [
      resolve(ROOT, 'scripts', 'build-candidate-sankey-preview.mjs'),
      '--candidate-run',
      runDir,
      '--out',
      out,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(out), true, 'expected preview HTML to be written');

  const html = readFileSync(out, 'utf8');
  assert.match(html, /工程技术部 · 部门能力流程系统桑基图/);
  assert.match(html, /模型预览/);
  assert.match(html, /未经过映射复核，不作为正式结论/);
  assert.match(html, /候选L3/);
  assert.match(html, /候选A1/);
  assert.match(html, /审批链待确认/);
  assert.match(html, /受控传递待确认/);
  assert.match(html, /归档要求待补/);
  assert.match(html, /角色待确认/);
  assert.match(html, /工程数据集审签和发放管理标准/);
  assert.doesNotMatch(html, /内部锚点P14/);
  assert.doesNotMatch(html, /原文定位不足/);
  assert.match(html, /原文位置待核对/);
  assert.doesNotMatch(html, /第14页/);
  assert.doesNotMatch(html, /段落P14/);
  assert.match(html, /表01第2行/);
  assert.match(html, /可能的审批或确认环节/);
  assert.match(html, /资料、表单或结果传递关系/);
  assert.match(html, /输出物或归档要求/);
  assert.match(html, /执行角色/);
  assert.match(html, /echarts\.min\.js/);
  assert.doesNotMatch(html, /docs\/norms\/工程技术部业务资料/);

  const graphMatch = html.match(/var graph = (\{[\s\S]*?\});\s*chart\.setOption/);
  assert.ok(graphMatch, 'expected embedded Sankey graph data');
  const graph = JSON.parse(graphMatch[1]);
  assert.ok(graph.nodes.length <= 12, 'overview Sankey should aggregate by candidate type instead of rendering every candidate as a leaf');
  assert.equal(
    graph.nodes.some(node => node.name.includes('工程数据集审签和发放管理标准') && node.name.includes('第14页')),
    false,
    'individual candidate details belong in the table, not the overview Sankey nodes',
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
