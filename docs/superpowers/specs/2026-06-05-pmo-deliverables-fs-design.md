# PMO 交付物文件系统化设计

## 概述

PMO 5173 看板（`pmo/gantt-react/`）当前把交付物的状态/审批信息维护在 `public/deliverable-status.json` 手写覆盖层，把凭证文件（docx/xlsx/pdf/md）落到浏览器本地 IndexedDB。两层都没有跟 `pmo/deliverables/*.md` 互通，导致 PMO 同事手写的正本（如 `DLV-001-启动会议程和参会清单.md`）跟看板数据脱钩，状态变更无法沉淀到文件，凭证文件在多用户/多设备下无法共享。

本次设计把 `pmo/deliverables/` 升级为**状态正本**，新建 Vite dev-only 插件 + 6 个 HTTP 端点 + chokidar 监听，扫目录、读 frontmatter、写回状态机变更、上传文件转 md，全部走文件系统。5173 在 dev 模式自动随 `.md` 文件变化 HMR 刷新；生产构建（`npm run build`）自动降级回 WBS 字段，插件代码不进入产物。

**不做**：生产环境部署方案（用户已确认"只 dev"）、多用户协作锁（用 `If-Match` 简单拒绝）、PDF 转 md（库不成熟，拒收）、全文搜索（走台账搜索框的现有逻辑）、PMO 端审批推送（邮件/钉钉）。

## 真源与数据流

### 真源

| 真源 | 位置 | 角色 |
|---|---|---|
| WBS 主表 | `pmo/gantt-react/public/tasks.json` | 决定 DLV 是否存在、类型/等级/部门/计划完成（不可变分类） |
| 交付物凭证 | `pmo/deliverables/DLV-XXX-*.md` | **本次升级为主**：状态/责任/审批历史/凭证元信息 |
| 凭证归档 | `pmo/deliverables/_history/DLV-XXX/` | 模板草稿、原始上传、历史快照（**不**被插件扫描） |
| 状态覆盖（过渡） | `pmo/gantt-react/public/deliverable-status.json` | 系统读到 .md 时此文件对该 DLV 失效；未读到的 DLV 仍走此 JSON |

### 绑定规则

- 文件名必须匹配 `^DLV-(\d{3})-[^\/\\]+\.md$`，`deliverableId = DLV-<3位编号>`
- 子串 `DLV-XXX-` 必带 3 位数字加连字符；后面允许 `01-` `02-` 这类二级序号（如 `DLV-001-01-补充.md`）
- 同一 DLV 出现多份 → 启动时 warning + 跳过该 DLV，不阻塞 dev
- 与 `tasks.json` 自动抽取的 DLV 列表合并时，以**`tasks.json` 抽出的 DLV 为全集**，`.md` 文件为覆盖层

### 数据流

```
pmo/gantt-react/public/tasks.json  (WBS 主表,不动)
        │
        ▼
normalizeDeliverables  → DLV 全集
        │
        ▼
useDeliverableFs.init()
   ├─ fetch GET /api/pmo/deliverables         → 全量 frontmatter 摘要
   ├─ 合并: DLV 对象 shallow-merge with .md frontmatter
   │     ├─ 字段冲突:.md 为准
   │     └─ workflowHistory 数组整体替换
   └─ import.meta.hot.on('pmo:deliverables-changed', handler)

文件系统事件
   ├─ 文件 watcher (Vite server.watcher.add(deliverablesPath))
   │   add/change/unlink → server.ws.send({type:'pmo:deliverables-changed', data:{id, kind}})
   └─ 前端 listener 增量刷新缓存,React 重渲
```

## 文件变更

**新增**
- `pmo/gantt-react/plugins/pmoDeliverablesPlugin.js` — Vite 插件:中间件 + watcher + HMR
- `pmo/gantt-react/src/utils/deliverableFrontmatter.js` — parse/stringify/validate 纯函数
- `pmo/gantt-react/src/utils/deliverableFsApi.js` — 浏览器侧 fetch 封装
- `pmo/gantt-react/src/hooks/useDeliverableFs.js` — React Hook,缓存 + HMR 订阅
- `pmo/gantt-react/src/components/DeliverableActions.jsx` — 生成模板/触发状态/上传文件 UI
- `pmo/scripts/smoke-frontmatter.js` — ① 纯函数测试
- `pmo/scripts/smoke-writeback.js` — ② 状态写回测试
- `pmo/scripts/smoke-plugin-endpoints.js` — ③ HTTP 端点测试
- `pmo/scripts/smoke-hmr.js` — ④ chokidar HMR 集成测试
- `pmo/gantt-react/test-results/deliverable-helpers.mjs` — 测试 fixtures 与断言 helper

**修改**
- `pmo/gantt-react/vite.config.js` — 挂 `pmoDeliverablesPlugin`,`server.fs.allow` 扩到 `pmo/..`
- `pmo/gantt-react/package.json` — `+ gray-matter`,`+ mammoth`(docx 转 md),`+ xlsx`(xlsx 转 md),`+ react-markdown`(body 渲染),新增 4 个 `test:*` 脚本
- `pmo/gantt-react/src/utils/deliverableWorkflow.js` — `transitionDeliverableStatus(dlv, command, { writeback })` 接受写回选项
- `pmo/gantt-react/src/utils/deliverableUtils.js` — `loadDeliverableStatusOverrides` 改走 `useDeliverableFs` 链路
- `pmo/gantt-react/src/components/DeliverableDetail.jsx` — 新增"正本文件"tab,`下载正本` 按钮
- `pmo/gantt-react/src/App.jsx` — 初始化时调用 `useDeliverableFs.init()`,在 `loadDeliverableStatusOverrides` 之后
- `pmo/deliverables/DLV-001-启动会议程和参会清单.md` — 改写为新 frontmatter + body 结构(原"七、变更记录"改名 `## 变更记录`,列重排为 `版本/状态/动作/责任人/时间/备注`)
- `pmo/gantt-react/public/deliverable-status.json` — 删除 DLV-001 那条记录(由 .md 提供),保留其他 DLV 作过渡

**删除**

无删除项。

## .md Frontmatter Schema

```yaml
---
deliverableId: DLV-001                       # 自动从文件名填,不必手写
title: 启动会议程和参会清单                  # 必填
status: 待评审                               # 必填,枚举: 未提交/编制中/已提交/待评审/通过/退回整改/已归档
deliverableType: 过程记录类                  # 必填
deliverableLevel: C                          # 必填,枚举: A/B/C/D
department: 信息化项目组（PMO）              # 必填
owner: 刘春含                                 # 可空
reviewer: PMO                                # 可空
plannedFinish: 2026-06-05                    # 必填,ISO 日期
actualSubmitDate: 2026-06-20                 # 可空
actualPassDate:                              # 可空
actualArchiveDate:                           # 可空
risk: 中                                      # 枚举: 高/中/低
reviewOpinion: 已提交初稿，等待 PMO 评审    # 可空
ownerNote: 已提交初稿，等待 PMO 评审         # 可空
evidence:                                    # 可空
  fileName: DLV-001-启动会议程和参会清单.md
  fileSize: 0
  fileType: text/markdown
  uploadedAt: 2026-06-20T09:00:00.000Z
  source: 占位登记（待补传原件）
workflowHistory:                              # 必填,数组
  - action: submit
    label: 提交
    from: 未提交
    to: 已提交
    actor: 项目管理部
    at: 2026-06-20T09:00:00.000Z
    note: 提交初稿
  - action: startReview
    label: 进入评审
    from: 已提交
    to: 待评审
    actor: PMO
    at: 2026-06-20T10:00:00.000Z
    note: 进入 PMO 评审
---
```

### body 强制结构

```
# <title>

(自由正文)

## 变更记录
| 版本 | 状态 | 动作 | 责任人 | 时间 | 备注 |
| --- | --- | --- | --- | --- | --- |
| V0.1 | 已提交 | 提交 | 项目管理部 | 2026-06-20 | 提交初稿 |
| V0.2 | 待评审 | 进入评审 | PMO | 2026-06-20 | 进入 PMO 评审 |
```

- `## 变更记录` 表由系统维护,每次状态变更追加一行
- 人手编辑只改正文,不碰这个表;若表被删,下次写回时用 `workflowHistory` 重建
- 现有 DLV-001 的"七、变更记录"表改造时:7 列(`版本/日期/修订人/修订说明`) → 6 列(`版本/状态/动作/责任人/时间/备注`),V0.1~V1.0 四行通过历史 events 重建

## 模块边界

```
pmoDeliverablesPlugin.js (Vite 插件,apply: 'serve')
    └─ 唯一接触文件系统的服务端代码
       ├─ 6 个中间件 (见下)
       ├─ server.watcher.add(deliverablesPath)  ← Vite 内置 chokidar,不引第三方
       └─ server.ws.send('pmo:deliverables-changed') 广播

deliverableFrontmatter.js (浏览器/Node 双兼容)
    ├─ parse(string) → {frontmatter, body, mtime}
    ├─ stringify({frontmatter, body}) → string
    └─ validate(frontmatter) → throws DeliverableFsError(SCHEMA_INVALID)

deliverableFsApi.js (浏览器侧 fetch 封装)
    ├─ list() / get(id) / getRaw(id)
    ├─ put(id, content, ifMatch)
    ├─ transition(id, command)
    └─ upload(id, file)

useDeliverableFs.js (React Hook)
    ├─ init() — 全量拉取
    ├─ getFrontmatter(id) — 同步读缓存
    └─ HMR 增量更新

deliverableWorkflow.js (现有,扩展)
    └─ transitionDeliverableStatus(dlv, command, { writeback: true })
       ├─ writeback: false → 纯内存(原行为)
       └─ writeback: true  → 跑状态机 + PUT 写回 + 快照(若 approve/archive)
```

## HTTP 端点(6 个)

| 方法 | 路径 | 用途 | 错误码 |
|---|---|---|---|
| GET | `/api/pmo/deliverables` | 列全量 frontmatter 摘要 | — |
| GET | `/api/pmo/deliverables/:id` | 读单个,返回 `{frontmatter, body, mtime}` | 404 |
| GET | `/api/pmo/deliverables/:id/raw` | raw .md 文本(下载) | 404 |
| PUT | `/api/pmo/deliverables/:id` | 整体覆写(模板/外部编辑 sync) | 409 mtime 不匹配,400 schema |
| POST | `/api/pmo/deliverables/:id/transition` | 状态机写回 | 409 mtime,422 状态机拒绝,400 schema |
| POST | `/api/pmo/deliverables/:id/upload` | multipart,转 md 落主文件 + 原文件落 _history | 400 ext,400 太大,422 转码失败 |

所有端点响应 `{ok, data?, error?}` JSON,错误带 `code` 字段。

## 写回与快照

### 原子写

```
writeFile(filepath, content)
  ├─ 写临时文件 filepath + '.tmp'
  ├─ 原子 rename 到 filepath
  └─ 失败时清理 .tmp
```

### 状态写回流程

```
transitionDeliverableStatus(dlv, command, {writeback:true})
  ├─ 跑状态机(原逻辑不变)→ 内存新 dlv
  ├─ 读磁盘 .md 当前 mtime
  ├─ 拼新 frontmatter(原 + 改动字段)
  ├─ 在 body 的 ## 变更记录 表追加一行(表缺失则用 workflowHistory 重建)
  ├─ PUT 写回(走 mtime If-Match 校验)
  │  ├─ 409 → 抛 WRITE_CONFLICT,UI 让用户选择覆盖或重读
  │  └─ 200 → 继续
  ├─ 若 action ∈ {approve, archive} → 复制 .md 到 _history/DLV-XXX/<ISO ts>-snapshot-<from>-to-<to>.md
  └─ 广播 pmo:deliverables-changed {id, kind:'change'}
```

### 上传转码

```
POST /api/pmo/deliverables/:id/upload (multipart, file)
  ├─ 扩展名判定:
  │   ├─ .md   → 直接读
  │   ├─ .docx → mammoth.extractRawText → 简单按 # 提标题
  │   ├─ .xlsx → xlsx 读第一个 sheet → markdown 表
  │   └─ 其他  → 400 UPLOAD_UNSUPPORTED_EXT
  ├─ 原文件落 _history/DLV-XXX/<ts>-原-<原文件名>
  ├─ 转码文本拼 body,frontmatter 增 evidence.{fileName,fileSize,fileType,uploadedAt,source:'上传转码'}
  ├─ 写 deliverables/DLV-XXX-*.md
  └─ 广播 pmo:deliverables-changed {id, kind:'change'}
```

> .pdf 拒收(库不成熟,用户已确认)。UI 上传控件隐藏 .pdf 选项。

## 错误处理

错误统一 `DeliverableFsError { code, message, cause? }`,code 取值:

| code | 触发 | UI 行为 |
|---|---|---|
| `PARSE_FRONT_MATTER` | YAML 解析失败 | toast + 该 DLV 灰显"凭证文件解析失败" |
| `SCHEMA_INVALID` | 字段缺失或枚举越界 | 写回时拒绝,弹红字提示"请用 ISO 日期"等 |
| `DUP_FILE_FOR_DLV` | 同 DLV 多份 .md | 启动 warning,跳过该 DLV,提示"移到 _history" |
| `WRITE_CONFLICT` | If-Match mtime 不匹配 | 弹错"文件已被外部修改,刷新后重试或强制覆盖" |
| `ATOMIC_WRITE_FAILED` | .tmp rename 失败 | 弹错"文件写入失败,检查目录权限",内存状态不动 |
| `UPLOAD_TOO_LARGE` | > 25MB | 上传前 JS 端预检,服务端二次校验 |
| `UPLOAD_UNSUPPORTED_EXT` | 非 docx/xlsx/md | toast "仅支持 docx/xlsx/md" |
| `CONVERTER_FAILED` | mammoth/xlsx 库抛错 | 原文件已落 _history,提示"用 pandoc 手动转后再次上传" |
| `STATUS_TRANSITION_DENIED` | 状态机拒绝 | 原 `deliverableWorkflow` 错误,原样上抛 |

### 兜底回退(单 DLV 读)

```
1. useDeliverableFs 缓存(mtime 未变)→ 直接用
2. fetch /api/pmo/deliverables/:id → {frontmatter, body, mtime}
3. 失败 → deliverable-status.json 旧覆盖层
4. 失败 → tasks.json 自动抽取的默认 DLV 对象(纯 WBS 字段)
```

任何一环出错都继续往下走,不断 dev server。

### 启动校验

启动时扫 `deliverables/` 下所有 `DLV-XXX-*.md`:
- 解析失败 → console.warn + 跳过
- 同 DLV 多份 → console.warn + 跳过该 DLV
- 校验失败 → console.warn + 跳过该文件
- 扫到遗留 `.tmp` → 删掉(上次原子写半中断)

## HMR 协议

**插件端**:
```js
server.watcher.on('add'|'change'|'unlink', (path) => {
  if (path.includes('/_history/')) return;          // 归档目录不广播
  const m = /DLV-(\d{3})-/.exec(path);
  if (!m) return;
  const id = `DLV-${m[1]}`;
  server.ws.send({ type: 'pmo:deliverables-changed', data: { id, kind: eventName } });
});
```

**前端**:
```js
useEffect(() => {
  if (!import.meta.hot) return;
  import.meta.hot.on('pmo:deliverables-changed', ({ id, kind }) => {
    if (kind === 'unlink') cache.delete(id);
    else cache.refresh(id);                          // 重新拉该 DLV
    notifySubscribers();                              // 触发 React 重渲
  });
}, []);
```

Vite 内置 watcher 自带 100ms debounce,不再加防抖。

## 测试

测试延续项目"手动 HTTP 请求脚本"风格(参见 `pmo/scripts/smoke-deliverable-workflow.mjs`),不引 jest/vitest。

### 5 层测试矩阵

| 层次 | 脚本 | 覆盖 |
|---|---|---|
| ① frontmatter 纯函数 | `npm test:frontmatter` | parse/stringify/validate 全分支 |
| ② 状态机+写回 | `npm test:writeback` | transitionDeliverableStatus 改 .md 后字段保留、新字段落地、变更记录表追加、原子写 |
| ③ HTTP 端点 | `npm test:plugin` | 6 个端点成功/失败码,If-Match 冲突,upload 转码 |
| ④ chokidar 集成 | `npm test:hmr` | 外部 fs 操作 → HMR payload(fake WS) |
| ⑤ 浏览器 E2E | playwright-cli 手动 | UI 上点生成模板/状态走一步/上传 |

### 关键测试用例

**① frontmatter**
- 解析现有 DLV-001-启动会议程和参会清单.md(旧"七、变更记录"表)
- stringify → reparse 字段一致
- 缺 status / status 越界 / plannedFinish 非 ISO → SCHEMA_INVALID
- evidence 为 null / 为对象 两种形态

**② 写回**
- 未提交→编制中:workflowHistory +1,evidence 不变
- 待评审→通过:status/actualPassDate/reviewOpinion 改,变更记录表 +1 行
- 非法跃迁 → STATUS_TRANSITION_DENIED,文件不写
- chmod 555 deliverables/ 模拟写失败 → ATOMIC_WRITE_FAILED,内存 dlv 不变
- 5 次连写 → workflowHistory 长度 +5,变更记录表行数 +5

**③ 端点**
- GET /api/pmo/deliverables → 200 数组
- GET /api/pmo/deliverables/DLV-001 → 200 {frontmatter, body, raw}
- GET /api/pmo/deliverables/DLV-999 → 404
- PUT If-Match 匹配 → 200;If-Match 旧 mtime → 409 + 新 mtime
- POST .../upload 传 .pdf → 400
- POST .../upload 传 .docx → 200, _history 含原文件,主 .md evidence 更新
- 启动时 DUP → 不挂,日志含警告

**④ HMR**
- fake WS 客户端订阅
- 外部 fs.writeFileSync 改 .md → 200ms 内收到 pmo:deliverables-changed
- 外部 fs.unlinkSync 删 .md → 收到 unlink
- 改 _history/ 下的文件 → 不发事件
- 改非 DLV- 开头的文件 → 不发事件

**⑤ 浏览器 E2E**(playwright-cli 手动)
1. `npm run dev` 起 Vite
2. playwright-cli 打开 http://localhost:5173/
3. 切到 PMO 周会页,看 DLV-001 状态"待评审"
4. 拿一个未在 .md 存在的 DLV(比如 DLV-007),点"生成模板",看 deliverables/ 下出现新 .md
5. 拍当前 .md 状态,点"通过",看 mtime 更新、变更记录表多一行
6. 同一时刻用 VSCode 改 .md,看浏览器内自动刷新
7. 用 explorer 删 .md,看该 DLV 退回老 deliverable-status.json 数据 + toast 提示

## 边界

- dev-only 边界:`apply: 'serve'` 让插件仅 dev 注册,`npm run build` 产物中不包含插件代码
- 兜底链全工作:删 `pmoDeliverablesPlugin` 后 dev server 仍能跑(只退到 WBS 字段)
- HMR 5s 兜底:WS 断连时每 5s 轮询全量,断连恢复后回退 HMR
- _history 子目录:不递归扫描,文件名以 `DLV-` 开头的归档文件在 _history 也不被扫
- 模板/快照/上传归档文件命名:`<ISO ts>-<kind>-<原名>.md` (kind ∈ template/snapshot/upload)
- chokidar:复用 Vite 内置 `server.watcher`,不引第三方依赖
- 文件大小:服务端 25MB 上限,前端预检

## 文档更新

- `pmo/CLAUDE.md` — `模块 B` 加 1 段"动态凭证消费(本次新增)"
- `pmo/gantt-react/README.md` — 加 dev plugin 端点列表与 frontmatter schema
- `pmo/gantt-react/vite.config.js` — 注释中说明 `server.fs.allow` 范围
- `docs/glossary.md` — 新增术语:交付物凭证 (deliverable evidence)、交付物正本 (deliverable canonical)、frontmatter 状态机、原子写 (atomic write)、HMR 增量同步 (HMR delta sync)
- `pmo/信息化项目_计划管控真源.md` — 加 1 段"凭证文件归属",说明 .md 状态正本 + _history 归档

## 验收标准

- [ ] `pmo/deliverables/DLV-001-启动会议程和参会清单.md` 改造为新 frontmatter + body 格式
- [ ] `pmo/gantt-react/public/deliverable-status.json` 删 DLV-001 那条记录
- [ ] 5 个 `npm test:*` 全过(frontmatter / writeback / plugin / hmr)
- [ ] 浏览器 E2E 7 步全过(playwright-cli 手动跑)
- [ ] `npm run build` 产物 grep 不到 `pmoDeliverablesPlugin` / `deliverable-status` 端点代码
- [ ] 临时把 `pmoDeliverablesPlugin` 注释掉,dev server 仍能跑(走兜底 4)
- [ ] `_history/DLV-001/` 留 1 个 .docx 上传样本 + 1 个 snapshot 样本
- [ ] `docs/glossary.md` 新增 5 个术语
- [ ] `pmo/CLAUDE.md` / `pmo/gantt-react/README.md` 更新到位
- [ ] `pmo/信息化项目_计划管控真源.md` 增"凭证文件归属"段
