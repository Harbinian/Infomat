# docs/plans 说明

> 状态：计划、方案和检查记录目录  
> 生效日期：2026-06-10  
> 范围：阶段性计划、需求问卷、稳定性检查说明和项目执行方案。

本目录保存计划性文档和阶段性检查说明。这里的文件用于解释某个时间点的工作安排、设计考虑或验证口径，不替代仓库当前边界文件、流程输入基线或组织真源。

## 1. 当前文件

| 文件 | 作用 | 口径 |
|---|---|---|
| `2026-05-17-changxing-network-plan.md` | 网络规划材料 | 历史方案 |
| `2026-05-17-changxing-requirements-questionnaire.md` | 需求调研问题清单 | 调研材料 |
| `2026-06-29-mdm-governance-input-baseline-landing-plan.md` | MDM 治理落地计划 | 执行计划 |
| `2026-08-09-mdm-data-flow-lifecycle-governance-development-plan.md` | MDM 数据流与生命周期治理开发计划 | 等待批量导入与首轮测试门槛 |
| `2026-08-20-3001-process-governance-v7-data-lifecycle-upgrade-plan.md` | 3001 v7数据生命周期升级计划 | 范围已收口；七步前端基础基本完成，v7结构、自动分析、迁移和验收待实施 |
| `2026-08-13-ea-bpm-governance-evaluation-design/` | 3000 EA/BPM治理评价与3001评审准备设计包 | 3001四方面前端已实现；3000正式治理评价仍等待G-01至G-06 |
| `2026-08-15-3001-process-governance-v4-upgrade/` | 3001输出物、数据、表单、字段与业务行为关系升级 | v4结构、兼容迁移、页面、AI助手和验收真源 |
| `2026-08-17-3001-process-governance-v6-graph-editing/` | 3001可编辑流程图与数据结构精简升级 | v6结构、迁移映射、图编辑、认知负担与验收真源；已实施 |
| `2026-08-20-3001-seven-step-frontend-acceptance-plan.md` | 3001七步治理前端正式验收 | 固定G0至G5、无状态硬门槛、真实流程和v4迁移双案例、缺陷分级与签发边界 |
| `2026-08-20-3001-process-governance-v7-data-lifecycle-upgrade-plan.md` | 3001 v7数据生命周期升级总计划 | v7已发布并进入使用中验证；真实脱敏流程业务核对继续进行 |
| `2026-08-21-3001-process-governance-v7-lifecycle-upgrade/` | 3001 v7数据生命周期实施设计包 | PRD、技术方案、接口约定、迁移映射、迁移测试和验证记录真源；v7已发布并进入使用中验证 |
| `2026-08-26-3001-single-process-user-trial/` | 3001单流程真实用户试验包 | 材料已准备；等待脱敏流程、独立参与角色和隔离运行授权，尚未开始真实用户试验 |
| `2026-08-21-3001-interaction-bulk-data-edit-upgrade/` | 3001交互缺陷收口与Excel/WPS批量数据编辑升级 | 缺陷分类、角色与阶段分层、批量粘贴、预览、引用保护和测试门槛；正式3001已发布，进入使用中验证 |
| `2026-08-21-3001-web-grid-editor-upgrade/` | 3001双模式网页表格编辑器升级 | 业务式编辑、九类网页表格、同一JSON、工作副本、整体应用和复用边界；实施与技术验证真源 |
| `2026-08-12-3001-process-authoring-rollout-execution-plan.md` | 3001流程结构化编制推广与执行计划 | V1.1按四轮编制和两级推广门槛执行，未满足门槛时顺延 |
| `2026-08-12-3001-pilot-action-register.md` | 3001首轮样板行动项台账 | V1.1分别记录事项状态、流程阶段、四轮交接和推广门槛 |
| `2026-07-23-internet-only-office-governance-process-draft.md` | 全公司互联网专用办公区需求收集、建设与使用管理流程 | 待评审草案 |
| `2026-07-24-internet-only-office-feedback-optimization-plan.md` | 互联网专用办公区流程及 3001 结构化填写优化计划 | 技术优化已完成，待业务确认 |
| `流程治理字段台账主线稳定性检查.md` | MDM 主线稳定性检查说明 | 测试说明 |
| `系统集成项目计划.md` | 系统集成项目计划 | 计划材料 |

## 2. 使用边界

1. 计划文档可以说明为什么做某件事，但不能覆盖 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 或 `MAINLINE_MAP.md` 的当前边界。
2. 涉及流程和部门数据时，仍以 `docs/norms/`、`docs/organization/` 和 PMO 驾驶舱当前数据为准。
3. 涉及 MDM 测试入口时，以 `apps/mdm-platform/package.json` 和根 `package.json` 当前脚本为准。
4. 历史计划如已不再执行，应在文件开头注明状态，不直接删除。

## 3. 修改自检

- 新增计划时，标题或正文注明日期、范围和负责人/适用对象。
- 引用测试命令时，确认命令在当前 `package.json` 中存在。
- 引用资料目录时，确认目录边界与 `docs/README.md` 一致。
