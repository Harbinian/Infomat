# 质量管理部流程治理结构块试点待审草案

本草案根据 Opus 审核意见收窄试点范围，但没有采用审核样例中新造的 L2、L3 key 或 A1 编号。待审仅使用现有质量管理部映射文件中的真实 L1/L2/L3/A1。

试点范围：`产品检验与符合性` 下的 `产品检验管理`、`首件检验管理`、`检验方案策划管理`，共 7 条稳定 L3、27 条 A1。

## 1. 结构块待审 YAML

```yaml
---
meta:
  dept_code: "QMS"
  dept_name: "质量管理部"
  domain: "总经理直辖"
  maintainer: "待确认"
  version: "0.1.0"
  status: "draft"
  parser_schema_version: 1

l3_catalog:
  - l1: "产品检验与符合性"
    l2: "产品检验管理"
    l3_key: "ZL-02-01"
    l3_name: "工序检验与专检实施"
    system: "MES"
    owner: "待确认"
    evidence_refs: [EV-ZL-P-001]
  - l1: "产品检验与符合性"
    l2: "产品检验管理"
    l3_key: "ZL-02-02"
    l3_name: "关键工序与特种工序检验控制"
    system: "MES"
    owner: "待确认"
    evidence_refs: [EV-ZL-P-001]
  - l1: "产品检验与符合性"
    l2: "产品检验管理"
    l3_key: "ZL-02-03"
    l3_name: "项目特定检验要求执行"
    system: "MES"
    owner: "待确认"
    evidence_refs: [EV-ZL-P-001]
  - l1: "产品检验与符合性"
    l2: "首件检验管理"
    l3_key: "ZL-02-04"
    l3_name: "首件检验计划与三检实施"
    system: "PLM"
    owner: "待确认"
    evidence_refs: [EV-ZL-P-002]
  - l1: "产品检验与符合性"
    l2: "首件检验管理"
    l3_key: "ZL-02-05"
    l3_name: "FAIR编制与审核归档"
    system: "PLM"
    owner: "待确认"
    evidence_refs: [EV-ZL-P-002]
  - l1: "产品检验与符合性"
    l2: "检验方案策划管理"
    l3_key: "ZL-02-06"
    l3_name: "检验方案策划与编制"
    system: "PLM"
    owner: "待确认"
    evidence_refs: [EV-ZL-P-003]
  - l1: "产品检验与符合性"
    l2: "检验方案策划管理"
    l3_key: "ZL-02-07"
    l3_name: "检验方案审批与分发"
    system: "PLM"
    owner: "待确认"
    evidence_refs: [EV-ZL-P-003]

a1_catalog:
  - a1_code: "ZL-L3-29-A01"
    l3_key: "ZL-02-01"
    behavior: "确认检验验收条件（工艺文件齐备、设备校准有效、人员资格有效）"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-004]
  - a1_code: "ZL-L3-29-A02"
    l3_key: "ZL-02-01"
    behavior: "执行自检并记录结果"
    role: "操作者"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-005]
  - a1_code: "ZL-L3-29-A03"
    l3_key: "ZL-02-01"
    behavior: "执行互检并记录结果"
    role: "同工序其他操作者"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-005]
  - a1_code: "ZL-L3-29-A04"
    l3_key: "ZL-02-01"
    behavior: "执行专检并判定检验结论"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-006]
  - a1_code: "ZL-L3-29-A05"
    l3_key: "ZL-02-01"
    behavior: "对不合格品执行标识、隔离并与不合格品控制衔接"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-007]
  - a1_code: "ZL-L3-30-A01"
    l3_key: "ZL-02-02"
    behavior: "识别关键工序并确认检验控制要求"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-008]
  - a1_code: "ZL-L3-30-A02"
    l3_key: "ZL-02-02"
    behavior: "执行关键工序100%检验并记录"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-008]
  - a1_code: "ZL-L3-30-A03"
    l3_key: "ZL-02-02"
    behavior: "确认特种工序随炉件/试片验收要求"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-009]
  - a1_code: "ZL-L3-30-A04"
    l3_key: "ZL-02-02"
    behavior: "检验随炉件/试片性能并判定符合性"
    role: "理化计量室计量员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-009]
  - a1_code: "ZL-L3-31-A01"
    l3_key: "ZL-02-03"
    behavior: "识别项目特定检验要求（商飞重要检验点、MA700授权检验等）"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-010]
  - a1_code: "ZL-L3-31-A02"
    l3_key: "ZL-02-03"
    behavior: "按项目特定检验规程执行检验"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-010]
  - a1_code: "ZL-L3-31-A03"
    l3_key: "ZL-02-03"
    behavior: "在项目特定检验点通知顾客/授权代表到场确认"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "OA"
    evidence_refs: [EV-ZL-P-011]
  - a1_code: "ZL-L3-32-A01"
    l3_key: "ZL-02-04"
    behavior: "识别首件检验触发条件（新产品/新工装/工程更改/产线搬迁/停产恢复）"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-012]
  - a1_code: "ZL-L3-32-A02"
    l3_key: "ZL-02-04"
    behavior: "编制首件检验计划（含检验范围、特性清单、方法、资源）"
    role: "质量安环部技术员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-013]
  - a1_code: "ZL-L3-32-A03"
    l3_key: "ZL-02-04"
    behavior: "审核首件检验计划"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-014]
  - a1_code: "ZL-L3-32-A04"
    l3_key: "ZL-02-04"
    behavior: "执行首件三检（自检、互检、专检）"
    role: "操作者、检验员"
    entry: "待确认"
    system: "MES"
    evidence_refs: [EV-ZL-P-015]
  - a1_code: "ZL-L3-33-A01"
    l3_key: "ZL-02-05"
    behavior: "填写首件检验报告（FAIR）并标注特性气球图"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-016]
  - a1_code: "ZL-L3-33-A02"
    l3_key: "ZL-02-05"
    behavior: "审核FAIR的完整性和准确性"
    role: "质量安环部技术员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-017]
  - a1_code: "ZL-L3-33-A03"
    l3_key: "ZL-02-05"
    behavior: "批准FAIR并归档至制造记录"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-018]
  - a1_code: "ZL-L3-33-A04"
    l3_key: "ZL-02-05"
    behavior: "当工程更改触发FAI变更时重新执行首件检验流程"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-019]
  - a1_code: "ZL-L3-34-A01"
    l3_key: "ZL-02-06"
    behavior: "提取产品设计特性并确定需检验的特性项目"
    role: "质量安环部技术员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-020]
  - a1_code: "ZL-L3-34-A02"
    l3_key: "ZL-02-06"
    behavior: "确定检验顺序和验证方法（目视/量具/检测设备/试验）"
    role: "质量安环部技术员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-021]
  - a1_code: "ZL-L3-34-A03"
    l3_key: "ZL-02-06"
    behavior: "确定所需测量设备和工装清单"
    role: "质量安环部技术员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-022]
  - a1_code: "ZL-L3-34-A04"
    l3_key: "ZL-02-06"
    behavior: "编制完整的检验方案文件"
    role: "质量安环部技术员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-023]
  - a1_code: "ZL-L3-35-A01"
    l3_key: "ZL-02-07"
    behavior: "审核检验方案的技术合理性"
    role: "质量安环部检验员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-024]
  - a1_code: "ZL-L3-35-A02"
    l3_key: "ZL-02-07"
    behavior: "批准检验方案并受控发布"
    role: "质量安环部技术员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-024]
  - a1_code: "ZL-L3-35-A03"
    l3_key: "ZL-02-07"
    behavior: "分发检验方案至生产单元和检验执行岗位"
    role: "质量安环部文档管理员"
    entry: "待确认"
    system: "PLM"
    evidence_refs: [EV-ZL-P-025]

evidence_catalog:
  - id: "EV-ZL-P-001"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.1-§5.7"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-002"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.1-§5.9"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-003"
    source_type: "institution"
    source_file: "SYCXQMS-P5-03/A《产品检验方案的策划程序》"
    locator: "§5.1-§5.5"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-004"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.1"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-005"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.2"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-006"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.3"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-007"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.7"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-008"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.4"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-009"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.5"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-010"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.6"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-011"
    source_type: "institution"
    source_file: "SYCXQMS-P5-07/A《产品检验管理程序》"
    locator: "§5.6"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-012"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.1"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-013"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.2"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-014"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.3"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-015"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.4"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-016"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.5"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-017"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.6"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-018"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.7"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-019"
    source_type: "institution"
    source_file: "SYCXQMS-P5-01/A《首件检验管理程序》"
    locator: "§5.9"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-020"
    source_type: "institution"
    source_file: "SYCXQMS-P5-03/A《产品检验方案的策划程序》"
    locator: "§5.1"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-021"
    source_type: "institution"
    source_file: "SYCXQMS-P5-03/A《产品检验方案的策划程序》"
    locator: "§5.2"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-022"
    source_type: "institution"
    source_file: "SYCXQMS-P5-03/A《产品检验方案的策划程序》"
    locator: "§5.3"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-023"
    source_type: "institution"
    source_file: "SYCXQMS-P5-03/A《产品检验方案的策划程序》"
    locator: "§5.4"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-024"
    source_type: "institution"
    source_file: "SYCXQMS-P5-03/A《产品检验方案的策划程序》"
    locator: "§5.5"
    locate_method: "clause"
    status: "pending_review"
  - id: "EV-ZL-P-025"
    source_type: "institution"
    source_file: "SYCXQMS-P5-03/A《产品检验方案的策划程序》"
    locator: "§5.5"
    locate_method: "clause"
    status: "pending_review"

mdm_requirement_catalog: []
---
```

## 2. 待人工确认清单

| 类型 | 对象 | 需要确认的问题 | 建议确认人 |
|---|---|---|---|
| 编码 | dept_code=QMS / L3=ZL-02-xx / A1=ZL-L3-xx-Axx | 是否接受部门代码用 QMS、流程/A1 继续沿用现有 ZL 编号的双口径？ | 信息化负责人 / 质量管理部接口人 |
| L3 粒度 | ZL-02-01 至 ZL-02-07 | 是否用这 7 条现有稳定 L3 作为首轮试点，而不是合并成 Opus 样例中的 3 条新 L3？ | 流程治理负责人 / 质量管理部 |
| l3_catalog.owner | 全部 7 条 L3 | 现有映射表没有 L3 owner 字段，草案统一为 `待确认`。 | 质量管理部 |
| l3_catalog.system | 全部 7 条 L3 | L3 系统已按主承载系统收敛为单值：产品检验执行类为 MES，首件/FAIR/检验方案类为 PLM；需确认主承载口径是否正确。 | MES/PLM 工作组 / 质量管理部 |
| a1_catalog.entry | 全部 27 条 A1 | `应用模块（S2）` 多为空或 `—`，草案统一为 `待确认`。 | MES/PLM 工作组 / 质量管理部 |
| 角色称谓 | A1 执行角色 | 源表角色仍出现“质量安环部”等历史称谓，是否需要改为现行“质量管理部”口径？ | 质量管理部 / 体系文件管理员 |
| 证据 | 全部 evidence | 本轮未回到制度、表单或原始文件核验，不能标记 `verified`。 | 质量体系文件管理员 |

## 3. 证据成熟度清单

| evidence_id | source_file | locator | status | 原因 |
|---|---|---|---|---|
| EV-ZL-P-001 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.1-§5.7 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-002 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.1-§5.9 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-003 | SYCXQMS-P5-03/A《产品检验方案的策划程序》 | §5.1-§5.5 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-004 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.1 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-005 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.2 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-006 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.3 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-007 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.7 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-008 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.4 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-009 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.5 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-010 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.6 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-011 | SYCXQMS-P5-07/A《产品检验管理程序》 | §5.6 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-012 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.1 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-013 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.2 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-014 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.3 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-015 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.4 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-016 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.5 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-017 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.6 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-018 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.7 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-019 | SYCXQMS-P5-01/A《首件检验管理程序》 | §5.9 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-020 | SYCXQMS-P5-03/A《产品检验方案的策划程序》 | §5.1 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-021 | SYCXQMS-P5-03/A《产品检验方案的策划程序》 | §5.2 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-022 | SYCXQMS-P5-03/A《产品检验方案的策划程序》 | §5.3 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-023 | SYCXQMS-P5-03/A《产品检验方案的策划程序》 | §5.4 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-024 | SYCXQMS-P5-03/A《产品检验方案的策划程序》 | §5.5 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |
| EV-ZL-P-025 | SYCXQMS-P5-03/A《产品检验方案的策划程序》 | §5.5 | pending_review | 仅从映射表读取到制度编号/条款线索，未回到原文核验。 |

## 4. 风险与残留问题

- 本试点切片不能直接作为 `verified` 正式结构块，证据仍需回到制度或表单原文核验。
- Opus 样例中的 `检验实施与策划`、`QMS.INSP.001`、`A1-QMS-INSP-*` 不来自现有映射文件，本草案未采用。
- 试点切片仍是 7 条 L3，而不是 Opus 建议的 3 条 L3；原因是现有稳定 L3 表已经拆到 7 条，直接合并会改变现有 A1 挂接关系。
- 27 条 A1 的 entry 均为 `待确认`，只能证明结构能挂接，不能证明前端可执行入口已明确。
- 本试点切片内 A1 系统均来自源表，未出现空系统；L3 系统已按主承载系统收敛为单值，但仍需业务确认主承载口径。
- `mdm_requirement_catalog` 保持空数组；Opus 建议的检验项目主数据、测量设备主数据需要另行经过字段台账或制度原文确认后再写入。

