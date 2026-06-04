# 数字化底座项目甘特图

基于 `信息化项目_Project_H5可用.xlsx` 构建的可交互 H5 甘特图看板，用于项目管理、领导汇报和进度跟踪。

## 快速开始

### 方式一：直接双击打开（推荐）

双击 `index-standalone.html` 即可在浏览器中打开，**无需 HTTP 服务器**。

> 数据已内嵌在 HTML 中（133KB），支持 file:// 协议直接打开。

### 方式二：本地服务（原始版）

```bash
cd pmo
python -m http.server 8080
```

访问 http://localhost:8080

> 注意：如果直接双击打开 index.html（file:// 协议），fetch 请求 tasks.json 可能被浏览器安全策略阻止。推荐使用本地 HTTP 服务。

## 更新任务数据

1. 修改 `信息化项目_Project_H5可用.xlsx`
2. 重新生成 JSON：

```bash
cd pmo
python convert_xlsx.py
```

3. 刷新浏览器页面

## 功能说明

| 功能 | 说明 |
|------|------|
| 仪表盘 | 7 个核心指标卡片：总任务、里程碑、高风险、进行中、跨年、部门、供应商 |
| 筛选器 | 按年份、主线、部门、供应商、风险等级、任务类型、里程碑筛选 |
| 搜索 | 按任务名称或 WBS 编号关键词搜索 |
| 视图切换 | 全部任务 / 总览（仅一二级+里程碑） / 2026年 / 2027年 / 2028年 / 里程碑视图 / 高风险视图 |
| WBS 任务树 | 左侧固定列，支持展开/折叠（一二级默认展开），点击选中任务 |
| 甘特图 | Canvas 2D 渲染，横向滚动，月轴表头固定，里程碑金色菱形，今日红色虚线 |
| 任务详情 | 右侧滑出面板，显示完整 15 个字段，风险等级和里程碑有颜色标识 |
| 悬停提示 | 鼠标悬停甘特条显示任务关键信息摘要 |
| 关键里程碑 | 底部里程碑汇总列表 |

## 数据格式

`tasks.json` 字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 任务 ID |
| wbs | string | WBS 编号（如 1.1.1） |
| name | string | 任务名称 |
| type | string | 任务类型（摘要/里程碑/启动/调研/设计/开发/测试等） |
| duration | string | 工期 |
| start | string | 开始时间 |
| finish | string | 完成时间 |
| predecessors | string | 前置任务 ID |
| resources | string | 资源名称 |
| department | string | 责任部门 |
| vendor | string | 供应商 |
| reviewer | string | 审核人/审批组 |
| risk | string | 风险等级（高/中/低） |
| milestone | string | 是否里程碑（是/否） |
| deliverable | string | 交付物 |
| notes | string | 备注 |

## 技术栈

- 纯静态 HTML + CSS + JavaScript（ES6+）
- Canvas 2D API 渲染甘特图
- 零框架、零构建工具、零 CDN 依赖
- 系统字体栈，无外部资源加载

## 浏览器兼容

- Chrome / Edge 90+
- Firefox 90+
- Safari 15+

## 文件结构

```
pmo/
├── index.html                # 单文件完整应用（需要 HTTP 服务）
├── index-standalone.html     # 内嵌数据版（可直接双击打开）
├── tasks.json                # 任务数据（353 条，由 XLSX 生成）
├── convert_xlsx.py           # XLSX → tasks.json 转换脚本
├── build-standalone.js       # 生成内嵌数据版 HTML
└── README.md                 # 本文件
```
