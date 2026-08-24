# 输入、输出与实时核验规则

## 结构快照

快照使用 `database-process-evidence-v1`，至少包含：

- `database`：固定为 `CXSYSYS`。
- `schema`：固定为 `dbo`。
- `captured_at`、`snapshot_digest`、`source_summary`。
- `forms[]`：表单标识、业务名称、主表、物理表到业务对象和表单区域的对应关系。
- `workflows[]`：工作流标识、适用主表、节点、连线、角色候选、数据操作和判断读取字段。
- `term_candidates[]`：从业务字段和列表规范筛选出的术语候选。
- `pending_issues[]`：数据库不能证明的业务事实。
- `verification_targets[]`：可选，只读实时核验允许查看的表和字段；每个目标最多20行，只输出非空数量等摘要，不输出原值。

快照不得包含连接字符串、密码、令牌、人员联系方式或原始人员记录。技术字段使用 `classification: "technical"`，生成时必须排除。

## 实时只读门

只有同时满足下列条件才运行 `export-cxsysys-readonly-snapshot.ps1`：

1. 用户在当前任务中明确授权实时只读核验。
2. 连接信息通过 `INFOMAT_CXSYSYS_READONLY_CONNECTION_STRING` 环境变量提供；不得读取 `.env` 或在命令行显示连接值。
3. 连接数据库为 `CXSYSYS`、默认架构为 `dbo`。
4. 账号不是 `sysadmin`、`db_owner`，有效数据库权限不含 `INSERT`、`UPDATE`、`DELETE`、`ALTER`、`CONTROL`、`CREATE TABLE`、`EXECUTE` 等写入或管理权限。
5. 脚本只按快照中的 `verification_targets[]` 生成固定的限列、限行摘要查询，不接收 SQL 文本，不使用 `SELECT *`。

任一条件不满足就停止实时核验。快照生成仍可继续，但 `generation-summary.json` 必须写 `read_only_verification: "not_provided"`，`pending-issues.md` 必须保留实时节点、审批字段实际写入时点和退回条件待核验。

## 输出状态

`evidence-map.jsonl` 的 `status` 只允许：

- `结构已确认`：表、列、主明细关系等结构证据已确认。
- `配置已确认`：工作流节点、连线、列表或公式配置已确认。
- `实时已核验`：本轮用专用只读账号完成限列限行核验。
- `分析候选`：由结构或配置推导，尚未由业务人员确认。
- `待业务确认`：数据库不能证明，必须由业务人员决定。

## 写文件边界

生成脚本只写用户指定的新批次目录。目录已存在且非空时拒绝运行，不覆盖旧批次。数据库导出脚本只写指定的本地 JSON 文件，不修改数据库。
