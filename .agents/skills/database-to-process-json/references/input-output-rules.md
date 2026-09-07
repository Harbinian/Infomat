# 输入、输出与实时核验规则

## 结构快照

快照使用 `database-process-evidence-v1`，至少包含：

- `database`：固定为 `CXSYSYS`。
- `schema`：固定为 `dbo`。
- `captured_at`、`snapshot_digest`、`source_summary`。
- `forms[]`：表单标识、业务名称、主表、物理表到业务对象和表单区域的对应关系。
- `workflows[]`：工作流标识、适用主表、节点、连线、角色候选、数据操作和判断读取字段。快照整理时必须同时保留实际办理行为和办理后的判断节点，形成“业务行为 → 判断节点 → 下一业务行为”；不能删除业务行为，也不能只保留普通节点加条件线。
- `term_candidates[]`：从业务字段和列表规范筛选出的术语候选。
- `pending_issues[]`：数据库不能证明的业务事实。
- `verification_targets[]`：可选，只读实时核验允许查看的表和字段；每个目标最多20行，只输出非空数量等摘要，不输出原值。

快照不得包含连接字符串、密码、令牌、人员联系方式或原始人员记录。技术字段使用 `classification: "technical"`，生成时必须排除。

随附的 `product-manufacturing-outline-snapshot.json` 是历史结构大纲，不含各表的 `fields[]`，不能作为独立生成完整流程的样例。使用时须提供标识可匹配且含字段的旧草稿，或提供完整字段快照；缺少实际更新字段时应明确报错，不根据审批节点名称补造字段。

## 实时只读门

只有同时满足下列条件才运行 `export-cxsysys-readonly-snapshot.ps1`：

1. 用户在当前任务中明确授权实时只读核验。
2. 连接信息通过 `INFOMAT_CXSYSYS_READONLY_CONNECTION_STRING` 环境变量提供；不得读取 `.env` 或在命令行显示连接值。
3. 连接数据库为 `CXSYSYS`、默认架构为 `dbo`。
4. 账号不是 `sysadmin`、`db_owner`，有效数据库权限不含 `INSERT`、`UPDATE`、`DELETE`、`ALTER`、`CONTROL`、`CREATE TABLE`、`EXECUTE` 等写入或管理权限。
5. 脚本只按快照中的 `verification_targets[]` 生成固定的限列、限行摘要查询，不接收 SQL 文本，不使用 `SELECT *`。

任一条件不满足就停止实时核验。快照生成仍可继续，但 `generation-summary.json` 必须写 `read_only_verification: "not_provided"`，`pending-issues.md` 必须保留实时节点、审批字段实际写入时点和退回条件待核验。

导出文件继续使用 `cxsysys-read-only-verification-v1`，必须包含 `snapshot_sha256`（本次输入快照文件字节的 SHA-256）、`verified_at`、只读标记、权限摘要和非空的 `results[]`。每项结果只包含 `table`、`column`、`sampled_rows`、`non_null_rows`；表和字段必须在本次快照允许清单内，行数不得超过配置或20行，非空数不得超过抽样数，同一列不得重复。

生成脚本按实际核验到的列另记“实时已核验”证据，保留结构证据原有状态。`read_only_verification: "verified"` 仅表示核验文件及其列摘要通过检查，同时输出 `read_only_verification_scope: "sampled_columns_only"` 和 `verified_columns`。审批写入时点、工作流配置和退回条件仍保留专项核验问题。旧核验文件缺少快照摘要、时间或结果时拒绝使用，应在授权范围内重新导出；原文件不修改。

## 输出状态

`evidence-map.jsonl` 的 `status` 只允许：

- `结构已确认`：表、列、主明细关系等结构证据已确认。
- `配置已确认`：工作流节点、连线、列表或公式配置已确认。
- `实时已核验`：本轮用专用只读账号完成对应列的限行摘要查询，仅证明该列可查询及本次非空计数。
- `分析候选`：由结构或配置推导，尚未由业务人员确认。
- `待业务确认`：数据库不能证明，必须由业务人员决定。

## 写文件边界

生成脚本只写用户指定的新批次目录。目录已存在且非空时拒绝运行，不覆盖旧批次。数据库导出脚本只写指定的本地 JSON 文件，不修改数据库。

使用旧草稿时，先检查迁移后的结构及引用，再合并快照中新增的数据对象、字段和表单区域。人工术语、填写说明、来源关系、生命周期和迁移待定信息保留。旧行为或流程关系无法匹配、数据操作或字段来源相互冲突时，在写入输出目录前停止并指出冲突。字段证据通过稳定标识或对象内唯一的业务名称对应回快照物理列名；无法匹配的人工字段仍保留，并标记待业务确认。

主交付 JSON 按 `未审核-<归口部门或待确认部门>-<流程名称>-最终待核对-<YYYYMMDD>.json` 命名。归口部门为空时固定写“待确认部门”，不得把 `process-governance-v7` 等结构版本名称当成交付文件名。
