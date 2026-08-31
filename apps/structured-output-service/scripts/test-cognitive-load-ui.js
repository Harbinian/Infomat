const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
const diagram = fs.readFileSync(path.join(appRoot, 'public', 'process-diagram.js'), 'utf8');

assert.doesNotMatch(html, /@media \(max-width: 1919px\), \(max-height: 899px\)/);
assert.doesNotMatch(html, /@media \(max-width: (?:1599|1279)px\)/);
assert.doesNotMatch(html, /viewport-blocker|viewportBlocker|syncViewportRequirement/);
assert.doesNotMatch(html, /当前窗口不能编辑|内容可视区调整到至少|不再支持 1536 和 1280/);
assert.doesNotMatch(html, /\.setAttribute\('inert'|\.removeAttribute\('inert'/);
assert.match(html, /body \{[\s\S]*?height: 100vh;[\s\S]*?overflow: hidden;/);
assert.match(html, />保存当前草稿<\/button>/);
assert.match(html, /const checkLabel = checked[\s\S]*?: '检查本轮';/);
assert.match(html, /data-action="check-governance-step"/);

const stepIntro = html.slice(
  html.indexOf('function renderStepIntro('),
  html.indexOf('function renderGovernanceIssuePanel(')
);
assert.doesNotMatch(stepIntro, /step\.number|step\.label|step\.responsibility|step-intro/);

const skeletonList = html.slice(
  html.indexOf('function renderSkeletonListPanel('),
  html.indexOf('function renderSkeletonStep(')
);
assert.doesNotMatch(skeletonList, /<aside class="graph-property-shell"/);
assert.match(skeletonList, /renderFlowEditModal\(\)/);

const processPanel = html.slice(
  html.indexOf('function renderDiagramPanel('),
  html.indexOf('function ensureActiveGraphDataObject(')
);
assert.match(processPanel, /flow-graph-editor-layout/);
assert.doesNotMatch(processPanel, /aria-label="当前选择属性"/);
assert.match(processPanel, /renderFlowEditModal\(\)/);
assert.match(html, /class="modal flow-editor-drawer"/);
assert.match(html, /width: min\(52vw, 980px\)/);
assert.match(html, /max-height: calc\(100vh - 24px\)/);
assert.match(html, /data-graph-property="behavior_description"/);
assert.match(html, /data-graph-property="completion_standard"/);
assert.match(html, /data-graph-property="condition"/);
assert.match(html, /data-graph-list-property="countersign_target_departments"/);
assert.match(html, /function relationConditionEditorCopy\(relation = \{\}\)/);
[
  '判断条件',
  '退回条件',
  '并行启动条件（可选）',
  '并行汇合要求（可选）',
  '并行路线条件或汇合要求（可选）'
].forEach(label => assert.ok(html.includes(label), `missing relation condition editor copy: ${label}`));
assert.match(html, /flowRelationDraft\.stage === 'confirm' \? `[\s\S]*?data-graph-relation-condition/);
assert.doesNotMatch(html, /flowRelationDraft\.stage === 'confirm' && \['condition', 'loop'\]\.includes/);
assert.match(html, /点击流程线编辑判断、退回与并行条件/);
assert.match(html, /编辑判断、退回与并行条件/);
assert.match(html, /grid-template-columns: minmax\(0, 1fr\); gap: 12px; \}/);
assert.doesNotMatch(html, /第4步维护的条件/);
assert.doesNotMatch(html, /diagramExpanded = next === 'skeleton' && activeStepView === 'diagram'/);
assert.match(html, /data-action="toggle-diagram-expanded"/);
assert.match(html, /清晰检查（100%）/);
assert.match(html, /查看全图/);

[
  'const LANE_FONT_SIZE = 42;',
  'const POOL_TITLE_FONT_SIZE = 48;',
  'const NODE_FONT_SIZE = 45;',
  'const EXTERNAL_NODE_FONT_SIZE = 42;',
  'const BADGE_FONT_SIZE = 36;',
  'const EDGE_FONT_SIZE = 39;'
].forEach(source => assert.ok(diagram.includes(source), `missing three-times diagram style: ${source}`));
assert.match(diagram, /cy\.zoom\(1\);/);
assert.match(diagram, /mode: 'clear'/);
assert.match(diagram, /options\.selectedFocus/);

console.log('structured-output-service cognitive-load UI contract tests passed');
