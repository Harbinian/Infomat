# .agents 说明

> 状态：Agent 协作配置目录  
> 生效日期：2026-06-11  
> 范围：本仓库内由 Agent 使用的项目技能和提示材料。

本目录保存仓库随附的 Agent 技能配置。它用于帮助 AI 助手理解 Infomat 的流程映射、证据映射和中文文本处理规则，不作为业务资料真源。

## 当前内容

| 路径 | 作用 |
|---|---|
| `skills/business-behavior-mapping/` | BBM/A1 业务行为映射兼容技能 |
| `skills/department-capability-mapping/` | DCM 部门能力流程系统映射兼容技能 |
| `skills/process-evidence-mapping/` | 只读取机器可读源文件，生成并校验 `document-structured-output-v2` 流程证据草稿；不可读来源阻断，不自动发布 |
| `skills/database-to-process-json/` | 仅在用户显式调用时，从指定的 `CXSYSYS.dbo` 表单结构快照生成一个使用业务文件名的未审核 V7 JSON 和证据包；审批等实际办理保留为业务行为，办理后的条件分叉另设判断节点；默认不连接数据库，实时核验只允许专用只读账号和固定摘要查询 |
| `skills/technical-chinese-writer/` | 中文技术、业务和管理文档的受控起草、改写、审校与压缩技能 |
| `skills/humanizer-zh/` | 仅在用户明确点名时使用的中文文风清理技能，不得替代受控写作 |

## 使用边界

1. 技能可以指导 AI 协作流程，但不能替代 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 和 `MAINLINE_MAP.md`。
2. 修改技能前，确认根目录 `AGENTS.md` / `CODEX.md` 是否需要同步说明触发场景。
3. 不在本目录放项目生成物、截图、运行日志或临时数据。
4. 新增技能时，写清适用场景、输入、输出和不适用边界。
5. `process-evidence-mapping` 的唯一机器主产物是 `document-structured-output-v2.json`；中间候选和 Markdown 视图不得替代标准合同或流程输入基线。
6. 中文正式交付物先使用 `technical-chinese-writer` 锁定事实和责任；`humanizer-zh` 只在用户点名时进行受限文风清理。
