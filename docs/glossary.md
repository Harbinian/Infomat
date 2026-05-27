# Infomat 项目术语表

> 版本：V1.0
> 更新日期：2026-05-27
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
| 部门 | Department / D1 | 组织架构中的职能部门或生产单元，桑基图第 1 层节点 |
| 跨部门组合 | Joint Department | 多个部门以 `+` 连接的联合牵头节点，如"工技+物保+质量"，仅在桑基图中表达 |
| 能力域 | Capability Domain | 按业务域聚合的高阶能力分类，如"工艺生产过程管控""质量执行" |
| 业务能力 | Business Capability / L2 | capabilities 表中 level=L2 的记录，对 L3 业务流程进行归类聚合 |
| 业务流程 | Business Process / L3 | 具体可执行的操作流程，如"首件检验""MBOM 编制""工装定检"。capabilities 表中 level=L3 的记录 |
| 应用系统 | Application System / S1 | 承载业务流程的信息系统，包括 PLM、MES、ERP（用友 U8），桑基图第 4 层 |
| 映射关系 | Mapping | 部门→能力→流程→系统的四层关联关系，Infomat 平台的核心管理对象。数据表 mappings |
| 桑基图 | Sankey Diagram | ECharts 渲染的四层流向图，可视化展示部门-能力-流程-系统的映射关系 |
| PLM | Product Lifecycle Management | 产品生命周期管理系统，管理设计数据（EBOM）、工艺文件（CAPP）、工装策划与设计、MBOM 等 |
| MES | Manufacturing Execution System | 制造执行系统，管理生产过程执行、质量检验、工装使用与维护、设备运维等 |
| ERP | Enterprise Resource Planning | 本项目特指用友 U8，管理计划排程、采购、库存、财务、成本核算 |
| MBOM | Manufacturing Bill of Material | 制造物料清单，定义零件制造所需的物料项、工艺路线和工序结构 |
| EBOM | Engineering Bill of Material | 工程设计物料清单，PLM 侧维护的设计零部件结构，是 MBOM 的源头输入 |
| CAPP | Computer Aided Process Planning | 计算机辅助工艺设计，PLM 系统的子模块，管理工艺路线、工序卡片和工时定额 |
| 黄金源 | Golden Source | 某一数据字段的权威来源系统，在 field_identities 表中确认，用于解决跨系统数据一致性问题 |
| 字段台账 | Field Ledger | 记录各业务流程涉及的数据字段及其来源系统、流转路径的台账，黄金源确认的前置输入 |
| 字段身份 | Field Identity | 对某一字段的黄金源归属做出的正式确认，存储在 field_identities 表 |
| 跨部门协同 | Cross-Department Collaboration | 多个部门联合参与同一业务能力的组织模式，桑基图中以组合节点表示 |
| 审批流 | Approval Flow | 映射关系从 draft 到 published 的七步状态机，每步生成审批任务和审计记录 |
| 状态机 | State Machine | mappings.status 的状态变迁模型：draft→submitted→dept_reviewed→cross_confirmed→fields_confirmed→final_reviewed→published |
| A1 业务行为 | Activity Level 1 | 业务流程（L3）分解后的原子级业务行为，是部门职责落地的最小可执行单元 |
| 工时定额 | Labor Hour Quota | 完成特定零件或工序所需的标准工时，用于生产计划、排程和成本核算 |
| 术语冲突 | Term Conflict | 同一术语在不同部门/系统中含义不一致，记录在 term_conflicts 表 |
| 跨部门待办 | Cross-Department Todo | 因映射关系变更或冲突需要相关方处理的任务，记录在 todos 表 |
| 版本历史 | Version History | 映射关系、术语等关键实体的变更记录，通过 change_set + version_log 表实现 |
| 变更集 | Change Set | 一次提交中包含的多个变更的原子集合，用于版本追溯 |
| 外部标识 | External Identity | 外部系统（PLM/MES/ERP）中的对象编号与本系统的关联映射 |

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
| 量具 | GAG / Gauge | 卡尺、千分尺、高度规、塞规、硬度计、三坐标等计量器具，编码模板四，总长 22 位。原候选码 QMS 已更名为 GAG |
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
| 能力映射 | Capability Mapping | 将体系文件中的条款/流程上收为"部门→业务能力→业务流程→应用系统"映射关系的过程 |
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
| SQLite | SQLite | 本地文件数据库，存储路径 mdm-platform/data/platform.db。单文件，不适合多进程并发 |
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

## 附录：缩写速查表

| 缩写 | 全称 | 所属域 |
|------|------|--------|
| A1 | Activity Level 1 | 业务域 |
| CAPP | Computer Aided Process Planning | 业务域 |
| CSM | Consumable / Supplies | 主数据域 |
| CTL | Cutting Tool | 主数据域 |
| D1 | Department Level 1 | 业务域 |
| EBOM | Engineering Bill of Material | 业务域 |
| EQP | Equipment | 主数据域 |
| ERP | Enterprise Resource Planning | 业务域 |
| FST | Fastener / Standard Parts | 主数据域 |
| GAG | Gauge / Measuring Tool | 主数据域 |
| GLB | Guideline Level B | 体系文件域 |
| GLC | Guideline Level C | 体系文件域 |
| GLG | Guideline Level G | 体系文件域 |
| GLTX | GuiLi TiXi（管理体系） | 体系文件域 |
| L1/L2/L3 | Level 1/2/3 | 业务域 |
| M1/M2/P2/P3/P4 | QMS 模块代码 | 体系文件域 |
| MBOM | Manufacturing Bill of Material | 业务域 |
| MDM | Master Data Management | 主数据域 |
| MES | Manufacturing Execution System | 业务域 |
| MOD11 | Modulus 11 | 主数据域 |
| MTR | Material (Raw) | 主数据域 |
| PLM | Product Lifecycle Management | 业务域 |
| PRC | Process Component | 主数据域 |
| PRT | Part | 主数据域 |
| QMS | Quality Management System | 体系文件域 |
| RBAC | Role-Based Access Control | 技术域 |
| S1 | System Level 1 | 业务域 |
| SACC | SAC Supply Chain | 供应链协同域 |
| SCD | Slowly Changing Dimension | 技术域 |
| SYCX | ShenYang ChangXing（昌兴复材） | 体系文件域 |
| TLG | Tooling | 主数据域 |
| TLS | Tools | 主数据域 |
| U8 | 用友 U8 ERP | 供应链协同域 |
| WAL | Write-Ahead Logging | 技术域 |
