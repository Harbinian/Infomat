# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本项目是一个制造业信息化系统的业务关系网络图可视化工具，用于映射业务能力、L3流程和应用系统之间的多对多关系。

## 运行方式

直接在浏览器中打开 `index.html` 即可运行，无需构建或依赖安装。

## 架构说明

- **单文件应用**：所有代码（HTML/CSS/JS）集中在 `index.html`
- **状态管理**：使用全局 `state` 对象管理 capabilities、processes、systems、connections
- **数据格式**：
  - capabilities: `{ name: string, l3: string[] }[]`（L2能力及其L3子能力）
  - processes: `string[]`（31条L3流程）
  - systems: `{ id: string, name: string }[]`（应用系统）
  - connections: `{ capName: string, procName: string, sysId: string }[]`（连线关系）

## 设计规范

详见 `SPEC.md`，核心要点：
- 三列布局（业务能力 x=30 | L3流程 x=320 | 应用系统 x=600）
- 行高45px，所有列垂直居中
- 节点样式：绿色(L3能力) / 紫色(L3流程) / 橙色(应用系统)
- 节点点击三步完成连线：绿 → 紫 → 橙
- 点击连线可删除，Delete确认，ESC取消

## 临时文件

`.superpowers/` 目录下的文件为 brainstorming session 的临时产物，可忽略。