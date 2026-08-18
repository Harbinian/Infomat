# Codex执行提示词：3001流程结构规则v6升级与可编辑流程图

把下面的内容作为完整任务交给Codex执行。Codex开始前必须按仓库入口顺序读取根目录执行规则，再读本目录方案文档。

---

## 任务目标

在`apps/structured-output-service/`完成3001的`process-governance-v6`升级，一次交付两项变更：

1. 把流程图从只读预览升级为可编辑编制入口（图编辑为主，文字编制并存，点击元素双向跳转）。
2. 合并流程数据结构冗余，收敛到`process-governance-v6`。

## 开始前必读

按顺序读取：

1. `AGENTS.md`、`CODEX.md`、`REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md`、`MAINLINE_MAP.md`
2. `docs/architecture/data-governance-operating-rules.md`
3. `apps/structured-output-service/AGENTS.md`
4. 本目录`PRD.md`、`Tech-Spec.md`、`API-Contract.md`、`Migration-Mapping.md`、`Migration-Test-Plan.md`

## 已锁定的决策（不得更改）

1. 图编辑与数据结构精简合并成**一个版本**发布，版本号为`process-governance-v6`。
2. 数据结构精简执行以下合并：
   - `current_actor_role`拆为`actor_department`与`actor_position`，执行主体模式由`actor_assignment_mode`表达。
   - `input_description`、`output_description`、`trigger`移出必填，降为历史兼容可选字段。
   - `work_role`从行为对象移入`migration.work_roles[]`。
   - `reference_materials[]`、`internal_process_calls[]`从根对象移入`migration`归档。
   - 删除常量字段`governance_status`和冗余字段`join_mode`。
3. 保持无状态：布局坐标、画布缩放、图例状态不写入JSON、浏览器持久化或服务端状态；正式承接、审核、发布仍在MDM平台。
4. 单一真源：内存中只保留一份草稿对象，流程关系图、数据关系图、属性面板和文字编制读写同一份对象，双向同步，不做图数据与文本数据的翻译层。
5. 不提供自由拖动摆位，布局继续自动生成。

## 需要创建或修改的文件

### 新增

- `docs/contracts/process-governance-v6.schema.json`：按`Migration-Mapping.md`定义v6结构规则。
- `apps/structured-output-service/scripts/`下的v6迁移测试和图编辑契约测试。

### 修改

- `docs/contracts/process-governance-version-history.json`：登记v6，`current_version`改为`process-governance-v6`。
- `apps/structured-output-service/server.js`：增加v6模板和校验器，默认结构版本切换为v6，`/api/schema`、`/api/template`、`/api/health`和`/api/version-history`统一采用v6当前版本。
- `apps/structured-output-service/public/index.html`：流程图标签升级为可编辑，增加工具条和属性面板，接入双向定位与即时校验。
- `apps/structured-output-service/public/process-diagram.js`：从只读渲染扩展为可选中、可监听新建和连线手势，保持现有布局与可读性样式。
- `apps/structured-output-service/public/structure-score.js`：结构评分和评审引用切换到v6。
- 统一所有测试、评分、评审中的结构版本引用到v6，消除v4、v5残留断言。

## 迁移要求（3001无状态口径）

- 转换只在当前页面内存中执行，源文件不修改，导出统一为v6。
- 转换必须幂等；同一输入重复规范化不产生重复行为、关系、数据或迁移记录。
- 无法无损转换的内容进入`migration`归档，不得静默丢弃、清空、猜测或用默认值掩盖。
- 必须验证四类场景：上一受支持版本导入当前版本；当前版本导出后重新导入；重复执行迁移；迁移失败后恢复。

## 文档同步要求

同步更新以下文档，不得只改代码不改文档：

- `apps/structured-output-service/AGENTS.md`：把"只读跨职能流程图预览"改为"可编辑流程图"，补充单一真源、双向同步、坐标不持久化条款，结构规则切换到v6。
- `apps/structured-output-service/README.md`、`PRD.md`、`Tech-Spec.md`：同步v6结构与图编辑说明。
- `docs/contracts/README.md`：规则文件表登记v6，标注当前版本。
- `docs/architecture/data-governance-operating-rules.md`：把3001当前输出版本从v5更新为v6。
- 如引入新术语，同步`docs/glossary.md`。

## 验证命令

```powershell
npm --prefix apps/structured-output-service test
```

MDM-AI助手继续使用v5，本次不修改、不测试，不纳入v6完成范围。

## 验收标准

- v6文件通过结构校验和文件内引用校验，导出后重新导入不丢失内容。
- v1至v5文件可导入并转换；重复转换结果稳定；转换失败保留当前页面内容和源文件。
- 图上新建要素、建立和修改流程关系与数据关系后，对应数组正确写入，技术标识唯一，`/api/validate`通过。
- 点击图中元素跳转文字编制对应项并聚焦；反向"定位到图"居中该元素。
- 刷新后草稿、布局和撤销记录清空；有未导出内容时先提示。
- 1920×1080、1536×864和1280×720内容可视区无关键操作遮挡、意外页面级横向滚动或控制台错误；不执行手机布局验收。
- 业务缺项仅提示；结构错误、重复技术标识、断开的本地引用、非法枚举和往返丢失阻断导出。

## 禁止事项

- 不改动MDM平台、`docs/norms/`流程输入基线、PMO驾驶舱或MDM数据库。
- 不通过API、数据库、队列、回调、共享会话或轮询与3000通信。
- 不新增数据库、账号、自动保存或浏览器持久化。
- 不把审核状态、审核意见、批准标记或制度关联字段写入当前单流程格式。
