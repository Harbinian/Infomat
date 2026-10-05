const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { structuredOutputUiConfig } = require('../server');

assert.deepStrictEqual(structuredOutputUiConfig({}), {
  compact_task_ui_enabled: true,
  compact_task_ui_status: 'candidate',
  internal_workflow_step_count: 7,
  visible_task_count: 4
});
assert.strictEqual(structuredOutputUiConfig({ STRUCTURED_OUTPUT_COMPACT_TASK_UI_ENABLED: '1' }).compact_task_ui_enabled, true);
assert.strictEqual(structuredOutputUiConfig({ STRUCTURED_OUTPUT_COMPACT_TASK_UI_ENABLED: '0' }).compact_task_ui_enabled, false);
assert.strictEqual(structuredOutputUiConfig({ STRUCTURED_OUTPUT_COMPACT_TASK_UI_ENABLED: 'true' }).compact_task_ui_enabled, false);

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
[
  "label: '填写流程说明', description: '名称、目的、范围和材料来源', steps: Object.freeze(['start', 'boundary'])",
  "label: '编制环节与流转', description: '谁做什么、按什么条件流转', steps: Object.freeze(['skeleton', 'action'])",
  "label: '整理数据与表单', description: '对象字段、表单及取值来源', steps: Object.freeze(['data'])",
  "label: '检查问题并下载', description: '定位问题、下载未审核草稿', steps: Object.freeze(['cross-department', 'handoff'])"
].forEach(fragment => assert.ok(html.includes(fragment), `missing compact-task mapping: ${fragment}`));
assert.match(html, /let uiConfig = \{ compact_task_ui_enabled: false/);
assert.match(html, /fetch\('\/api\/ui-config', \{ cache: 'no-store' \}\)/);
assert.match(html, /if \(compactTaskUiEnabled\(\)\)/);
assert.match(html, /aria-label="业务编制任务导航"/);
assert.match(html, /按四项任务完成编制/);
assert.match(html, /compactTaskUiEnabled\(\) \? '按四项任务完成一条流程的编制、核对和交接准备'/);
assert.match(html, /COMPACT_TASK_HELP\.map\(item =>/);
assert.match(html, /不认定主数据、关键字段或正式权威来源/);
assert.match(html, /建立关系时直接填写条件/);
assert.match(html, /不需要切换到其他任务/);
assert.match(html, /governanceNavigationLocation/);
assert.match(html, /targetStep === 'action' \? 'skeleton' : targetStep/);
assert.match(html, /workspaceViewTitle\.textContent = compactTaskUiEnabled\(\) \? '本次要做的工作' : '治理步骤'/);
assert.match(html, /进入最终检查与保存/);
assert.match(html, /返回跨部门事实核对/);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /app\.get\('\/api\/ui-config'/);
assert.match(serverSource, /STRUCTURED_OUTPUT_COMPACT_TASK_UI_ENABLED/);

console.log('Four-task UI default and explicit fallback contract tests passed');
