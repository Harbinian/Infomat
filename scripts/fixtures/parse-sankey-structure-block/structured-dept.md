---
# ============================================================
# 流程治理结构块 v1（parser 优先读取本块，正文仅供人阅读）
# 边界：本文件是流程输入基线真源；MDM 不得反向覆盖本文件。
# ============================================================

meta:
  dept_code: QM
  dept_name: 质量管理部
  domain: 总经理直辖
  maintainer: 张三
  version: 1.0.0
  status: draft
  parser_schema_version: 1

l3_catalog:
  - l1: 质量管理
    l2: 质量策划
    l3_key: QM.PLAN.001
    l3_name: 质量目标制定与分解
    system: OA
    owner: 质量策划岗
    evidence_refs: [EV-QM-001]
  - l1: 质量管理
    l2: 过程控制
    l3_key: QM.CTRL.001
    l3_name: 首件检验
    system: MES
    owner: 检验员
    evidence_refs: [EV-QM-002, EV-QM-003]

a1_catalog:
  - a1_code: A1-QM-CTRL-001-01
    l3_key: QM.CTRL.001
    behavior: 提交首件检验申请
    role: 操作工
    entry: MES-首件申请单
    system: MES
    evidence_refs: [EV-QM-002]
  - a1_code: A1-QM-CTRL-001-02
    l3_key: QM.CTRL.001
    behavior: 执行首件检验并判定
    role: 检验员
    entry: MES-首件检验记录
    system: MES
    evidence_refs: [EV-QM-003]

evidence_catalog:
  - id: EV-QM-001
    source_type: institution
    source_file: QM-ZD-012 质量目标管理制度.pdf
    locator: "第4.2条 / 第3页"
    locate_method: manual_page
    status: verified
  - id: EV-QM-002
    source_type: form
    source_file: QM-BD-034 首件检验申请单.xlsx
    locator: "表头签批栏"
    locate_method: table_cell
    status: verified
  - id: EV-QM-003
    source_type: institution
    source_file: QM-GC-008 首件检验规程.pdf
    locator: "待定位到具体条款"
    locate_method: clause
    status: pending_review

mdm_requirement_catalog: []
---

# 质量管理部 - 能力-流程-系统映射关系

正文仅供人工阅读，不包含可解析的 legacy DCM/A1 表格。
