# 首期 MDM 数据模型设计（组织/人员 + 产品主数据）

> 状态：历史设计记录。最后复核：2026-06-17。适用范围：仅用于追溯早期 MDM 建模思路，不作为当前执行计划或当前流程输入基线。
> 备注：原文曾引用 `docs/integration/物料主数据编码规范.md`，当前仓库未包含该文件；涉及该规范的表述按“历史参考”理解，后续如需恢复应先补齐资料真源。

## 0. 设计范围与已确认决策

- 管理模式：Transaction Hub（MDM作为录入与主控系统）
- 首期主数据域：组织/人员 + 产品主数据（PLM口径，ERP按PLM执行）
- 组织层级：类型 + 层级可配置（OrgType + Parent 形成树）
- 组织/人员主链路：岗位为核心（Person 通过任岗 Assignment 关联 Position，Position 归属 OrgUnit）
- 产品版本：版本 = 新产品记录（每次工程变更形成新的 Product 记录）
- 产品聚合：增加 ProductFamily（型号根/产品族）用于跨版本聚合与查询
- 编码：首期由 MDM 生成“带语义的可读编码”，要求能从编码识别实体类型与基础分类信息（内部ID与可读编码分离）
- 属性扩展：AttributeDef + AttributeValue（避免加字段就发版）
- 系统映射：ExternalIdentity（统一外部主键/编码映射）
- 安全策略：内部ID不在前端展示；非管理员不可访问内部ID（接口返回与查询均需控制）

## 1. 建模原则

- 内部ID与业务可读编码分离：内部ID稳定不变；可读编码可按规则生成但不作为外键唯一来源
- 时间有效性：对组织/岗位/任岗关系提供有效期字段，支持历史追溯
- 生命周期状态：对产品/组织提供 status/lifecycle_state 支撑受控发布与废止
- 扩展优先走“元数据”：分类与属性通过配置表扩展，减少频繁改表
- 与历史规范口径一致：曾参考“物料主数据编码规范”中“REV 独立字段、不进主编码”的原则，产品版本与编码解耦；当前仓库未包含该规范文件，后续恢复引用前需先补齐资料真源

## 2. 编码策略（首期）

### 2.1 编码生成目标

- 满足人工可识别、可沟通（页面展示/报表/接口）
- 满足系统唯一性（同一实体类型内唯一）
- 不与外部系统编码强绑定（通过 ExternalIdentity 映射即可）
- 编码承载最小语义：实体类型 + 分类/归属（禁止写入易变信息，如中文名称全称）

### 2.2 建议编码格式（可配置）

#### 2.2.1 组织类型（org_type）枚举（首期）

- company（公司）
- department（部门）
- office（办公室）
- team（班组）

建议配套 type_code（用于编码语义段）：

- company → `COM`
- department → `DEPT`
- office → `OFC`
- team → `TEAM`

#### 2.2.2 OrgUnit（组织单元）

目标：从编码识别“组织类型 + 组织简称/归属”。

- org_unit_code：`OU-{type_code}-{mnemonic}-{seq}`
  - 示例：`OU-DEPT-ENG-000123`、`OU-OFC-HR-000008`、`OU-TEAM-LAY-000042`
  - mnemonic（组织简称）为必填字段，规则：
    - 3~8位，A-Z0-9，下划线可选
    - 一经生效后不允许修改（避免编码语义漂移）

#### 2.2.3 Position（岗位）

目标：从编码识别“岗位归属组织 + 岗位类别”。

- position_code：`POS-{org_mnemonic}-{pos_mnemonic}-{seq}`
  - 示例：`POS-ENG-DES-000031`、`POS-QA-INS-000014`
  - pos_mnemonic（岗位简称）为必填字段，规则同 org mnemonic；一经生效后不允许修改

#### 2.2.4 Person（人员/工号）

人员流动会导致“部门语义”不稳定，因此工号仅承载“实体类型语义”，不强塞归属信息。

- employee_no：`EMP-{seq}`
  - 示例：`EMP-000381`

#### 2.2.5 ProductFamily（型号根/产品族）

目标：从编码识别“产品族归属型号/项目 + 大类”。

- product_family_code：`PF-{model_code}-{class_major}-{seq}`
  - 示例：`PF-S19-CF-000052`
  - model_code：3位项目/机型代码（如 `S19`），由业务维护（不建议从名称自动截取）
  - class_major：2位大类码，可对齐物料编码规范中的大类（如 `CF/ME/AS`）

#### 2.2.6 Product（版本化产品记录）

目标：从编码识别“型号/项目 + 分类”。

- product_code：`PRD-{model_code}-{class_major}-{class_mid}-{class_minor}-{seq}`
  - 示例：`PRD-S19-CF-RFF-PNL-00001`
  - 与历史“物料主数据编码规范”的段位保持一致（大类/机型/中类/小类/流水）；当前仓库未包含该规范文件，后续恢复引用前需先补齐资料真源
  - revision 独立字段，不要求进入 product_code

备注：

- 如果你们后续需要“件号/对外交付件号”，建议继续遵循“件号与内部编码分离，通过映射表关联”的原则

### 2.3 编码实现建议

- 提供 CodeRule 与 CodeSequence（按 entity_type + scope_key 维度生成流水）
  - scope_key 用于支持“按 model_code + class 维度分段流水”，例如 Product 的 scope_key 可取：`S19|CF|RFF|PNL`
- 编码生成在“提交生效”动作发生时生成（避免草稿占号）
- mnemonic 字段与 model_code 字段在生效后锁定（只能停用/废止，不允许改写）

## 3. 数据对象清单（MVP）

### 3.1 组织/人员域

- OrgUnit（组织单元）
- Position（岗位）
- Person（人员）
- PersonPositionAssignment（任岗关系）

### 3.2 产品主数据域（PLM口径）

- ProductFamily（型号根/产品族）
- Product（版本化产品记录）
- ClassNode（分类树，可用于产品分类、也可对齐物料分类）
- EntityClassMembership（实体与分类的关系）
- AttributeDef（属性定义）
- AttributeValue（属性值）

### 3.3 跨系统映射与集成运营

- ExternalSystem（外部系统定义：PLM/ERP/DW）
- ExternalIdentity（外部标识映射）

## 4. 数据字典（表结构与约束）

字段类型不绑定具体数据库实现，建议映射：id=UUID，时间=DATETIME，状态=ENUM/TEXT，金额/数量=DECIMAL。

### 4.1 org_unit

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| org_unit_id | 是 | 是 | 内部ID |
| org_unit_code | 是 | 是 | MDM可读编码 |
| org_unit_name | 是 | 否 | 名称 |
| org_type | 是 | 否 | 组织类型（集团/公司/工厂/部门/班组…） |
| org_mnemonic | 是 | 是 | 组织简称（用于编码语义段） |
| parent_org_unit_id | 否 | 否 | 上级组织ID（同表外键） |
| manager_person_id | 否 | 否 | 负责人（外键到 person） |
| status | 是 | 否 | draft/active/inactive（建议） |
| effective_from | 是 | 否 | 生效时间 |
| effective_to | 否 | 否 | 失效时间 |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

约束建议：

- org_unit_code 唯一
- parent_org_unit_id 不能形成环（树结构校验）
- effective_from <= effective_to（若存在）

### 4.2 position

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| position_id | 是 | 是 | 内部ID |
| position_code | 是 | 是 | MDM可读编码 |
| position_name | 是 | 否 | 岗位名称 |
| pos_mnemonic | 是 | 否 | 岗位简称（用于编码语义段） |
| org_unit_id | 是 | 否 | 归属组织（外键到 org_unit） |
| status | 是 | 否 | draft/active/inactive |
| effective_from | 是 | 否 | 生效时间 |
| effective_to | 否 | 否 | 失效时间 |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

### 4.3 person

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| person_id | 是 | 是 | 内部ID |
| employee_no | 是 | 是 | 工号（MDM生成） |
| person_name | 是 | 否 | 姓名 |
| mobile | 否 | 否 | 手机 |
| email | 否 | 否 | 邮箱 |
| employment_status | 是 | 否 | active/leave/suspended（建议） |
| status | 是 | 否 | draft/active/inactive |
| effective_from | 是 | 否 | 生效时间 |
| effective_to | 否 | 否 | 失效时间 |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

约束建议：

- employee_no 唯一
- mobile/email 可做可选唯一（按你们实际决定）

### 4.4 person_position_assignment

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| assignment_id | 是 | 是 | 内部ID |
| person_id | 是 | 否 | 外键到 person |
| position_id | 是 | 否 | 外键到 position |
| is_primary | 是 | 否 | 是否主岗 |
| start_date | 是 | 否 | 开始日期 |
| end_date | 否 | 否 | 结束日期 |
| status | 是 | 否 | active/inactive |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

约束建议：

- 同一 person_id 只能存在 1 条 is_primary=true 且 status=active 的记录
- end_date >= start_date（若存在）

### 4.5 product_family

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| product_family_id | 是 | 是 | 内部ID |
| product_family_code | 是 | 是 | MDM可读编码 |
| model_name | 是 | 否 | 型号/产品族名称 |
| model_code | 是 | 否 | 项目/机型代码（3位，用于编码语义段） |
| class_major | 是 | 否 | 产品大类码（建议对齐物料大类） |
| product_type | 否 | 否 | 产品类型（枚举/字典） |
| status | 是 | 否 | draft/active/inactive |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

### 4.6 product（版本化产品记录）

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| product_id | 是 | 是 | 内部ID |
| product_code | 是 | 是 | MDM可读编码（建议不把rev固化进编码） |
| product_family_id | 是 | 否 | 外键到 product_family |
| revision | 否 | 否 | 版次/修订号（独立字段） |
| class_mid | 否 | 否 | 中类码（3位） |
| class_minor | 否 | 否 | 小类码（3位） |
| lifecycle_state | 是 | 否 | draft/released/obsolete（建议） |
| superseded_by_product_id | 否 | 否 | 指向新版本 product_id（可空） |
| effective_from | 否 | 否 | 生效时间（released时赋值） |
| effective_to | 否 | 否 | 失效时间（被替代/废止时赋值） |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

约束建议：

- product_code 唯一
- superseded_by_product_id 指向同一 product_family_id（可做应用层校验）

### 4.7 class_node（分类树）

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| class_node_id | 是 | 是 | 内部ID |
| class_code | 是 | 是 | 分类编码（可对齐大类/中类/小类） |
| class_name | 是 | 否 | 分类名称 |
| class_type | 是 | 否 | product/material/common（建议） |
| parent_class_node_id | 否 | 否 | 上级分类（同表外键） |
| status | 是 | 否 | active/inactive |

### 4.8 entity_class_membership

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| membership_id | 是 | 是 | 内部ID |
| entity_type | 是 | 否 | product/product_family/… |
| entity_id | 是 | 否 | 内部ID |
| class_node_id | 是 | 否 | 外键到 class_node |
| is_primary | 是 | 否 | 主分类标识 |
| created_at | 是 | 否 | 创建时间 |

约束建议：

- entity_type + entity_id + class_node_id 唯一
- 同一 entity_type + entity_id 只能一个 is_primary=true（如需）

### 4.9 attribute_def

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| attribute_def_id | 是 | 是 | 内部ID |
| attribute_code | 是 | 是 | 属性编码（稳定） |
| attribute_name | 是 | 否 | 属性名 |
| data_type | 是 | 否 | string/number/date/boolean/enum/json |
| enum_ref | 否 | 否 | 若为enum，指向字典/枚举定义 |
| applies_to | 是 | 否 | product/product_family/common |
| is_required | 是 | 否 | 是否必填 |
| status | 是 | 否 | active/inactive |

### 4.10 attribute_value（以产品为例）

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| attribute_value_id | 是 | 是 | 内部ID |
| entity_type | 是 | 否 | product/product_family |
| entity_id | 是 | 否 | 内部ID |
| attribute_def_id | 是 | 否 | 外键到 attribute_def |
| value_string | 否 | 否 | 字符值（按data_type落不同列或统一JSON） |
| value_number | 否 | 否 | 数值 |
| value_date | 否 | 否 | 日期 |
| value_bool | 否 | 否 | 布尔 |
| value_json | 否 | 否 | JSON |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

约束建议：

- entity_type + entity_id + attribute_def_id 唯一

### 4.11 external_system

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| system_id | 是 | 是 | 内部ID |
| system_code | 是 | 是 | PLM/ERP/DW 等 |
| system_name | 是 | 否 | 名称 |
| status | 是 | 否 | active/inactive |

### 4.12 external_identity

| 字段 | 必填 | 唯一 | 说明 |
|---|---:|---:|---|
| external_identity_id | 是 | 是 | 内部ID |
| entity_type | 是 | 否 | OrgUnit/Position/Person/Product/… |
| entity_id | 是 | 否 | 内部ID |
| system_code | 是 | 否 | 外部系统编码（外键到 external_system.system_code 或直接枚举） |
| external_key | 是 | 否 | 外部系统“内部ID”（不在前端展示；由集成账号访问） |
| is_primary | 是 | 否 | 是否该系统侧主标识 |
| last_sync_at | 否 | 否 | 最近同步时间 |
| last_sync_status | 否 | 否 | ok/failed/pending |
| created_at | 是 | 否 | 创建时间 |
| updated_at | 是 | 否 | 更新时间 |

约束建议：

- entity_type + entity_id + system_code 唯一（每个实体对每个系统最多一条映射）
- system_code + external_key 唯一（避免同一外部key指向多个内部实体）

## 5. 最小流程（与模型配套）

### 5.1 组织/人员

- OrgUnit/Position/Person 创建为 draft
- 提交生效时：
  - 生成 org_unit_code/position_code/employee_no
  - 置 status=active，写 effective_from
- 任岗：
  - 新增 assignment（默认 active）
  - 校验同一人仅一条主岗 is_primary=true

### 5.2 产品（PLM口径）

- ProductFamily 创建为 draft，提交生效后生成 product_family_code
- Product 创建为 draft：
  - 若是新版本：在旧版本 product 上写 superseded_by_product_id
  - 提交 released 时写 effective_from
  - obsolete 时写 effective_to

## 6. 下一步工作拆分（从“模型”走向“可用”）

- 第一步：确认枚举与字典
  - org_type（company/department/office/team）、employment_status、lifecycle_state、product_type、class_type、attribute.data_type
- 第二步：落地“语义编码”输入项与校验
  - OrgUnit：org_mnemonic（生效后锁定）
  - Position：pos_mnemonic（生效后锁定）
  - ProductFamily：model_code + class_major（生效后锁定）
  - Product：class_mid/class_minor + seq（按 scope_key 分段流水）
- 第三步：对齐 PLM/ERP 的 external_key 口径（按内部ID）
  - PLM：external_key=PLM内部ID（GUID/数字均可）
  - ERP：external_key=ERP内部ID
  - 前端/普通用户不展示、不查询 external_key
- 第四步：补齐“内部ID不可见”的接口与权限规范
  - 对外（前端）接口仅允许用 code 检索；响应体不返回 *_id 字段
  - 管理员/集成账号可访问 id/external_key（用于排障、对账与集成）

## 7. 内部ID不可见（安全与接口约束）

### 7.1 核心原则

- 内部ID（如 org_unit_id/person_id/product_id）是系统内部主键，默认不在前端展示
- 非管理员用户：
  - 不允许通过内部ID查询详情
  - 接口响应不返回内部ID字段（用 code 作为对外标识）
- 集成账号：
  - 允许读写 ExternalIdentity.external_key
  - 允许在特定接口中读取内部ID（用于映射/对账）

### 7.2 建议角色划分（最小集）

- Admin：可见内部ID与 external_key，可做全量查询、排障与映射修复
- Steward（业务维护人员）：只能用 code 操作业务对象；不可见内部ID与 external_key
- IntegrationClient（系统对接账号）：只允许访问“集成接口集合”，用于交换 external_key 与业务字段

### 7.3 接口形态建议（示例）

- 前端查询：`GET /api/org-units?code=OU-DEPT-ENG-000123`
- 管理查询：`GET /api/admin/org-units/{org_unit_id}`
- 集成映射：`POST /api/integration/external-identities`（仅 IntegrationClient 可用）
