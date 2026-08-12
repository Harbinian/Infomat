# 3001 单流程编制技术规格

## 1. 文件结构和兼容策略

当前导出结构为`docs/contracts/process-governance-v3.schema.json`。格式以单个`process`为根对象，不使用`processes[]`，从结构上保证一份JSON只对应一个流程。v1、v2结构规则继续作为兼容导入规则。

`document-structured-output-v2` 保持只读兼容：

1. 制度文件解析器继续产生v2内存结果，避免重写成熟解析逻辑。
2. 前端按 `process_ref` 拆分多流程结果，只把当前候选送入编辑工作台。
3. v1导入后在当前页面内存中规范化为v2；源文件不修改。
4. 导出时统一生成`process-governance-v3`，导出结果可重新导入并适配回编辑工作台。v1、v2表单只补`form_design_state=unspecified`，不根据名称、编号或明细数量推断状态。
5. MDM平台通过受控预览和审核接口接收v1/v2，不信任文件中的审核字段。

`behaviors[].behavior_description`是向后兼容的可选字符串字段。旧版`process-governance-v1`没有该字段时仍符合结构规则；前端规范化导入后只在当前页面内存中补为空字符串。历史v2步骤只迁移`step_name`到`behavior_name`，不得把该名称复制到`behavior_description`。

本次在`process-governance-v3.behaviors[]`增加三个可选字段：`actor_assignment_mode`、`actor_department_data_ref`和`actor_position_rule`。结构版本号、关系枚举以及`/api/template`、`/api/schema`、`/api/validate`的外层请求响应保持不变，不修改3000业务功能。旧v3文件仍符合结构规则；3001导入时根据`current_actor_role=全公司`识别全公司通用，其余旧值按固定部门和岗位处理，并在当前页面内存中补齐可选字段。

## 2. 无状态实现

- Multer继续使用 `memoryStorage()`。
- 服务端不提供会话接口，也不新增会话表、缓存、文件目录或草稿接口。
- 页面状态只保存在JavaScript运行内存中。
- 不调用任何浏览器持久化API。
- `/api/data` 和 `/api/export` 继续返回404。
- 结构化JSON导入在浏览器内存中处理。服务端保留的历史解析接口仍使用内存上传，请求完成后不保留用户内容。

## 3. 页面状态

页面维护：

- 当前单流程编辑结果。
- 本次导入拆出的候选流程列表。
- 当前候选索引。
- 当前未保存标记。
- 当前打开的“文字编制／跨职能流程图预览”标签。
- 当前打开的文字分区和流程步骤子分区；流程步骤只包含业务流程、流程关系、输出物与数据、跨部门待办汇总。
- 当前业务流程选中项的类型（业务行为或跨部门待办）与稳定引用，以及当前表单或记录；表单右侧同时渲染全部字段分组，不再保存“当前表结构标签页”状态。
- 历史归并弹窗的目标外部门行为、分析结果和字段冲突选择；关闭或取消弹窗时直接丢弃，不写入当前流程。
- 从`/api/enums`读取的花名册岗位目录及当前加载状态。
- 本次页面运行内已经打开过预览的流程标识、图例示例展开状态和预览展开状态。

候选列表只存在当前页面运行态。切换候选时保留本次运行内的编辑结果，刷新后全部清空。

页面外壳使用`app-shell`两列网格：`task-sidebar`固定300px，`main-column`使用`minmax(0, 1fr)`占满剩余宽度。页面宽度不再限制为1500px；`body`设置`min-width: 1280px`。左侧任务栏在视口内常驻并独立滚动，右侧编辑区保持`min-width: 0`，宽表格只在自身容器内滚动。

`candidateList`使用带`data-candidate-index`的按钮投影当前`candidates[]`，不建立第二套候选状态。按钮显示原数组序号、流程名称和未导出标记，并通过`title`及`aria-label`保留长名称。切换按钮只更新`currentIndex`、执行既有初始分区选择并重新渲染；该过程不调用`touch()`、`protect()`或候选排序函数。

`workspaceViewSwitch`位于任务栏并复用`renderWorkspaceTabs()`。没有当前流程时，两个视图按钮保持可见但禁用；存在当前流程时，按钮继续使用原`activeWorkspaceTab`、预览状态和`setActiveWorkspaceTab()`。右侧`workspace`只渲染当前标签面板，避免重复生成视图导航。

`renderPreviewGuidance()`继续位于右侧文字编制面板，但改为单行提示条。提示条保留“填写业务行为名称后显示节点、填写明确流程关系后显示箭头、不得按录入顺序自动连线”三项规则；预览首次可用时显示“已可查看”和原查看入口。提示条只读取当前图形状态，不修改流程内容。

全局操作仍使用原按钮标识和事件入口。新建与导入位于任务栏上部；唯一`statusBox`位于任务栏中部并保留`role="status"`和完整错误文案；导出、清空和唯一保存方式警示位于任务栏底部。DOM位置变化不得改变按钮启用条件、未保存保护或导出流程。

页面只保留一个`max-width: 1279px`媒体查询，用于显示非阻断桌面窗口提示。该媒体查询不得改变网格、表单、条目侧栏、关系说明、评分卡或流程图布局；低于1280px时由页面横向滚动承载桌面布局。3001不再维护900px以下和390×844移动端行为。

3000本地流程编辑器本期不修改。为后续迁移保留通用任务分组：3001的“新建／导入、候选流程、查看方式、导出／清空”可以分别映射为3000的“新建／打开／导入、草稿、查看方式、保存／提交／导出／关闭”；本期不抽取共享组件，不共享页面状态，也不增加3000通信。

文字编制使用“基本信息、目的与范围、术语定义、流程步骤、表单与记录、导出检查”六个互斥分区。表单名称和业务行为名称在输入时只更新对应侧栏标签，不因控件失焦重绘整个工作区，避免连续输入时把下一个字段替换为失效节点。

业务行为、流程关系、输出物与数据、跨部门承接分别通过`activeBehaviorRef`、`activeRelationRef`、`activeDataRef`和`activeHandoffRef`记录当前条目。业务流程、流程关系和输出物与数据渲染`record-workbench`：左侧`record-selector`显示条目，右侧只渲染当前条目的编辑卡。业务流程侧栏同时投影本部门行为、控制节点和跨部门待办，待办按锚点显示且没有独立排序；跨部门待办汇总页保持只读。业务行为移动只交换`behaviors[]`中的对象位置；流程关系和输出物与数据复用`moveCollectionItem()`，分别按`relation_ref`和`data_ref`定位对象。边界移动返回失败且不调用`touch()`；有效移动保持被移动条目选中，标记当前候选已修改并重新渲染。任何顺序调整都不得重建技术标识、改写对象内容或更新跨数组引用。流程图仍按明确关系计算，不得把数组顺序解释为流程先后。

`renderRelations()`在关系侧栏和当前关系编辑卡之前固定渲染一个`aside.relation-guidance`。说明本身没有按钮、输入项或页面状态，不读取也不写入当前流程；即使`flow_relations[]`为空，说明仍与空状态同时显示。顺序、判断分支、流程内部回路和并行路线保持桌面并列网格。右侧当前关系编辑卡只保留一条简短提示。

## 4. 只读跨职能流程图预览

- 前端锁定使用`cytoscape@3.34.0`。服务端通过`GET /vendor/cytoscape.min.js`提供本地浏览器脚本，不使用CDN，也不暴露整个`node_modules`目录；不增加BPMN引擎或BPMN XML输出。
- `public/process-diagram.js`把当前`process-governance-v3`内存对象转换为图形元素。转换函数接受部门目录顺序，但不得修改输入对象。
- `behaviors[]`生成本流程节点。`actor_assignment_mode=fixed_department`时，前端从`current_actor_role`识别执行部门和岗位；具体岗位按“部门名称 + 岗位名称”拆分，空值或无法识别的历史值进入“执行部门待明确”泳道。`actor_assignment_mode=company_wide`或历史`current_actor_role=全公司`进入“全公司通用”泳道，该泳道不代表跨部门。`actor_assignment_mode=dynamic_from_data`进入“运行时责任部门”泳道，节点副标题读取`actor_department_data_ref`对应的数据名称，但不把数据对象绘制成节点。
- 每个参与执行的部门形成横向泳道。归口部门在已参与执行时排在第一条，其他部门按`/api/enums`返回的组织目录顺序排列；泳道由不可交互的背景节点绘制。
- 只有关系类型、起点和终点均明确且引用有效的`flow_relations[]`才生成本流程箭头。主线层级由非回路的有效本流程关系确定；无关系节点保持相同横向层级，不能用数组顺序形成先后暗示。前端使用强连通分量识别非回路闭环，将闭环作为一个稳定分组参与层级计算，再按关系顺序为组内节点分配相邻子层级，避免拓扑排序失败后未处理节点全部落在同一位置。
- `node_type="decision"`只表示承担条件判断的节点。承接该节点出口的目标节点不因承接判断结果而要求使用`node_type="decision"`；目标节点本身不再判断时可以继续使用`node_type="action"`。`relation_type="sequence"`可以作为判断节点的一条默认继续路径，不要求填写`condition`，但必须填写`to_behavior_ref`。`relation_type="condition"`和`relation_type="loop"`必须填写`condition`及`to_behavior_ref`；回路表示条件成立时返回本流程前序行为，不是独立节点。
- 布局使用Cytoscape`preset`模式。前端先计算关系层级、泳道高度和节点坐标，再一次性装载图形。显式回路、内部调用返回和跨部门承接返回不参与主线层级计算。
- 业务行为使用圆角矩形；判断和并行使用菱形并分别显示“×”和“＋”；节点类型为空时使用虚线矩形；会签部门数量使用独立小标记显示。岗位文字进入节点第二行。
- 图例阅读提示在既有泳道与跨部门说明之后固定补充“带条件的前进箭头表示判断分支；标有‘回路’的返回箭头表示退回前序步骤”。该文案只解释现有图形，不改变边或节点生成规则。
- `ProcessDiagram.buildGraphModel()`只为当前页面增加`rawLabel`、显示用换行、节点和标签尺寸、线路轨道、闭环核对项、布局碰撞结果和视野建议。连续中文按字符换行，并同时设置Cytoscape的`text-overflow-wrap: anywhere`；显示换行不得写回业务字段。普通节点按行数增加高度，判断和并行菱形按内接文字区域同步扩大宽高。
- 图形节点只读取`behavior_name`作为主标题，不读取`behavior_description`。补充说明只在文字编制中显示，避免增加主图信息密度。
- 关系标签最大宽度为220图形单位。相邻层级中心间距取“前后节点半宽之和＋220＋48”和440中的较大值。相邻层级的单一顺序关系继续使用直角连线；多分支和跨层关系按稳定关系顺序分配上方曲线轨道；显式回路从节点区下方返回。同一方向的下一条轨道在上一条标签高度之外再增加24图形单位，泳道高度同步预留上方和下方轨道空间。
- 非回路闭环中的关系进入`reviewItems`，提示关系类型核对并保留`focusKind: relation`和原`focusRef`。该项只影响页面提示和定位，不进入结构校验、不阻止导出、不自动改为回路，也不修改关系箭头的类型样式。
- `cross_department_handoffs[]`存在有效`counterparty_behavior_ref`时复用对应外部门行为节点，不再生成第二个待办节点；虚线箭头按方向连接锚点与该行为，需要返回时再从该行为连接恢复位置。只有没有本文件关联行为的兼容记录才生成独立待办节点，并按承接部门或“承接部门待明确”泳道放置。
- 导入文件中已有的`internal_process_calls[]`在调用行为所属泳道生成粗边框节点，并使用本流程实线连接。存在有效返回位置时绘制实线返回关系；点击节点只显示MDM平台维护提示。
- 缺少有效关系端点、关系类型、发送行为或调用行为的项目进入预览问题清单，不写回原对象，也不自动补关系。主图只读取动态责任部门来源数据的名称，不显示数据对象节点；`forms[]`、完整会签部门、流程阶段和推测的开始或结束事件仍不进入主图。
- 页面HTML提供七类常驻图例、固定阅读提示和可展开的三步示例。图例示例位于画布外；图例示例状态和展开查看状态只保存在当前页面变量中。
- Cytoscape节点设置为不可抓取。图形只允许平移、缩放、适应画布、重置视图和展开查看。业务行为、关系和跨部门承接可以定位到对应文字卡片；内部流程调用不跳转到文字编辑区。初始化和重置时先完整拟合画布：拟合缩放比例不低于0.60时保留全图，否则改为拟合泳道表头中心锚点和前两层节点并显示聚焦提示；“适应画布”不使用该阈值，始终拟合全部元素。只读预览允许缩小至0.03，以保证约40个行为的宽流程能够完整进入画布。
- 标签选择、图形实例和计算坐标只保存在页面内存中；Schema、导入导出JSON、`/api/schema`、`/api/template`和`/api/validate`不增加图形字段。本次只改变历史JSON的显示方式，不需要数据结构迁移，但必须通过历史导入和无损往返测试。
- Cytoscape或图形模块加载失败时，前端只关闭预览画布并显示错误说明，不清空文字数据，不阻止现有导入和导出流程。

## 5. 旧版拆分

拆分时：

- 只保留当前 `process_ref` 对应的步骤、行为详情、分支和工作角色关系。
- 历史v2没有独立的“具体做什么”补充说明。迁移时保留`step_name`为业务行为名称，并把`behavior_description`置为空字符串，不得复制或推测内容。
- 表单通过 `step_ref` 归入对应流程。`form_tables.table_kind=main`映射为`area_type="基本信息"`，`detail`映射为`area_type="明细清单"`；`form_table_fields`只进入其`table_ref`指向的结构，不合并不同明细表。
- 跨部门关系按源步骤归入当前流程。
- 术语和文档级参考材料复制到每个候选并在内存中隐式保留，不形成制度关联，也不显示为当前页面编辑入口。
- 当前或历史文件中已有的`internal_process_calls[]`在候选规范化、切换和导出过程中保持不变，不生成3001编辑入口。
- 无法归属的旧字段不静默删除；转换器将其保留为参考材料或待治理数据候选。

## 6. 当前单流程格式映射

| 编辑工作台 | `process-governance-v3` |
|---|---|
| 当前流程 | `process` |
| 隐式保留的历史编制参考材料 | `reference_materials[]` |
| 步骤及行为详情 | `behaviors[]` |
| 业务行为或节点名称 | `behaviors[].behavior_name` |
| “具体做什么”可选补充说明 | `behaviors[].behavior_description` |
| 执行部门和花名册岗位兼容值 | `behaviors[].current_actor_role` |
| 执行主体确定方式 | `behaviors[].actor_assignment_mode` |
| 动态责任部门来源数据 | `behaviors[].actor_department_data_ref` |
| 办理人员确定规则 | `behaviors[].actor_position_rule` |
| 顺序、判断、循环、并行 | `flow_relations[]` |
| 隐式保留的已有正式工作角色 | `behaviors[].work_role` |
| 输出及消费关系的唯一编辑入口 | `data_objects[].produced_by_behavior_ref`、`data_objects[].consumed_by_behavior_refs`，同步兼容`behaviors[].output_data_refs`和`behaviors[].input_data_refs` |
| 跨部门发送、输入数据、返回数据和恢复位置 | `cross_department_handoffs[]` |
| 隐式保留并仅供流程图预览的同部门调用 | `internal_process_calls[]` |
| 表单或记录、主表／明细表、填写项 | `forms[].areas[].items[]` |

## 7. 跨部门行为单一录入、历史归并和部门内调用预览

- `flowItems()`把`behaviors[]`和`cross_department_handoffs[]`投影为一个业务流程列表。存在有效`counterparty_behavior_ref`时，只显示关联的外部门行为节点，不再额外显示待办节点；只有没有本文件关联行为的兼容记录才按方向显示在锚点前后。投影只影响页面显示，不改变数组顺序。
- 所有实际业务动作都保存在`behaviors[]`。跨部门关系通过`counterparty_behavior_ref`引用外部门行为，`requested_matter`保存交界事项；本文件关联行为的`counterparty_behavior_name`保持空值，不再重复保存动作名称，也不建立额外`flow_relations[]`。
- 用户在本部门行为处新增前置或后续跨部门行为时，前端同时生成稳定`behavior_ref`和`handoff_ref`，写入`handoff_direction`、`anchor_behavior_ref`、`counterparty_behavior_ref`、本流程部门和默认触发时点。选择外部门后，从行为的`current_actor_role`同步承接部门和识别状态；`outbound_followup`存在唯一普通后续行为时自动带出返回位置。
- `renderLinkedHandoffFields()`在外部门行为编辑卡中只渲染方向、锚点、事项、数据和返回关系；名称、部门、岗位及完成标准沿用同卡上方行为字段。`renderHandoffEditor()`仅兼容没有本文件关联行为的历史记录。`renderHandoffs()`只输出只读摘要和定位按钮。
- 删除待办按`handoff_ref`定位。前端先显示承接部门、处理事项及删除范围；用户取消时不触发`touch()`或重新渲染，用户确认后只从`cross_department_handoffs[]`移除当前记录。
- 一项业务行为可以被多条`cross_department_handoffs[]`引用。删除该行为时，前端先显示关联数量；用户确认后再级联删除这些承接记录。
- `analyzeLegacyExternalBehavior()`只分析执行部门不同于归口部门且仍有重复普通关系或承接记录的行为。没有前序且只有一个本流程后续行为时，结果为`inbound_prerequisite`；存在唯一前序本流程行为时，结果为`outbound_followup`。多个前序或后续分支、相邻行为仍属于外部门、多个可能保留的承接记录或其他无法唯一确定方向和去向的引用形成明确阻塞项。`work_role`、会签、表单、数据和`internal_process_calls[]`因继续绑定保留行为，不再阻塞。
- 分析函数把唯一的旧版自锚定待办纳入归并来源，不再作为“其他跨部门待办引用”阻塞。存在匹配方向的待办时优先保留；否则保留唯一自锚定待办；均不存在时才新建。候选值从外部门行为和全部待归并记录收集，传递数据、返回数据、触发条件和其他非空字段不一致时生成逐字段选项，用户未完成选择前不得确认。
- `applyLegacyExternalBehaviorMerge()`只接收深拷贝文档和用户选择。前置输入归并时，将外部门产生或旧版返回的数据写入`transfer_data_ref`并校正为“外部门→归口部门”；后续承接归并时，将外部门行为产生的数据归入`returned_data_ref`并校正为“归口部门→外部门”。两类归并都保留外部门行为，将`counterparty_behavior_ref`指向该行为并清空重复的`counterparty_behavior_name`，只删除重复待办和连接该行为的普通关系；数据生产／使用引用、表单、工作角色、会签及内部调用保持原绑定。
- `confirmLegacyMerge()`把归并结果提交`/api/validate`。只有返回`valid=true`后才替换当前候选并调用`touch()`；请求失败、校验失败、取消或关闭弹窗时不修改当前文档。该过程不写回用户选择的源文件。
- 页面不渲染`internal_process_calls[]`编辑器，也不提供新增和删除动作。规范化导入和导出继续保留该数组；新建模板保持空数组。
- 预览中的内部流程调用被点击时，前端保留流程图并显示“部门内调用请在MDM平台正式功能中维护”，不得切换到不可编辑区域。

## 8. 岗位、数据类型和纸质表单字段实现

- `/api/enums`读取仓库`docs/organization/花名册.md`并返回`rosterRolesByDepartment`，同时返回服务端固定配置`fieldType`。该接口不调用MDM平台、数据库、认证或会话。
- `actorAssignmentEditor()`先渲染`actor_assignment_mode`。固定部门模式再调用`actorRolePicker()`列出全部组织部门，执行岗位从`rosterRolesByDepartment[selectedDepartment]`读取；归口部门为空时也允许选择，不设默认值。全公司通用和动态责任部门不进入部门选择器。
- `externalActorDepartment()`只对固定部门模式的`current_actor_role`与归口部门进行比较。新选外部门时，`ensureLinkedHandoffForExternalBehavior()`创建或复用唯一交接关系；改回归口部门、全公司通用或动态责任部门时，`removeCounterpartyLinksForBehavior()`先取得用户确认，按锚点和恢复位置补齐普通顺序关系，再删除固定跨部门关系。
- 归口部门选择器不通过通用`input`绑定直接写入草稿。`owningDepartmentChangeImpact()`先统计固定和动态执行主体、跨部门待办、能力归类、正式工作角色及历史部门内调用，并向用户显示旧值、新值、重置范围、保留范围和后续处理。用户确认后，`buildOwningDepartmentResetDocument()`在深拷贝中执行重置：清空固定执行部门和岗位，把动态责任部门恢复为未选择的固定模式，删除`cross_department_handoffs[]`，把能力归类恢复为未归类；`company_wide`行为保持不变。删除待办前，`owningDepartmentResetSequencePairs()`根据文件内有效行为引用补齐缺失的普通顺序关系。前端只有在副本通过`/api/validate`后才替换当前草稿；取消、版本不一致、服务异常或校验失败均不得修改原草稿。
- 归口部门重置不得删除行为、普通流程关系、数据、表单、技术标识、正式`work_role`或只读`internal_process_calls[]`。确认框必须单独提示正式工作角色和历史部门内调用仍需复核，不能因3001无法编辑而静默清空。
- 执行岗位选择器不设默认值。固定岗位保存为部门名与岗位名拼接的`current_actor_role`字符串；全公司通用保存为`全公司`；动态责任部门把`current_actor_role`保持为空，并使用`actor_department_data_ref`和`actor_position_rule`。
- `dataFlowConsistencyDetails().isAvailableBeforeBehavior()`校验动态来源数据：数据必须存在有效产生行为或跨部门可用起点，并且沿非回路关系到达当前行为；当前行为自身、后续行为和并行兄弟路线产生的数据均不通过。
- 规范化导入不清空未收录岗位。花名册加载失败时，岗位选择器不可修改现有值，但不影响其他编制和导出。
- 新增业务行为的`work_role`为`null`。合法历史`work_role`经行为引用规范化后隐式保留，页面不提供新增、修改或删除入口。
- 前端`formItemTypeField()`把`fieldType`渲染为`select`。新增或主动修改填写项时，只能选择标准值；不得回退为通用文本输入。
- 规范化导入继续把`item_type`作为原字符串保留。非标准历史值作为只读兼容选项显示并附未收录提示；用户改选后只能写入标准值。`fieldType`读取失败时，选择器禁用，已有值不清空。
- `process-governance-v1`中的`item_type`暂时保持字符串定义，唯一用途是允许仍在支持范围内的历史JSON无损导入、导出和恢复劳动成果。该兼容定义不代表前端允许自由填写；待历史非标准值完成治理后，再按版本迁移规则评估收紧结构规则。
- “录入现有表单”和“设计新建／优化表单”都创建一个空`area_type="基本信息"`分组，并分别写入`current_state`和`proposed_design`；空白流程本身不自动创建表单。
- `renderForms()`为每张表单渲染一个`form-field-table`，按`forms[].areas[]`顺序使用多个`tbody`分组显示主表字段、全部明细表字段和归属待确认字段。列固定为序号、字段名称、数据类型、字段归属、必填、填写说明、排序和删除；明细表标题及排序操作位于分组标题行。主表`area_title`仅作为历史兼容值保留。
- 新增字段进入`area_type=""`的待确认分组。字段归属选择器通过`item_ref`找到原字段对象：先从原`items[]`移除，再把同一对象追加到目标主表或明细表。该操作不得重建字段、修改字段内容或按数据类型推断归属。
- 选择“新建明细表”时创建`area_type="明细清单"`且`area_title=""`的内存分组。空标题只用顺序号显示占位；占位名称不写回JSON。
- 字段排序只交换同一`items[]`中的完整对象。明细分组排序只交换`areas[]`中的完整明细对象，不改变`area_ref`、`item_ref`或其他引用。
- 删除明细表复用一个确认函数，并在确认文案中显示字段数量。取消时函数返回`false`且不调用`touch()`；确认后只删除目标明细表。字段移走后保留空明细表，不自动改写现状证据。
- 新增字段后，`handleAction()`记录字段名称的`data-bind`路径，重新渲染后聚焦该输入框。表格只在自身容器内处理宽度，不把字段行改为移动端卡片，也不得把表格最小宽度传递为页面级横向溢出。
- v1、v2导入统一规范化为v3并把每张表单状态写为`unspecified`；v3合法状态原样保留。源文件只读，升级结果只存在当前页面内存。

## 8.1 业务行为精简和数据时序

- `renderBehaviors()`不再渲染`input_data_refs`和`output_data_refs`复选框，也不渲染`input_description`和`output_description`编辑控件。页面使用`renderBehaviorDerivedSummary()`只读显示进入方式、使用数据和产生数据，并跳转到“输出物与数据”。
- 没有有效前序来源的行为显示`trigger`编辑控件，标签为“流程如何开始”。存在有效非回路关系、前置跨部门待办或返回恢复位置时，页面通过`behaviorEntrySummary()`生成只读进入说明；历史非空`trigger`保留在只读历史补充中。
- `precondition`继续使用原字段，页面改称“其他开始条件（可选）”。`completion_standard`只对`action`和`decision`编辑和评分；`parallel_split`和`parallel_join`不承担实际业务动作，历史非空完成标准只读保留。
- 历史`input_description`和`output_description`不参与现行评分，也不自动生成数据对象。非空值在折叠的历史补充中显示，规范化、导出和重新导入必须逐字保留。
- `dataFlowConsistencyDetails()`是数据先后规则的唯一实现，供业务行为只读摘要、产生行为选择器、使用行为选择器、`businessWarnings()`和`evaluateContent()`共同使用。它按有效`sequence`、`condition`和`parallel`关系构建有向图，排除`loop`；有效返回承接按锚点到恢复位置增加前向可达关系。
- 普通数据的使用行为必须位于唯一有效产生行为之后。产生行为等于使用行为时判为自身引用；使用行为可到达产生行为时判为前序引用后续；两者互不可达时判为并行或无序引用；双向可达时判为非回路闭环，以上情况均不允许新增。
- 无本流程产生行为的数据默认视为外部输入。被`inbound_prerequisite.transfer_data_ref`引用时，从`anchor_behavior_ref`起可用；被返回承接的`returned_data_ref`引用时，从`resume_behavior_ref`起可用。恢复位置之前以及与恢复位置无明确先后关系的行为不能引用。
- 产生行为选择器只列出位于全部现有使用行为之前的候选；使用行为选择器只列出从产生位置明确可达的候选。导入历史不合规值时，当前值继续显示并标记“历史引用待整改”，用户可以取消选择，但页面不得在导入时删除。
- `syncBehaviorLinksForData()`只在用户修改当前数据对象的产生关系或使用关系后执行。修改产生关系时只归一`produced_by_behavior_ref`与各行为的`output_data_refs`；修改使用关系时只归一`consumed_by_behavior_refs`与各行为的`input_data_refs`，避免编辑一侧时覆盖另一侧尚未确认的历史引用。

## 9. 校验分层

3001导出前执行：

- 新建流程通过`/api/template?version=process-governance-v3`读取服务端空白模板，避免前后端分别维护结构。
- 新建和导出前调用`/api/schema`确认服务端默认结构版本为`process-governance-v3`；版本不一致时停止后续请求并保留当前页面内容。接口返回HTML或其他非JSON内容时，前端转换为可操作的服务异常提示，不直接暴露JSON解析错误。
- JSON Schema校验。
- 技术标识格式校验。
- 单文件内行为、数据对象、表单引用检查。
- 一份文件一个流程检查。

以下内容仅提示，不阻止草稿导出：

- PMO审核必填内容缺失。
- 流程入口、出口和可达性。
- 判断分支覆盖。
- 回路触发条件。
- 并行开始的有效路线数量和并行汇合的有效来源数量。
- 数据产生行为与使用行为的流程先后关系。
- 外部门行为是否仍用普通流程关系和承接记录重复表达同一次交接。
- 跨流程和跨部门目标是否存在。
- 执行岗位是否为空或仍为当前花名册未收录的历史值。
- 表单设计状态是否待确认、字段归属是否待确认，以及多张明细表中哪一张缺少区分标题。

`businessWarnings()`返回`message`、`suggestions[]`和定位元数据。`message`只保存系统能够确认的当前情况，`suggestions[]`至少包含1条可执行建议；多条建议按页面顺序显示，不合并为含糊句子。基础字段使用`editorSection + focusPath`定位；业务行为、流程关系、数据对象、跨部门承接、表单和表结构使用`focusKind + focusRef`选择对象，再用`focusPath`定位具体字段。流程入口说明缺失时定位`trigger`；数据时序问题定位数据对象的产生行为或使用行为。执行部门和岗位选择器通过`data-focus-key`映射到`current_actor_role`，复选项通过`data-list-bind`映射到数组字段。导出确认框使用同一组当前情况和建议，不另写一套文案。

`parallelStructureDetails()`是并行完整性的唯一计数入口，供结构评分和`businessWarnings()`共同使用。并行开始按不同`to_behavior_ref`统计从该节点发出的有效`parallel`路线；并行汇合按不同`from_behavior_ref`统计流入的有效`parallel`路线，并把`requires_return=true`且`resume_behavior_ref`指向该节点的有效后续承接各计为1个来源。计数结果同时保留与该控制节点相连、但`relation_type=sequence`的关系。`parallelSplitGuidance()`和`parallelJoinGuidance()`根据同一结果生成当前情况、建议和全部关系类型`focusPaths`：存在可改类型的顺序关系时建议修改现有关系，转换后仍不足时才补充新增建议。

`dataFlowConsistencyDetails()`是数据时序的唯一判断入口。有效`counterparty_behavior_ref`形成显式可达关系：前置输入为“外部门行为→本流程锚点”，后续承接为“本流程锚点→外部门行为”，需要返回时再形成“外部门行为→恢复位置”。因此外部门后续行为产生的数据不能被本流程前序行为引用。结构评分、数据选择器和导出检查复用同一问题列表；历史不合规引用在当前页面内存中保持原值，只有用户主动修改对应数据关系时才归一该关系。

用户点击导出检查问题项后，前端先切换分区并选中对象，再匹配`data-bind`、`data-focus-key`和`data-list-bind`。匹配到的`input`、`select`、`textarea`获得键盘焦点、`aria-invalid="true"`和红色呼吸高亮；多个匹配控件同时高亮。不存在具体控件时才退回高亮对象卡片或分区。动画结束后移除临时样式和属性，定位过程不调用`touch()`，不得修改当前流程。系统设置`prefers-reduced-motion`时取消动画并保留静态红色外框。

判断节点出口检查统计从该节点发出的`sequence`、`condition`、`loop`关系和`cross_department_handoffs[]`。出口数量不足时报告当前数量；同一判断节点存在多条无条件顺序关系时，从第二条开始逐条定位。每条流程关系分别检查关系类型、起点行为和目标行为；`condition`单独检查判断条件，`loop`单独检查回路触发条件，`sequence`允许空`condition`作为默认继续路径。每条跨部门承接分别检查发出部门、承接部门、发送行为、输入数据、返回数据、承接事项、承接触发条件和完成标准。检查不要求目标节点成为判断节点。计算主线入口和出口时排除显式`loop`，避免退回关系把正常主线误判为没有入口或出口。

MDM平台负责跨对象和最终可执行性校验。真实责任人负责审核业务事实。

JSON Schema结构错误和单文件技术引用错误分别提示。结构错误提示维护人员检查导出格式；只有技术标识重复或本文件引用断开时，页面才提示“技术引用已断开或重复”。

顺序调整、提示定位和判断出口识别本身不改写对象内容。v1到v2只执行本规格明确的兼容字段映射；兼容验证必须确认导入后可点击定位，重新排序只改变`behaviors[]`、`flow_relations[]`或`data_objects[]`中对应对象的数组位置，所有稳定引用和业务字段保持不变。跨部门待办在统一业务流程中的位置由引用投影，不提供独立数组排序。

## 9.1 结构化学习评分实现

`public/structure-score.js`是无依赖的纯前端评分模块。模块集中维护`structure-learning-score-v1`的权重、占位值判断、行为链计算、六项内容评分、技术评分合并、展示分和等级边界。`public/index.html`只负责生成当前文档副本、调用现有接口、渲染结果和执行问题定位，不在页面中维护第二套评分权重。

评分数据流如下：

1. 用户进入“导出检查”后，页面对当前流程执行`JSON.stringify()`和`JSON.parse()`，并在副本上调用`syncRoles()`。原始候选流程不得被修改。
2. 评分模块同步计算基础信息、业务行为、行为关系、数据与承接、表单结构和有效行为链。
3. 页面调用`/api/schema`确认前后端均使用`process-governance-v3`，再分别把当前副本和规范化回读副本提交到`/api/validate`。
4. 页面比较两份副本的稳定序列化结果。比较时只排除`export_meta.exported_at`，业务字段、数组顺序和技术引用均须保持一致。
5. 技术检查完成后，页面合并技术结构15分，生成结构完整性、展示分和等级。技术阻断把展示分限制为最高59分。

评分状态只保存在`structureScoreState`中。状态以候选序号和当前文档序列化内容作为键；用户切换候选或修改内容后，旧请求的`runId`、候选序号或文档键不匹配时，页面丢弃旧结果。评分和重新评分不得调用`touch()`，不得修改`exported_at`，不得写入JSON或浏览器持久化空间。

校验服务不可用、接口未返回JSON或前后端版本不一致属于运行异常。页面保留已计算的内容维度，但不生成最终结构完整性、展示分和等级；用户恢复服务后点击“重新评分”。结构规则或本文件技术引用检查未通过属于文件技术阻断，页面生成分数并执行59分封顶，同时保留原有导出阻断行为。

判断出口评分使用现行3001规则：一条无条件`sequence`可以作为默认继续路径，`condition`和`loop`必须填写条件，结构完整的`outbound_followup`可以作为出口，`inbound_prerequisite`不作为出口。评分只检查结构是否完整，不要求目标节点为`decision`，也不判断条件是否互斥或业务做法是否正确。

业务行为维度每项按五个检查点计算：节点类型、名称、执行岗位、进入方式和完成标准。进入方式由`dataFlowConsistencyDetails().incomingByBehavior`判断；有有效前序来源时不要求重复填写`trigger`，没有来源时必须填写流程入口说明。并行控制节点的完成标准按不适用通过。`input_description`和`output_description`不再计分。

数据对象维度继续检查名称、说明和关联关系。第三项只有在至少存在一个有效产生或使用关系且`dataFlowConsistencyDetails()`没有该数据对象的时序问题时通过；每个时序问题另外返回“数据时序”定位项，但同一数据对象第三项最多扣一次。

承接子项满分5分。没有承接时按不适用获得5分；有承接时，每条关系分别检查方向、本流程有效锚点、外部门或待明确标记、传递数据或承接事项、触发条件或完成标准。关联本文件外部门行为时，行为的`completion_standard`可满足完成标准检查，行为名称由`counterparty_behavior_ref`解析，不要求重复填写`counterparty_behavior_name`。外部门流程、确认状态、返回路径和证据只形成治理提示。评分函数对输入对象只读，测试必须在评分前后比较规范化JSON。

评分模块返回问题的维度、当前情况、`suggestions[]`、影响和定位元数据。页面使用现有`focusExportWarning()`定位基础字段、业务行为、流程关系、数据对象、跨部门承接、表单或表结构；无法定位具体输入控件时退回对象卡片或分区。重复的评分扣项和普通导出提示按文案及定位元数据去重。

v2历史升级曾引入承接关系结构。服务端继续编译v1、v2和v3规则；当前默认模板和导出使用v3，v1、v2仅用于兼容导入。v1承接关系迁移为`outbound_followup`，`send_behavior_ref`映射到`anchor_behavior_ref`，`input_data_ref`映射到`transfer_data_ref`，既有目标部门、目标流程和目标行为映射到外部门字段；存在返回数据或恢复行为时设置`requires_return=true`。v1、v2表单在页面内存中补`form_design_state=unspecified`。字段冲突保留原值并产生警告，不猜测正确答案。

## 9.2 导出后的静态提示

`renderExportCheck()`在评分和普通提示项之后、导出边界及导出按钮之前渲染`next-stage-grid`。该区域包含两张静态卡片：

1. “完成业务评审后，进入MDM平台正式编辑”说明归口部门MDM审核员在MDM平台执行预览、填写审核依据和审核导入，MDM平台复核文件内容未变化后才写入流程草稿。
2. “后续预告：系统动力学评价”说明未来评价将结合正式流程、运行数据和实际反馈观察动态变化，并明确评价不替代业务评审、审核和管理决策。

两张卡片不绑定`data-action`，不包含按钮或链接，不调用MDM平台接口，不修改`structureScoreState`、候选流程、未导出状态、JSON或浏览器持久化空间。卡片保持桌面两列网格，不提供移动端单列变体。

## 10. 页面参考材料暂停和DeepSeek移除

- 删除页面“导入参考材料”、拖放区、参考材料编辑区和缺失提示，只保留JSON结构化文件导入。
- `/api/template`生成`reference_materials: []`。`normalizeV1()`保留导入JSON中已有的合法参考材料，再导出时不清空。
- 后端确定性解析和`/api/upload`仅保留用于历史迁移和回归测试，不再作为业务用户页面入口。
- 删除页面模型说明、建议状态和建议请求。
- 删除 `/api/suggestions`。
- 删除DeepSeek及CC Switch配置读取、健康状态和网络调用。
- 页面顶部不展示DeepSeek停用说明，也不展示3001无状态、MDM平台通信或线下审核边界的通用声明；这些边界只保留在产品和运行文档中。
- 历史上传解析只使用确定性解析器。
- 健康检查只返回服务状态、端口、运行时间、Git提交、结构版本和结构摘要。

## 11. 安全和隐私

- 原文件不嵌入JSON。
- 历史参考材料只保留结构化JSON中已有的文件名、编号或版本、SHA-256摘要和可读文本；页面不新增这些内容。
- 服务端不记录文件名、原文、编制人或业务内容。
- 导出由浏览器完成。
- 服务默认监听`0.0.0.0:3001`，公司局域网用户通过服务器局域网地址直接访问；`STRUCTURED_OUTPUT_HOST`只用于维护人员显式收窄监听范围。
- 3001运行时不依赖DeepSeek、`apps/structure-assistant`或认证网关。独立试点脚本不得停止、重绑或启动3001。
- 部署主机通过公司局域网边界和防火墙限制访问来源，不将3001映射到公网。
- 空白模板接口提供Git提交、结构版本和结构摘要，不提供用户内容。

## 12. MDM平台交接边界

- 3001只输出未审核的结构化事实和治理提示，不保存账号、任务、决定或审核状态。
- MDM平台通过`POST /api/process-design/import-structured-output/preview`重新规范化和校验，通过`POST /api/process-design/import-structured-output/approve`复核原始数据、预览哈希、审核依据和真实身份。
- 审核导入成功后，MDM平台以“流程草稿标识＋`handoff_ref`”幂等保存承接对象，并将问题池作为承接对象的待办投影。
- MDM平台负责参与人、部门范围、双方决定、最终责任人、争议升级、结构卡口和发布阻断；3001不得代替这些治理动作。
