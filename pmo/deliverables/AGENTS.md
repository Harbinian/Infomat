# AGENTS.md - PMO 交付物

本文件约束 `pmo/deliverables/` 下的受控交付物。根目录规则和 `pmo/AGENTS.md` 同时适用。

## 真源边界

- `DLV-XXX-*.md` 是交付物状态和正文的 Markdown 正本。
- `DLV-XXX-*.docx`、`DLV-XXX-*.xlsx` 是交付物配套原件或提交件，需与对应 Markdown、清单或版本记录保持可追溯关系。
- PMO 计划、日期、阶段门和任务字段的真源仍在 `pmo/` 根目录 Markdown，不在交付物正文里单独改口径。
- 交付物与计划任务的绑定只认显式锚点：任务侧 `受控交付物编号`，或正本 frontmatter 的 `normalizedWbs` / `taskId`。不要依赖标题文本相似度建立关联，也不要用任务顺序推断编号。
- `DLV-###` 编号是正本的唯一身份。新增编号前先确认未被占用（`GET /api/pmo/deliverables/ledger` 的 `suggestedNextId` 取「已有最大号 +1」，历史空缺号不回收）。
- 流程和组织口径变化依据用户指定外部材料、业务说明及有权确认；3001编制并由用户下载/上传3000治理。`docs/`旧资料仅用于追溯及明确授权的兼容维护。
- 上传原件、状态快照、运行历史和临时导出默认写入被忽略的 `artifacts/pmo/deliverables/`。

## 行动项字段（action 块）

- 交付物**被发布为行动项后**，frontmatter 才出现 `action` 块；未发布的正本不含该块，既有正本无需改动。
- `action.assigneeDepartment`（责任部门，取自《信息化项目部门主备对接人名单》9 个业务部门）与顶层 `department`（编制归属，如「信息化项目组」「MDM工作组」）是**两个不同概念**，不得互相覆盖。
- `action.dueDate` 是行动项截止时间，**独立于 `plannedFinish`**（计划真源日期）。两者口径不同，不要同步改写。
- 完成判定与证据要求的真源是 `信息化项目_执行标准真源.md`。绑定任务存在时只读带入（`criteriaSource: task`，不落盘）；只有交付物无计划锚点时，才手工写入 `action.criteria` 并标记 `criteriaSource: manual`。
- 行动项事件由插件写入 `workflowHistory` 并同步正文 `## 变更记录`，不要手工编辑这两处。
- 期限调整遵循协同工作规则 8.2：调整生效但**不追溯消除已经发生的逾期事实**，原截止时间保留在操作记录中。

## 编辑规则

- 新增交付物保持 `DLV-编号-主题` 命名，并同步交付物清单或 PMO 页面消费说明。
- 正式纪要、启动令、预审材料和周会材料应保留正式公文口吻、版本记录和变更记录。
- 来自录音、转写或指导意见的内容应改写为正式纪要语言，再合并到正文和待办。
- 修改 frontmatter、状态字段、审批历史或上传凭证时，同步检查 PMO dev 插件、API 和测试。
- 交付物内容改变项目计划、日期、阶段门或责任分工时，先更新 PMO 真源，再重新生成并校验任务数据。
- 不提交未脱敏附件、临时签字扫描件、dev 服务过程文件或一次性导出物。

## 验证口径

交付物 frontmatter、状态机、上传或写回链路变化时，按受影响路径选择以下检查；跨链路修改覆盖所有相关入口：

```powershell
cd pmo/gantt-react
npm run test:frontmatter
npm run test:writeback
npm run test:plugin
```

交付物内容影响 PMO 计划或任务数据：

从仓库根目录运行：

```powershell
npm run build:pmo-task-data
npm run test:pmo-task-data
```

仅修改叙述性正文时，核对受影响的版本记录、交叉引用和 DLV 编号；不运行应用测试。
