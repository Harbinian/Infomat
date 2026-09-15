const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
assert.match(html, /\[hidden\] \{ display: none !important; \}/);
assert.match(html, /class="panel role-workbench wb-task-first"/);
assert.match(html, /role-workbench\.on\.wb-task-first/);
assert.match(html, /height: calc\(100vh - 105px\)/);
assert.match(html, /我现在该做什么/);
assert.match(html, /职责全景放在“全量职责”中查看/);
assert.match(html, /id="pgDataGovernanceSection" data-pg-view="dataGovernance"/);
assert.match(html, /业务部门只回答定向事实问题/);
assert.match(html, /class="pdg-modal-mask" id="pdgModalMask"/);
assert.match(html, /\.pdg-modal-mask \{[\s\S]*position: fixed; inset: 0/);
assert.match(html, /\.pdg-modal \{[\s\S]*width: 100%; height: 100%/);
assert.match(html, /html\.pdg-modal-open,[\s\S]*body\.pdg-modal-open \{ overflow: hidden !important; \}/);
assert.match(html, /document\.documentElement\.classList\.add\('pdg-modal-open'\)/);
assert.match(html, /document\.documentElement\.classList\.remove\('pdg-modal-open'\)/);
assert.match(html, /\.confirm-overlay \{[^}]*z-index: 10020/);
assert.match(html, /generate-candidates/);
assert.match(html, /answer_targeted_business_fact/);
assert.match(html, /系统未自动确认/);
assert.match(html, /state\.processDataGovernance\.dirty/);
assert.match(html, /尚未保存当前输入/);
assert.match(html, /beforeunload[\s\S]*processDataGovernance\.dirty/);
assert.match(html, /cacheFilters\.pdgPackageId = route\.pdgPackageId \|\| ''/);
assert.match(html, /cacheFilters\.pdgFactRequestId = route\.pdgFactRequestId \|\| ''/);
assert.match(html, /if \(mode === 'all'\) \{\s*renderWorkbenchRoles\(data\);/);
assert.match(html, /数据治理尚未开启。开启后，可选择已发布的V7流程版本建立工作包/);
assert.match(html, /id="pdgVersionSelect"/);
assert.match(html, /payload.published_versions/);
assert.match(html, /process_version_id:versionId/);
assert.doesNotMatch(html, /status.configured_process_version_id/);

console.log('Process data governance frontend contract tests passed');

assert.ok(html.includes('data-parent-tab="processGovernance" data-workspace="dataGovernance"'), 'data governance keeps its sidebar entry');
assert.ok(!html.includes('const PROCESS_DATA_GOVERNANCE_SUBTAB'), 'data governance must not duplicate a page-level workspace tab');
