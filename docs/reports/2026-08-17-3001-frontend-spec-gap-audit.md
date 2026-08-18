# 3001前端规格-实现差距审计

> 日期：2026-08-17
> 审计范围：`apps/structured-output-service/AGENTS.md` 与 `apps/structured-output-service/` 前端、服务端、测试实现
> 数据来源：源码与规格静态核对
> 改动状态：只读分析，未修改任何真源或源码

## 结论摘要

版本主线已统一到 `process-governance-v5`，无"当前格式"的 v4/v5 混用。但存在五处需要修复的差距：390×844 窄屏布局未实现、评分版本号 v1/v2/v3 三处漂移、v4 时代死代码测试套件、`join_mode` 规格-实现-契约错位、跨部门死 CSS 与空转代码及规格外功能。

## 逐条核对结果

| # | 核对项 | 实现证据 | 状态 | 说明 |
|---|---|---|---|---|
| 1 | 版本主线统一为 v5 | `index.html:2017`(EXPECTED)、`index.html:2216`/`server.js:2895`(template)、`server.js:2917`(health)、`server.js:2890`(schema)、`test-service-contract.js:3315-3317`(执行中测试) | 符合 | 无 v4/v5 混用 |
| 2 | 评分标签版本号 | `AGENTS.md:70`写"v1（试行）"；`structure-score.js:28`/`test-structure-score.js:143`写"v2（process-governance-v5）"；`index.html:5327`兜底文案写"v3" | 不符合 | 三处版本号漂移 |
| 3 | 测试套件 | `test-service-contract.js:1233-3307` 的 `testFrontendContractLegacy` 未被 `main()`(:3673-3681) 调用，断言 EXPECTED=v4(:1288)、fetch template v4(:1287)、评分 v2(v4)(:1320)、normalizeV1 输出 v4(:1846)、交接 UI(:1289-1291)、moveCollectionItem(:2127) | 不符合 | v4 死代码与当前实现矛盾 |
| 4 | 移动端 390×844 | `index.html:33` body `min-width:1920px`；唯一 `@media` 是 `prefers-reduced-motion`(:693)；触屏拖动 pointer 事件存在(:974,7601-7624) | 部分 | 无宽度断点，390×844 依赖页面级横向滚动，需浏览器实测 |
| 5 | 跨部门 | v5 无交接字段/UI（测试 :3318-3322 断言不存在；schema 无该字段）；转换仅导入触发(`index.html:2798,2970-2979`)；残留死 CSS(:1797-1810,1878-1889,955,443-470)与规格外"归并同名数据"(:4742,6384,6109-6167) | 部分 | 活动结构正确，残留死代码与规格外功能 |
| 6 | 字段来源 source_type | v5 schema:159-180 有该字段，外部系统 `source_data_ref` 强制 null；`index.html:2055-2058` FIELD_SOURCE_TYPES 与渲染/导入/校验一致 | 符合 | — |
| 7 | 列表排序 | 四类列表仅拖动把手(`index.html:4491/4587/4729/5074`，`itemDragHandle`:4279-4289)；表单表格上移/下移箭头(:4994-4995)属允许的"排序"列 | 符合 | 注意 `AGENTS.md` 内部矛盾：:43（只用手把）vs :186（仍要求上移/下移测试） |
| 8 | join_mode | `process-diagram.js:162` 仍读 `join_mode==='all'`；`index.html:4614-4617` 仍渲染"汇合方式"编辑控件；v1 schema:391-426 required 仍含 join_mode | 不符合 | 规格未提但 schema+实现保留，规格-契约错位 |
| 9 | work_role | 新增行为 `work_role:null`(`index.html:5821`)，无编辑控件(只读提示:4541)，导出 syncRoles 重算名称(:5755-5762) | 符合 | `refreshRoleName`(:5764-5768) 查询的 `[data-role-name]` 无渲染目标，空转代码 |

## 最需修复的差距 Top 5

1. **390×844 无窄屏布局**：`min-width:1920px` + 无宽度断点，与 `AGENTS.md` 移动端要求直接冲突，需补响应式断点并浏览器实测。
2. **评分版本号 v1/v2/v3 三处漂移**：`AGENTS.md`(v1)、`structure-score.js`(v2)、`index.html`(v3) 不一致，需统一口径。
3. **v4 死代码测试套件**：`testFrontendContractLegacy` 未被调用却断言 v4，易误导维护者，需删除或迁移到 v5。
4. **join_mode 规格-实现-契约错位**：规格未提、schema 必填、图与编辑控件仍读取，需三方对齐（删除或明确保留）。
5. **跨部门死 CSS / 空转 work_role 刷新 / 规格外"归并同名数据"**：残留死样式与空转函数增加维护噪音，规格外功能需评估去留。

## 补充说明

- 本次审计修正了此前"执行中测试仍断言 v4"的判断：执行路径(`main()` :3673-3681)已切 v5，v4 断言位于未调用的死代码函数 `testFrontendContractLegacy` 内，不会导致测试失败，但应清理。
- `AGENTS.md` 存在一处内部矛盾：第 43 条要求四类列表"只用手把不用箭头"，第 186 条仍要求"上移/下移"测试，需统一表述。
