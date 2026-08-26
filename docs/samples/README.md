# Samples

本目录只存放“必要样例”，用于说明格式与复现最小流程。

## 当前样例

| 文件 | 用途 |
|---|---|
| `互联网专用办公区需求收集与使用管理程序-3001填报测试.md` | 导入 3001，测试“阶段一、阶段二、阶段三”拆成 3 条流程、显式业务行为字段、当前判断节点分支、业务流程绑定，以及使用日期、预约单号和终端编号无损整理 |
| `3001-process-authoring-training-sample-v3.json` | 3001推广培训公共样例，练习单流程v3、判断分支、回路、跨部门承接、数据对象和三张表单；迁移到v7后固定保留6条指向控制节点的数据关系和1条指向控制节点的表单关系，页面只允许人工改到实际办理业务的`action`行为，7项全部处理前不能下载；不得作为正式流程导入3000 |
| `3001-control-node-relationship-repair-sample-v7.json` | 3001历史控制节点关系整改的脱敏技术夹具。导入后应保留1条数据关系和1条表单处理关系技术阻断；人工把`data_link_legacy_control_node`和`form_link_legacy_control_node`都改到`behavior_register_application`后，文件应通过严格校验、下载并重新导入。该映射只用于技术验收，不是正式业务关系或治理结论 |
| `3001-data-form-relationship-sample-v4.json` | 3001 v4公开样例，练习创建更新使用、跨流程来源线索、多行为表单、字段业务数据归属、多种取值来源、主表、多张明细表、重名提示、删除保护和受控归并；不代表真实制度或部门职责 |
| `3001-review-readiness-sequential-v3.json` | 流程标准评审准备规则的普通顺序流程测试数据；无数据和表单时用于验证“不适用”边界 |
| `3001-review-readiness-approval-parallel-v3.json` | 流程标准评审准备规则的审批、退回、并行开始和并行汇合测试数据；历史工作角色只用于触发条件规则 |
| `3001-process-review-readiness-test-cases-v1.md` | `process-review-readiness-v1`测试矩阵、内存变体、预期状态和定位验收要求 |

规则：

- 样例必须小、可脱敏、可再分发
- 任何大体量输出、抓取记录、浏览器 profile、批量导出结果都属于生成物，不得提交
- 生成物应输出到 `artifacts/`（或工具指定目录），并通过 `.gitignore` 排除
- 文件名包含`review-readiness`的样例只用于规则开发和回归，不是已确认业务流程，也不计入真实流程试点

