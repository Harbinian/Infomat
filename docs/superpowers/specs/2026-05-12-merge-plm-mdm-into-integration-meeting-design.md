# Merge PLM & MDM Detailed Docs into Integration Meeting Page — Design Spec

**Goal:** Fuse detailed PLM implementation plan and MDM 5-stage workflow into the master integration meeting page, enriching PLM/MDM sections while preserving the target's unique analytical framework.

**Date:** 2026-05-12

**Source of truth:** When factual conflicts arise between the target page and the two source files, the source files take precedence.

---

## Architecture

Single-file HTML merge. Three existing HTML files share ~80% CSS overlap with identical `:root` variables and class naming conventions. The merge is additive — CSS classes from sources are added to the target's `<style>` block, and HTML sections are inserted at specific anchor points. No build step, no JavaScript changes required.

## Source → Target Mapping

### PLM source → Target s8 (PLM是什么)

| Source section | Destination | Action |
|---------------|-------------|--------|
| §0 前情总结 (3-card summary) | s8, after sys-hero | Insert as sub-section with `summary-grid` |
| §1 五阶段实施路径 (5 phase-cards) | s8, after 3大闭环 | Insert as sub-section with `phase-stack` |
| §2 工艺规程迁移专项 (3-step + resource table) | s8, after 五阶段 | Insert as sub-section |
| §3 数据字典 (4 dd-sections) | s8, after 迁移专项 | Insert as sub-section |

### MDM source → Target s12 + s14

| Source section | Destination | Action |
|---------------|-------------|--------|
| Cover SVG diagram | s12, top | Insert visual overview of 5-stage pipeline |
| §1 体系定义 (8 categories, encoding, attributes, R&R) | s12, after existing 5 cards | Insert as enriched detail |
| §2-5 full workflow | s14, replace the "chain" block | 5 phase-cards with detailed content |
| §总结 (summary box + risk contrast) | s14, end | Insert summary |
| §4 integration topology SVG | Merge into s13 | Add MDM-centric topology as complementary view |

## Preserved Target Content

These sections are unique to the target and must not be altered:

- s11 主数据事故链 (unique risk narrative with accident chain visualization)
- s13 系统集成拓扑 + 五条数据流 (complementary to MDM source §4)
- s15 黄金源矩阵
- s16 关键接口设计
- s17 Q1-Q8 成熟度
- s18 组织分工确认
- s19 会后行动清单
- appendix

## CSS Merge List

From PLM source, add: `.summary-grid`, `.summary-card`, `.summary-icon`, `.phase-tag` color variants (teal, orange, blue, green), `.flow-steps`, `.flow-step-card`, `.fs-num`, `.fs-check`, `.res-grid`, `.res-card`, `.rn`/`.rl`/`.rd`, `.dd-section`, `.dd-section h4`, `.dd-num`, `.field-grid`, `.field-card`, `.fn`/`.fd`/`.ft`, `.ft-mes`/`.ft-erp`/`.ft-quality`/`.ft-plm`, `.enc`, `.es`/`.ev`/`.el`/`.esep`, `.enc-note`

From MDM source, add: `.cat-grid`, `.cat-card`, `.cat-icon`/`.cat-name`/`.cat-desc`, `.resp-grid`, `.resp-card`, `.r-sys`/`.r-dept`/`.r-desc`, `.badge-row`, `.badge` with color variants, `.flow` (5-col grid), `.flow-step` with color variants (`.green`, `.amber`, `.purple`, `.red`), `.status-chain`, `.st`, `.arrow`, `.dataflow`, `.legend`, `.dot`, `.summary-box`, `.danger`, `.timeline`, `.tl-item`

## Navigation Changes

Add to target nav:
- s8 sub-anchors: `#plm-phases`, `#plm-migration`, `#plm-datadict`
- s14 sub-anchors: `#mdm-stage1` through `#mdm-stage5`

## Factual Conflict Rules

- MDM encoding: source says "≥30位混合编码" → use source value
- MDM timeline: source says "5-6 months" → use source value  
- PLM phases: source has 5 phases with specific T+N timing → use source
- PLM vendor: both agree on 翎瑞鸿翔 → no conflict
- System vendors: target lists all vendors, sources may not → target wins for non-conflicting data
