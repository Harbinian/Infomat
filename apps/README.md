# apps 说明

> 状态：可运行应用集合目录  
> 生效日期：2026-06-10  
> 范围：仓库内可运行应用、应用源码、应用内测试和应用维护脚本。

本目录只放可运行应用。业务资料、流程输入基线、PMO 页面和仓库级脚本不要放进应用目录。

## 当前应用

| 应用 | 说明 | 入口 |
|---|---|---|
| `mdm-platform/` | MDM 平台承接应用 | `apps/mdm-platform/README.md` |
| `structured-output-service/` | 局域网单流程治理编制工具，按 `process-governance-v1` 结构规则提供无状态新建、历史文件迁移、岗位选择、流程图预览和单流程 JSON 导入导出 | `apps/structured-output-service/README.md` |
| `weekly-action-service/` | PMO 周会行动项服务，本地 3002，保存每周例会行动项、风险、问题、变更和责任池事项的服务端本机台账 | `apps/weekly-action-service/README.md` |

## 使用边界

1. 修改 MDM 平台代码、接口、数据库、前端或应用内脚本时，进入 `apps/mdm-platform/`。
2. 修改3001单流程治理编制工具时，进入 `apps/structured-output-service/`，并以 `docs/contracts/process-governance-v1.schema.json` 为当前导出结构规则；`document-structured-output-v2` 只用于确定性解析和历史导入。如读取流程映射或花名册，只能只读消费 `docs/norms/*映射关系.md` 和 `docs/organization/花名册.md`。
3. 修改 PMO 周会行动项服务时，进入 `apps/weekly-action-service/`；该服务只保存运行台账，不写回 PMO Markdown 真源、`tasks.json` 或 MDM 数据库。
4. 组织资料以 `docs/organization/` 下的真源为准。
5. 流程映射以 `docs/norms/` 下的输入基线为准；应用只消费快照或同步结果。
6. 跨应用、跨 PMO 或跨资料的脚本放在根目录 `scripts/`。
7. 新增应用前，必须新增应用级 README，写清运行命令、数据边界、测试入口和禁止提交的本地状态。
