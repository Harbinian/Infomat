# 流程版本后续数据治理迁移与恢复说明

## 1. 当前结论

本轮只完成了dry-run。2026年8月27日对固定MySQL实例`localhost:3307/infomat_mdm`的只读结果为：

- `migration_recorded=false`；
- `consistency_status=not_applied`；
- 六张目标表均不存在；
- 当前有11个已发布流程版本；
- 当前工作包数量为0。

本轮没有运行`--apply`或`--rollback`，没有开启功能开关，也没有选择试点`process_version_id`。

## 2. 命令

在`apps/mdm-platform`目录运行：

```powershell
npm run migrate:process-data-governance:dry-run
npm run migrate:process-data-governance:apply
npm run migrate:process-data-governance:rollback
```

三个命令必须显式选择其一。脚本不会把没有参数的执行默认为应用迁移。

## 3. 应用前门槛

执行`apply`前必须同时具备：

1. 已确认数据库实例、库名和维护窗口；
2. 已完成全库备份，并在隔离实例验证可以恢复；
3. dry-run返回`not_applied`，没有`partial_structure`、`record_without_structure`、`structure_without_record`或`schema_drift`；
4. 已记录11个现有已发布版本的数量和关键标识，但不自动生成工作包；
5. 业务负责人和MDM工作组已经确认唯一试点`process_version_id`；
6. 功能开关保持关闭，应用迁移期间没有用户进入试点操作；
7. 已安排失败后的恢复负责人和停止条件。

缺少任一条件时停止，不通过补表、补迁移记录或改环境变量掩盖问题。

## 4. 应用步骤

1. 再次执行dry-run并保存脱敏结果。
2. 停止可能写入3000的业务操作，确认备份时间晚于最后一次业务写入。
3. 执行`npm run migrate:process-data-governance:apply`。
4. 再次执行dry-run，结果必须为`applied`，六张表结构摘要全部匹配，行数均为0。
5. 核对迁移前后的已发布流程版本数量、`process_design_versions`关键摘要和引用关系一致。
6. 不立即打开功能。先在隔离环境完成试点流程补建和角色验收。
7. 正式试点启用时，同时配置开关和唯一版本标识，再重启3000并验证`GET /api/process-data-governance/status`。

迁移只建空表和写入迁移键，不回填历史工作包。

## 5. 重复执行

结构和迁移记录均匹配时，再次执行`apply`只返回当前检查结果，不重复建表、不新增迁移记录、不创建工作包。

出现以下状态时`apply`必须停止：

- `partial_structure`：只有部分表存在；
- `record_without_structure`：迁移记录存在但表缺失；
- `structure_without_record`：表完整但迁移记录缺失；
- `schema_drift`：目标表结构与当前代码不一致。

这些状态必须由数据库负责人核查实际对象和备份，不能让脚本自动修复。

## 6. 试点旧版本补建

迁移完成后，MDM工作组只能通过公开接口对配置中的唯一试点版本执行补建：

```text
POST /api/process-data-governance/creation-tasks/reconcile
```

请求必须携带精确`process_version_id`。重复补建返回既有工作包。版本不是V7、不是不可变正式状态、与试点配置不一致或来源摘要不可读取时停止。

补建过程不读取原始3001文件，不修改流程版本正文，不向其他10个历史版本扩散。

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
| 上一状态进入当前结构 | 在迁移前结构上执行dry-run和apply；11个历史版本不被自动改写或回填 |
| 当前版本往返 | 唯一试点版本补建后读取工作包、生成候选并重新读取；`process_version_id`和来源摘要不变 |
| 重复执行 | 重复apply和重复补建均幂等；不出现第二个工作包或重复明细 |
| 失败恢复 | 模拟部分DDL、来源摘要变化、并发修订冲突和非空回退；系统停止并保留恢复路径 |

## 9. 迁移后核对

- 六张表的结构摘要与当前代码一致。
- 迁移键唯一且时间可追溯。
- 迁移前后已发布流程版本数量一致，流程内容摘要未变化。
- 未配置试点时数据生命周期治理入口不可见，业务接口返回503。
- 配置错误或版本范围不一致时返回范围拒绝，不创建任务或工作包。
- `admin`写入返回403；MDM工作组和目标业务部门分别只能执行自己的动作。
- 浏览器关闭或切换带未提交内容的蒙版弹窗时出现保护提示。

