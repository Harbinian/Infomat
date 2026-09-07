---
name: database-to-process-json
description: >
  Explicit-only Infomat workflow for generating one unreviewed
  process-governance-v7 JSON and its evidence package from a named CXSYSYS.dbo
  form or root table. Use only when the user explicitly invokes
  $database-to-process-json and supplies a form template or root table.
---

# Database to Process JSON

本技能只在用户明确写出 `$database-to-process-json` 时运行。一次只处理一个明确指定的表单流程，输出未审核的 `process-governance-v7` 草稿和证据包。

## 不可突破的边界

- 数据库全程只读。不得执行写入、建表、改表、删除、存储过程、触发器或权限变更。
- 默认读取带时间和摘要的结构快照。只有用户明确授权、具备专用只读账号并通过权限门时，才运行 `scripts/export-cxsysys-readonly-snapshot.ps1`。
- 不接受任意 SQL，不执行 `SELECT *`，不读取或打印连接字符串、密码、令牌、人员联系方式和原始人员数据。
- 只允许 `CXSYSYS.dbo`。主表或表单模板必须明确；匹配到多个工作流时停止生成并列出候选，不替用户选择。
- 数据库结构和配置只能证明结构事实或形成分析候选。业务目的、正式责任、权威来源、生效、归档和保管规则没有业务证据时必须保持待确认。
- 角色配置只进入候选证据和待确认问题，不直接写成正式执行岗位。
- 工作流连线条件不能代替判断节点。校对、复核、审核、核查、审批、批准等实际办理必须保留为`action`；办理完成后另设`decision`表达同意、不同意等结果。每个结果使用独立关系指向明确目标；无法补齐结果去向时停止生成。
- 每次运行写入一个新的 `artifacts/database-process-json/<run-id>/`。不得覆盖现有批次。

## 执行顺序

1. 读取根 `AGENTS.md`、`CODEX.md`、`REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md`、`MAINLINE_MAP.md`、`MEMORY.md` 的当前运行基线，以及 `docs/architecture/data-governance-operating-rules.md`。
2. 核对用户指定的主表或表单模板、目标输出批次和快照时间。数据库名称不是 `CXSYSYS`、架构不是 `dbo` 时立即停止。
3. 检查快照中是否只有一个表单匹配项。再检查工作流：只有一个时继续；多个时停止并列出 `workflow_id` 和名称。
4. 按 [CXSYSYS 映射规则](references/cxsysys-mapping-rules.md) 生成数据对象、表单区域、业务行为、控制节点、流程关系、数据关系、术语候选和待确认问题。生成前检查所有条件分叉的源节点；普通行为承载条件分叉时停止，保留实际办理行为并在其后增加判断节点，不把勤哲连线条件原样当作合格流程图。
5. 如具备明确授权和专用只读账号，先按 [输入输出与实时核验规则](references/input-output-rules.md) 运行只读导出。再运行以下生成命令；已有核验文件时添加 `--read-only-verification <文件>`，一次生成完整批次：

   ```powershell
   node .agents/skills/database-to-process-json/scripts/run-database-to-process-json.mjs `
     --snapshot <结构快照.json> `
     --root-table <主表名> `
     --base-json <可选的旧版3001文件.json> `
     --output artifacts/database-process-json/<run-id>
   ```

   多工作流已由人工选定时，再加 `--workflow <workflow-id>`。已有 V1 至 V7 草稿时可用 `--base-json`：V1 至 V6 先按现有迁移入口转换，符合当前结构的 V7 直接保留；人工填写的对象、字段、术语、说明、来源关系和迁移待定信息不清空。只对匹配标识的节点类型、节点名称和流程关系执行快照修正；未匹配的旧行为、旧流程关系或相互冲突的数据关系必须明确阻断。快照未匹配的人工数据对象和字段保留，并登记待确认问题。没有旧草稿时由结构快照新建 V7。
6. 连接不可用时不阻断快照生成，但必须保留实时待核验事项。核验文件必须包含当前快照的 SHA-256、核验时间、权限摘要和有效查询结果；旧文件缺项时明确拒绝作为实时证据。列的抽样非空计数只证明该列本次可查询及计数，不证明流程配置、业务含义或实际写入时点。补充核验后重新生成时，使用新的批次目录。
7. 核对固定输出：
   - `未审核-<归口部门或待确认部门>-<流程名称>-最终待核对-<YYYYMMDD>.json`
   - `source-manifest.json`
   - `schema-snapshot.json`
   - `evidence-map.jsonl`
   - `pending-issues.md`
   - `generation-summary.json`
   - 可选 `read-only-verification.json`
8. 运行 `node .agents/skills/database-to-process-json/scripts/test-database-to-process-json.mjs` 和 3001 V7 校验。输出 JSON 只允许作为未审核草稿，不得自动导入 3000 或发布为正式流程。

## 交付口径

- 结论先写本轮识别到的流程、数据对象、判断分支和更新字段。
- 分清“结构已确认、配置已确认、实时已核验、分析候选、待业务确认”。
- 明说数据库是否实际连接；没有实时连接时，不得把快照证据称为实时数据库结果。
- 交付 JSON 使用业务名称。`process-governance-v7` 只作为 JSON 内部结构版本，不得用作交付文件名。
- 技术名称只出现在 `schema-snapshot.json`、`source-manifest.json` 和 `evidence-map.jsonl`，不进入流程目的、适用范围、术语、行为名称和面向业务人员的待确认说明。
