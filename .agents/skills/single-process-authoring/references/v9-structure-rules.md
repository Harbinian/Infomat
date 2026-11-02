# V9 结构与兼容规则

本文件说明当前候选技术表达，不决定业务事实。结构以 `docs/contracts/process-governance-v9.schema.json` 为准，语义由共享 `scripts/process-governance/v7-validator.js` 与数据可用性检查执行。未改变的顶层、稳定标识、表单、生命周期规则沿用V8；不添加可信审核状态、图坐标或正式版本标识。

- `process.entry_behavior_refs`明确实际流程入口；不按数组首项、节点名称或入度猜测。未知用空数组保留问题，不能通过正式门槛。
- 对象 `record_model`为 `single_instance`、`record_collection`或 `pending_confirmation`。集合并非多条创建争抢同一记录；每次 `create`形成独立新实例。`collection_field_refs`列出集合索引或保管元数据字段，实例正文不得混入集合更新。
- 数据链接 `record_scope`为 `new_instance`、`current_instance`、`prior_records`、`collection_metadata`或待确认。创建只用新实例；使用和更新不能读取本动作未来的新输出。更新实例与集合元数据分开链接、分别列出字段，保留历史正文及稳定身份。
- 链接 `presence`为 `required`、`if_exists`、`conditional`或待确认。创建可必然或条件发生；条件创建不保证后续输入存在。使用和更新可必须存在或存在时才办理，不能用条件读取规避实际必须存在的材料。
- 外部来源 `presence`为 `required`、`if_exists`或待确认，并沿用明确的可用时点。必需来源是执行前须核验的声明，不是材料已供给、权限已满足或部门已确认的证据。

旧完整原生V7/V8只在当前页面副本中新增空入口和待确认记录语义，既有字段、标识、数组顺序及迁移归档保留。早期格式按受限兼容规则规范化并保留原文；不得静默丢弃或猜测。V9回读须无损、重复迁移幂等，失败不得替换当前草稿或改写源文件。3000按原生版本读取历史记录，不批量回填。当前没有旧格式兼容截止日期；回退时保留V9原件，不生成有损降级文件。

脚本保留 `validate-process-v8.mjs`兼容名称；默认空模板为V9，`--promote`仍只做旧V7→V8标识转换。示例 `minimal-v8-example.json`仅说明历史V8形状，不作V9生成模板。当前3001运行实例未因候选源码而切换；上传V9之前须核对3000实际接收支持。
