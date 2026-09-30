# docs/contracts 说明

## V8 候选兼容说明（2026-09-22）

V8 候选合同 `process-governance-v8.schema.json` 保持 V7 字段形状，新增 decision + use 的引用允许规则。V7 两个历史摘要继续受支持，V7 Schema 与校验语义不变；来源版本、迁移、目标校验和回读验证见 3001 README 的 V8 候选章节。版本历史中的 candidate 不是正式部署或业务验收。

> 状态：自动化校验规则目录
> 生效日期：2026-06-10  
> 范围：脚本读取的结构化规则，不作为业务正文或流程输入基线。

本目录保存仓库级校验脚本使用的规则文件。规则文件用于规定脚本如何检查流程映射、部门桑基图、PMO驾驶舱和组织口径。

修改任一结构规则或版本历史前，先读取本目录 `AGENTS.md`。

所有`docs/`文件均不作为当前治理依据；本目录只说明技术兼容，业务、组织和职责来自用户指定外部材料及明确确认。

## 1. 当前规则文件

| 文件 | 使用方 | 输入 | 输出 | 回归命令 | 作用 |
|---|---|---|---|---|---|
| `dcm-bbm-contract.json` | `scripts/check-dcm-bbm.mjs` | `docs/norms/`、`docs/organization/组织架构和部门职责.md`、`pmo/procedure-management/dashboard.html` | 默认报告 `docs/reports/dcm-bbm-quality-report.md` | `node scripts/check-dcm-bbm.mjs --no-fail` | 定义 DCM/BBM 质检的路径、术语、允许系统、交付物命名、表头、证据类型和 HTML 检查规则 |
| `dcm-bbm-contract.json` | `scripts/check-norms-source-manifest.mjs` | `docs/reports/2026-06-11-norms-source-manifest.md`、`docs/norms/` | 只读校验输出 | `npm run test:norms-source-manifest` | 校验规则文件中的部门、域口径和标准三件套覆盖状态一致 |
| `dcm-bbm-contract.json` | `scripts/check-dept-domain-mapping.mjs` | `docs/organization/组织架构和部门职责.md`、`scripts/parse-sankey-data.mjs` | 只读校验输出 | `npm run test:dept-domain-mapping` | 校验历史组织映射与旧规则文件的一致性，不代表业务确认 |
| `document-structured-output.schema.json` | `scripts/test-document-structured-output-schema.mjs`、文档结构化输出导出/校验脚本 | `apps/structured-output-service/`、`apps/mdm-platform/`、`scripts/parse-sankey-data.mjs` | 只读校验输出 | `npm run test:document-structured-output-schema`、`npm run test:work-role-contract` | 统一制度、流程、行为、工作角色绑定、表单字段、证据、待确认问题和结构块投影的数据模型；工作角色事实须有业务确认，不以旧组织资料认定 |
| `process-governance-v1.schema.json` | `apps/structured-output-service/` | 历史3001单流程文件 | 规范化到当前V8的兼容输入 | `npm --prefix apps/structured-output-service test` | 只作为3001兼容导入规则；3000旧版编制及导入入口已退役，源文件不修改 |
| `process-governance-v2.schema.json` | `apps/structured-output-service/` | 历史v2单流程文件 | 迁移到当前V8的兼容输入 | `npm --prefix apps/structured-output-service test` | 保留v2承接结构，只作为兼容读取规则；源文件不修改 |
| `process-governance-v3.schema.json` | `apps/structured-output-service/` | 历史v3单流程文件 | 迁移到当前V8的兼容输入 | `npm --prefix apps/structured-output-service test` | 保留表单状态和执行主体确定方式，只作为兼容读取规则；源文件不修改 |
| `process-governance-v4.schema.json` | `apps/structured-output-service/` | 历史v4单流程文件 | 迁移到当前V8的兼容输入 | `npm --prefix apps/structured-output-service test` | 保留数据行为关系、来源线索、表单多行为操作和字段数据关系，只作为兼容读取规则；源文件不修改 |
| `process-governance-v5.schema.json` | `apps/structured-output-service/` | 历史v5单流程文件 | 3001内存迁移到V8 | `npm --prefix apps/structured-output-service test` | 旧版兼容读取；MDM-AI助手已退役，不作为现行消费方 |
| `process-governance-v6.schema.json` | `apps/structured-output-service/` | 历史v6单流程文件 | 迁移到当前V8的兼容输入 | `npm --prefix apps/structured-output-service test` | 保留无状态图编辑、迁移归档和稳定引用，只作为兼容读取规则 |
| `process-governance-v7.schema.json` | `apps/structured-output-service/`、`apps/mdm-platform/` | 历史V7文件 | 3001迁移到V8；3000保留原生V7正文 | `npm --prefix apps/structured-output-service test` | 历史版本及摘要冻结，原校验语义不变，不作为当前3001默认导出规则 |
| `process-governance-v8.schema.json` | `apps/structured-output-service/`、`apps/mdm-platform/` | V8候选文件、3001旧文件内存迁移 | 单流程V8未审核JSON、3000原生版本正文 | `npm --prefix apps/structured-output-service test` | 本工作区默认候选规则，允许判断节点use；不扩大后续工作包版本范围 |
| `process-governance-version-history.json` | `apps/structured-output-service/` | 仓库受控版本说明 | 前端只读v1至v8升级历史、候选状态和v7兼容修订记录 | `npm --prefix apps/structured-output-service test` | 当前V8为`candidate`，历史V7保留`released`记录；`schema_revisions[]`登记一个当前摘要和一个受限兼容的早期摘要；版本说明独立于当前草稿，不写入导出JSON |

## 2. 修改规则

1. 修改规则文件前先确认对应脚本确实读取该字段。
2. 修改部门清单或域映射时，先核对用户指定外部原始材料及明确业务确认；旧组织文件只用于兼容影响检查。
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

5. 修改任一`process-governance-v*.schema.json`、3001单流程导入导出映射或MDM受控导入规范化逻辑后，运行：

```powershell
npm --prefix apps/structured-output-service test
npm --prefix apps/mdm-platform run test:process-design
```

6. 规则文件可以表达检查要求，但不要在这里新增流程、部门职责或业务行为正文。
7. 任一`process-governance-vN`进入`released`后，改变Schema摘要、必填字段、枚举、引用规则或导入导出结构必须发布新的版本号。新版本应同时说明现有JSON和历史摘要的影响、旧字段映射、不能自动迁移的内容、兼容截止条件、失败处理、服务回退和用户恢复方式，并验证上一支持版本导入、当前版本导出后重导、重复迁移以及迁移失败后原草稿和源文件保持不变。`schema_revisions[]`只追溯已经发生的同名v7演进，不构成继续同名变更的授权。

## 3. 与其他目录的关系

- `docs/norms/`：旧消费链中被检查的历史流程资料、标准映射和部门桑基图。
- `pmo/procedure-management/dashboard.html`：被检查的 PMO 展示页。
- `docs/organization/组织架构和部门职责.md`：旧部门与域映射消费文件，仅用于兼容定位。
- `docs/reports/`：保存检查结果、缺口审计和整改记录。
