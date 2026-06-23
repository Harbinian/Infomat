# scripts 目录说明

本目录放仓库级自动化脚本：输入通常跨 `docs/`、`pmo/` 或 `apps/mdm-platform/`，输出也可能回写生成快照或校验报告。只服务单个应用的脚本应留在对应应用目录，例如 `apps/mdm-platform/scripts/`。

## 当前主线入口

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `parse-sankey-data.mjs` | 从部门流程映射真源生成公司级桑基数据，并注入 PMO 流程驾驶舱 | `docs/norms/`、`docs/organization/组织架构和部门职责.md`、跨部门报告 | 写入 `docs/company-sankey-data.json` 和 `pmo/procedure-management/dashboard.html` |
| `check-dashboard-data.mjs` | 校验公司级快照、PMO 内嵌数据、跨部门报告派生统计和报告来源指纹一致 | `docs/company-sankey-data.json`、`pmo/procedure-management/dashboard.html`、`docs/norms/流程治理/跨部门完整性检查报告.md` | 只读校验 |
| `check-dept-domain-mapping.mjs` | 校验 DCM/BBM 合同与组织真源一致，并确认 parser 从组织真源读取部门到域映射 | `docs/organization/组织架构和部门职责.md`、`docs/contracts/dcm-bbm-contract.json`、`scripts/parse-sankey-data.mjs` | 只读校验 |
| `check-engineering-source-manifest.mjs` | 校验工程技术部源文件清单中的 canonical 缺口和外部候选索引仍与仓库现状一致 | `docs/reports/2026-06-11-engineering-source-manifest.md`、外部参考候选目录 | 只读校验 |
| `check-norms-source-manifest.mjs` | 校验部门流程真源清单与合同部门、`docs/norms` canonical 三件套一致 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、两份 source manifest 报告 | 只读校验 |
| `check-pmo-task-data.mjs` | 校验 PMO 根目录备份数据与 React 应用读取数据同源同 hash | `pmo/tasks.json`、`pmo/gantt-react/public/tasks.json`、两份 PMO source manifest | 只读校验 |
| `check-pmo-wbs-semantic-depth.mjs` | 校验 PMO WBS 语义补组后不再保留二级叶子任务，并确认父级日期覆盖子任务 | `pmo/tasks.json` | 只读校验 |
| `check-source-manifest-hashes.mjs` | 校验公司级快照里的 sourceManifest 文件大小和 SHA256 仍匹配磁盘源文件 | `docs/company-sankey-data.json`、`sourceManifest.files` 中登记的源文件 | 只读校验 |
| `sync-process-governance-mainline.mjs` | 串起流程治理主线同步、检查和 MDM 快照导入 | 流程真源、PMO 驾驶舱、MDM 平台脚本；迁移过渡期的遗留本地库必须显式隔离 | 会运行 parser，并调用 MDM 平台同步 / 导入脚本 |
| `test-process-governance-mainline.mjs` | 聚合仓库级流程治理主线只读校验 | 根级主线检查脚本 | 依次运行合约、PMO 数据、部门域、source manifest 和 PMO 任务数据校验 |
| `test-process-governance-mainline-contract.mjs` | 仓库级流程治理主线契约测试 | `package.json`、`docs/company-sankey-data.json`、仓库级脚本 | 只读校验 |
| `infomat-services.config.json` | MDM、PMO、MySQL 固定启动合同 | 固定端口、固定 MySQL 用户/库、固定读模型 | 非敏感配置真源 |
| `infomat-service-config.mjs` | 读取固定启动合同并合成本机运行环境 | `infomat-services.config.json`、本机 `infomat-services.local.env` | 供启动和冒烟脚本复用 |
| `start-infomat-services.ps1` | 固定启动 MDM、PMO 和项目 MySQL | 固定合同、本机私有 env、Docker 容器 `infomat-candidate-review-mysql` | 按固定环境启动服务，不修改仓库真源 |
| `smoke-infomat-services.mjs` | 固定配置下检查 MDM/PMO 是否可用 | 固定合同、本机私有 env、运行中的服务 | 只读检查，输出会隐藏密码 |
| `test-infomat-services-config.mjs` | 防止启动配置再次漂移 | 固定合同、启动脚本、冒烟脚本、`.gitignore` | 只读校验 |

常用命令：

```bash
npm run start:infomat-services
npm run smoke:infomat-services
npm run test:infomat-services-config
npm run test:process-governance-mainline
npm run test:dept-domain-mapping
npm run test:engineering-source-manifest
npm run test:norms-source-manifest
npm run test:pmo-task-data
npm run test:pmo-wbs-semantic-depth
npm run test:source-manifest-hashes
npm run test:process-evidence-skill
npm run test:process-candidates
npm run test:process-candidate-review
npm run test:ocr-source
$env:MDM_DB_PATH='apps/mdm-platform/data/<target>.db'; npm run sync:process-governance
```

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
| PMO | `127.0.0.1:5173` |
| MySQL | `127.0.0.1:3307` |
| MySQL Docker 容器 | `infomat-candidate-review-mysql` |
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

启动确认项：

| 检查项 | 正确状态 |
|---|---|
| MDM | `http://127.0.0.1:3000` 可访问 |
| PMO | `http://127.0.0.1:5173` 可访问 |
| MySQL | Docker 容器 `infomat-candidate-review-mysql` 通过 `127.0.0.1:3307` 提供服务 |
| 权限数据 | `npm run smoke:infomat-services` 显示 `ADMIN001 / 系统管理员 / admin` |
| 私有密码 | `scripts/infomat-services.local.env` 包含 `MYSQL_PASSWORD` 和 `MDM_ADMIN_PASSWORD` |

候选复核正式入口在 MDM 平台：

```bash
cd apps/mdm-platform
npm run init:mysql
npm run import:process-candidate-review -- --candidate-run artifacts/process-candidates/<run-id>
npm start
```

复核 API 固定为 `/api/process-governance/candidate-review/*`，复核决策写入 MDM MySQL `process_candidate_review_*` 表。

根目录候选复核 MySQL 服务只作为迁移过渡工具保留，不作为正式 MDM 入口：

```bash
npm run review:mysql:init
npm run review:mysql:import -- --candidate-run artifacts/process-candidates/<run-id>
npm run review:mysql:serve
```

连接参数通过环境变量传入：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。临时服务只读候选产物并把人工复核结果写入 MySQL，不自动修改正式流程映射。

## 审计与质量脚本

| 脚本 | 作用 | 输入 | 输出 / 副作用 |
|---|---|---|---|
| `check-dcm-bbm.mjs` | 校验 DCM/BBM 合同、部门映射、跨部门证据和驾驶舱数据 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/`、PMO 驾驶舱 | 默认写 `docs/reports/dcm-bbm-quality-report.md`；`--report=...` 可覆盖，`--no-fail` 可用于主线容错 |
| `audit-a1-transfer-evidence.mjs` | 审计 A1 跨部门输入 / 输出证据 | `docs/contracts/dcm-bbm-contract.json`、`docs/norms/` | 默认写 `docs/reports/{日期}-a1-transfer-evidence-audit.md`；`--no-write` 可只读运行 |
| `ocr-source.mjs` | 对扫描 PDF 和图片源文件生成 OCR 候选证据中间件；PaddleOCR 不可用时登记待复核 | `docs/norms/` 或指定文件/目录下的 PDF/图片 | 默认写 `artifacts/ocr/<run-id>/`；可显式写 `build/ocr/`，但不生成流程结论 |
| `test-ocr-source.mjs` | 校验 OCR 包装脚本的输出边界、复核登记和非结论化规则 | 一个扫描 PDF 样例 | 写入被忽略的 `artifacts/ocr/test-ocr-source/` |
| `.agents/skills/process-evidence-mapping/scripts/run-process-candidate-workflow.mjs` | 串联 OCR 判断、evidence chunks、embedding/降级、候选解读、角色抽取、对象链、差异报告和候选待办 Markdown | 单个制度文件、部门名、当前部门映射 | 写入 `artifacts/process-candidates/<run-id>/`；更新 `docs/norms/流程治理/候选映射待办.md` |
| `.agents/skills/process-evidence-mapping/scripts/update-candidate-todo-md.mjs` | 将未解决候选项写入人工待办面板，按稳定键去重，并过滤当前正式映射已覆盖项 | `mapping_diff_items.json`、当前部门映射 | 写入候选待办 Markdown；只保留未解决项 |
| `build-candidate-sankey-preview.mjs` | 为候选运行生成部门候选预览页 | `artifacts/process-candidates/<run-id>/mapping_diff_items.json` | 默认写入同一候选运行目录的 `preview.html`；只有显式 `--out` 才会写指定路径 |
| `mark-sankey-preview-status.mjs` | 旧批量预览标记脚本的安全兼容入口 | 无 | 不再批量修改正式部门桑基图，只输出 deprecated/no-op 提示 |
| `rebuild-department-sankey-page.mjs` | 从部门正式映射 Markdown 重建单个部门桑基图 HTML | `docs/norms/{部门}部门-能力-流程-系统映射关系.md` | 写 `docs/norms/{部门}部门能力流程系统桑基图.html`，不读取候选产物 |
| `init-candidate-review-mysql.mjs` | 初始化候选复核 MySQL 表结构 | MySQL 连接环境变量 | 写入 MySQL schema，不写仓库真源 |
| `import-candidate-review-mysql.mjs` | 将候选运行产物、原文摘录导入 MySQL | `artifacts/process-candidates/<run-id>/` | 写入 MySQL 候选题库和原文摘录 |
| `candidate-review-service.mjs` | 启动候选复核网页服务 | MySQL 候选题库 | 页面从接口读取题目和原文高亮，选择结果直接写 MySQL |
| `candidate-review-core.mjs` | 候选复核 MySQL schema、原文匹配、高亮和仓库方法 | 候选 JSON、`chunks.jsonl`、MySQL pool | 供导入脚本、服务和测试复用 |
| `test-process-evidence-skill.mjs` | 校验 process-evidence-mapping 技能是否按固定执行顺序重写，且包含 OCR、embedding、候选待办边界 | `.agents/skills/process-evidence-mapping/SKILL.md` | 只读校验 |
| `.agents/skills/process-evidence-mapping/scripts/test-candidate-workflow.mjs` | 用 GLTX-CW-01 回归候选解读、角色簿、对象链、差异报告和候选待办 Markdown | 财务部 GLTX-CW-01 制度和当前财务部映射 | 写入被忽略的 `artifacts/process-candidates/test-gltx-cw-01/` |
| `test-candidate-review-mysql.mjs` | 校验 MySQL 表结构、原文高亮、对比色按钮和服务页面契约 | 测试候选运行夹具 | 写入被忽略的 `artifacts/process-candidates/test-candidate-review-mysql/` |
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

- 新增仓库级脚本时，在脚本头部写清用法、输入、输出和是否写文件。
- 修改 `parse-sankey-data.mjs` 后，至少运行 `node scripts/check-dashboard-data.mjs` 和 `npm run test:process-governance-mainline`。
- 修改会触碰 MDM 导入链路的脚本后，同步运行 `apps/mdm-platform` 下的流程治理相关测试。
- 不在本目录新增一次性输出、截图、数据库、日志或缓存；这些应放入本地临时目录或按边界文件先写迁移提案。
