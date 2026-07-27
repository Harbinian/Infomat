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
