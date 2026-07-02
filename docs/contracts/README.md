# docs/contracts 说明

> 状态：自动化校验合同目录  
> 生效日期：2026-06-10  
> 范围：脚本读取的结构化规则，不作为业务正文或流程输入基线。

本目录保存仓库级校验脚本使用的合同文件。合同文件用于约束脚本如何检查流程映射、部门桑基图、PMO 驾驶舱和组织口径。

合同文件不替代 `docs/norms/` 中的流程输入基线。
合同文件也不替代 `docs/organization/` 中的组织真源。

## 1. 当前合同

| 文件 | 使用方 | 输入 | 输出 | 回归命令 | 作用 |
|---|---|---|---|---|---|
| `dcm-bbm-contract.json` | `scripts/check-dcm-bbm.mjs` | `docs/norms/`、`docs/organization/组织架构和部门职责.md`、`pmo/procedure-management/dashboard.html` | 默认报告 `docs/reports/dcm-bbm-quality-report.md` | `node scripts/check-dcm-bbm.mjs --no-fail` | 定义 DCM/BBM 质检的路径、术语、允许系统、交付物命名、表头、证据类型和 HTML 检查规则 |
| `dcm-bbm-contract.json` | `scripts/check-norms-source-manifest.mjs` | `docs/reports/2026-06-11-norms-source-manifest.md`、`docs/norms/` | 只读校验输出 | `npm run test:norms-source-manifest` | 校验合同部门、域口径和 canonical 三件套覆盖状态一致 |
| `dcm-bbm-contract.json` | `scripts/check-dept-domain-mapping.mjs` | `docs/organization/组织架构和部门职责.md`、`scripts/parse-sankey-data.mjs` | 只读校验输出 | `npm run test:dept-domain-mapping` | 校验部门到域映射来自组织真源且与合同一致 |
| `document-structured-output.schema.json` | `scripts/test-document-structured-output-schema.mjs`、文档结构化输出后续导出/校验脚本 | `apps/mdm-platform/public/index.html`、`apps/mdm-platform/server/mysqlSchema.js`、`apps/mdm-platform/server/routes/processDesignMysql.js`、`scripts/parse-sankey-data.mjs` | 只读校验输出 | `npm run test:document-structured-output-schema` | 统一制度编号、制度版次、制度草稿、流程、业务行为、表单字段、证据、待确认问题和结构块投影的数据模型 |

## 2. 修改规则

1. 修改合同前先确认对应脚本确实读取该字段。
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

5. 合同文件可以表达检查规则，但不要在这里新增流程、部门职责或业务行为正文。

## 3. 与其他目录的关系

- `docs/norms/`：被检查的流程输入基线、标准映射和部门桑基图。
- `pmo/procedure-management/dashboard.html`：被检查的 PMO 展示页。
- `docs/organization/组织架构和部门职责.md`：部门与域映射真源。
- `docs/reports/`：保存检查结果、缺口审计和整改记录。
