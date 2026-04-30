# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

Infomat 是一个制造企业数字化运营平台的业务关系网络图可视化工具，用于映射业务能力、L3流程和应用系统之间的多对多关系。

## 系统供应商（暂定）

| 系统 | 供应商 | 定位 |
|------|--------|------|
| ERP | 用友U8 | 企业资源计划核心层 |
| MES | 北京虎蜥 | 制造执行层 |
| OA | 华天动力 | 流程协同层 |
| PLM | 暂定 | 产品全生命周期管理 |

## 核心应用系统

- **用友U8** - ERP（PS/FI/CO/PP/MM/SD模块）
- **北京虎蜥** - MES（制造执行）
- **华天动力** - OA（流程协同）
- **PLM** - 产品全生命周期管理
- **PDM** - BOM管理 & 工艺数据管理
- **CAPP** - 工艺设计
- **SCIM** - 供应商协同门户
- **WMS** - 仓储管理

## 关键文档

- `系统集成关系说明.md` - 核心系统集成关系和技术规范
- `SPEC.md` - 业务关系网络图的设计规范
- `ROADMAP.md` - 项目开发路线
- `docs/superpowers/plans/` - 详细实施计划
- `docs/superpowers/specs/` - 设计规格文档

## 技术架构

**前端应用**：
- `index.html` - 业务关系网络图主页面（纯HTML/CSS/JS，无外部依赖）
- 三列布局：业务能力(L3) | L3流程 | 应用系统

**Python脚本**：
- `bizmapper.py` - 业务映射器

## 运行方式

- 业务关系网络图：直接在浏览器打开 `index.html`
- 分析布局：`node analyze-layout.js`

## 文件命名规范

- 中文命名文档使用全名（如 `系统集成关系说明.md`）
- 英文/拼音命名使用英文单词（如 `bizmapper.py`）