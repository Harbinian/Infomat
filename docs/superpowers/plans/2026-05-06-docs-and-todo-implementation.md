# 文档体系升级与全生命周期 To-Do List 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成文档体系结构升级，包括归档老化文档、创建 integration/ 目录、迁移技术规范文档、并升级 ROADMAP.md 为系统集成项目计划。

**Architecture:** 文档组织调整，纯文件系统操作，不涉及代码变更。操作顺序：归档 → 创建新目录 → 迁移文档 → 生成新计划文档。

**Tech Stack:** 文件系统操作、Markdown 编辑

---

## 任务总览

| 任务 | 描述 | 依赖 |
|------|------|------|
| T1 | 创建归档目录并归档老化文档 | 无 |
| T2 | 创建 integration/ 目录并迁移技术规范文档 | T1 |
| T3 | 创建 plans/ 目录并升级 ROADMAP.md | T2 |
| T4 | 验证目录结构符合设计规范 | T3 |

---

## Task 1: 创建归档目录并归档老化文档

**Files:**
- Create: `docs/archives/2026-05-系统集成预审会前/` (目录)
- Archive: `docs/meetings/系统集成前需要解决的问题.md`
- Archive: `docs/meetings/组织架构专题讨论材料.md`
- Archive: `docs/meetings/系统集成架构专题会_PPT_md版.md`
- Archive: `docs/meetings/主数据专题会_会前信息收集邮件模板_航空复材版_V1.0.md`
- Archive: `docs/Demo/H5说明大纲（修订MD版）.md`
- Archive: `docs/Demo/系统集成方案预审会PPT反向稿.md`

- [ ] **Step 1: 创建归档目录**

Run: `mkdir -p "E:/CA001/Infomat/docs/archives/2026-05-系统集成预审会前"`

Expected: 目录创建成功

- [ ] **Step 2: 移动系统集成前需要解决的问题.md**

Run: `mv "docs/meetings/系统集成前需要解决的问题.md" "docs/archives/2026-05-系统集成预审会前/"`

Expected: 文件移动成功

- [ ] **Step 3: 移动组织架构专题讨论材料.md**

Run: `mv "docs/meetings/组织架构专题讨论材料.md" "docs/archives/2026-05-系统集成预审会前/"`

Expected: 文件移动成功

- [ ] **Step 4: 移动系统集成架构专题会_PPT_md版.md**

Run: `mv "docs/meetings/系统集成架构专题会_PPT_md版.md" "docs/archives/2026-05-系统集成预审会前/"`

Expected: 文件移动成功

- [ ] **Step 5: 移动主数据专题会_会前信息收集邮件模板_航空复材版_V1.0.md**

Run: `mv "docs/meetings/主数据专题会_会前信息收集邮件模板_航空复材版_V1.0.md" "docs/archives/2026-05-系统集成预审会前/"`

Expected: 文件移动成功

- [ ] **Step 6: 移动H5说明大纲（修订MD版）.md**

Run: `mv "docs/Demo/H5说明大纲（修订MD版）.md" "docs/archives/2026-05-系统集成预审会前/"`

Expected: 文件移动成功

- [ ] **Step 7: 移动系统集成方案预审会PPT反向稿.md**

Run: `mv "docs/Demo/系统集成方案预审会PPT反向稿.md" "docs/archives/2026-05-系统集成预审会前/"`

Expected: 文件移动成功

- [ ] **Step 8: 验证归档目录内容**

Run: `ls -la "E:/CA001/Infomat/docs/archives/2026-05-系统集成预审会前/"`

Expected: 列出 6 个归档的 md 文件

---

## Task 2: 创建 integration/ 目录并迁移技术规范文档

**Files:**
- Create: `docs/integration/` (目录)
- Create: `docs/integration/物料主数据编码规范.md` (从 specifications/ 迁移)
- Create: `docs/integration/接口设计卡模板.md` (从 specifications/ 迁移)
- Create: `docs/integration/PLM选型评分矩阵.md` (从 specifications/ 迁移)
- Delete: `docs/specifications/` (迁移后删除)
- Create: `docs/integration/MDM主数据治理方案.md` (从 meetings/ 迁移)
- Create: `docs/integration/系统集成关系说明.md` (从 system-integration/ 迁移)

- [ ] **Step 1: 创建 integration/ 目录**

Run: `mkdir -p "E:/CA001/Infomat/docs/integration"`

Expected: 目录创建成功

- [ ] **Step 2: 复制物料主数据编码规范草案_V0.2.md 并重命名**

Run: `cp "docs/specifications/物料主数据编码规范草案_V0.2.md" "docs/integration/物料主数据编码规范.md"`

Expected: 文件复制成功

- [ ] **Step 3: 复制接口设计卡模板.md**

Run: `cp "docs/specifications/接口设计卡模板.md" "docs/integration/接口设计卡模板.md"`

Expected: 文件复制成功

- [ ] **Step 4: 复制PLM选型评分矩阵.md**

Run: `cp "docs/specifications/PLM选型评分矩阵.md" "docs/integration/PLM选型评分矩阵.md"`

Expected: 文件复制成功

- [ ] **Step 5: 复制MDM主数据治理解决方案.md 并重命名**

Run: `cp "docs/meetings/MDM主数据治理解决方案.md" "docs/integration/MDM主数据治理方案.md"`

Expected: 文件复制成功

- [ ] **Step 6: 复制系统集成关系说明.md**

Run: `cp "docs/system-integration/系统集成关系说明.md" "docs/integration/系统集成关系说明.md"`

Expected: 文件复制成功

- [ ] **Step 7: 删除 specifications/ 目录**

Run: `rm -rf "docs/specifications"`

Expected: 目录删除成功

- [ ] **Step 8: 验证 integration/ 目录内容**

Run: `ls -la "E:/CA001/Infomat/docs/integration/"`

Expected: 列出 5 个 md 文件：
- 系统集成关系说明.md
- MDM主数据治理方案.md
- 物料主数据编码规范.md
- 接口设计卡模板.md
- PLM选型评分矩阵.md

---

## Task 3: 创建 plans/ 目录并升级 ROADMAP.md

**Files:**
- Create: `docs/plans/` (目录)
- Create: `docs/plans/系统集成项目计划.md` (新文档，合并 ROADMAP + spec 内容)
- Delete: `docs/ROADMAP.md` (已升级，不再需要)
- Delete: `docs/SPEC.md` (业务关系网络图设计规范已完成，移入 superpowers/specs/)

- [ ] **Step 1: 创建 plans/ 目录**

Run: `mkdir -p "E:/CA001/Infomat/docs/plans"`

Expected: 目录创建成功

- [ ] **Step 2: 读取 ROADMAP.md 内容用于合并**

Read: `docs/ROADMAP.md` (已读取，见上文)

- [ ] **Step 3: 读取系统集成关系说明.md 用于提取系统列表**

Read: `docs/integration/系统集成关系说明.md`

- [ ] **Step 4: 创建系统集成项目计划.md**

基于 spec Section 三的阶段划分和 ROADMAP.md 内容，创建合并后的系统集成项目计划文档。

文档结构：
1. 项目概述 (来自 spec)
2. 阶段划分 P0-P5 (来自 spec Section 3.2)
3. P1 接口范围 (来自 spec Section 3.3)
4. 接口链路清单 (14 条，来自 spec Section 3.3)
5. 远期待确认项 (来自 spec Section 3.4)

Run: (写入文件 `docs/plans/系统集成项目计划.md`)

- [ ] **Step 5: 删除老化的 ROADMAP.md**

Run: `rm "docs/ROADMAP.md"`

Expected: 文件删除成功

- [ ] **Step 6: 移动 SPEC.md 到 superpowers/specs/**

Run: `mv "docs/SPEC.md" "docs/superpowers/specs/SPEC.md"`

Expected: 文件移动成功

- [ ] **Step 7: 验证 plans/ 目录内容**

Run: `ls -la "E:/CA001/Infomat/docs/plans/"`

Expected: 列出 `系统集成项目计划.md`

---

## Task 4: 验证目录结构符合设计规范

**Files:**
- Verify: `docs/` 目录结构

- [ ] **Step 1: 列出完整 docs/ 目录结构**

Run: `find "E:/CA001/Infomat/docs" -type d | sort`

Expected: 目录结构：
```
docs/
├── archives/
│   └── 2026-05-系统集成预审会前/
├── Demo/
├── integration/
├── meetings/
├── organization/
├── plans/
└── superpowers/
    ├── plans/
    └── specs/
```

- [ ] **Step 2: 验证 integration/ 目录文件完整性**

Run: `ls "E:/CA001/Infomat/docs/integration/"`

Expected:
- 系统集成关系说明.md
- MDM主数据治理方案.md
- 物料主数据编码规范.md
- 接口设计卡模板.md
- PLM选型评分矩阵.md

- [ ] **Step 3: 验证 archives/ 目录文件完整性**

Run: `ls "E:/CA001/Infomat/docs/archives/2026-05-系统集成预审会前/"`

Expected (6个文件):
- 系统集成前需要解决的问题.md
- 组织架构专题讨论材料.md
- 系统集成架构专题会_PPT_md版.md
- 主数据专题会_会前信息收集邮件模板_航空复材版_V1.0.md
- H5说明大纲（修订MD版）.md
- 系统集成方案预审会PPT反向稿.md

- [ ] **Step 4: 验证 specifications/ 目录已删除**

Run: `ls "E:/CA001/Infomat/docs/specifications/" 2>&1 || echo "目录不存在(已正确删除)"`

Expected: "目录不存在(已正确删除)"

---

## 自我检查清单

### Spec 覆盖检查

| Spec Section | 实现状态 |
|-------------|---------|
| 1.1 文档诊断 | ✅ T1 完成归档 |
| 1.2 归档目录结构 | ✅ T1 创建 archives/2026-05-系统集成预审会前/ |
| 2.1 活跃文档目录 | ✅ T2 创建 integration/ |
| 2.2 目录说明 | ✅ T2/T3 完成 |
| 3.2 阶段划分 | ✅ T3 在系统集成项目计划.md 中体现 |
| 3.3 P1 接口范围 | ✅ T3 在系统集成项目计划.md 中体现 |
| 三-四 执行顺序 | ✅ 全部 4 项均有对应任务 |

### 占位符检查

- [x] 无 "TBD" / "TODO" / "待实现"
- [x] 无 "添加适当错误处理" 等模糊描述
- [x] 所有步骤均有具体命令或操作内容

### 类型一致性

- [x] 目录名称完全匹配 spec
- [x] 文件名称完全匹配 spec

---

## 执行摘要

完成本计划将实现：
1. 6 个老化文档归档至 `docs/archives/2026-05-系统集成预审会前/`
2. 新建 `docs/integration/` 整合系统集成主文档
3. 新建 `docs/plans/` 存放系统集成项目计划
4. 删除老化的 `specifications/` 和 `ROADMAP.md`
5. `SPEC.md` 移入 `superpowers/specs/`
