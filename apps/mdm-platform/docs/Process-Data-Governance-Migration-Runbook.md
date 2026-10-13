# 流程版本后续数据治理迁移与恢复说明

## 1. 适用范围与运行条件

本指南说明六张工作包表的结构维护及恢复。是否已迁移、是否开启和是否验收，须分别核对目标实例，不沿用历史数量或阶段结论。

`PROCESS_DATA_GOVERNANCE_ENABLED=1`开启后，有权限的用户主动选择一个已发布原生V8或受支持V7版本建立工作包。旧`PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID`不再读取；`configured_process_version_id`兼容返回`null`，`scope_mode=published_v7_versions`保留机器值，实际格式由`primary_schema_version`及`supported_schema_versions`说明。既有工作包的来源、摘要、稳定标识和审核记录原样保留，不重建或回填。

`PROCESS_DATA_GOVERNANCE_READ_ONLY=1`只展示已完成包并拒绝工作包写入；缺省或`0`为办理模式，其他值拒绝访问并使ready不可用。这个参数不关闭预览及正式写入口；获准转为全流程只读时，还须分别核对`PROCESS_V7_PREVIEW_ENABLED`和`PROCESS_V7_FORMAL_ENABLED`。实际配置变更须有目标授权。

只读切换不需要DDL。获准执行时核对所保留包的完成状态、来源版本、状态响应、角色范围、正式正文和结论可读性，以及写入拒绝后行内容不变。未完成包不能为通过检查而改状态。历史单版本试点配置和阶段验证见文末历史快照。

## 2. 命令

在`apps/mdm-platform`目录运行：

```powershell
npm run migrate:process-data-governance:dry-run
npm run migrate:process-data-governance:apply
npm run migrate:process-data-governance:rollback
```

三个命令必须显式选择其一。脚本不会把没有参数的执行默认为应用迁移。

三个CLI均调用`loadFixedMysqlEnvironment`并读取固定配置及可能存在的私有env，没有显式`--target`保障，不能只凭dry-run名称执行。本次正式状态查询优先使用已准备的`inspect:launch-stage06 -- --target <获准准确目标> --output <获准新目录>`；其正式读取仍须独立批准。以后执行本节旧迁移CLI前，必须在批准的新发布布局中冻结并核对非敏感固定配置，确认该布局私有env不存在，再通过获准环境注入凭据；否则停止，不读取私有文件、不修改旧工作区或自动改目标。每一步退出非零均停止，错误先受控保存再脱敏。

## 3. 应用前门槛

执行`apply`前必须同时具备：

1. 已确认数据库实例、库名和维护窗口；
2. 已完成全库备份，并在隔离实例验证可以恢复；
3. dry-run返回`not_applied`，没有`partial_structure`、`record_without_structure`、`structure_without_record`或`schema_drift`；
4. 已按本次读取授权记录现有已发布版本的实际数量、关键标识、来源摘要和引用，不自动生成工作包；
5. 已确认迁移只建立空表，工作包随后由有权限的用户选择实际已发布版本建立，不预填版本ID；
6. 功能开关保持关闭，应用迁移期间没有用户进入工作包操作；
7. 已安排失败后的恢复负责人和停止条件。

缺少任一条件时停止，不通过补表、补迁移记录或改环境变量掩盖问题。

## 4. 应用步骤

1. 再次执行dry-run并保存脱敏结果。
2. 停止可能写入3000的业务操作，确认备份时间晚于最后一次业务写入。
3. 执行`npm run migrate:process-data-governance:apply`。
4. 再次执行dry-run，结果必须为`applied`，六张表结构摘要全部匹配，行数均为0。
5. 核对迁移前后的已发布流程版本数量、`process_design_versions`关键摘要和引用关系一致。
6. 开启前在隔离环境验证多个已发布版本、固定来源、重复建立及角色权限。
7. 按本次授权设置`PROCESS_DATA_GOVERNANCE_ENABLED=1`，重启3000并验证`GET /api/ready`和`GET /api/process-data-governance/status`。无需填写旧试点版本配置；页面无已发布的受支持原生版本时显示空状态，不自动补建。

迁移只建空表和写入迁移键，不回填历史工作包。

## 5. 重复执行

结构和迁移记录均匹配时，再次执行`apply`只返回当前检查结果，不重复建表、不新增迁移记录、不创建工作包。

出现以下状态时`apply`必须停止：

- `partial_structure`：只有部分表存在；
- `record_without_structure`：迁移记录存在但表缺失；
- `structure_without_record`：表完整但迁移记录缺失；
- `schema_drift`：目标表结构与当前代码不一致。

这些状态必须由数据库负责人核查实际对象和备份，不能让脚本自动修复。

## 6. 为所选已发布版本建立工作包

迁移完成且功能开启后，MDM工作组在页面选择已发布的原生V8或受支持V7版本；页面调用以下公开接口：

```text
POST /api/process-data-governance/creation-tasks/reconcile
```

请求必须携带所选`process_version_id`。重复建立返回既有工作包。版本不是原生V8或受支持V7、不是已发布或历史已发布状态、来源内容不可读取或摘要不匹配时拒绝，不替换旧工作包的来源。

建立过程只读取所选正式版本，不读取原始3001文件，不修改流程正文，不自动为其他版本创建工作包。

## 7. 回退

只有六张表全部为空时，才可以执行：

```powershell
npm run migrate:process-data-governance:rollback
```

回退按事件、审核、事实问题、明细、工作包和创建任务的依赖顺序删除空表，最后删除迁移记录。执行后再次dry-run，结果必须为`not_applied`。

任一表有行时，命令返回`PROCESS_DATA_GOVERNANCE_ROLLBACK_NONEMPTY`并停止。此时：

- 立即关闭功能开关；
- 保留数据库和审计记录；
- 根据故障影响选择从已验证备份恢复或编制补偿迁移；
- 未获得数据恢复授权前不得删表、清空或直接删除迁移记录。

## 8. 必须验证的四类场景

| 场景 | 验证内容 |
|---|---|
| 上一状态进入当前结构 | 在迁移前结构上执行dry-run和apply；以本次基线登记的历史版本不被自动改写或回填 |
| 多版本往返 | 分别选择两个已发布版本建立工作包、生成候选并重新读取；两个工作包独立，各自`process_version_id`和来源摘要不变 |
| 重复执行 | 重复apply和重复补建均幂等；不出现第二个工作包或重复明细 |
| 失败恢复 | 模拟部分DDL、来源摘要变化、并发修订冲突和非空回退；系统停止并保留恢复路径 |

## 9. 迁移后核对

- 六张表的结构摘要与当前代码一致。
- 迁移键唯一且时间可追溯。
- 迁移前后已发布流程版本数量一致，流程内容摘要未变化。
- 功能关闭时工作包业务接口返回503，页面展示关闭状态；开启后无需配置试点版本，没有已发布的受支持原生版本时显示空列表。
- 配置错误或版本范围不一致时返回范围拒绝，不创建任务或工作包。
- `admin`写入返回403；MDM工作组和目标业务部门分别只能执行自己的动作。
- 浏览器关闭或切换带未提交内容的蒙版弹窗时出现保护提示。

## 历史追溯

整理前原文、阶段记录和已废止说明保留在[历史快照](../../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/docs/Process-Data-Governance-Migration-Runbook.md.before.txt)。仅在核对决策依据、兼容或历史问题时读取；它不覆盖本文的当前说明。
