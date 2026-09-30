# 数字化底座项目 PMO 管控看板

基于 React + Vite 的交付物驱动项目管控看板，从甘特图升级为 PMO 周会可用工具。

修改本应用前先读 `AGENTS.md`。涉及代码、插件、数据字段、前端行为、启动命令或测试命令变化时，必须同步更新本 README 或 `AGENTS.md`。

## 快速开始

```bash
npm install
npm run dev
npm run build
npm run preview
```

开发模式默认访问 `http://localhost:5174`。

## 本机 Docker 部署（5173）

容器保留 Vite 服务及交付物插件，因此读取、上传、状态写回和行动项发布仍可使用。它是原有内部开发服务的容器化运行方式，不是带登录鉴权的生产发布服务。只在受信任的内网使用，不对公网开放。

`src/` 与 `plugins/` 是**构建进镜像**的（见 `Dockerfile` 的 `COPY`），不随宿主机改动自动更新。修改前端或插件后必须重新执行 `build` 并重建容器，否则容器仍运行旧版本 —— 表现为页面上缺少新功能入口。只有 `pmo/deliverables/`、`artifacts/pmo/deliverables/`、`public/`、名册、流程地图和 ECharts 是挂载的。

在仓库根目录执行以下 PowerShell 命令：

```powershell
docker compose -f pmo/gantt-react/compose.yaml build
docker compose -f pmo/gantt-react/compose.yaml up -d --no-build
node pmo/gantt-react/scripts/smoke-docker.mjs http://127.0.0.1:5173
```

默认基镜像为 `node:24-bookworm-slim`。本机无法拉取 Docker Hub 镜像时，可复用已存在且验证过的本地 Node 24 镜像：先设置 `$env:PMO_NODE_IMAGE='infomat-node:24.21.0'`，再运行构建命令。镜像必须事先存在；该名称不是公共镜像。

容器名为 `infomat-pmo-5173`，监听 `0.0.0.0:5173`，使用非 root 用户、只读根文件系统和临时 Vite 缓存。Compose 只将 `pmo/deliverables/` 及 `artifacts/pmo/deliverables/` 挂载为可写目录，分别保存交付物正本和上传、历史产物；重建容器不会删除这些宿主机文件。`public/`、`信息化项目_部门主备对接人名单.md`、流程地图和 ECharts 从原路径只读挂载，重新生成任务数据或调整主备对接人后刷新页面即可。

名册是发布行动项的责任部门来源。它缺失时责任部门下拉会为空（插件启动日志会显式告警），因此修改该文件后无需重建镜像，重启容器或让挂载生效即可。

构建上下文采用白名单，不包含 `.env`、其他应用或交付物正本。更新前应备份上述两个可写目录；回退软件不会自动回退期间发生的数据修改。周会事项仍存储在浏览器 `localStorage`，继续使用原访问地址和端口可保持原浏览器存储空间。

`scripts/smoke-docker.mjs` 只读检查首页、前端模块、任务及清单文件摘要、流程地图、ECharts、交付物列表和详情，不写入业务数据。候选容器的写回测试必须使用隔离交付物目录。

恢复宿主机运行时，先执行 `docker compose -f pmo/gantt-react/compose.yaml down` 释放5173，再进入 `pmo/gantt-react` 执行 `npm.cmd run dev -- --host 0.0.0.0 --port 5173 --strictPort`。不要同时启动两份服务写入同一交付物目录。

安全限制：当前 XLSX 上传依赖 `xlsx@0.18.5`，npm 审计报告其存在高风险问题且没有 npm 修复版。容器隔离不消除该解析风险，不应上传不可信文件；更换解析库或取消该能力需要单独处理。

## 数据来源

`public/tasks.json` 由 `pmo/信息化项目_计划管控真源.md` 通过 `pmo/build_pmo_task_data.py` 生成。页面实际读取 `public/tasks.json`，同时保留 `pmo/tasks.json` 作为 PMO 根目录备份。

当前任务数为 516，每条任务固定输出43个顶层字段。字段数由`pmo/build_pmo_task_data.py`中的唯一输出字段清单计算，并由生成器逐行检查，不从真源摘要手工复制。生成脚本会保留基础甘特字段，并附带阶段门、关键路径控制、H5 重点展示、合同/付款控制口径、执行标准缺口分桶和优先级队列等执行管控字段。

任务清单中的“责任人”由前端按 `pmo/信息化项目_工作平衡.md` 的工作组负责人口径派生，不回写 `public/tasks.json`。

任务真源中的 `受控交付物编号` 会生成 `deliverableId`，用于把计划任务显式绑定到 `pmo/deliverables/DLV-XXX-*.md` 正本。

交付物台账分两类行，编号规则不同：

- **受控行**：`DLV-###` 编号只来自正本文件本身，不由任务投影生成。绑定的唯一依据是显式锚点 —— 任务侧 `受控交付物编号`，或正本 frontmatter 的 `normalizedWbs` / `taskId`。两侧都声明且指向不同任务时报告冲突，不静默择一。
- **计划投影行**：来自任务 `deliverable` 自由文本，用 `projectionKey`（`task:<编号>`）标识，不占用 `DLV` 命名空间、不持久化、不可发布行动项。它们显示在台账的「计划候选池」子页签，经「提升为受控」后才会分配编号并创建正本。

历史实现的 `DLV-${counter++}` 顺序发号已删除：counter 无条件递增会让影子编号与正本编号空间重叠，曾导致 `DLV-006`、`DLV-007` 正本在台账上不可见、`DLV-179` 被内容无关的任务顶替。

服务侧同步读取/提供 `public/pmo-source-manifest.json`，用于标识当前 PMO 真源组合：

| 真源 | 作用 |
|---|---|
| `pmo/信息化项目_计划管控真源.md` | 计划、资源、风险、阶段门和执行字段 |
| `pmo/信息化项目_WBS结构真源.md` | WBS 编号、父子层级和排序 |
| `pmo/信息化项目_工作平衡.md` | 人员分配、例会把关机制和高压窗口 |
| `pmo/信息化项目_工作开展原则.md` | PMO 推进原则、协同边界和闭环规则 |
| `pmo/信息化项目_执行标准真源.md` | 执行标准卡、检查清单、完成判定和证据要求 |

### 替换新任务数据

1. 修改 `pmo/信息化项目_计划管控真源.md`。
2. 如调整 WBS 编号/层级，同步修改 `pmo/信息化项目_WBS结构真源.md`。
3. 如调整人员或推进机制，同步修改 `pmo/信息化项目_工作平衡.md`、`pmo/信息化项目_工作开展原则.md`。
4. 在 `pmo/` 下运行 `python build_pmo_task_data.py`。
5. 脚本同时写入 `pmo/tasks.json`、`pmo/pmo-source-manifest.json`、`pmo/gantt-react/public/tasks.json` 和 `pmo/gantt-react/public/pmo-source-manifest.json`。
6. 刷新浏览器。

运行完成后应看到 `Wrote 516 tasks from 信息化项目_计划管控真源.md`。如任务数发生变化，先确认 MD 真源是否确实增删任务。

## 交付物文件系统(dev 模式)

`pmo/deliverables/DLV-XXX-*.md` 是交付物状态正本。frontmatter 包含状态、责任、审批历史和凭证信息,正文末尾有系统维护的 `## 变更记录` 表。

`public/deliverable-status.json` 及其覆盖层逻辑已停用（重构前的过渡兜底，当前内容为空数组）。台账数据只来自正本文件与任务投影。

### HTTP 端点

台账与名册：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pmo/deliverables` | 受控交付物摘要列表 |
| GET | `/api/pmo/deliverables/ledger` | 台账索引原始数据（受控记录 + 扫描错误 + 建议编号） |
| GET | `/api/pmo/deliverables/roster` | 责任部门名册（解析自《信息化项目部门主备对接人名单》） |
| POST | `/api/pmo/deliverables` | 提升为受控：新建正本骨架（编号已占用返回 409） |

正本读写：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pmo/deliverables/:id` | 详情（frontmatter + 正文） |
| GET | `/api/pmo/deliverables/:id/raw` | 正本 Markdown 原文 |
| PUT | `/api/pmo/deliverables/:id` | 覆盖写回（`If-Match` mtime 校验；不携带 `action` 时保留磁盘上的行动项记录） |
| POST | `/api/pmo/deliverables/:id/upload` | 上传凭证（.md / .docx / .xlsx） |

行动项：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/pmo/deliverables/:id/publish` | 发布行动项（责任部门须在名册内；已发布未关闭时拒绝重复发布） |
| POST | `/api/pmo/deliverables/:id/acknowledge` | 登记已接收（规则 6.2） |
| POST | `/api/pmo/deliverables/:id/submit-result` | 登记办理结果或材料位置 |
| POST | `/api/pmo/deliverables/:id/close` | 确认关闭（规则 6.4：无结果且无凭证时拒绝） |
| POST | `/api/pmo/deliverables/:id/reopen` | 重新开启 |
| POST | `/api/pmo/deliverables/:id/due-date` | 期限调整（规则 8.1：须由指定同意人确认） |
| POST | `/api/pmo/deliverables/publish-text` | 发布文本归档留痕 |

`/transition` 端点保留，与上述行动项端点共用同一分派器，状态迁移与行动项事件都可通过它提交。

启动时扫描所有 `DLV-XXX-*.md`。解析失败、字段缺失或同 DLV 多份的文件不阻塞 dev server，但**不再只写 console.warn** —— 扫描错误随 `GET /ledger` 上报，在台账健康度徽标与对账视图中可见。同 DLV 多份正本时，该编号的读取、写回、状态流转和上传接口返回 409，需先保留唯一 Markdown 正本后再操作。

### 交付物 frontmatter 的可选 `action` 块

交付物被发布为行动项后，frontmatter 才出现 `action` 块；未发布的正本不含该块，因此既有正本无需任何改动：

```yaml
action:
  assigneeDepartment: MDM工作组   # 规则 6.3 责任部门，取自部门名册
  dueDate: '2026-10-15'           # 规则 6.3 截止时间（独立于 plannedFinish）
  state: 待接收                    # 待接收 / 已接收 / 已提交待确认 / 已关闭
  publishedAt: '2026-09-24T02:00:00.000Z'
  publishedBy: 张广懿
  ackDueDate: '2026-09-25'        # 规则 6.2：publishedAt + 1 个工作日
  acknowledgedAt: ''
  acknowledgedBy: ''
  resultNote: ''
  closedAt: ''
  closedBy: ''
  closureNote: ''
  criteriaSource: task            # task 时完成判定取自绑定任务，不落盘
  criteria: ''
  evidenceRequirement: ''
```

行动项状态（`action.state`）与交付物状态（`status`）是两条独立的轴：前者表达行动项的承接与关闭，后者表达交付物自身的编制与评审进度。逾期不是状态，而是由 `dueDate < 今天 && state !== '已关闭'` 派生的徽标。

修复历史错配的参考锚点（需 PMO 确认后另行提交）：`DLV-179` 对应 WBS 4.7.1「AI辅助治理文档整理规范制定」，`DLV-006`、`DLV-007` 为 PMO 自持材料、无计划锚点。

### 测试

```bash
npm run test:frontmatter
npm run test:writeback
npm run test:plugin
npm run test:hmr
npm run test:task-owner
npm run test:pmo-week-range
npm run test:weekly-issue-ledger
npm run test:deliverable-identity
npm run test:deliverable-action
node ../scripts/smoke-deliverable-workflow.mjs
```

## Console 口径

- `Slow network is detected`、`Fallback font`、`A listener indicated an asynchronous response` 多来自浏览器扩展或 Chrome 消息通道，不作为本应用缺陷处理。
- `Download the React DevTools` 是 React 开发提示，生产构建不输出。
- `analyzeTasks()` 的甘特图诊断仅在 Vite 开发模式运行，生产构建已静默。
- 已知的 3 个 WBS 里程碑父级误判记录在 `../pmo-gantt-known-issues.md`，MD 真源不因展示误判修改。

## 功能视图

| 视图 | 说明 |
|------|------|
| 全部任务 | 甘特图 + 任务树 (收起 WBS 时进度条联动隐藏) |
| 任务清单 | PMO 看板内的任务明细表,按 WBS 排序,展示责任部门和责任人,支持任务类型/里程碑/风险筛选 |
| 交付物台账 | 受控交付物表格（等级/类型/部门/月份/状态筛选）；「计划候选池」子页签列出未纳管的计划投影行，可提升为受控 |
| 阶段门 | 8个阶段门卡片，区分已满足/疑似匹配/缺失 |
| 标准治理 | 执行标准覆盖率快照、缺口分桶和高风险缺标准优先队列 |
| 周会事项 | PMO 行动台账：行动项、风险、问题、变更和责任池事项；登记落盘到 `pmo/weekly-issues/ledger.json` |
| 本周交付物 | 基于 PMO 观察日期的周四至下周三到期交付物 |
| 延期交付物 | 已延期交付物和分级建议动作 |
| PMO周会 | 周四至下周三 A/B、延期A/B、阶段门缺失、高风险任务四块视图 |

## 周会事项台账

“周会事项”页签是《信息化项目协同工作规则》6.1 所说的 **PMO 行动台账**，页面固定五类去向：行动项台账、风险台账、问题台账、变更台账和责任池，每类都显示关闭标准。

登记数据写入 `pmo/weekly-issues/ledger.json`（文件正本），随仓库版本管理；页面标题旁的徽标显示当前存储模式（「文件正本」/「仅本地」）。静态构建下插件不可用，会降级为浏览器 `localStorage` 并显示「仅本地」——那种模式的数据不持久。

规则校验在服务端执行：

- **6.4** 关闭需具备结果、材料位置、记录或明确结论，由「登记结果」或关闭结论承载；两者皆空时拒绝关闭。
- **8.1** 期限调整必须由「期限调整」动作填写同意人，不能直接改日期。
- **8.2** 逾期是派生徽标（`截止时间 < 今天 && 未关闭`），不是状态；调整期限后原截止时间保留在事项历史中，不追溯消除已经发生的逾期事实。

每行提供「复制发布文本」，产出与交付物行动项同格式的工作群发布文本。首次接入时若正本为空且浏览器有遗留事项，会自动迁入一次，避免升级即丢数据。

### 周会事项端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pmo/weekly-issues` | 台账全量（含 `mtime` 供乐观锁） |
| POST | `/api/pmo/weekly-issues` | 登记事项（标题必填） |
| PUT | `/api/pmo/weekly-issues/:id` | 更新事项（`If-Match` 乐观锁；规则校验失败返回 422） |

## 阶段门规则

阶段门使用三层匹配：

1. 精确关键词包含，计入已满足。
2. 同 WBS 主线疑似匹配，计入疑似。
3. 别名表疑似匹配，计入疑似。

阶段门风险会随 PMO 观察日期变化重新计算。
