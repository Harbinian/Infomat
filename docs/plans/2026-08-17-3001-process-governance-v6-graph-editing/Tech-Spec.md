# 3001流程结构规则v6技术规格

## 总体架构

3001继续是单进程Express服务，端口3001，无状态。前端使用桌面专用的左侧任务栏和右侧编辑区。右侧提供流程关系、数据关系、文字编制和版本说明互斥标签；流程关系是默认图入口。

内存中只保留一份草稿对象。画布渲染、属性面板和文字编制都读写同一份对象。任一视图修改后，其余视图按同一对象重新渲染。不建立图数据与文本数据之间的翻译层。

## 画布组件

- 工具条：当前图模式最多六个一级操作。流程节点类型、数据操作类型和关系类型进入二级菜单或属性面板。
- 画布：复用现有跨职能泳道布局与可读性样式。节点第二行显示执行岗位；执行部门与归口部门不同的行为标记"跨部门行为"；跨泳道箭头由普通流程关系两端部门自动识别。
- 属性面板：显示选中节点或关系的概要，提供`behavior_name`、执行部门、执行岗位、关系类型、`condition`的就地编辑，其余字段通过"在文字编制中编辑"跳转并聚焦。
- 双向定位：图中元素跳转文字编制对应项并红色高亮；文字编制"定位到图"切回画布并居中该元素。

## 布局与无状态

布局坐标、画布缩放、图例状态、展开状态和组件配置只存在当前页面内存，不写入`process-governance-v6`、浏览器持久化或服务端状态。切换候选时自动布局重新计算；刷新后草稿和全部视图状态清空。

## v6数据结构

根对象必填字段：

```text
schema_version, export_meta, process, behaviors, flow_relations, data_objects, forms, terms, migration
```

`reference_materials`和`internal_process_calls`从根对象移入`migration`归档。`cross_department_handoffs`在v5已从活动结构移除，v6继续不包含。

业务行为`behaviors[]`必填字段：

```text
behavior_ref, node_type, behavior_name, actor_assignment_mode, actor_department,
actor_position, completion_standard, countersign_all_required, countersign_target_departments
```

可选字段：

```text
behavior_description, precondition, timing, actor_department_data_ref, actor_position_rule,
trigger, input_description, output_description
```

`trigger`仅对没有非回路入边的流程入口节点开放编辑；`input_description`和`output_description`只读保留。`work_role`从行为对象移入`migration.work_roles[]`。

流程关系`flow_relations[]`删除`join_mode`，并行汇合语义由`node_type=parallel_join`节点承担。

数据对象`data_objects[]`删除`governance_status`，数据对象默认即待治理候选。

## 校验

`/api/validate`按`schema_version`选择校验规则。v6硬性校验技术标识唯一性和行为、数据、表单、关系的本文件引用。图上操作即时调用校验，损坏引用阻断写入。业务缺项仍只提示不阻断。

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `apps/structured-output-service/public/index.html` | 流程图标签升级为可编辑，增加工具条与属性面板，接入双向定位与即时校验 |
| `apps/structured-output-service/public/process-diagram.js` | 从只读渲染扩展为可选中、可监听新建和连线手势，保持现有布局与可读性样式 |
| `apps/structured-output-service/public/data-relation-diagram.js` | 独立聚焦式数据二部图和合并可见边 |
| `apps/structured-output-service/public/process-governance-migration.js` | 浏览器与Node共用的纯迁移 |
| `apps/structured-output-service/public/graph-edit-commands.js` | 图命令、删除保护和同名数据归并 |
| `apps/structured-output-service/public/graph-editor-state.js` | 候选隔离的撤销重做、指纹和视图状态 |
| `apps/structured-output-service/public/structure-score.js` | 结构评分和评审引用切换到v6 |
| `apps/structured-output-service/server.js` | 增加v6模板、校验器与版本历史，默认结构版本切换为v6 |
| `apps/structured-output-service/scripts/` | 新增图编辑契约测试和v6迁移测试 |
| `docs/contracts/process-governance-v6.schema.json` | 新增v6结构规则 |
| `docs/contracts/process-governance-version-history.json` | 登记v6，`current_version`切换为v6 |
