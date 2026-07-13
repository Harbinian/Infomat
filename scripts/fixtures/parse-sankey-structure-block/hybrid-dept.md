---
# ============================================================
# 流程治理结构块 v1（覆盖本块声明的 L3/A1；正文 legacy 剩余项继续保留）
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
    l2: 过程控制
    l3_key: QM.CTRL.001
    l3_name: 首件检验
    system: MES
    owner: 检验员
    evidence_refs: [EV-QM-002]

a1_catalog:
  - a1_code: A1-QM-CTRL-001-01
    l3_key: QM.CTRL.001
    behavior: 提交首件检验申请
    role: 操作工
    entry: MES-首件申请单
    system: MES
    evidence_refs: [EV-QM-002]

evidence_catalog:
  - id: EV-QM-002
    source_type: form
    source_file: QM-BD-034 首件检验申请单.xlsx
    locator: "表头签批栏"
    locate_method: table_cell
    status: verified

mdm_requirement_catalog: []
---

# 质量管理部 - 能力-流程-系统映射关系

正文 legacy 表格包含一条与结构块同名冲突的 L3，以及一条未覆盖 L3。

| 部门 | 能力域 | 业务能力 | 业务流程 | 说明 | 应用系统 |
|---|---|---|---|---|---|
| 质量管理部 | 质量管理 | 过程控制 | 首件检验 | legacy 冲突，应被结构块覆盖 | ERP |
| 质量管理部 | 质量管理 | 不合格品控制 | 不合格品评审处置 | legacy 未覆盖，应继续保留 | OA |

## 业务行为（A1）映射

### L3-001 首件检验

| 业务行为（A1）编号 | 业务行为（A1） | 角色 | 应用系统 |
|---|---|---|---|
| A1-QM-CTRL-001-01 | 旧版提交首件检验申请 | 操作工 | ERP |

### L3-002 不合格品评审处置

| 业务行为（A1）编号 | 业务行为（A1） | 角色 | 应用系统 |
|---|---|---|---|
| A1-QM-NC-001-01 | 发起不合格品评审 | 检验员 | OA |
