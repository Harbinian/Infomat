# scripts 目录说明

本目录放仓库级自动化脚本：输入通常跨 `docs/`、`pmo/` 或 `apps/mdm-platform/`，输出也可能回写生成快照或校验报告。只服务单个应用的脚本应留在对应应用目录，例如 `apps/mdm-platform/scripts/`。

修改本目录脚本前先读 `AGENTS.md`。涉及命令、输入、输出、副作用、启动合同或验证口径变化时，必须同步更新本 README。

## 当前主线入口

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `parse-sankey-data.mjs` | 从部门流程输入基线生成公司级桑基数据，并注入 PMO 流程驾驶舱；若文件头存在流程治理结构块 v1，则优先读取结构块，并将正文 legacy 中未被覆盖的 L3/A1 合并为 hybrid 解析结果；同时输出 `processMappings` 供 MySQL 导入保留部门内 L1/L2/L3 枚举 | `docs/norms/`、`docs/organization/组织架构和部门职责.md`、跨部门报告 | 写入 `docs/company-sankey-data.json` 和 `pmo/procedure-management/dashboard.html` |
| `check-dashboard-data.mjs` | 校验公司级快照、PMO 内嵌数据、跨部门报告派生统计和报告来源指纹一致 | `docs/company-sankey-data.json`、`pmo/procedure-management/dashboard.html`、`docs/norms/流程治理/跨部门完整性检查报告.md` | 只读校验 |
| `check-dept-domain-mapping.mjs` | 校验 DCM/BBM 合同与组织真源一致，并确认 parser 从组织真源读取部门到域映射 | `docs/organization/组织架构和部门职责.md`、`docs/contracts/dcm-bbm-contract.json`、`scripts/parse-sankey-data.mjs` | 只读校验 |
| `check-engineering-source-manifest.mjs` | 校验工程技术部源文件清单中的 canonical 缺口和外部待确认索引仍与仓库现状一致 | `docs/reports/2026-06-11-engineering-source-manifest.md`、外部参考待确认目录 | 只读校验 |
| `check-norms-source-manifest.mjs` | 校验部门流程输入基线清单与合同部门、`docs/norms` canonical 三件套一致 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、两份 source manifest 报告 | 只读校验 |
| `check-pmo-task-data.mjs` | 校验 PMO 根目录备份数据与 React 应用读取数据同源同 hash | `pmo/tasks.json`、`pmo/gantt-react/public/tasks.json`、两份 PMO source manifest | 只读校验 |
| `check-pmo-wbs-semantic-depth.mjs` | 校验 PMO WBS 语义补组后不再保留二级叶子任务，并确认父级日期覆盖子任务 | `pmo/tasks.json` | 只读校验 |
| `check-source-manifest-hashes.mjs` | 校验公司级快照里的 sourceManifest 文件大小和 SHA256 仍匹配磁盘源文件 | `docs/company-sankey-data.json`、`sourceManifest.files` 中登记的源文件 | 只读校验 |
| `sync-process-governance-mainline.mjs` | 串起流程治理主线同步、检查和 MDM 快照导入 | 流程输入基线、PMO 驾驶舱、MDM 平台脚本；迁移过渡期的遗留本地库必须显式隔离 | 会运行 parser，并调用 MDM 平台同步 / 导入脚本 |
| `test-process-governance-mainline.mjs` | 聚合仓库级流程治理主线只读校验 | 根级主线检查脚本 | 依次运行合约、PMO 数据、部门域、source manifest 和 PMO 任务数据校验 |
| `test-process-governance-mainline-contract.mjs` | 仓库级流程治理主线契约测试 | `package.json`、`docs/company-sankey-data.json`、仓库级脚本 | 只读校验 |
| `test-parse-sankey-structure-block.mjs` | 校验流程治理结构块 v1 的 parser 优先读取、hybrid 合并、系统枚举、证据状态和 A1→L3 引用约束 | 内置临时夹具 | 只读校验 |
| `test-document-structured-output-schema.mjs` | 校验文档结构化输出标准 schema 与前端字段、MySQL process_design 表、制度编号/版次字段、MySQL 路由枚举和结构块 parser 关键约束一致 | `docs/contracts/document-structured-output.schema.json`、MDM 前端、MySQL schema、MySQL 路由、结构块 parser | 只读校验 |
| `infomat-services.config.json` | MDM、PMO、MySQL 固定启动合同 | 固定端口、固定 MySQL 用户/库、固定读模型 | 非敏感配置真源 |
| `infomat-service-config.mjs` | 读取固定启动合同并合成本机运行环境 | `infomat-services.config.json`、本机 `infomat-services.local.env` | 供启动和冒烟脚本复用 |
| `repair-infomat-mysql-container.ps1` | 将本机历史 MySQL 容器对齐到固定启动合同 | 固定合同、本机私有 env、Docker 容器状态 | 只修复本机 Docker 运行态，不写仓库真源 |
| `start-infomat-services.ps1` | 固定启动 MDM、PMO 和项目 MySQL | 固定合同、本机私有 env、Docker 容器 `infomat-input-baseline-review-mysql` | 按固定环境启动服务，不修改仓库真源 |
| `smoke-infomat-services.mjs` | 固定配置下检查 MDM/PMO 是否可用 | 固定合同、本机私有 env、运行中的服务 | 只读检查，输出会隐藏密码 |
| `test-infomat-services-config.mjs` | 防止启动配置再次漂移 | 固定合同、启动脚本、冒烟脚本、`.gitignore` | 只读校验 |

常用命令：

```bash
npm run start:infomat-services
npm run smoke:infomat-services
npm run repair:infomat-mysql
npm run test:infomat-services-config
npm run test:process-governance-mainline
npm run test:dept-domain-mapping
npm run test:engineering-source-manifest
npm run test:norms-source-manifest
npm run test:parse-sankey-structure-block
npm run test:document-structured-output-schema
npm run verify:norms-source-mapping
npm run test:pmo-task-data
npm run test:pmo-wbs-semantic-depth
npm run test:source-manifest-hashes
npm run test:process-evidence-skill
npm run test:process-input-baseline-review
npm run test:ocr-source
$env:MDM_DB_PATH='apps/mdm-platform/data/<target>.db'; npm run sync:process-governance
```

`parse-sankey-data.mjs` 支持部门渐进迁移：单个部门文件存在 `meta.parser_schema_version: 1` 且提供 `l3_catalog` 时优先解析结构块；若正文仍有旧 Markdown DCM/A1 表格，则同一 L3/A1 由结构块覆盖，legacy 中未覆盖的剩余项继续进入快照，部门记录为 `source: hybrid` 并输出覆盖 warning。未提供结构块的部门继续走旧 Markdown 表格/标题解析，并在 stderr 打印 `[WARN] {部门} 未提供结构块(schema v1)，回退旧 Markdown 解析，存在漂移风险。`。生成的 `docs/company-sankey-data.json` 保留既有 `nodes`、`links`、`stats`、`processMappings`、`evidenceRefs` 等字段，并新增 `meta.departments[]` 记录各部门 `source: structured|hybrid|legacy`。

## MDM / PMO 固定启动合同

MDM 和 PMO 的仓库根目录启动入口：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

固定配置在 `scripts/infomat-services.config.json`，当前约定为：

| 项 | 固定值 |
|---|---|
| MDM | `127.0.0.1:3000` |
| PMO | 本机访问 `127.0.0.1:5173`，服务监听 `0.0.0.0:5173` |
| MySQL | `localhost:3307` |
| MySQL Docker 容器 | `infomat-input-baseline-review-mysql` |
| MySQL 用户 / 库 | `mdm_user` / `infomat_mdm` |
| MySQL 连接池 | `MYSQL_CONNECTION_LIMIT=16` |
| 读模型 | `MDM_IDENTITY_READ_MODEL=mysql`、`PROCESS_GOVERNANCE_READ_MODEL=mysql` |
| 管理员工号 | `ADMIN001` |

本机密码写入 `scripts/infomat-services.local.env`，该文件被 `.gitignore` 忽略：

```text
MYSQL_PASSWORD=你的项目 MySQL 密码
MDM_ADMIN_PASSWORD=你的管理员密码
```

`start-infomat-services.ps1` 使用固定合同启动服务，并在启动前刷新 3000/5173 上的 MDM/PMO 进程。非敏感配置放在 `infomat-services.config.json`，本机密码放在 `infomat-services.local.env`。

如果固定 MySQL 容器不存在，先运行：

```powershell
npm run repair:infomat-mysql
npm run start:infomat-services
npm run smoke:infomat-services
```

修复脚本只对齐本机 Docker 容器和固定端口，不改变资料真源。启动脚本会先完成 MDM MySQL schema 初始化、人员身份 live schema 校验和管理员权限校验，再启动 MDM / PMO。

启动确认项：

| 检查项 | 正确状态 |
|---|---|
| MDM | `http://127.0.0.1:3000` 可访问 |
| PMO | 本机 `http://127.0.0.1:5173` 可访问；同事使用 `http://<本机局域网IP>:5173` |
| MySQL | Docker 容器 `infomat-input-baseline-review-mysql` 通过 `localhost:3307` 提供服务 |
| 权限数据 | `npm run smoke:infomat-services` 显示 `ADMIN001 / 系统管理员 / admin` |
| 私有密码 | `scripts/infomat-services.local.env` 包含 `MYSQL_PASSWORD` 和 `MDM_ADMIN_PASSWORD` |

输入基线问题复核正式入口在 MDM 平台：

```bash
cd apps/mdm-platform
npm run init:mysql
npm run import:process-input-baseline-review -- --review-run artifacts/process-input-baseline-review/<run-id>
npm start
```

复核 API 固定为 `/api/process-governance/input-baseline-review/*`，复核决策写入 MDM MySQL `process_input_baseline_review_*` 表。

根目录输入基线问题复核 MySQL 服务只作为迁移过渡工具保留，不作为正式 MDM 入口：

```bash
npm run review:mysql:init
npm run review:mysql:import -- --review-run artifacts/process-input-baseline-review/<run-id>
npm run review:mysql:serve
```

连接参数通过环境变量传入：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。临时服务只读待确认产物并把人工复核结果写入 MySQL，不自动修改正式流程映射。

## 审计与质量脚本

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `check-dcm-bbm.mjs` | 校验 DCM/BBM 合同、部门映射、跨部门证据和驾驶舱数据；已识别流程治理结构块 v1 的 L3/A1 计数 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、PMO 驾驶舱 | 默认写 `docs/reports/dcm-bbm-quality-report.md`；`--report=...` 可覆盖，`--no-fail` 可用于主线容错 |
| `verify-norms-source-mapping.mjs` | 只读盘点 `docs/norms` 源文件和部门映射表，核验 DCM/BBM 证据字段能否回到源文件编号、制度或表单名称、条款/表格/摘录位置 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 写 `docs/reports/{日期}-norms-source-mapping-verification.md` 和 `artifacts/norms-source-mapping-verify/<run-id>/`，不写数据库，不修改映射基线 |
| `audit-a1-transfer-evidence.mjs` | 审计 A1 跨部门输入 / 输出证据 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 默认写 `docs/reports/{日期}-a1-transfer-evidence-audit.md`；`--no-write` 可只读运行 |
| `ocr-source.mjs` | 对扫描 PDF 和图片源文件生成 OCR 待确认证据中间件；PaddleOCR 不可用时登记待复核 | `docs/norms/` 或指定文件/目录下的 PDF/图片 | 默认写 `artifacts/ocr/<run-id>/`；可显式写 `build/ocr/`，但不生成流程结论 |
| `test-ocr-source.mjs` | 校验 OCR 包装脚本的输出边界、复核登记和非结论化规则 | 一个扫描 PDF 样例 | 写入被忽略的 `artifacts/ocr/test-ocr-source/` |
| `.agents/skills/process-evidence-mapping/scripts/run-process-input-baseline-review-workflow.mjs` | 串联 OCR 判断、evidence chunks、embedding/降级、输入基线解读、角色抽取、对象链、差异报告和待确认待办 Markdown | 单个制度文件、部门名、当前部门映射 | 写入 `artifacts/process-input-baseline-review/<run-id>/`；更新 `docs/norms/流程治理/输入基线问题待办.md` |
| `.agents/skills/process-evidence-mapping/scripts/update-input-baseline-review-todo-md.mjs` | 将未解决待确认问题写入人工待办面板，按稳定键去重，并过滤当前已确认流程映射已覆盖项 | `mapping_diff_items.json`、当前部门映射 | 写入待确认待办 Markdown；只保留未解决项 |
| `build-reviewItem-sankey-preview.mjs` | 为问题识别批次生成部门待确认预览页 | `artifacts/process-input-baseline-review/<run-id>/mapping_diff_items.json` | 默认写入同一问题识别批次目录的 `preview.html`；只有显式 `--out` 才会写指定路径 |
| `mark-sankey-preview-status.mjs` | 旧批量预览标记脚本的安全兼容入口 | 无 | 不再批量修改正式部门桑基图，只输出 deprecated/no-op 提示 |
| `rebuild-department-sankey-page.mjs` | 从部门已确认流程映射 Markdown 重建单个部门桑基图 HTML | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | 写 `docs/norms/{部门}部门能力流程系统桑基图.html`，不读取待确认产物 |
| `init-input-baseline-review-mysql.mjs` | 初始化输入基线问题复核 MySQL 表结构 | MySQL 连接环境变量 | 写入 MySQL schema，不写仓库真源 |
| `import-input-baseline-review-mysql.mjs` | 将问题识别批次产物、原文摘录导入 MySQL | `artifacts/process-input-baseline-review/<run-id>/` | 写入 MySQL 待确认问题库和原文摘录 |
| `input-baseline-review-service.mjs` | 启动输入基线问题复核网页服务 | MySQL 待确认问题库 | 页面从接口读取题目和原文高亮，选择结果直接写 MySQL |
| `input-baseline-review-core.mjs` | 输入基线问题复核 MySQL schema、原文匹配、高亮和仓库方法 | 待确认 JSON、`chunks.jsonl`、MySQL pool | 供导入脚本、服务和测试复用 |
| `test-process-evidence-skill.mjs` | 校验 process-evidence-mapping 技能是否按固定执行顺序重写，且包含 OCR、embedding、待确认待办边界 | `.agents/skills/process-evidence-mapping/SKILL.md` | 只读校验 |
| `.agents/skills/process-evidence-mapping/scripts/test-input-baseline-review-workflow.mjs` | 用 GLTX-CW-01 回归输入基线解读、角色簿、对象链、差异报告和待确认待办 Markdown | 财务部 GLTX-CW-01 制度和当前财务部映射 | 写入被忽略的 `artifacts/process-input-baseline-review/test-gltx-cw-01/` |
| `test-input-baseline-review-mysql.mjs` | 校验 MySQL 表结构、原文高亮、对比色按钮和服务页面契约 | 测试问题识别批次夹具 | 写入被忽略的 `artifacts/process-input-baseline-review/test-input-baseline-review-mysql/` |
| `glossary.mjs` | 查询仓库术语表 | `docs/glossary.md` | 只读查询 |

## 局部或历史工具

| 脚本 | 作用 | 当前注意事项 |
|---|---|---|
| `analyze-layout.js` | 快速计算旧布局样例的行数、画布高度和列起始位置 | 只读输出，可通过 `npm run analyze:layout` 运行；不属于流程治理主线 |
| `build-feedback-sankey.mjs` | 给单个部门桑基图 HTML 注入反馈交互 | 会直接改 `docs/norms/{部门}部门能力流程系统桑基图.html`，运行前先确认目标部门页面仍作为当前资产维护 |
| `generate_digital_project_gantt_8k.py` | 从 Markdown 渲染 8K 甘特图 PNG，可用 `--source`、`--output`、`--font` 或 `GANTT_FONT_PATHS` 指定输入输出和字体 | 偏 PMO 渲染工具，默认写入 `output/` |
| `render_gantt_h5_png.mjs` | 用 Chrome DevTools 把 H5 甘特图渲染成 PNG，可用 `--input`、`--output`、`--chrome` 或 `CHROME_PATH` 指定路径 | 偏 PMO 渲染工具，默认写入 `output/` 和临时 Chrome profile |
| `merge_norms.py` | 合并 norms-formatter 产物，可用 `--src` 和 `--out` 指定目录 | 默认读取 `docs/norms/` 并写入 `docs/norms/merged/` |

## 修改规则

- 新增或修改仓库级脚本时，遵守 `scripts/AGENTS.md`，并在脚本头部或本 README 写清用法、输入、输出、是否写文件、是否写数据库和验证命令。
- 修改 `parse-sankey-data.mjs` 后，至少运行 `node scripts/check-dashboard-data.mjs` 和 `npm run test:process-governance-mainline`。
- 修改会触碰 MDM 导入链路的脚本后，同步运行 `apps/mdm-platform` 下的流程治理相关测试。
- 不在本目录新增一次性输出、截图、数据库、日志或缓存；这些应放入本地临时目录或按边界文件先写迁移提案。
