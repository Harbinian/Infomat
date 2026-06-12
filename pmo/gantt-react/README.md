# 数字化底座项目 PMO 管控看板

基于 React + Vite 的交付物驱动项目管控看板，从甘特图升级为 PMO 周会可用工具。

## 快速开始

```bash
npm install
npm run dev
npm run build
npm run preview
```

开发模式默认访问 `http://localhost:5173`。

## 数据来源

`public/tasks.json` 由 `pmo/信息化项目_计划管控真源.md` 通过 `pmo/convert_xlsx.py` 转换生成。页面实际读取 `public/tasks.json`，同时保留 `pmo/tasks.json` 作为 PMO 根目录备份。

当前任务数为 467，字段数为 45。转换脚本会保留基础甘特字段，并附带阶段门、关键路径控制、H5 重点展示、合同/付款控制口径等执行管控字段。

服务侧同步读取/提供 `public/pmo-source-manifest.json`，用于标识当前 PMO 真源组合：

| 真源 | 作用 |
|---|---|
| `pmo/信息化项目_计划管控真源.md` | 计划、资源、风险、阶段门和执行字段 |
| `pmo/信息化项目_WBS结构真源.md` | WBS 编号、父子层级和排序 |
| `pmo/信息化项目_工作平衡.md` | 人员分配、例会把关机制和高压窗口 |
| `pmo/信息化项目_工作开展原则.md` | PMO 推进原则、协同边界和闭环规则 |

### 替换新任务数据

1. 修改 `pmo/信息化项目_计划管控真源.md`。
2. 如调整 WBS 编号/层级，同步修改 `pmo/信息化项目_WBS结构真源.md`。
3. 如调整人员或推进机制，同步修改 `pmo/信息化项目_工作平衡.md`、`pmo/信息化项目_工作开展原则.md`。
4. 在 `pmo/` 下运行 `python convert_xlsx.py`。
5. 脚本同时写入 `pmo/tasks.json`、`pmo/gantt-react/public/tasks.json` 和 `pmo/gantt-react/public/pmo-source-manifest.json`。
6. 刷新浏览器。

运行完成后应看到 `Wrote 467 tasks from 信息化项目_计划管控真源.md`。如任务数发生变化，先确认 MD 真源是否确实增删任务。

## 交付物文件系统(dev 模式)

`pmo/deliverables/DLV-XXX-*.md` 是交付物状态正本。frontmatter 包含状态、责任、审批历史和凭证信息,正文末尾有系统维护的 `## 变更记录` 表。`public/deliverable-status.json` 仅作为无正本文件时的过渡兜底。

### 6 个 HTTP 端点

| 方法 | 路径 |
|---|---|
| GET | `/api/pmo/deliverables` |
| GET | `/api/pmo/deliverables/:id` |
| GET | `/api/pmo/deliverables/:id/raw` |
| PUT | `/api/pmo/deliverables/:id`(支持 `If-Match` mtime 校验) |
| POST | `/api/pmo/deliverables/:id/transition` |
| POST | `/api/pmo/deliverables/:id/upload`(支持 .md / .docx / .xlsx) |

启动时扫描所有 `DLV-XXX-*.md`,解析失败、字段缺失或同 DLV 多份时只在 console.warn 提示并跳过,不阻塞 dev server。

### 测试

```bash
npm run test:frontmatter
npm run test:writeback
npm run test:plugin
npm run test:hmr
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
| 任务清单 | PMO 看板内的任务明细表,按 WBS 排序,支持任务类型/里程碑/风险筛选 |
| 交付物台账 | 所有交付物表格，支持等级/类型/部门/月份/状态筛选 |
| 阶段门 | 8个阶段门卡片，区分已满足/疑似匹配/缺失 |
| 本周交付物 | 基于 PMO 观察日期的本周到期交付物 |
| 延期交付物 | 已延期交付物和分级建议动作 |
| PMO周会 | 本周A/B、延期A/B、阶段门缺失、高风险任务四块视图 |

## 阶段门规则

阶段门使用三层匹配：

1. 精确关键词包含，计入已满足。
2. 同 WBS 主线疑似匹配，计入疑似。
3. 别名表疑似匹配，计入疑似。

阶段门风险会随 PMO 观察日期变化重新计算。
