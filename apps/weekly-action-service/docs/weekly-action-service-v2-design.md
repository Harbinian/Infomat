# 3002 周会行动项服务 v2 设计基线

> 状态：已确认设计基线，尚未实现  
> 生效日期：2026-07-06  
> 主责目录：`apps/weekly-action-service/`  
> 运行数据目录：`artifacts/weekly-actions/`  
> 适用范围：PMO 周例会会后跟踪、行动项台账、责任池、材料缺口、制度或表单待补、后续访谈、MDM 现有入口跟踪。

## 1. 背景

`DLV-006-首次周例会会议材料.html` 第 10 条把会后跟踪分为六个去向：行动项台账、责任池、材料缺口清单、制度或表单待补说明、后续访谈清单、MDM 现有入口。当前 3002 v1 只提供简化行动项登记，存在以下断层：

- 甘特图事项需要通过周例会行动项落地，但行动项缺少完整的会后管理工具。
- 周会事项跨周后容易从当前视图消失。
- 责任方只有文本字段，无法锁定部门、岗位、姓名、项目组织和事项角色。
- 关闭证据、延期、核验、退回和升级没有完整留痕。
- 5173 管周会内容，3002 管会后行动项台账，两者边界需要固定。

v2 的目标是把 3002 建成“会后跟踪统一入口/总账”，而不是正式会议纪要系统、PMO 正本生成器或人事系统。

## 2. 边界

### 2.1 3002 可以做

- 管理会后整理录入、候选事项确认、正式事项池。
- 管理六类跟踪去向的责任、状态、证据、延期、暂缓、升级、关闭和作废。
- 只读使用人员快照，辅助选择当前操作人、主责任人、协作人、PMO 跟踪人、PMO 核验人和升级接收人。
- 保存事项当前状态、全局审计事件流、证据附件索引、会议草稿、导出记录。
- 生成周会复盘包、责任穿透清单和运行导出。

### 2.2 3002 不可以做

- 不写回 `pmo/` 下的 Markdown 真源。
- 不写回 `pmo/tasks.json` 或 `pmo/gantt-react/public/tasks.json`。
- 不写 MDM 数据库。
- 不写回 `docs/organization/花名册.md`、`docs/organization/组织架构和部门职责.md` 或 `docs/organization/信息化项目人员角色映射.md`。
- 不接 SQLite。
- v2 第一版不接 MySQL。
- 不自动生成正式会议纪要、PMO DLV 或受控交付物。
- 不做 5173 到 3002 的自动同步。
- 不做飞书、邮件或短信外发提醒。

## 3. 总体数据流

```text
docs/organization/信息化项目人员角色映射.md
  ↓ 手动运行仓库脚本
artifacts/weekly-actions/personnel-snapshot.json
  ↓ 3002 只读
当前操作人 / 责任分派 / 核验人 / 升级接收人

5173 周会内容或人工会议摘录
  ↓ 人工粘贴到 3002 会后整理录入区
候选事项
  ↓ 逐条人工确认
3002 正式事项池
  ↓ 证据、延期、核验、升级、复盘、导出
周会复盘包 / 责任穿透清单 / 运行导出
```

## 4. v2 运行目录

```text
artifacts/weekly-actions/
  weekly-action-ledger-v2.json
  personnel-snapshot.json
  evidence/{itemId}/{evidenceId}/...
  meeting-drafts/{meetingWeekId}/{draftId}.json
  intakes/{intakeId}.json
  exports/{exportId}.json
```

规则：

- `weekly-action-ledger-v2.json` 只保存事项当前状态、全局审计事件流和轻量索引。
- `personnel-snapshot.json` 是只读人员快照，由脚本从组织映射真源生成。
- 证据附件只放在 `evidence/`，不进入 PMO 正本目录。
- 会议草稿、整理录入批次和导出材料独立保存，台账事件引用对应 ID。
- `artifacts/` 下运行数据默认不提交。

## 5. 人员快照

### 5.1 生成方式

- 人员快照由仓库脚本从 `docs/organization/信息化项目人员角色映射.md` 生成。
- 生成动作必须手动触发，3002 不自动解析 Markdown 真源。
- 快照输出到 `artifacts/weekly-actions/personnel-snapshot.json`。
- 如果快照不存在，3002 允许创建事项草稿，但正式责任分派受限。

### 5.2 快照元数据

快照必须包含：

| 字段 | 含义 |
|---|---|
| `snapshotId` | 本次快照批次 ID |
| `schemaVersion` | 快照结构版本 |
| `generatedAt` | 生成时间 |
| `generatedBy` | 生成操作人 |
| `sourceFiles` | 来源文件列表 |
| `sourceHash` | 来源内容哈希 |
| `rowCount` | 映射行数量 |
| `warningCount` | 警告数量 |
| `warnings` | 生成警告 |
| `people` | 按人员聚合的基础信息 |
| `personRoles` | 可被 3002 选择的人员项目角色 |

### 5.3 `personRoleKey`

`personRoleKey` 由生成脚本确定性生成，不在 Markdown 中手填。

- 已匹配花名册人员：`EMP-{工号}__ORG-{项目组织编码}__ROLE-{项目角色编码}`
- 花名册待补人员：`PENDING-{姓名哈希}__ORG-{项目组织编码}__ROLE-{项目角色编码}`
- 同一人多个项目角色生成多条 `personRoleKey`。
- 人、项目组织、项目角色本质不变时，脚本应保持 key 稳定。
- 角色本质变化时生成新 key，旧 key 只服务历史事项。

### 5.4 质量门

硬性失败：

- 映射表写 `已匹配花名册`，但 `花名册.md` 找不到姓名。
- 工号、部门、职务与 `花名册.md` 不一致。
- 同一 `personRoleKey` 被两行生成。
- `已撤销` 人员被标为可选。

允许生成但必须警告：

- `花名册待补`，且工号、部门、职务均为 `待花名册确认`。
- `暂定` 或 `待确认` 角色存在。
- 来源可信度为 `中：PMO运行材料` 或 `待确认：需补花名册`。

### 5.5 可选规则

- `已匹配花名册` 且非暂定：可作为主业务责任人、协作人、PMO 跟踪人、PMO 核验人。
- `暂定`：可选，界面显示“暂定”。
- `花名册待补`：可选，但不能作为默认主业务责任人；若选为主责任人，必须关联或生成 `人员信息待校正` 事项。
- `待确认`：可选为协作人或访谈对象，不建议作为关闭责任人。
- `已撤销`：不进入可选列表，只保留历史事项快照。

### 5.6 快照缺失或过期

- 快照不存在：允许录入事项草稿，责任人只能为 `待分派`。
- 快照有警告：允许分派，但选人时显示标记。
- 快照生成超过 14 天：允许使用，顶部提示“人员快照可能过期”。
- 新快照不自动改已有事项责任人，只提示差异。

## 6. 轻量身份与动作限制

### 6.1 当前操作人

- 进入 3002 时先选择“我是谁”，来源于人员快照。
- 浏览器保存当前身份，用于自动填写 `createdBy`、`updatedBy`、`verifiedBy`、`assignedBy`。
- 未选择当前操作人时，只能浏览，不能新增、核验、关闭、变更责任或作废。
- 所有操作事件写入 `operatorPersonRoleKey`、`operatorSnapshot`、`operatedAt`、`operationType`。

### 6.2 轻量动作限制

动作限制按人员快照中的 `项目组织 + 项目角色` 与事项责任关系判断。

| 操作对象 | 可执行动作 |
|---|---|
| 信息化项目管理工作室或 PMO 运行分工中的会议组织、行动项跟踪、逾期提醒、风险升级人员 | 新增、分派、退回、核验、关闭、升级、审批延期、确认暂缓、作废 |
| 主业务责任人 | 更新进展、提交证据、提交延期申请、补充说明 |
| 协作人 | 补充说明、上传证据 |
| 项目决策组 | 处理升级结论、重大争议、考核候选确认 |
| 花名册待补或待确认身份 | 不能作为 PMO 核验人或关闭操作人 |

普通业务责任人不能自行关闭事项。

## 7. 正式事项池

### 7.1 跟踪去向

统一事项池支持六类跟踪去向：

1. 行动项台账
2. 责任池
3. 材料缺口清单
4. 制度或表单待补说明
5. 后续访谈清单
6. MDM 现有入口

同一事项可以调整跟踪去向，但调整必须记录事件。

### 7.2 状态机

v2 状态：

| 状态 | 口径 |
|---|---|
| `待分派` | 会后整理形成但责任未定，必须写原因和 PMO 下一步确认动作 |
| `处理中` | 责任已确认，正在推进 |
| `待核验` | 业务责任人提交完成和证据，等待 PMO 核验 |
| `需升级` | 逾期、责任争议、无响应或影响重大，需要升级 |
| `暂缓` | 经 PMO 确认暂不推进，必须有暂缓原因和恢复条件 |
| `已关闭` | PMO 核验证据充分后关闭 |
| `已作废` | 误录或不作为正式跟踪事项，保留审计记录 |

主要流转：

```text
待分派 -> 处理中 -> 待核验 -> 已关闭
待核验 -> 处理中
处理中 / 待分派 / 待核验 -> 需升级
处理中 / 需升级 -> 暂缓
暂缓 -> 处理中
任意非关闭状态 -> 已作废
```

### 7.3 责任字段

每个事项拆分责任字段：

- `primaryResponsible`：主业务责任人，必须具体到姓名、花名册部门、花名册职务、项目组织、本事项角色。
- `collaborators`：协作人，可多选。
- `pmoTracker`：PMO 跟踪人。
- `pmoVerifier`：PMO 核验人。
- `escalationReceivers`：升级接收人。
- `assignmentHistory` 或 `historyRefs`：责任变化留痕。

每个责任字段同时保存：

- `personRoleKey`
- `snapshotId`
- `assignmentSnapshot`
- `assignedAt`
- `assignedBy`
- `assignmentReason`

### 7.4 创建必填规则

通用必填：

- 标题
- 跟踪去向
- 来源
- 状态
- PMO 跟踪人
- 截止日期或无需截止日期说明
- 关闭证据要求

按去向追加：

| 跟踪去向 | 追加必填 |
|---|---|
| 行动项台账 | 主业务责任人 |
| 责任池 | 责任边界待确认对象或待分派原因 |
| 材料缺口清单 | 材料名称、材料提供责任人 |
| 制度或表单待补说明 | 涉及制度/表单、待补位置或问题 |
| 后续访谈清单 | 访谈对象、计划时间 |
| MDM 现有入口 | 入口页面/记录/字段说明、确认人 |

## 8. 会后整理录入

### 8.1 人工确认导入

- 5173 管甘特图、周会内容上下文、计划视图和会议材料辅助。
- 3002 管会后事项、责任、证据、核验、延期、升级和复盘。
- 5173 到 3002 不做自动同步。
- 3002 提供会后整理录入区，人工粘贴候选事项文本。
- 每个候选项必须人工确认后才能进入正式事项池。

### 8.2 录入批次

每批录入保存：

- `intakeId`
- `sourceType`
- `sourceTitle`
- `sourceText`
- `createdBy`
- `createdAt`
- `candidateItems`
- 候选项 `originalExcerpt`
- 人工修改记录
- 确认人和确认时间
- 被排除候选项的排除原因

候选项被确认后，正式事项保存 `intakeId` 和 `originalExcerpt`。

### 8.3 两张轻模板

会议纪要摘录模板：

- 原话/摘录
- 来源
- 发言人或来源对象
- 涉及项目组织
- 涉及事项
- 明确结论
- 潜在行动项
- 需确认问题

会后整理摘要模板：

- 候选事项标题
- 跟踪去向
- 原始摘录
- 主业务责任人
- PMO 跟踪人
- 截止日期
- 关闭证据要求
- 风险/升级条件
- 是否需上会复盘

模板只帮助整理候选事项，不替代正式会议纪要。

## 9. 证据、延期、暂缓、作废

### 9.1 证据清单

关闭证据结构化为清单。每条证据保存：

- `evidenceId`
- `submittedBy`
- `submittedAt`
- `evidenceType`
- `title`
- `description`
- `filePath` 或 `recordLink`
- `fileHash`
- `fileSize`
- `relatedDestination`
- `verificationStatus`
- `verifiedBy`
- `verifiedAt`
- `verificationNote`

证据附件保存到：

```text
artifacts/weekly-actions/evidence/{itemId}/{evidenceId}/
```

### 9.2 延期申请

延期申请作为独立子记录保存：

- `requestId`
- `requestedBy`
- `requestedAt`
- `oldDueDate`
- `newDueDate`
- `reason`
- `impact`
- `recoveryAction`
- `pmoDecision`
- `decidedBy`
- `decidedAt`
- `decisionNote`

只有 PMO 审批通过后，事项 `dueDate` 才更新。

### 9.3 暂缓

暂缓必须经 PMO 确认：

- `suspendReason`
- `approvedBy`
- `approvedAt`
- `resumeCondition`
- `reviewDate`
- `impactNote`

暂缓事项仍进入周会复盘视图。暂缓不能直接关闭，必须先恢复到 `处理中` 或形成正式关闭依据。

### 9.4 作废

- 事项创建后不允许物理删除。
- 误录项执行 `作废`，必须填写作废原因。
- 已有证据、延期申请或核验记录的事项作废时，必须说明为何不作为正式跟踪事项。
- 附件不随事项作废物理删除。

## 10. 考核候选

3002 只标记考核候选，不自动判定考核结果。

触发规则：

- 逾期且无批准延期。
- 关闭证据被退回后仍无补正。
- `需升级` 后超过约定时间无响应。
- 同一责任人或同一项目组织重复出现同类问题。
- 待分派事项超过 1 个工作日仍无责任确认。
- 暂缓复核到期仍无恢复或正式说明。
- PMO 标记材料质量明显不足。

是否纳入考核由 PMO 或项目决策组人工确认。`花名册待补` 或 `待确认` 身份不能直接进入个人考核，必须先走人员信息校正或责任边界确认。

## 11. 审计事件流

v2 台账采用“事项当前状态 + 全局审计事件流”。

`weekly-action-ledger-v2.json` 结构：

```json
{
  "version": 2,
  "items": [],
  "events": []
}
```

每个事件至少包含：

- `eventId`
- `itemId`
- `eventType`
- `operatorPersonRoleKey`
- `operatorSnapshot`
- `operatedAt`
- `before`
- `after`
- `reason`
- `sourceSnapshotId`
- `relatedIds`

事件流记录创建、候选确认、分派、责任变更、进展、证据、核验、退回、延期、延期审批、升级、暂缓、恢复、关闭、作废、导出、会议草稿生成和 v1 迁移。

## 12. v2 业务动作接口

v2 写操作按业务动作拆分，不再依赖通用 `PUT /api/items/:id`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态 |
| GET | `/api/meta` | 类型、状态、周期、快照状态 |
| GET | `/api/personnel-snapshot` | 当前人员快照摘要和可选人员 |
| POST | `/api/current-operator` | 设置当前操作身份 |
| GET | `/api/items` | 查询事项，默认跨周显示未关闭和风险项 |
| POST | `/api/items` | 创建正式事项 |
| POST | `/api/intakes` | 创建会后整理录入批次 |
| POST | `/api/intakes/:id/confirm` | 确认候选项进入事项池 |
| POST | `/api/items/:id/assign` | 分派或变更责任 |
| POST | `/api/items/:id/progress` | 更新进展 |
| POST | `/api/items/:id/evidence` | 提交证据 |
| POST | `/api/items/:id/verify` | PMO 核验证据或退回 |
| POST | `/api/items/:id/delay-requests` | 提交延期申请 |
| POST | `/api/items/:id/delay-requests/:requestId/decide` | PMO 审批延期 |
| POST | `/api/items/:id/escalate` | 升级 |
| POST | `/api/items/:id/suspend` | 暂缓 |
| POST | `/api/items/:id/resume` | 恢复 |
| POST | `/api/items/:id/close` | 关闭 |
| POST | `/api/items/:id/void` | 作废 |
| POST | `/api/meeting-drafts` | 生成复盘草稿 |
| POST | `/api/exports` | 生成运行导出 |

每个写接口都必须做身份校验、状态校验、必填校验、动作权限校验和审计事件记录。

## 13. 前端视图

第一版固定三个视图。

### 13.1 PMO 工作台

显示：

- 待分派
- 待核验
- 延期待审批
- 逾期
- 需升级
- 证据退回
- 暂缓到期复核
- 人员快照警告

### 13.2 周会复盘包

默认跨周滚动，纳入：

- 上次周会以来新增事项
- 上周期未关闭事项
- 本周期已提交待核验事项
- 本周期已关闭事项
- 逾期未关闭事项
- 需升级事项
- 待分派事项
- 暂缓到复核日期事项
- 延期申请待审批事项
- 人员信息待校正事项
- 建议带上会讨论事项

### 13.3 责任穿透视图

按项目组织、部门、岗位、姓名展示：

- 未关闭事项
- 逾期事项
- 证据退回
- 延期申请
- 需升级事项
- 考核候选
- 关闭质量

### 13.4 事项详情

事项详情按工作流步骤组织：

- 基本信息
- 责任分派
- 进展记录
- 证据清单
- 延期与暂缓
- 升级与考核候选
- 审计历史
- 来源摘录

## 14. 站内提醒

第一版只做站内提醒和复盘包提示。

- 到期前 1 个工作日：即将到期。
- 到期当日未提交证据：今日到期。
- 超过截止日期且无批准延期：逾期。
- 逾期超过 1 个工作日仍无进展：建议需升级。
- 待核验超过 1 个工作日未处理：提醒 PMO 核验。
- 延期申请超过 1 个工作日未审批：提醒 PMO 处理。
- 暂缓到复核日期：需复核。

## 15. 会议草稿与运行导出

### 15.1 会议草稿

会议草稿保存到：

```text
artifacts/weekly-actions/meeting-drafts/{meetingWeekId}/{draftId}.json
```

草稿字段：

- `draftId`
- `meetingWeekId`
- `generatedAt`
- `generatedBy`
- `includedItemIds`
- `excludedItemIds`
- `exclusionReasons`
- `sections`
- `status`
- `note`

草稿只能作为运行草稿，不能替代正式纪要或 DLV。

### 15.2 运行导出

第一版导出两类：

- 周会复盘包导出
- 责任穿透清单导出

导出到：

```text
artifacts/weekly-actions/exports/
```

导出文件必须标记“3002 运行导出，非正式会议纪要/非 PMO 受控交付物”，并保存 `exportId`、`generatedAt`、`generatedBy`、`sourceLedgerVersion`、`includedItemIds`。

## 16. v1 迁移

- v2 新台账文件为 `weekly-action-ledger-v2.json`。
- v1 文件 `weekly-action-ledger-v1.json` 保留，不覆盖、不删除。
- 如果只有 v1，3002 提示“发现旧台账，可迁移为 v2”。
- 迁移动作必须人工触发。
- 迁移生成 v2 后，每条旧事项写入 `legacyImported` 审计事件。
- v1 的 `owner` 映射为临时文本责任，状态为 `待分派` 或 `处理中`，由 PMO 后续重新绑定人员快照。
- 迁移后 v1 只作为备份，不再写入。

## 17. 第一版验收样例

第一版必须用一条端到端样例事项证明闭环：

1. 生成并读取人员快照。
2. 选择当前操作人。
3. 创建会后整理录入批次。
4. 从候选项确认生成正式事项。
5. 分派主业务责任人、PMO 跟踪人、PMO 核验人。
6. 业务责任人提交进展和证据。
7. PMO 退回一次证据。
8. 业务责任人补充证据。
9. 提交延期申请并由 PMO 审批。
10. PMO 核验通过并关闭。
11. 生成周会复盘包和责任穿透导出。
12. 审计事件能串起以上每一步。

## 18. 第一版实施阶段

1. 人员快照生成与校验。
2. v2 台账与事件流。
3. 业务动作接口。
4. 前端三视图和事项详情。
5. 导出和端到端测试。

每一阶段都应更新 `README.md`、`AGENTS.md` 和测试说明。涉及新脚本时同步 `scripts/README.md` 或 app 内 `scripts/` 说明。
