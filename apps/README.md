# apps 说明

> 状态：可运行应用集合目录  
> 生效日期：2026-06-10  
> 范围：仓库内可运行应用、应用源码、应用内测试和应用维护脚本。

本目录只放可运行应用。业务资料、流程输入基线、PMO 页面和仓库级脚本不要放进应用目录。

## 当前应用

| 应用 | 说明 | 入口 |
|---|---|---|
| `mdm-platform/` | MDM 平台承接应用 | `apps/mdm-platform/README.md` |
| `structured-output-service/` | 局域网3001单流程治理编制工具，默认导出`process-governance-v7`，无状态兼容导入v1至v7及历史多流程文件 | `apps/structured-output-service/README.md` |
| `information-collection-service/` | 内部信息表收集服务，4000 用于表单设计和任务管理，4001 用于员工填报；业务数据写入独立 `collection_*` 表 | `apps/information-collection-service/README.md` |

## 使用边界

1. 修改 MDM 平台代码、接口、数据库、前端或应用内脚本时，进入 `apps/mdm-platform/`。
2. 修改3001单流程治理编制工具时，进入 `apps/structured-output-service/`，并以 `docs/contracts/process-governance-v7.schema.json` 为当前导出结构规则；v1至v6和`document-structured-output-v2`只用于兼容迁移与确定性解析。如读取流程映射或花名册，只能只读消费对应仓库资料。
5. 修改信息表收集服务时，进入 `apps/information-collection-service/`；身份数据只读复用现有 MySQL，信息收集权限和业务数据不得写入 MDM 治理表。
6. 组织资料以 `docs/organization/` 下的真源为准。
7. 流程映射以 `docs/norms/` 下的输入基线为准；应用只消费快照或同步结果。
8. 跨应用、跨 PMO 或跨资料的脚本放在根目录 `scripts/`。
9. 新增应用前，必须新增应用级 README，写清运行命令、数据边界、测试入口和禁止提交的本地状态。
