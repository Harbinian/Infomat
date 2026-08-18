# docs/contracts 说明

> 状态：自动化校验规则目录
> 生效日期：2026-06-10  
> 范围：脚本读取的结构化规则，不作为业务正文或流程输入基线。

本目录保存仓库级校验脚本使用的规则文件。规则文件用于规定脚本如何检查流程映射、部门桑基图、PMO驾驶舱和组织口径。

规则文件不替代 `docs/norms/` 中的流程输入基线。
规则文件也不替代 `docs/organization/` 中的组织真源。

## 1. 当前规则文件

| 文件 | 使用方 | 输入 | 输出 | 回归命令 | 作用 |
|---|---|---|---|---|---|
| `dcm-bbm-contract.json` | `scripts/check-dcm-bbm.mjs` | `docs/norms/`、`docs/organization/组织架构和部门职责.md`、`pmo/procedure-management/dashboard.html` | 默认报告 `docs/reports/dcm-bbm-quality-report.md` | `node scripts/check-dcm-bbm.mjs --no-fail` | 定义 DCM/BBM 质检的路径、术语、允许系统、交付物命名、表头、证据类型和 HTML 检查规则 |
| `dcm-bbm-contract.json` | `scripts/check-norms-source-manifest.mjs` | `docs/reports/2026-06-11-norms-source-manifest.md`、`docs/norms/` | 只读校验输出 | `npm run test:norms-source-manifest` | 校验规则文件中的部门、域口径和标准三件套覆盖状态一致 |
| `dcm-bbm-contract.json` | `scripts/check-dept-domain-mapping.mjs` | `docs/organization/组织架构和部门职责.md`、`scripts/parse-sankey-data.mjs` | 只读校验输出 | `npm run test:dept-domain-mapping` | 校验部门到域映射来自组织真源且与规则文件一致 |
| `document-structured-output.schema.json` | `scripts/test-document-structured-output-schema.mjs`、文档结构化输出导出/校验脚本 | `apps/structured-output-service/`、`apps/mdm-platform/`、`scripts/parse-sankey-data.mjs` | 只读校验输出 | `npm run test:document-structured-output-schema`、`npm run test:work-role-contract` | 统一制度、流程、行为、工作角色绑定、表单字段、证据、待确认问题和结构块投影的数据模型；工作角色正式目录仍以组织真源为准 |
| `process-governance-v1.schema.json` | `apps/structured-output-service/`、`apps/mdm-platform/` | 历史3001单流程文件 | 规范化到当前版本的兼容输入 | `npm --prefix apps/structured-output-service test`、`npm --prefix apps/mdm-platform run test:process-design` | 只作为兼容导入规则；v1承接按后续承接迁移，源文件不修改 |
| `process-governance-v2.schema.json` | `apps/structured-output-service/` | 历史v2单流程文件 | 迁移到v6的兼容输入 | `npm --prefix apps/structured-output-service test` | 保留v2承接结构，只作为兼容读取规则；源文件不修改 |
| `process-governance-v3.schema.json` | `apps/structured-output-service/` | 历史v3单流程文件 | 迁移到v6的兼容输入 | `npm --prefix apps/structured-output-service test` | 保留表单设计状态和执行主体确定方式，只作为兼容读取规则；源文件不修改 |
| `process-governance-v4.schema.json` | `apps/structured-output-service/` | 历史v4单流程文件 | 迁移到v6的兼容输入 | `npm --prefix apps/structured-output-service test` | 保留数据行为关系、来源线索、表单多行为操作和字段数据关系，只作为兼容读取规则；源文件不修改 |
| `process-governance-v5.schema.json` | `apps/structured-output-service/`、`apps/structure-assistant/` | 3001兼容导入和MDM-AI助手现行文件 | 单流程`process-governance-v5`未审核JSON | `npm --prefix apps/structured-output-service test` | 3001只做兼容读取并在页面内存中迁移到v6；MDM-AI助手仍固定使用v5，本次不修改、不测试 |
| `process-governance-v6.schema.json` | `apps/structured-output-service/` | 3001空白新建、v1至v5兼容迁移和v6文件 | 单流程`process-governance-v6`未审核JSON | `npm --prefix apps/structured-output-service test` | 统一普通行为与控制节点，流程关系与数据行为关系共用页面内存草稿；迁移归档必需且只读，不保存图坐标 |
| `process-governance-version-history.json` | `apps/structured-output-service/` | 仓库受控版本说明 | 前端只读v1至v6升级历史 | `npm --prefix apps/structured-output-service test` | 版本说明独立于当前草稿，不写入导出JSON |

## 2. 修改规则

1. 修改规则文件前先确认对应脚本确实读取该字段。
2. 修改部门清单或域映射时，必须先核对 `docs/organization/组织架构和部门职责.md`。
3. 修改交付物命名、表头、证据类型、部门清单或 HTML 规则后，运行：

```powershell
node scripts/check-dcm-bbm.mjs --no-fail
npm run test:norms-source-manifest
npm run test:dept-domain-mapping
```

4. 修改文档结构化输出 schema、MDM 文档结构化页面字段、`process_design_*` 表结构或结构块 parser 字段后，运行：

```powershell
npm run test:document-structured-output-schema
```

5. 修改任一`process-governance-v*.schema.json`、3001单流程导入导出映射、MDM受控导入规范化逻辑或AI助手结构读取逻辑后，运行：

```powershell
npm --prefix apps/structured-output-service test
npm --prefix apps/mdm-platform run test:process-design
npm --prefix apps/structure-assistant test
```

6. 规则文件可以表达检查要求，但不要在这里新增流程、部门职责或业务行为正文。

## 3. 与其他目录的关系

- `docs/norms/`：被检查的流程输入基线、标准映射和部门桑基图。
- `pmo/procedure-management/dashboard.html`：被检查的 PMO 展示页。
- `docs/organization/组织架构和部门职责.md`：部门与域映射真源。
- `docs/reports/`：保存检查结果、缺口审计和整改记录。
