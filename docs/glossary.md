# Infomat 项目术语表

> 版本：V1.4
> 更新日期：2026-07-01
> 用途：为 AI 辅助开发提供统一的术语参考。按域分章，每章一张三列表。

## 使用约定

- 术语以中文名为主键，英文/缩写列记录对应英文全称或缩写
- 定义控制在 1–2 句话，只解释"这个术语在项目中是什么意思"
- 同名词跨域出现时，在各域各自收录，定义聚焦该域语境
- 新增术语直接追加到对应域表格末尾

---

## 1. 业务域

覆盖部门组织、能力流程、系统映射、跨部门协同相关的术语。

| 术语 | 英文/缩写 | 定义 |
|------|----------|------|
| 部门（D1） | Department / D1 | 组织架构中的职能部门或生产单元，桑基图第 1 层节点 |
| 办公室（D2） | Office / D2 | 部门（D1）下的办公室、室、组等二级组织层，仅在资料支持办公室级责任时纳入映射 |
| 跨部门组合 | Joint Department | 多个部门以 `+` 连接的联合牵头节点，如"工技+物保+质量"，仅在桑基图中表达 |
| 能力域（L1） | Capability Domain / L1 | 按业务域聚合的高阶能力分类，如"工艺生产过程管控""质量执行" |
| 业务能力（L2） | Business Capability / L2 | capabilities 表中 level=L2 的记录，对业务流程（L3）进行归类聚合 |
| 业务流程（L3） | Business Process / L3 | 具体可执行的操作流程，如"首件检验""MBOM 编制""工装定检"。capabilities 表中 level=L3 的记录 |
| 业务行为（A1） | Activity Level 1 / A1 | 业务流程（L3）分解后的原子级业务行为，是部门职责落地的最小可执行单元 |
| 业务行为（A2） | Activity Level 2 / A2 | 业务行为（A1）下的可选细分层，仅在用户要求更深拆分时启用 |
| 应用系统（S1） | Application System / S1 | 承载业务流程的信息系统，包括 PLM、MES、ERP（用友 U8），桑基图系统层节点 |
| 应用模块（S2） | Application Module / S2 | 应用系统（S1）下的模块、菜单或页面，仅在系统资料支持模块级映射时纳入 |
| 映射关系 | Mapping | 部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 业务流程（L3）→ 应用系统（S1）的关联关系，Infomat 平台的核心管理对象。数据表 mappings |
| 桑基图 | Sankey Diagram | ECharts 渲染的流向图，可视化展示部门（D1）、能力域（L1）、业务能力（L2）、业务流程（L3）和应用系统（S1）的映射关系 |
| PLM | Product Lifecycle Management | 产品生命周期管理系统，管理设计数据（EBOM）、工艺文件（CAPP）、工装策划与设计、MBOM 等 |
| MES | Manufacturing Execution System | 制造执行系统，管理生产过程执行、质量检验、工装使用与维护、设备运维等 |
| ERP | Enterprise Resource Planning | 本项目特指用友 U8，管理计划排程、采购、库存、财务、成本核算 |
| MBOM | Manufacturing Bill of Material | 制造物料清单，面向 ERP/MES/计划执行，表达投产、批次、工单、生产数量、制造资源和现场执行关系 |
| EBOM | Engineering Bill of Material | 工程设计物料清单，PLM 侧维护的设计零部件结构，含设计件、标准件、通用件、借用件的版本和状态，是下游 BOM 的源头 |
| PBOM | Process Bill of Material | 工艺物料清单，在 EBOM 基础上按工艺路线、工序、装配关系重组，引入工装、辅料、虚拟件、半成品，是 MBOM 的前置基础 |
| BOP | Bill of Process | 工艺过程清单，表达工艺路线、工序、工步的组织方式。与 PBOM 互补：PBOM 管"装什么"，BOP 管"怎么装" |
| 数字主线 | Digital Thread | 以 BOM 为骨架，把设计、工艺、制造、交付、服务、运维各阶段的数据状态、版本、配置、有效性串起来的数据贯通思路 |
| 实作 BOM / 实物 BOM | As-Built BOM | 记录实际装配、替换、代料、偏离、返修、批次、实物状态的 BOM，交付前后形成 |
| 批次 BOM | Batch BOM | 对某一生产批次/订单/架次的产品配置进行冻结的结构实例，解决"同型号不同批次配置不同"的问题 |
| SBOM | Service BOM | 服务 BOM，支撑服务保障、预测维修和数字孪生的产品结构视图 |
| DBOM | Delivery BOM | 交付 BOM，支撑交付验收的产品结构视图 |
| OBOM | Operations BOM | 运维 BOM，支撑运行维护的产品结构视图 |
| CAPP | Computer Aided Process Planning | 计算机辅助工艺设计，PLM 系统的子模块，管理工艺路线、工序卡片和工时定额 |
| 标准件 | Standard Part | 来自标准件库的通用零部件（如螺栓、铆钉），可在多个产品中直接引用 |
| 通用件 | Common Part | 可在多个产品/项目中复用的零部件，与借用件不同——通用件是主动设计为可复用，借用件是从已有产品结构引用 |
| 借用件 | Borrowed Part | 从已有产品结构中借用的零部件，特别容易带来版本同步和上下游影响问题，必须有来源关系追踪 |
| 虚拟件 | Phantom Part | 工艺拆分产生的逻辑组件，用于组织工艺路线和装配关系，不对应实物库存 |
| 辅料 | Auxiliary Material | 不进入 EBOM 但参与制造过程的消耗性物料（如脱模剂、清洗剂），出现在 PBOM/MBOM 中 |
| 半成品 | Semi-Finished Product | 制造过程中的中间交付物，在 PBOM/MBOM 中作为独立节点管理 |
| 工艺件 | Process Part | 仅在工艺/制造阶段使用的对象（如工装、夹具、样板），不出现在 EBOM 中 |
| 基线 | Baseline | 某一时刻冻结的产品结构快照，用于控制 EBOM/PBOM/MBOM 下发和变更的参照点 |
| 配置有效性 | Configuration Effectiveness | 定义某个零部件版本在什么条件下适用（时间、批次、架次、订单），是版本控制的关键维度 |
| 成熟度 | Maturity | 设计/工艺/制造对象的就绪程度标识，如设计中→审批中→冻结→发布，不等同于版本号 |
| 关键件 | Critical Part | 对产品安全、功能或性能有重大影响的零部件，需重点控制其版本、状态和变更 |
| 工步 | Work Step | 工序下的最小操作单元，定义具体的加工动作和技术参数 |
| 工位 | Work Station | 生产现场的作业位置，关联设备、工装和人员，用于组织工序执行 |
| 架次 | Sortie | 航空制造中的批次/架次概念，同一型号不同架次可能有不同技术状态和配置 |
| 技术状态 | Technical State / Configuration | 产品在某一时刻的设计、工艺、制造状态的综合快照，通过版本+状态+有效性共同控制 |
| 数字孪生 | Digital Twin | 物理产品的虚拟映射模型，由实作 BOM 和服务 BOM 驱动，支撑运行维护和预测性维修 |
| 黄金源 | Golden Source | 某一数据字段的权威来源系统，在 field_identities 表中确认，用于解决跨系统数据一致性问题 |
| 字段台账 | Field Ledger | 记录各业务流程涉及的数据字段及其来源系统、流转路径的台账，黄金源确认的前置输入 |
| 字段身份 | Field Identity | 对某一字段的黄金源归属做出的正式确认，存储在 field_identities 表 |
| 跨部门协同 | Cross-Department Collaboration | 多个部门联合参与同一业务能力的组织模式，桑基图中以组合节点表示 |
| 审批流 | Approval Flow | 映射关系从 draft 到 published 的七步状态机，每步生成审批任务和审计记录 |
| 状态机 | State Machine | mappings.status 的状态变迁模型：draft→submitted→dept_reviewed→cross_confirmed→fields_confirmed→final_reviewed→published |
| 工时定额 | Labor Hour Quota | 完成特定零件或工序所需的标准工时，用于生产计划、排程和成本核算 |
| 术语冲突 | Term Conflict | 同一术语在不同部门/系统中含义不一致，记录在 term_conflicts 表 |
| 跨部门待办 | Cross-Department Todo | 因映射关系变更或冲突需要相关方处理的任务，记录在 todos 表 |
| 版本历史 | Version History | 映射关系、术语等关键实体的变更记录，通过 change_set + version_log 表实现 |
| 变更集 | Change Set | 一次提交中包含的多个变更的原子集合，用于版本追溯 |
| 外部标识 | External Identity | 外部系统（PLM/MES/ERP）中的对象编号与本系统的关联映射 |
| 战略规划与经营指标治理 | Strategic Planning & KPI Governance | 经营发展部 L1 能力域，涵盖发展规划、年度经营指标、部门绩效和月度绩效考核 |
| 市场开发与客户合同治理 | Market Development & Contract Governance | 经营发展部 L1 能力域，涵盖市场信息收集、报价谈判、合同评审、顾客沟通与满意度 |
| 订单交付与项目履约治理 | Order Delivery & Project Fulfillment | 经营发展部 L1 能力域，涵盖销售订单评审、项目经营合规、产品交付结算、工作转移和交付后不合格品管理 |
| 采购与供应商资源治理 | Procurement & Supplier Governance | 经营发展部 L1 能力域，涵盖采购分类周期、供应商开发评价、审核批准、绩效评价、风险再评价和采购实施 |
| 外包外协与委外检测治理 | Outsourcing & External Testing | 经营发展部 L1 能力域，涵盖外协加工、外包管理、临时/紧急外包和外委检测 |
| 基建技改与设备验收治理 | Infrastructure & Equipment Acceptance | 经营发展部 L1 能力域，涵盖年度基建技改计划、报修实施、新设备验收和固定资产移交 |
| 管理体系流程与文化创新治理 | Management System & Innovation | 经营发展部 L1 能力域，涵盖体系文件编制编码、质量沟通、管理创新和企业文化建设 |
| 合规风险与外部申报治理 | Compliance Risk & External Filing | 经营发展部 L1 能力域，涵盖政策项目申报、内部控制与全面风险管理、项目激励、海关申报和法律证照管理 |
| 工装需求与设计管理 | Tooling Demand & Design | 物资保障部 L1 能力域，涵盖工装工具策划、工艺装备申请、工装设计与更改管理 |
| 工装验收与验证管理 | Tooling Acceptance & Verification | 物资保障部 L1 能力域，涵盖新制/返修/定检工装的实物与文件验收、不合格审理处置和投产前产品特性验证 |
| 工装运行管理 | Tooling Operations | 物资保障部 L1 能力域，涵盖工装接收建账、日常使用、定检定查、返工返修、维护保养、封存与优化改进 |
| 工具管理 | Tool Management | 物资保障部 L1 能力域，涵盖通用工具和专用工具的申请、采购、验收、库房、使用维护、调拨、维修、报废和量具检定 |
| 物资库房与备件管理 | Warehouse & Spare Parts | 物资保障部 L1 能力域，涵盖生产物料（含冷库材料）的接收、检验、运转、储存、出入库和设备备件管理 |
| 体系与信息化支撑 | System & IT Support | 物资保障部 L1 能力域，涵盖工装信息台账、OA 勤哲模块开发维护和部门制度文件版本控制 |
| 工艺装备品种表 | Tooling Varieties List | 按项目/机型编制的工装品种与数量清单（FM1407-47），是工装策划的核心输出物 |
| 工装定检目录 | Tooling Periodic Inspection Catalog | 记录每项工装的定检周期、定检类型和技术要求文件编号的管理台账 |
| 勤哲模块 | QinZhe Module | 昌兴复材内部 OA 平台的轻量开发模块，物资保障部用于工装信息管理和流程自动化 |
| 定检/定查 | Periodic Inspection/Check | 工装按周期进行的定期检修（定检）和定期检查（定查），定检侧重修复和校准，定查侧重状态确认 |
| 共用工装校准 | Shared Tooling Calibration | 生产和检验共用工装在使用前的校准管理，确保测量和加工基准一致 |
| 客供工装 | Customer-Provided Tooling | 由顾客（如商飞、波音）提供的工艺装备，需单独建账管理 |
| 项目决策组 | Project Steering Group | 昌兴复材数字化底座项目的最高决策机构，由公司决策层和 PMO 主管组成，对项目启动、治理授权、阶段门放行、跨部门责任边界、启动令签发等重大事项进行裁决（DLV-001 至 DLV-004 共同使用） |
| 项目启动令 | Project Launch Order | 项目启动会表决通过后由项目决策组签发的正式授权文件，标志项目从筹备期进入启动执行期，DLV-001 表决项 V-08 的输出物 |
| 责任池 | Responsibility Pool | 启动期与调研期对历史问题暴露的治理保护机制：历史流程、数据、跨部门边界、表单台账和历史不符合项先入池记录、分级、确认责任边界并制定治理动作；除拖期、交付物未交、材料质量过于低劣三类例外外不追责，DLV-002/DLV-003 治理原则 3 的核心机制 |
| 文档结构化输出 | Document Structured Output | MDM 流程治理中的制度创建能力，把制度说明、目的范围、术语、流程与行为、跨部门承接、附表结构、提交审核、结构化预览和 Markdown 草案按 9 个节点保存为可审核、可发布的结构化草稿；流程的 L1 能力域和 L2 业务能力从 MySQL 中本部门已有映射关系选择，不在此处新增；草稿或退回修改状态下支持明细编辑、删除和业务行为作废 |
| 作废业务行为 | Voided Business Behavior | 文档结构化输出中被维护人标记为不再生效的业务行为；它保留在草稿详情和事件历史中用于追溯，但不参与 Markdown、发布版本、流程图谱和 A1 投影 |
| 附表结构 | Form Table Structure | 制度或表单中的主表、明细表及其字段结构，包括表名、系统生成的表编号、系统生成的字段编号、字段名称、字段类型和是否必填 |
| 跨部门承接关系 | Cross-Department Handoff | 一个业务行为需要其他部门继续处理时记录的承接关系，本部门发起承接部门和承接标准，承接流程编号、承接流程和承接业务行为由承接部门回写 |

---

## 2. 主数据域

覆盖物料编码、MDM 数据模型、编码引擎和主数据治理相关的术语。

| 术语 | 英文/缩写 | 定义 |
|------|----------|------|
| 主数据管理 | MDM / Master Data Management | 对企业核心业务实体（物料、组织、人员、产品等）的编码、属性、生命周期进行统一管理的系统和方法 |
| 主数据编码 | Master Data Code | 为每一物料/零部件分配的唯一标识，作为跨系统"身份证号"，最大长度 30 位（含分隔符） |
| 类型码 | Type Code | 物料编码的前 3 位大写字母，标识物料大类。共 10 种：PRT/PRC/TLG/MTR/CTL/TLS/GAG/FST/EQP/CSM |
| 零组件 | PRT / Part | 设计零件/零部件，编码模板一（项目归口型），总长 26 位。PLM 发起，MDM 拼装校验 |
| 工艺组件 | PRC / Process Component | 工艺拆分产生的虚拟组件，不等同实物库存。编码模板一（项目归口型），总长 26 位 |
| 工装 | TLG / Tooling | 工艺装备/模具/夹具，编码模板一（项目归口型），总长 26 位。扩展位承载工装类型信息 |
| 主要材料 | MTR / Material (Raw) | 原材料/辅料，编码模板二（材料规范型），总长 23 位。按材料规范、型类级、牌号短码映射 |
| 刃具 | CTL / Cutting Tool | 铣刀、钻头、铰刀、丝锥、镗刀等，编码模板四（分类流水型），总长 16 位。按大类+材料取流水 |
| 一般工具 | TLS / Tools | 非量具、非刃具的通用工具（手动/气动/电动工具等），编码模板四，总长 14 位 |
| 量具 | GAG / Gauge | 卡尺、千分尺、高度规、塞规、硬度计、三坐标等计量器具，编码模板四，总长 22 位。原待确认码 QMS 已更名为 GAG |
| 工装标准件 | FST / Fastener / Standard Parts | 螺栓、铆钉、衬套、垫圈、螺母、螺钉、销等，编码模板三（标准号型），总长 16–30 位 |
| 设备 | EQP / Equipment | 生产、测量、保障、安全、环境、信息设备，编码模板四，总长 15 位 |
| 机物料 | CSM / Consumable / Supplies | 工具/量具/刃具剥离后的剩余机物料品类，编码模板四，总长 15 位 |
| 编码模板 | Coding Template | 四种编码段位结构：项目归口型（一）、材料规范型（二）、标准号型（三）、分类流水型（四） |
| 校验位 | Check Digit | 编码最末 1 位，MOD11 算法计算，可能为 0–9 或 X。用于防手工输入错误 |
| MOD11 | Modulus 11 | 校验位算法：从右向左以 2→9 循环加权，字母 A–Z 映射为 10–35，总和 mod 11 取余 |
| 项目号 | Project Code | 模板一第 2 段，3 位字母+数字，标识机型/项目（如 C91=C919） |
| 部段号 | Segment Code | 模板一第 3 段，4 位字母+数字，标识飞机部段及子类型（如 5382：538=后机身，2=压力框） |
| 说明型编号 | Descriptive Number | 模板一第 4 段，5 位字母+数字，工程技术人员在 PLM 中指定的编号 |
| 扩展位 | Extension | 模板一第 5 段，5 位字母+数字，承载批产/研制（性质1）、交付层级（性质2）、构型变体三维信息 |
| 规范短码 | Spec Short Code | 模板二 MTR 编码的 5 位字母+数字段，通过映射表关联到完整材料规范号（如 CP037→CMS-CP-307） |
| 型类级 | Type-Class-Grade | 模板二 MTR 编码的 3 字母+数字段，每位 16 进制表示材料的型、类、级 |
| 标准短码 | Standard Short Code | 模板三 FST 编码的 1–15 位字母+数字段，通过映射表关联到原始标准号（如 HB1101→HB1-101） |
| 拼装模式 | Assembly Mode | 编码生成模式一：外部传入各段值→MDM 拼接+校验→唯一性检查→返回。适用 PRT/PRC/TLG |
| 映射模式 | Mapping Mode | 编码生成模式二：外部传入材料描述→MDM 查建短码映射+拼接+校验→返回。适用 MTR |
| 流水模式 | Sequence Mode | 编码生成模式三：外部传入分类参数→MDM 按 scope_key 取流水+拼接+校验→返回。适用 CTL/TLS/GAG/FST/EQP/CSM |
| scope_key | Scope Key | 流水号切分维度，决定哪些参数组合下独立递增。如 GAG 的 scope_key = 分类\|公英制\|手固\|精度\|检周 |
| 幂等请求 | Idempotent Request | 编码申请通过 request_id 去重，同一幂等键已成功则返回既有编码，防止重复分配 |
| 编码流水 | Code Sequence | code_sequences 表管理的分段计数序列，同一 scope_key 下独立递增，流水号不得复用 |
| 短码映射 | Short Code Mapping | 将含非法字符的原始业务值转换为符合字符集的短码的对照表机制，原始值作为独立字段保留 |
| 一物一码 | One Object One Code | 核心编码原则：每物料分配唯一编码，杜绝一物多码和多物一码。编码一经分配即不变 |
| 生命周期状态 | Lifecycle Status | 物料编码的状态字段：draft / active / obsolete。状态不嵌入编码本体 |
| 产品族 | Product Family | product_family 表，产品型号根节点（如 C919），下挂版本化产品 |
| 版本化产品 | Versioned Product | product 表，带版本号和生命周期的产品记录，支持发布/废止操作 |
| 分类树 | Class Node | class_node 表，多级分类树结构，通过 entity_class_membership 关联到任意实体 |
| 实体分类成员 | Entity Class Membership | entity_class_membership 表，将组织、产品、物料等实体关联到分类节点的多对多关系 |
| 组织单元 | Org Unit | org_unit 表，部门/车间/班组的层级树结构，编码格式 OU-{type}-{mnemonic}-{seq} |
| 岗位 | Position | position 表，挂靠在组织单元下的岗位定义，编码格式 POS-{org_mnemonic}-{pos_mnemonic}-{seq} |
| 人员 | Person | person 表，员工主数据，通过 person_position_assignment 关联岗位。编码格式 EMP-{seq} |
| 任岗关系 | Person-Position Assignment | person_position_assignment 表，人员与岗位的多对多任职关系，含有效期 |
| 属性定义 | Attribute Definition | attribute_def 表，为实体定义扩展属性的元数据，含类型、是否必填、枚举值等约束 |
| 属性值 | Attribute Value | attribute_value 表，强类型属性值的批量 upsert 存储，支持 string/number/date/boolean 四种类型 |
| 外部系统 | External System | external_system 表，注册可接入 MDM 的外部系统（PLM/MES/ERP），分配 API Key |
| 编码引擎 | Code Engine | server/codeEngine.js，分段流水编码生成模块，按 entity_type + scope_key 分配流水 |
| 物料主表 | Material Master | 统一物料主数据表的设计草案（规范 9.6 节），含 material_code、type_code 等 20+ 字段 |
| 上机常温/低温/金属/胶漆 | Airborne Material Categories | MTR 材料五分类：1=上机常温、2=上机低温、3=上机金属、4=上机胶漆、5=工艺辅料 |
| 图号 | Drawing Number | 设计图纸的唯一标识，用于关联零部件与设计文件。图号不等于物料编码——前者是文件标识，后者是业务对象标识 |
| ECR | Engineering Change Request | 工程变更请求，由设计/工艺/制造发起的问题或变更需求，是变更流程的起点 |
| ECN | Engineering Change Notice | 工程变更通知，经审批确认后下发的正式变更指令，驱动 EBOM/PBOM/MBOM 同步 |
| 设计件 | Design Part | EBOM 中由设计部门定义的原始零部件，区别于工艺件和标准件 |
| 过程件 | In-Process Part | 制造过程中产生的中间状态对象（如未完工的装配体），仅在 PBOM/MBOM 中存在 |
| 设计状态 | Design Status | 零部件在设计阶段的生命周期标记：设计中→审核中→已发布→冻结→作废 |
| 变更影响分析 | Change Impact Analysis | 判断设计/工艺/制造变更是否影响 EBOM/PBOM/MBOM、已投产批次、库存、在制品和已交付产品的评估流程 |
| 经营指标字典 | KPI Dictionary | 经营发展部主数据对象：指标编码、名称、口径、周期、目标值、权重、责任部门和计算公式的统一字典 |
| 客户与项目机会 | Customer & Project Opportunity | 经营发展部主数据对象：客户编码、名称、分类、项目机会阶段、联系人、保密等级 |
| 报价基础 | Quotation Basis | 经营发展部主数据对象：工序、工种、标准工时、积分、定额版本和适用产品/项目的报价参考基准 |
| 合同订单类型 | Contract & Order Type | 经营发展部主数据对象：合同类型、订单类型、交付单据类型、编号规则、状态和结算条件的字典 |
| 供应商主数据 | Supplier Master Data | 经营发展部主数据对象：供应商编码、名称、类别、批准范围、批准状态、等级、资质和限制条件。ERP 维护交易主体，MDM 治理编码与状态 |
| 采购分类 | Procurement Category | 经营发展部主数据对象：采购类别、物料/服务类别、采购周期、请购部门和质量等级的字典 |
| 外包外协任务包 | Outsourcing Task Package | 经营发展部主数据对象：任务包编号、零件/工装、工序、供应商、计划日期、技术文件和执行/结算状态 |
| 风险等级 | Risk Level | 经营发展部主数据对象：风险编号、类别、概率、影响、等级、责任部门和应对策略的字典 |
| 证照资质 | License & Qualification | 经营发展部主数据对象：证照编号、名称、持有人、有效期、保管人、使用范围和预警规则 |
| 海关申报要素 | Customs Declaration Elements | 经营发展部主数据对象：货物编码、品名、规格、数量单位、危险品标识和关联订单/合同 |
| 假冒件 | Counterfeit Part | 未经授权或伪造的零部件，采购实施和外购产品验证中需重点识别和预防 |
| 有条件批准 | Conditional Approval | 供应商批准状态之一：在特定条件下（限定项目、限定期限、限定品类）允许供应商供货 |
| 外委检测 | External Testing | 将检测任务委托给外部检测机构，需管理检测机构选择、合同签订、样品交接和报告审核 |
| 工作转移 | Work Transfer | 将已批准的生产工作从一方转移到另一方，需客户批准并衔接首件验证 |
| 工装状态字典 | Tooling Status Dictionary | 物资保障部主数据对象：在用/封存/限用/禁用/定检到期/返修中/检验中/报废/验证中 九种工装生命周期状态 |
| 工装类别字典 | Tooling Category Dictionary | 物资保障部主数据对象：I类标准工艺装备/II类生产工艺装备/III类生产工艺装备/样板/试验设备/地面设备 |
| 工装批次字典 | Tooling Batch Dictionary | 物资保障部主数据对象：00批(研制)/0批(试制)/1批(小批生产)/2批(成批生产)，不同批次对应不同工装系数 |
| 岗位资格证 | Position Qualification Certificate | 行政人事部主数据对象：证书编码、工种/岗位、证书类型、有效期，MES 消费用于工序资质校验 |
| 技能项 | Skill Item | 行政人事部主数据对象：技能项编码、名称、所属岗位、技能等级和评价标准，与工序资质和薪酬晋升关联 |
| 培训师 | Trainer | 行政人事部主数据对象：培训师编码、等级（初级/中级/高级/资深/未聘）、课时津贴和课件津贴标准 |
| 会议纪要编号 | Meeting Minutes Number | 行政人事部编码规则：部门编号-年份-日期+顺序字母，归档后不可修改 |

---

## 3. 体系文件域

覆盖昌兴复材质量/管理体系文件的文档层级、编号规则和文件类型。

| 术语 | 英文/缩写 | 定义 |
|------|----------|------|
| 体系文件 | Quality System Document | 昌兴复材管理体系和质量体系下的标准化文件总称，按 GLC/GLB/GLG 三层分级管理 |
| GLC | Guideline Level C | 体系文件三层结构中的第 1 层——程序/规程级文件，管理类流程的 C 级文件 |
| GLB | Guideline Level B | 体系文件三层结构中的第 2 层——标准/细则级文件，具体操作标准或特定项目/客户的补充要求 |
| GLG | Guideline Level G | 体系文件三层结构中的第 3 层——概要/纲领级文件，手册层面的顶层文件 |
| 管理程序 | Management Procedure | GLC 层最常见的文件类型，描述一个业务域的标准操作流程和职责分工 |
| 管理规定 | Management Regulation | 体系文件类型之一，侧重规则、约束和合规要求，相对于管理程序更偏"规则"而非"流程" |
| 管理办法 | Management Method | 体系文件类型之一，侧重具体方法、工具和操作细节 |
| 管理标准 | Management Standard | GLB 层级常见的文件类型，侧重量化标准和技术参数 |
| 管理流程 | Management Process | 体系文件类型之一，以流程图或步骤描述为主的程序文件 |
| 管理制度 | Management System | 体系文件类型之一，覆盖多职能的综合性制度文件 |
| 程序文件 | Procedure Document | 通常指质量体系 QMS 编号下的程序文件，按 M1/M2/P2/P3/P4 模块分类 |
| 版次 | Revision | 体系文件的版本标识，如 A 版、B 版、D 版。标注在文件号末尾 |
| 文件号 | Document Number | 体系文件唯一编号，格式如 GLTX-JY-01-A（部门代码-职能代码-序号-版次）或 SYCX/QMS-P3-01-A（体系-模块-序号-版次） |
| GLTX | GuiLi TiXi | 管理体系程序文件的前缀标识，表示"管理体系" |
| SYCX/QMS | ShenYang ChangXing QMS | 昌兴复材质量体系程序文件的前缀标识 |
| JY | JingYing | 经营发展部的文件编号中的部门标识码 |
| WZ | WuZi | 物资保障部的文件编号中的部门标识码 |
| FM 表单号 | Form Number | 体系文件中引用的表单模板编号，如 FM1407-50 = 工艺装备申请单 |
| 体系文件编制表 | Compilation Table | 各部门提交的体系文件清单 Excel（如 运维安环部体系文件编制表.xlsx），是能力映射的输入材料 |
| 能力映射 | Capability Mapping | 将体系文件中的条款/流程上收为"部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 业务流程（L3）→ 应用系统（S1）"映射关系的过程 |
| 流程牵引、字段落账、主数据沉淀 | Process-Driven, Field-Accounted, MDM-Sedimented | MDM 建设方法论三阶段口径：先理清流程→再明确流转的字段→最后落成主数据编码和管理规则 |
| 物资保障部 | Material Support Dept | 负责仓储物流、工装工具策划/申请/设计/验收/使用/返工/维护/定检管理的部门 |
| 运维安环部 | Ops & EHS Dept | 负责动能供应、设备设施规划/保障/运维、安环管理的部门 |
| 质量管理部 | Quality Management Dept | 负责质量策划、质量执行、质量闭环的部门 |
| 经营发展部 | Business Development Dept | 负责经营指标、市场开发、销售订单、报价管理、项目经营合规、产品交付的部门 |
| 项目管理部 | Project Management Dept | 负责计划排程、生产过程管理、生产状态跟踪的部门 |
| 复材车间 | Composite Workshop | 复合材料制造的生产执行单元，参与工装使用维护和生产执行 |
| 工程技术部 | Engineering Dept | 负责工艺文件编制、工艺过程管控、物料管控、制造数据统筹、工装管理的部门 |

---

## 4. 技术域

覆盖 Infomat MDM 平台的技术栈、RBAC 权限系统、数据架构和关键实现模式。

| 术语 | 英文/缩写 | 定义 |
|------|----------|------|
| Express.js | Express | Node.js Web 框架，MDM 平台后端基于此构建，端口 3000 |
| better-sqlite3 | better-sqlite3 | Node.js SQLite 驱动，同步 API，支持 WAL 模式和外键约束 |
| SQLite | SQLite | 本地文件数据库，存储路径 apps/mdm-platform/data/platform.db。单文件，不适合多进程并发 |
| WAL | Write-Ahead Logging | SQLite 写入模式，允许并发读，提升频繁读写场景下的性能 |
| SCD Type 2 | Slowly Changing Dimension Type 2 | 缓慢变化维度的时间变体策略，通过 effective_from/effective_to 保留历史版本 |
| RBAC | Role-Based Access Control | 基于角色的权限控制系统，4 张表：roles → role_permissions ← permissions + user_roles |
| 角色 | Role | roles 表记录，系统角色（is_system=1 不可删除）和自定义角色。支持 parent_role_id 自引用继承 |
| 权限 | Permission | permissions 表记录，格式 resource:action（如 mapping:approve）。admin 拥有通配 *:* |
| 权限码 | Permission Code | resource:action 格式的权限标识，如 mapping:create、review:approve、dashboard:view |
| 角色继承 | Role Inheritance | 通过 parent_role_id 自引用实现，子角色递归获得父角色及所有祖先角色的权限 |
| deny 覆盖 allow | Deny Override Allow | 权限冲突解决规则：role_permissions 按 effect 排序，deny 后处理，因此 deny 优先级高于 allow |
| 字段约束 | Field Constraints | role_permissions 表中的 JSON 字段，定义 exclude（排除）和 readonly（只读）字段列表 |
| requirePermission | requirePermission(permCode) | RBAC 中间件，检查当前会话是否拥有指定权限，含 *:* 通配判断 |
| applyFieldConstraints | applyFieldConstraints(resourceType) | RBAC 中间件，在 JSON 序列化前根据生效约束剥离 exclude 字段、标记 readonly 字段 |
| 有效权限 | Effective Permissions | 用户直接分配角色 + 所有祖先角色权限递归合并、deny 覆盖 allow 后的最终权限集 |
| 行级可见性 | Row-Level Visibility | server/access.js 提供的过滤机制，基于 mapping_related_departments 限制用户可见的映射行 |
| API Key 认证 | API Key Authentication | server/integrationAuth.js 中间件，为外部系统（PLM/MES/ERP）提供基于 API Key 的集成认证 |
| express-session | express-session | Express 中间件，基于内存会话存储的用户认证机制。V1 自建用户体系，不接 OA/统一认证 |
| bcryptjs | bcryptjs | 密码哈希库，用于用户密码的安全存储和验证 |
| exceljs | exceljs | Excel 读写库，用于导入导出 Excel 功能 |
| multer | multer | Express 文件上传中间件，处理 Excel/CSV 导入时的文件接收 |
| csv-parse | csv-parse | CSV 解析库，用于 CSV 格式的数据导入 |
| ECharts | ECharts | 前端图表库，用于渲染桑基图和其他数据可视化 |
| nodemon | nodemon | 开发模式文件监控工具，npm run dev 使用，文件变更时自动重启 Express 服务 |
| 种子数据 | Seed Data | db.js 初始化时写入的系统数据：4 个默认角色（admin/reviewer/owner/submitter）及对应权限 |
| 冒烟测试 | Smoke Test | scripts/ 下手动 HTTP 请求脚本，覆盖各路由模块的基础 CRUD 和边界情况，无自动化测试框架 |
| 动态路由注册 | Dynamic Route Registration | server/index.js 中的 registerRouteIfExists() 机制，按约定目录结构自动挂载 Express Router |
| 内联迁移 | Inline Migration | db.js 中的数据库升级策略：通过条件 DDL（ALTER TABLE IF NOT EXISTS 模式）直接修改表结构，无独立迁移框架 |
| 前端单文件 | Single-File Frontend | public/index.html 一个文件包含全部前端代码（HTML + CSS + 原生 JS + ECharts），无模块化/无构建 |
| JSON 序列化过滤 | JSON Serialization Filter | applyFieldConstraints 中间件在 JSON.stringify 前剥离 exclude 字段的实现方式 |
| 审批任务 | Approval Task | approval_tasks 表，审批流每一步生成对应任务记录，关联 mapping_id 和审批人 |
| 审批历史 | Approval History | approval_history 表，审批流的完整审计轨迹，记录每一步的操作人、操作时间和操作结果 |
| 冲突检测 | Conflict Detection | field_conflicts 和 term_conflicts 表，比对不同部门的字段定义/术语定义，标记差异 |
| 导入导出 | Import/Export | import.js（Excel 批量导入业务数据）、importRbac.js（RBAC 批量导入）、export.js（台账/矩阵/冲突导出） |
| 主线体检 | Mainline Stability Check | `npm run test:mainline` 执行的稳定性检查，验证流程治理、字段台账、主数据对象、权限和导入导出链路是否保持可运行 |

---

## 5. 供应链协同域

覆盖昌兴复材与沈飞民机供应链信息化协同平台（SACC）相关的业务术语。

| 术语 | 英文/缩写 | 定义 |
|------|----------|------|
| 沈飞民机供应链信息化协同平台 | SACC / SAC Supply Chain | 沈飞民机的供应商协同平台（sacc-supplychain.avicnet.cn），昌兴复材作为供应商通过该平台进行订单、交付、报价、结算等业务交互 |
| 订单流水号 | Order Serial Number | 平台为每笔订单生成的唯一标识，用于全链路追溯 |
| 派工号 | Dispatch Number | 沈飞民机生产运营部下达的派工编号，格式 PGH + 日期 + 序号 |
| 质量编号 | Quality Number | 零件生产过程中由系统生成或供应商编制的唯一质量追溯编号 |
| 零件交付计划调整 | Delivery Plan Adjustment | 供应商对已确认订单的交付日期提出变更申请，经沈飞民机审批后生效 |
| 生产状态 | Production Status | 零件从任务下达到已交付的关键状态节点：任务下达、缺料、生产准备、加工、装配、半检、移交表处、表处、终检、待交付、已交付 |
| 供应商业务员 | Supplier Operator | 平台对供应商端操作用户的统一角色名称，昌兴复材经授权的人员以此角色登录操作 |
| 订单接收 | Order Acceptance | 供应商在平台上确认接收沈飞民机发布的订单，接收后订单转为正式可执行状态 |
| 超时自动接收 | Auto-Acceptance on Timeout | 平台机制：供应商在规定时限内未主动确认的订单，系统自动将其转为已接收状态 |
| 购料方式 | Material Procurement Type | 订单中约定的材料采购责任归属，包括"购料""来料加工"等类型 |
| 工艺代码 | Process Code | 由沈飞民机制定的加工工艺标识编码，关联零件制造工艺路线 |
| 三年需求预测 | Three-Year Demand Forecast | 沈飞民机发布的长期需求预测数据，供应商可在平台上查询 |
| 分卡 | Card Splitting | 将生产任务按零件/工序拆分为独立的生产过程管理卡片，每个卡片有独立质量编号 |
| 生产状态录入 | Production Status Entry | 在平台上更新零件生产进度（任务下达→缺料→终检→待交付→已交付），支持单条录入和批量导入 |
| 报价管理 | Quotation Management | 接收询价函→预算定额报价→审批→盖章→上传平台的完整报价流程 |
| 结算核对 | Settlement Reconciliation | 每月 6–10 日接收沈飞民机零件交付清单，核对金额与合同号，编制结算核对结果并反馈 |
| 产品交付确认 | Delivery Confirmation | 项目管理部部长在平台上确认产品已交付的操作 |
| 产品交付清单 | Delivery Checklist | 记录待交付产品明细的清单，由项目管理部项目助理管理 |
| 反馈问题管理 | Feedback Issue Management | 对平台上的质量问题、交付问题进行记录、追踪和处理的流程 |
| 用友U8 | Yonyou U8 / U8 | 昌兴复材内部使用的 ERP 系统，订单从平台接收后需在 1 工作日内转化录入 U8 |
| 经营发展部 | Business Development Dept | 在 SACC 上下文中负责报价管理、订单接收、U8 下单、结算核对 |
| 项目管理部 | Project Management Dept | 在 SACC 上下文中负责生产过程管理、生产状态录入、交付确认 |
| 室主任 | Office Director | 经营发展部关键岗位：组织报价、盖章上传、审核交付计划调整报告、结算核对 |
| 部长助理 | Assistant Director | 项目管理部关键岗位：起草生产状态录入内容、生成质量编号、执行分卡、批量导入 |
| 项目助理 | Project Assistant | 项目管理部关键岗位：发起交付计划调整、打印封面及合格证、管理交付清单、处理反馈问题 |
| RACI | Responsible / Accountable / Consulted / Informed | 跨部门协作中的职责分配矩阵，对应执行人/负责人/被咨询人/被知会人 |

---

## 6. 行政人事域

覆盖行政人事部的组织、人员、培训、薪酬、行政后勤相关的术语。

| 术语 | 英文/缩写 | 定义 |
|------|----------|------|
| 招聘录用 | Recruitment & Hiring | 行政人事部核心流程：从招聘需求提出、简历筛选、面试评估到录用入职的全过程 |
| 岗位变动 | Position Change | 员工在组织内岗位调整的管理流程，含晋升、平调、降职，需同步更新人员主数据和权限 |
| 考勤管理 | Attendance Management | 员工出勤、请假、加班、出差等考勤记录的收集与核算流程 |
| 离职管理 | Offboarding Management | 员工从提出离职到办结离职手续的全流程，含工作交接、资产归还、权限回收和档案归档 |
| 劳动合同 | Labor Contract | 用人单位与员工签订的劳动协议，主数据对象：合同编号、类型、期限、签订/终止日期、续签次数 |
| 岗前培训取证 | Pre-Job Training & Certification | 新员工或岗位变动员工上岗前必须完成的培训和资格证书获取流程，MES 消费证书数据进行工序资质校验 |
| 技能矩阵 | Skill Matrix | 以岗位为维度，记录每位员工在各项技能上的等级和评价结果的矩阵表，用于能力盘点、培训规划和薪酬激励 |
| 新员工管培 | New Employee Management Training | 新入职员工的系统化培养计划，含导师-学员结对、轮岗实习、多维考核评分 |
| 干部管理 | Cadre Management | 领导干部的职务任免、任期管理、年度考核、后备干部储备和培养状态跟踪 |
| 退休续用 | Retirement Re-Employment | 已达退休年龄人员的续用审批流程，含年度聘用期限、体检结果关联和到期提醒 |
| 社保公积金 | Social Insurance & Housing Fund | 员工社会保险和住房公积金的缴纳基数核定、月度申报和年度调整 |
| 会议纪要 | Meeting Minutes | 会议决议和待办事项的正式记录，编号规则为部门编号-年份-日期+顺序字母，归档后不可修改 |
| 公文管理 | Official Document Management | 公司级和部门级公文的发文、收文、传阅、归档管理，发文字号统一规则，密级管控 |
| 印章管理 | Seal Management | 公章、合同章、财务章、法人章等印章的刻制、启用、保管、使用登记、停用和销毁的全生命周期管理 |
| 车辆管理 | Vehicle Management | 公司车辆的台账管理，含使用状态、年检日期、保险到期预警和违章记录关联 |
| 宿舍管理 | Dormitory Management | 员工宿舍的房间/床位分配、入住/退房登记、押金管理和房源状态维护 |
| 档案管理 | Archive Management | 员工人事档案和公司档案资料的目录管理，含密级、保管期限、归档/销毁记录 |
| 办公用品 | Office Supplies | 行政人事部归口的低值易耗品管理，含物品编码、分类、申领审批、采购结算和库存盘点 |
| 请休假 | Leave & Vacation | 员工各类请假（事假/病假/婚假/产假/年休假等）的申请审批流程，年休假余额计算，病假医疗期累计 |
| 培训体系 | Training System | 公司培训项目的规划、实施、评估体系，含培训项目编码、课程目录、培训方式（内培/外培/外聘）和培训师管理 |
| 导师-学员结对 | Mentor-Mentee Pairing | 新员工管培中的一对一辅导关系，含导师/学员工号、培养期限和多维考核评分汇总 |

---

## 7. EHS/运维安环域

覆盖运维安环部的安全生产、职业卫生、消防安全、环境保护、节能双碳和设备设施运维保障相关的术语。

| 术语 | 英文/缩写 | 定义 |
|------|----------|------|
| 安全生产 | Safety Production | 运维安环部 L1 能力域：涵盖安全基础责任、风险分级管控、隐患排查治理、危险作业许可、安全应急和事故工伤管理 |
| 风险分级管控 | Risk Classification & Control | 对安全风险按等级分类并制定对应控制措施的闭环管理，风险源/风险点为主数据，隐患记录为业务记录 |
| 隐患排查治理 | Hazard Identification & Rectification | 对安全生产隐患的识别、分级、整改、验收闭环流程，隐患问题引用风险点/设备/区域主数据 |
| 危险作业许可 | Hazardous Work Permit | 对有限空间、高处作业、动火作业等危险作业的审批许可管理，作业类型和控制措施模板应主数据化 |
| 三违行为 | Three Violations（违章指挥/违章作业/违反劳动纪律） | 安全生产中的三类违规行为，是安全绩效和责任追究的重点管理对象 |
| 有限空间 | Confined Space | 通风不良、出入口受限的作业空间，进入前需审批、检测和监护，运维安环部重点管控对象 |
| 职业卫生 | Occupational Health | 运维安环部 L1 能力域：涵盖职业病危害识别申报、防护设施、危害监测、健康监护和职业健康档案管理 |
| 职业病危害因素 | Occupational Hazard Factor | 可能导致职业病的化学、物理、生物因素，需识别、申报、监测和告知，是职业卫生管理的主数据对象 |
| 劳动防护用品 | Personal Protective Equipment / PPE | 为从业人员配备的防护用品，含配发标准（按岗位/工种）、用品编码、规格和适用危害因素 |
| 消防安全 | Fire Safety | 运维安环部 L1 能力域：涵盖消防基础、建设项目消防三同时、火灾隐患排查、消防设施维护和消防应急管理 |
| 消防三同时 | Fire Safety Three Simultaneities | 建设项目中消防设施与主体工程同时设计、同时施工、同时投入使用和验收的管理要求 |
| 消防重点部位 | Key Fire Safety Location | 火灾风险较高的区域或设施，需单独建账、定期检查和重点监控，是消防安全主数据对象 |
| 环境保护 | Environmental Protection | 运维安环部 L1 能力域：涵盖环境因素识别、污染防治、环境监测、环保隐患治理和突发环境事件管理 |
| 环境因素 | Environmental Aspect | 可能对环境造成影响的组织活动、产品或服务要素，重要环境因素需识别、评价和清单维护 |
| 污染源 | Pollution Source | 产生废水、废气、噪声、固废等污染物的设施或工序，需编码、监测并关联排口和环境监测点 |
| 危险废物 | Hazardous Waste | 列入国家危险废物名录的废弃物，需按危废代码分类、暂存、转移联单和合规处置 |
| 节能双碳 | Energy Conservation & Dual Carbon | 运维安环部 L1 能力域：涵盖能源评审、节能运行控制、碳排放统计分析和能源计量管理 |
| 能源评审 | Energy Review | 对组织能源使用和消耗的系统性分析，输出主要耗能设备台账和年度节能双碳工作策划 |
| 碳排放因子 | Carbon Emission Factor | 单位能源或物料消耗对应的二氧化碳排放系数，用于碳排放统计和报告，由 MDM 统一维护 |
| 能源计量器具 | Energy Measuring Instrument | 用于测量能源消耗的仪表设备，含计量范围、准确度等级和检定/校准有效期，是能源管理主数据对象 |
| 设备设施运维保障 | Equipment & Facility O&M | 运维安环部 L1 能力域：涵盖设备计划策划、使用巡检、维护保养、维修保障、备件管理和事故/搬迁管理 |
| TPM | Total Productive Maintenance | 全员生产维护，通过自主维护、计划维护和早期设备管理提高设备综合效率的设备管理方法 |
| 设备操作证 | Equipment Operation Permit | 操作特定设备所需的资格证书，由运维安环部管理，与人员主数据和岗位资质关联 |
| EHS体系 | EHS Management System | 环境、职业健康和安全整合管理体系，涵盖法规合规、目标指标、内审、管理评审和持续改进 |
| 合规性评价 | Compliance Evaluation | 对组织活动是否符合适用法律法规和其他要求的定期评审，适用法规条款应主数据化并版本管理 |
| 相关方 | Stakeholder / Interested Party | 与组织 EHS 绩效有关或受其影响的外部单位（承包商、供应商、外来人员），需管理 EHS 准入和资质 |
| 管理评审 | Management Review | 由最高管理者主持的对 EHS 管理体系的定期评审，评审发现和决议作为体系改进输入 |
| 内审 | Internal Audit | 组织内部对 EHS 管理体系符合性和有效性的系统性检查，内审发现分类和整改闭环 |
| 危险点 | Hazard Point | 经识别确认的存在特定安全风险的具体位置或设备，是安全生产重点管控对象，需主数据化管理 |

---

## 附录：缩写速查表

| 缩写 | 全称 | 所属域 |
|------|------|--------|
| A1 | Activity Level 1 | 业务域 |
| A2 | Activity Level 2 | 业务域 |
| CAPP | Computer Aided Process Planning | 业务域 |
| CSM | Consumable / Supplies | 主数据域 |
| CTL | Cutting Tool | 主数据域 |
| BOP | Bill of Process | 业务域 |
| D1 | Department Level 1 | 业务域 |
| D2 | Office Level 2 | 业务域 |
| DBOM | Delivery BOM | 业务域 |
| EBOM | Engineering Bill of Material | 业务域 |
| ECN | Engineering Change Notice | 主数据域 |
| ECR | Engineering Change Request | 主数据域 |
| EHS | Environment, Health, Safety | EHS/运维安环域 |
| EQP | Equipment | 主数据域 |
| ERP | Enterprise Resource Planning | 业务域 |
| FST | Fastener / Standard Parts | 主数据域 |
| FM | Form Number | 体系文件域 |
| GAG | Gauge / Measuring Tool | 主数据域 |
| GLB | Guideline Level B | 体系文件域 |
| GLC | Guideline Level C | 体系文件域 |
| GLG | Guideline Level G | 体系文件域 |
| GLTX | GuiLi TiXi（管理体系） | 体系文件域 |
| KPI | Key Performance Indicator | 主数据域 |
| L1/L2/L3 | Level 1/2/3 | 业务域 |
| M1/M2/P2/P3/P4 | QMS 模块代码 | 体系文件域 |
| MBOM | Manufacturing Bill of Material | 业务域 |
| MDM | Master Data Management | 主数据域 |
| MES | Manufacturing Execution System | 业务域 |
| MOD11 | Modulus 11 | 主数据域 |
| MTR | Material (Raw) | 主数据域 |
| OBOM | Operations BOM | 业务域 |
| PBOM | Process Bill of Material | 业务域 |
| PLM | Product Lifecycle Management | 业务域 |
| PPE | Personal Protective Equipment | EHS/运维安环域 |
| PRC | Process Component | 主数据域 |
| PRT | Part | 主数据域 |
| QMS | Quality Management System | 体系文件域 |
| RBAC | Role-Based Access Control | 技术域 |
| S1 | System Level 1 | 业务域 |
| S2 | System Module Level 2 | 业务域 |
| SACC | SAC Supply Chain | 供应链协同域 |
| SBOM | Service BOM | 业务域 |
| SCD | Slowly Changing Dimension | 技术域 |
| SYCX | ShenYang ChangXing（昌兴复材） | 体系文件域 |
| TLG | Tooling | 主数据域 |
| TLS | Tools | 主数据域 |
| TPM | Total Productive Maintenance | EHS/运维安环域 |
| U8 | 用友 U8 ERP | 供应链协同域 |
| WAL | Write-Ahead Logging | 技术域 |

---

## 术语新增流程

### 交付物域扩展(2026-06-05)

| 术语 | 英文 | 释义 |
|---|---|---|
| 交付物凭证 | deliverable evidence | 标识交付物已提交或已存档的载体,本设计中为 `pmo/deliverables/DLV-XXX-*.md` 文件及其上传来源 |
| 交付物正本 | deliverable canonical | 交付物状态正本,本设计后由 .md frontmatter 承载状态、责任、审批历史和凭证信息 |
| frontmatter 状态机 | frontmatter state machine | 交付物状态机由服务端写回包装后,将状态变更落到 .md frontmatter 与正文变更记录表 |
| 原子写 | atomic write | 写文件先写 `<file>.tmp` 再 rename,避免中途失败留下半写内容 |
| HMR 增量同步 | HMR delta sync | 文件 watcher 监听到正本变化后,通过 Vite custom event 广播 `pmo:deliverables-changed`,前端刷新相关交付物状态 |

当开发过程中产生新术语需要纳入术语表时，按以下步骤操作：

1. **判断所属域**：确认术语属于 1-业务域 / 2-主数据域 / 3-体系文件域 / 4-技术域 / 5-供应链协同域 / 6-行政人事域 / 7-EHS/运维安环域 中的哪一个
2. **写条目**：按 `| 术语 | 英文/缩写 | 定义 |` 三列格式，追加到对应域表格末尾
3. **定义要求**：1-2 句话，只解释"这个术语在项目中是什么意思"，不含实现细节或代码路径
4. **更新附录**：如果术语有缩写，追加到附录缩写速查表（按字母顺序插入）
5. **同 commit 提交**：术语表变更和代码变更放在同一个 commit 中，确保术语和实现同步
6. **顺手审同域**：追加或修改术语时，扫一眼所在域的其他术语，发现定义已过时当场修正
7. **冲突人工裁定**：多人分支 merge 导致术语表冲突时，不要自动选择任一版本——人工判断保留哪个定义

### 示例：新增一个技术域术语

原始代码中引入了 `rateLimiter` 中间件，需要记录术语：

1. 打开 `docs/glossary.md`，找到 `## 4. 技术域` 章节的表格末尾
2. 追加行：

```
| 速率限制 | Rate Limiter | Express 中间件，限制同一 IP 在时间窗口内的请求次数，防止 API 滥用 |
```

3. 找到 `## 附录：缩写速查表`，按字母顺序插入：（本例无新缩写，跳过此步）
4. 提交：

```bash
git add docs/glossary.md src/middleware/rateLimiter.js
git commit -m "feat: add rate limiter middleware for API protection"
```

> 注意：不要在 commit 中只更新术语表而不更新代码，反之亦然。术语和代码应保持同步。
