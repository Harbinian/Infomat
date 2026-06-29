# 全库分层整改验证记录

> 日期：2026-06-11  
> 范围：本轮第 3 层只读清单、第 4 层目录边界说明和审计报告。  
> 结论：以下命令在当前分支通过。

## 1. 验证命令

| 范围 | 命令 | 结果 |
|---|---|---|
| 根目录流程治理主线聚合校验 | `npm run test:process-governance-mainline` | 通过；包含合约、PMO 数据、部门域、工程待确认源、sourceManifest 指纹、流程输入基线清单和 PMO 任务数据 |
| 根目录部门域一致性 | `npm run test:dept-domain-mapping` | 通过 |
| 工程技术部待确认源清单 | `npm run test:engineering-source-manifest` | 通过 |
| 公司级 sourceManifest 指纹 | `npm run test:source-manifest-hashes` | 通过 |
| PMO 驾驶舱数据一致性 | `node scripts/check-dashboard-data.mjs` | 通过 |
| MDM 安全专项 | `cd apps/mdm-platform && npm run test:security` | 通过 |
| MDM 主线稳定性 | `cd apps/mdm-platform && npm run test:mainline` | 通过 |
| MDM 项目角色边界 | `cd apps/mdm-platform && npm run test:project-roles` | 通过 |
| MDM 流程治理专项 | `cd apps/mdm-platform && npm run test:process-governance` | 通过 |
| PMO 任务数据一致性 | `npm run test:pmo-task-data` | 通过 |

## 2. 说明

- 本轮验证没有修改流程输入基线、PMO 真源或 MDM 数据库真源。
- 测试输出中的 SQLite migration 日志来自隔离测试库初始化。
- 2026-06-11 合并后复核时，当前工作区已无未提交改动。
