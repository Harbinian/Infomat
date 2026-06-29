# 2026-06-18 流程治理工作区可用性修正记录

> 状态：已实施  
> 范围：MDM 流程治理承接页、输入基线问题复核导入/展示、仓库级待确认报告生成脚本
> 边界：不修改 `docs/norms/` 流程输入基线，不反向覆盖 PMO 驾驶舱数据

## 1. 背景

部门用户在 MDM 流程治理页面查看文档问题时，原界面更像技术复核台，存在三类问题：

1. 表格滚动后看不到列头，不清楚当前列含义。
2. 输入基线问题复核区出现“待确认类型”“来源锚点”“内部锚点Pxx”等技术口径。
3. 映射待办和治理闭环的按钮含义、处理顺序、关闭条件没有贴近业务处理过程说明。

本轮把说明放回实际工作区，不新增独立说明页。

## 2. 已调整内容

### 2.1 明细表粘性表头

- 所有 `.table-container` 和 `.tw` 明细表支持随页面滚动显示表头。
- 浮动表头会同步原表格列宽和横向滚动位置。
- 保留原 CSS sticky 作为表格内部滚动兜底。

### 2.2 流程治理输入基线问题复核文案

- “输入基线问题复核”调整为面向业务用户的“待确认的问题”。
- 表头改为“在哪发现的 / 哪里有问题 / 是哪种问题 / 证据有没有问题 / 请你确认”。
- 复核下拉项改成确认语气：是否是问题、证据是否可用、是否需要修改原文。
- 规范化说明改为“给后续处理人的说明”，提示写证据、判断、改法和下一步。

### 2.3 来源位置口径

- 不再向用户展示“内部锚点P71/P72”。
- 有真实条款、页码、表格位置时，展示“第5.2条”“第71页”“表1”等可读位置。
- 只有内部抽取编号时，展示“原文位置待核对”。
- 前端增加兜底清洗：历史数据里若已有旧标签，页面展示时也会替换。

### 2.4 映射待办和治理闭环

- 在实际待办区补充类型含义、状态含义和处理步骤。
- 详情区补充按钮含义。
- “确认关闭”只在重新导入后状态变成“待关闭确认”时可用，避免用户提前关闭。

## 3. 涉及资产

- MDM 前端：`apps/mdm-platform/public/index.html`
- MDM 输入基线问题复核接口与仓储：`apps/mdm-platform/server/routes/processGovernance.js`、`apps/mdm-platform/server/processInputBaselineReviewRepository.js`
- MDM 流程治理 MySQL 读模型：`apps/mdm-platform/server/processGovernanceMysqlRepository.js`
- 应用内测试：`apps/mdm-platform/scripts/test-*.js`
- 仓库级待确认报告脚本：`scripts/input-baseline-review-core.mjs`、`scripts/build-reviewItem-sankey-preview.mjs`

## 4. 验证

已执行并通过：

```bash
cd apps/mdm-platform
npm run test:frontend
node scripts/test-process-governance-frontend.js
node scripts/test-process-input-baseline-review-mysql.js
node scripts/test-process-input-baseline-review-api.js
node scripts/test-process-governance-api.js
cd ../..
node scripts/test-input-baseline-review-mysql.mjs
node scripts/test-reviewItem-sankey-preview.mjs
```

说明：本轮没有运行 `scripts/parse-sankey-data.mjs`，因为没有修改流程输入基线 `docs/norms/`。
