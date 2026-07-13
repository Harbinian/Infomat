# PMO 周会行动项服务

> 状态：本地 PMO 运行台账服务  
> 默认端口：`3002`  
> 数据边界：服务端本机台账文件，不写回 PMO 真源

本服务用于承接每周例会的行动项管理。它服务会议现场登记、会后跟踪、状态更新、关闭证据和延期原因记录。

## v2 设计基线

当前代码实现仍为 v1 简化台账。v2 设计已经确认，设计基线见：

- `docs/weekly-action-service-v2-design.md`

v2 目标是把 3002 升级为会后跟踪统一入口，覆盖行动项台账、责任池、材料缺口清单、制度或表单待补说明、后续访谈清单和 MDM 现有入口。v2 设计包含人员快照、轻量身份选择、业务动作接口、v2 台账、全局审计事件流、证据清单、延期申请、暂缓、误录作废、周会复盘包、责任穿透视图和运行导出。

v2 边界：

- 人员快照由仓库脚本从 `docs/organization/信息化项目人员角色映射.md` 生成，3002 只读消费。
- 3002 不直接解析组织 Markdown 真源，不回写花名册、组织架构或 PMO Markdown 真源。
- v2 第一版仍使用 `artifacts/weekly-actions/` 运行文件，不引入 SQLite，不接 MySQL。
- 5173 到 3002 只做人工确认导入，不做自动同步。

## 运行

```powershell
npm start
```

默认访问：

```text
http://127.0.0.1:3002
```

需要改端口时：

```powershell
$env:WEEKLY_ACTION_PORT='3302'
npm start
```

## 数据保存

- 默认保存到仓库根目录下的 `artifacts/weekly-actions/weekly-action-ledger-v1.json`。
- `artifacts/` 已被忽略，不应提交。
- 可用 `WEEKLY_ACTION_DATA_DIR` 指定本机私有保存目录。
- 写入采用临时文件后替换的方式，避免中途失败留下半写内容。
- v2 计划使用 `weekly-action-ledger-v2.json`、`personnel-snapshot.json`、`evidence/`、`meeting-drafts/`、`intakes/` 和 `exports/` 分目录保存运行数据；v1 文件保留为备份，不覆盖。

示例：

```powershell
$env:WEEKLY_ACTION_DATA_DIR='E:\infomat-runtime\weekly-actions'
npm start
```

## 功能范围

- 周会周期固定按周四至下周三计算。
- 支持五类事项：周会行动项、风险事项、问题事项、变更事项、责任池事项。
- 支持登记事项、修改责任方和截止日期、调整状态、填写关闭证据、填写延期原因、删除误录项。
- 多个浏览器访问同一个 3002 服务时，读取同一份服务端本机台账。
- v2 将替换为六类跟踪去向、责任字段拆分、业务动作接口和误录作废；当前 v1 页面和接口尚未具备这些行为。

## 边界

- 不写回 `pmo/` 下的 Markdown 真源。
- 不修改 `pmo/tasks.json` 或 `pmo/gantt-react/public/tasks.json`。
- 不写 MDM 数据库。
- 不替代正式会议纪要或受控交付物。
- 当前不接 MySQL；项目管理模式稳定后，再评估是否迁移到独立 PMO 数据库。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态，不返回行动项内容 |
| GET | `/api/meta` | 事项类型、状态和当前周会周期 |
| GET | `/api/items` | 查询行动项，支持 `weekId`、`type`、`status`、`q` |
| POST | `/api/items` | 新增行动项 |
| PUT | `/api/items/:id` | 更新行动项 |
| DELETE | `/api/items/:id` | 删除误录项 |

## 验证

```powershell
npm test
```

测试覆盖：

- 周四至下周三周期计算。
- 新增、查询、关闭、删除行动项。
- 行动项写入服务端本机台账文件。
- 健康检查不暴露行动项内容。
- 页面不依赖浏览器本地台账保存。
