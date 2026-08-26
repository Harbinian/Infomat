const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const editorDir = path.join(__dirname, '..', 'public', 'process-governance-editor');
const editorHtml = fs.readFileSync(path.join(editorDir, 'index.html'), 'utf8');
const editorAdapter = fs.readFileSync(path.join(editorDir, 'mdm-adapter.js'), 'utf8');

assert.ok(html.includes('data-tab="processGovernance"'), 'top navigation must keep one process governance entry');
assert.strictEqual((html.match(/data-tab="processGovernance"/g) || []).length, 1, 'process governance must have one top entry');
assert.ok(html.includes('id="processGovernancePanel"'), 'unified process governance panel must exist');

const subtabStart = html.indexOf('const PROCESS_GOVERNANCE_SUBTABS = [');
const subtabEnd = html.indexOf('];', subtabStart);
const subtabSource = html.slice(subtabStart, subtabEnd);
[
  "{ key: 'editor', label: '流程编制' }",
  "{ key: 'handoffs', label: '跨部门承接待办' }",
  "{ key: 'conflicts', label: '承接冲突待办' }",
  "{ key: 'v7Preview', label: 'V7预览核对' }"
].forEach(fragment => assert.ok(subtabSource.includes(fragment), `missing unified subtab ${fragment}`));
assert.strictEqual((subtabSource.match(/key: '/g) || []).length, 4, 'only four process governance workspaces are allowed');
[
  '文档结构化输出',
  '待确认问题',
  '流程图谱',
  '证据来源',
  '映射工作',
  '治理闭环'
].forEach(label => assert.ok(!subtabSource.includes(label), `retired subtab remains: ${label}`));

assert.ok(html.includes('data-pg-view="editor"'), 'editor workspace must be routable');
assert.ok(html.includes('data-pg-view="handoffs"'), 'handoff queue must be routable');
assert.ok(html.includes('data-pg-view="conflicts"'), 'handoff conflict queue must be routable');
assert.ok(html.includes('data-pg-view="v7Preview"'), 'V7 preview review must be routable');
assert.ok(html.includes('/api/process-v7-preview/cases'), 'V7 preview review must use its isolated API');
assert.ok(html.includes('V7文件只用于预览和跨部门核对'), 'V7 preview boundary must be visible to users');
assert.ok(html.includes('id="pgV7PreviewFileInput"'), 'V7 preview must accept an explicit JSON upload');
[
  'id="pgV7FormalTargetMode"',
  'id="pgV7FormalCreateFields"',
  'id="pgV7FormalExistingFields"',
  'id="pgPromoteV7PreviewBtn"',
  'function promoteV7PreviewCase',
  "$('pgV7FormalCreateFields').classList.toggle('pg-hidden'",
  "$('pgV7FormalExistingFields').classList.toggle('pg-hidden'",
  "'/promote'",
  '新建流程主档',
  '选择已有流程主档',
  '正式V7草稿'
].forEach(fragment => assert.ok(html.includes(fragment), `V7 formal promotion UI missing ${fragment}`));
const submitFormalSource = html.slice(html.indexOf('async function submitV7FormalDraft'), html.indexOf('async function reviewV7FormalDraft'));
const reviewFormalSource = html.slice(html.indexOf('async function reviewV7FormalDraft'), html.indexOf('async function publishV7FormalDraft'));
const publishFormalSource = html.slice(html.indexOf('async function publishV7FormalDraft'), html.indexOf('async function readV7FormalVersion'));
const renderV7PreviewSource = html.slice(html.indexOf('function renderV7PreviewReviewDetail'), html.indexOf('async function loadV7PreviewReviewCases'));
[
  [submitFormalSource, 'formalDraft.revision_no', 'formalDraft.content_hash'],
  [reviewFormalSource, 'formalTask.draft_revision_no', 'formalTask.content_hash'],
  [publishFormalSource, 'formalDraft.revision_no', 'formalDraft.content_hash']
].forEach(function(expectation) {
  assert.ok(expectation[0].includes('expected_revision_no:' + expectation[1]), 'V7 formal action must send the current revision binding');
  assert.ok(expectation[0].includes('expected_content_hash:' + expectation[2]), 'V7 formal action must send the current content hash binding');
  assert.ok(expectation[0].indexOf('await api(') < expectation[0].indexOf('state.pgViewCache = {}'), 'V7 formal failures must preserve the current page and form values');
});
assert.ok(
  renderV7PreviewSource.includes('detail.formal_allowed_decisions || []'),
  'V7 formal review selector must use the server-authorized decisions'
);
assert.ok(
  !renderV7PreviewSource.includes('<option value="approve">审核通过</option>'),
  'V7 formal review selector must not hard-code approve when the current revision has blockers'
);
assert.ok(html.includes("return PROCESS_GOVERNANCE_VIEW_ALIASES[rawView] || 'editor'"), 'editor must be the default process governance workspace');
assert.ok(html.includes("workspace=' + encodeURIComponent(view)"), 'handoff workspaces must use stable workspace routes');
assert.ok(html.includes('data-src="/process-governance-editor/index.html"'), 'process governance must show the MDM-local 3001-style editor');
assert.ok(html.includes("activeView === 'editor'"), 'MDM editor must load only after authenticated navigation');
assert.ok(html.includes('id="pgDesignWizard" hidden aria-hidden="true"'), 'legacy step form must not remain the visible editor');
assert.ok(html.includes("event.data.type === 'mdm-process-editor-state'"), 'embedded editor must report unsaved state to MDM');
assert.ok(html.includes("event.data.type === 'mdm-process-editor-height'"), 'embedded editor must resize with its content');

[
  'process-diagram.js',
  'structure-score.js',
  'mdm-adapter.js',
  path.join('vendor', 'cytoscape.min.js')
].forEach(file => assert.ok(fs.existsSync(path.join(editorDir, file)), `MDM editor asset missing ${file}`));

[
  '单流程治理编制工作台',
  '导入3001文件',
  '保存草稿',
  '提交审核',
  '导出备份',
  '文字编制',
  '跨职能流程图预览',
  'record-workbench',
  '结构化学习评分',
  'moveCollectionItem',
  '/api/process-design/editor/template?version=process-governance-v3',
  '/api/process-design/editor/schema',
  '/api/process-design/editor/validate'
].forEach(fragment => assert.ok(editorHtml.includes(fragment), `MDM 3001-style editor missing ${fragment}`));

[
  '/api/process-design/drafts?limit=100',
  '/api/process-design/drafts/canonical',
  'expected_revision:',
  '/content',
  '/submit',
  'DRAFT_REVISION_CONFLICT',
  'HANDOFF_VOID_REASON_REQUIRED',
  "roles.includes('department_contact')",
  "roles.includes('admin')",
  "window.parent.postMessage"
].forEach(fragment => assert.ok(editorAdapter.includes(fragment), `MDM editor adapter missing ${fragment}`));
assert.ok(!editorHtml.includes('localStorage.'), 'MDM editor must not persist drafts in localStorage');
assert.ok(!editorHtml.includes('sessionStorage.'), 'MDM editor must not persist drafts in sessionStorage');
assert.ok(!editorAdapter.includes('localStorage.'), 'MDM editor adapter must not persist drafts in localStorage');
assert.ok(!editorAdapter.includes('sessionStorage.'), 'MDM editor adapter must not persist drafts in sessionStorage');

[
  'id="pgDesignWizard"',
  'id="pgDesignStepProgress"',
  'id="importProcessDesignStructuredOutputBtn"',
  '预览并审核导入3001文件',
  "['process-governance-v1', 'process-governance-v2', 'process-governance-v3']",
  'id="pgCanonicalJsonEditor"',
  'id="pgCanonicalJsonText"',
  'id="pgLoadCanonicalJsonBtn"',
  'id="pgSaveCanonicalJsonBtn"',
  'id="pgExportCanonicalJsonBtn"',
  'function loadCanonicalJsonForDraft',
  'function saveCanonicalJsonDraft',
  'expected_revision:',
  '/content',
  '/export',
  'canonicalDirty',
  "window.addEventListener('beforeunload'"
].forEach(fragment => assert.ok(html.includes(fragment), `single-process editor missing ${fragment}`));

[
  '录入现有表单',
  '设计新建／优化表单',
  '主表字段',
  '字段归属',
  '新建明细表',
  '明细表标题（按纸质单据填写，可暂缺）',
  'form_design_state',
  'data-form-item-assignment',
  'removeDetailArea'
].forEach(fragment => assert.ok(editorHtml.includes(fragment), `paper form editor missing ${fragment}`));
[
  '建立主表结构',
  '添加明细表结构',
  '结构类型',
  '主表标题'
].forEach(fragment => assert.ok(!editorHtml.includes(fragment), `database-oriented form wording remains: ${fragment}`));

[
  '制度说明',
  '流程与行为',
  '术语',
  '跨部门承接',
  '附表结构',
  '字段清单',
  '提交审核',
  '结构化预览',
  'Markdown 草案'
].forEach(label => assert.ok(html.includes(label), `existing list editor capability missing ${label}`));
assert.ok(html.includes('data-process-design-field-direction="up"'), 'stable field ordering must keep move-up action');
assert.ok(html.includes('data-process-design-field-direction="down"'), 'stable field ordering must keep move-down action');
assert.ok(!html.includes('localStorage.'), 'process governance must not persist drafts in localStorage');
assert.ok(!html.includes('sessionStorage.'), 'process governance must not persist drafts in sessionStorage');

[
  '/api/process-design/cross-dept-handoffs?limit=200',
  '/story',
  'function showHandoffStory',
  'pg-story-chain',
  '当前步骤',
  '下一责任角色',
  '处理人',
  '部门',
  '依据'
].forEach(fragment => assert.ok(html.includes(fragment), `handoff story UI missing ${fragment}`));
assert.ok(!html.includes('承接进度百分比'), 'handoff story must not infer percentage progress');
assert.ok(
  html.includes("var actorRoleLabel = item.status === 'confirmed' ? '执行角色' : '执行角色待确认';"),
  'V7 review must distinguish confirmed execution roles from roles still awaiting confirmation'
);
assert.ok(
  html.includes("'<div class=\"metric\"><div class=\"lbl\">' + actorRoleLabel + '</div>"),
  'V7 review must render the execution-role label selected from the item status'
);

[
  '/api/process-design/handoff-conflicts?limit=200',
  'function handleHandoffConflictAction',
  '/assign',
  '/proposal',
  '/department-confirmation',
  '/escalate',
  '/decision',
  'value="continue_handoff"',
  'value="not_required"',
  'value="return_revision"'
].forEach(fragment => assert.ok(html.includes(fragment), `handoff conflict UI missing ${fragment}`));

[
  'id="roleGuideList"',
  'role-guide-shell',
  '角色目标',
  '第一步入口',
  '可见功能标签',
  '当前待办',
  '允许动作',
  '禁止事项',
  'RACI责任',
  '典型故事',
  '完成标准'
].forEach(fragment => assert.ok(html.includes(fragment), `role responsibility page missing ${fragment}`));

[
  'data-panel="visibleTabs">角色可见标签',
  'function renderRoleVisibleTabs',
  'function roleVisibleTabUnion',
  '所选角色可见标签并集',
  '授权后可见标签并集',
  '标签可见性不替代服务端权限校验'
].forEach(fragment => assert.ok(html.includes(fragment), `visible-tab preview missing ${fragment}`));

assert.ok(html.includes('function applyRoleVisibility'), 'top tabs must be rendered from the fixed model');
assert.ok(html.includes('role.visibleTabs'), 'top tab visibility must consume role visibleTabs');
assert.ok(html.includes('visibleTabCodes.add(tab.code)'), 'multiple roles must merge visible tabs');

console.log('Unified process governance frontend contract tests passed');
