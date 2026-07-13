# AGENTS.md - PMO 交付物

本文件约束 `pmo/deliverables/` 下的受控交付物。根目录规则和 `pmo/AGENTS.md` 同时适用。

## 真源边界

- `DLV-XXX-*.md` 是交付物状态和正文的 Markdown 正本。
- `DLV-XXX-*.docx`、`DLV-XXX-*.xlsx` 是交付物配套原件或提交件，需与对应 Markdown、清单或版本记录保持可追溯关系。
- PMO 计划、日期、阶段门和任务字段的真源仍在 `pmo/` 根目录 Markdown，不在交付物正文里单独改口径。
- 流程输入基线和组织口径变化必须回到 `docs/norms/` 或 `docs/organization/` 修改。
- 上传原件、状态快照、运行历史和临时导出默认写入被忽略的 `artifacts/pmo/deliverables/`。

## 编辑规则

- 新增交付物保持 `DLV-编号-主题` 命名，并同步交付物清单或 PMO 页面消费说明。
- 正式纪要、启动令、预审材料和周会材料应保留正式公文口吻、版本记录和变更记录。
- 来自录音、转写或指导意见的内容应改写为正式纪要语言，再合并到正文和待办。
- 修改 frontmatter、状态字段、审批历史或上传凭证时，同步检查 PMO dev 插件、API 和测试。
- 交付物内容改变项目计划、日期、阶段门或责任分工时，先更新 PMO 真源，再重新生成并校验任务数据。
- 不提交未脱敏附件、临时签字扫描件、dev 服务过程文件或一次性导出物。

## 验证口径

交付物 frontmatter、状态机、上传或写回链路变化：

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

仅修改叙述性正文时，检查版本记录、交叉引用和对应 DLV 编号即可；最终说明写明无需运行应用测试的理由。
