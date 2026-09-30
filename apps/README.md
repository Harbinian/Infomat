# apps 说明

> 状态：可运行应用集合目录  
> 生效日期：2026-06-10  
> 范围：仓库内可运行应用、应用源码、应用内测试和应用维护脚本。

本目录只放可运行应用。业务资料、流程输入基线、PMO 页面和仓库级脚本不要放进应用目录。

## 当前应用

| 应用 | 说明 | 入口 |
|---|---|---|
| `mdm-platform/` | MDM 平台承接应用 | `apps/mdm-platform/README.md` |
| `structured-output-service/` | 局域网3001单流程治理编制工具，本工作区默认导出`process-governance-v8`候选，无状态兼容导入v1至v8及已支持历史文件；实际服务状态须实时核对 | `apps/structured-output-service/README.md` |
| `information-collection-service/` | 内部信息表收集服务，4000 用于表单设计和任务管理，4001 用于员工填报；业务数据写入独立 `collection_*` 表 | `apps/information-collection-service/README.md` |

## 使用边界

1. 修改 MDM 平台代码、接口、数据库、前端或应用内脚本时，进入 `apps/mdm-platform/`。
2. 修改3001单流程治理编制工具时，进入 `apps/structured-output-service/`，使用V8当前技术规则；V1至V7及已支持历史格式保留各自校验和迁移边界。`docs/contracts/`只说明技术兼容，不决定业务事实；流程映射和花名册副本只读消费。
5. 修改信息表收集服务时，进入 `apps/information-collection-service/`；身份数据只读复用现有 MySQL，信息收集权限和业务数据不得写入 MDM 治理表。
6. 组织、人员和职责以用户指定的外部原始材料及明确确认记录为依据；`docs/organization/`保留历史资料和转换副本。
7. 当前流程由3001编制，用户下载后上传3000治理并形成正式版本；`docs/norms/`及旧快照不作为当前治理依据，也不据此自动同步数据库。
8. 跨应用、跨 PMO 或跨资料的脚本放在根目录 `scripts/`。
9. 新增应用前，必须新增应用级 README，写清运行命令、数据边界、测试入口和禁止提交的本地状态。
