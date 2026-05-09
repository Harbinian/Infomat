# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Infomat 是一个业务关系映射工具，用于管理和可视化"业务能力 → 业务流程 → 应用系统"三列关系图。核心场景是航空复材制造领域的业务流程梳理和系统集成分析。

## 常用命令

### 前端（主应用）
直接用浏览器打开 `index.html` 即可运行，无构建步骤。

### 布局验证脚本
```bash
node analyze-layout.js
```

## 技术栈

**前端**：单文件 HTML 应用，原生 JavaScript + CSS，无框架、无构建工具、无外部依赖。SVG `path` + `marker` 绘制连线。数据持久化使用 `localStorage`。

**Python 工具**：独立 CLI 脚本（如有），通过 MiniMax Vision API 提取结构化数据。

**Node 辅助**：`analyze-layout.js` 仅用于验证布局参数，不参与生产链路。

## 代码架构

### 状态管理
前端所有状态集中在一个 `state` 对象中：
```javascript
state = {
  capabilities: [{name, l3:[...]}],  // 业务能力 + 三级流程
  processes: [...],                    // 业务流程列表
  systems: [{id, name}],              // 应用系统列表
  connections: [{capName, procName, sysId}],
  // 交互状态
  selectionStep, selectedCapName, selectedProcName,
  selectedConnIdx, lastSaved,
  // 布局参数
  colX, rowHeight, startY, nodeHeight
}
```

### 数据流向
```
前端 JSON → localStorage / Blob 导入导出
```

### 目录结构
- `index.html` — 主应用（所有前端逻辑）
- `analyze-layout.js` — 布局参数验证脚本
- `output/` — Excel/JSON 样例输出
- `docs/` — 业务规范、会议记录、集成关系说明
- `.planning/codebase/` — 架构/栈/结构扫描文档
- `docs/superpowers/specs/` — 设计方案文档（如数据持久化设计）
- `docs/superpowers/plans/` — 实现计划

## 关键约束

- 前端无模块化，所有逻辑在一个 HTML 文件中
- 无自动化测试
