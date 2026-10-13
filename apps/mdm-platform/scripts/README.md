# MDM 应用脚本说明

本文件按用途说明当前命令；命令表依据本应用`package.json`核对。阶段进展、验证结论和已废止配置保留在文末历史快照，不能代替当前脚本或目标状态。代码路径以应用目录为基准。

`node --test scripts/test-workbench-availability.js`使用合成会话、随机回环HTTP服务、SQL和DOM替身，检查管理员个人待办边界、人员ID完整性、预览开关状态及关闭时的请求顺序；不读取私有配置、不连接真实数据库。当前前端测试由在`frontend/`目录运行的`npm test`收集。

`node scripts/test-workbench-availability-browser.js --build <artifacts内的前端构建目录> --output <artifacts内的新证据目录>`以合成HTTP响应核对实际构建页面，使用Edge100%、1699×828 CSS像素，输出截图和验证记录；不登录真实账号、不连接数据库，不使用3000端口。

`node --test scripts/test-system-admin-definition-reads.js`使用合成SQL核对独立管理员读取设计交接时的账号状态、密码代次、现有全局读取权限及事务内账号锁，同时检查治理写入被拒绝；不读取私有配置、不连接真实数据库。结构指纹检查由其他专项覆盖，本脚本只替换该检查外壳，身份及权限逻辑使用实际实现。

`node --test scripts/test-degraded-log-context.js`使用合成会话、合成仓储工厂和随机回环HTTP服务，核对两个降级入口写入`dependency_degraded`，在分类日志中保留来源错误码，并按现有MySQL不可用契约返回503，避免回显来源错误消息。静态守卫使用开发依赖`acorn`解析语法树，按词法作用域检查`server/`下`securityLog(<标识>)`的自由变量；其他函数或兄弟块的局部变量不能提供绑定。它不检查变量初始化顺序或运行时值。完整入口要求安装开发依赖；生产镜像不安装或加载解析器。不读取私有配置、不连接真实数据库，不使用3000端口。

## 执行边界

- 运行、结构维护及数据写入使用不同入口。`inspect`、`dry-run`及`smoke`名称本身不证明无副作用；先核对脚本加载的配置、目标、连接和写入。
- 仅3000操作使用`service:*`；仓库共同开发脚本同时涉及PMO、MDM和初始化，不是3000专用发布入口。
- 正式MySQL、备份恢复、迁移、账号维护和发布须取得对应目标授权。配置只核对变量名及脱敏结果，不输出Secret。
- 隔离验证使用脚本自建的唯一owner、临时实例和合成材料，清理只针对该owner；失败证据保留，不能误清理现有数据库、容器或历史资产。
- 需要`--baseline`的对照检查先核对所需源码快照；需要`--output`的检查使用全新且被忽略的artifacts目录。不能用不完整before快照证明兼容。
- 浏览器仅Edge100%、1699×828 CSS像素桌面；事件级组合输入检查不能代替Windows中文输入法人工验收。测试名称保留V7兼容标识时，须检查实际夹具与正文格式。

## 纯静态检查与专项选择

`check:native-process-consistency`只检查当前格式门槛、正式预览模块及用户文案，不启动应用、不连接数据库、不读取私有配置或写文件。`test:architecture-seams`显式阻断真实MySQL。`test:v8-transition`检查格式贯通；其结果不表示业务启用。

事务资格与身份精度按[身份与事务合同](../docs/Identity-Transaction-Contract.md)选择B02纯合同或真实隔离MySQL专项。真实锁等待、回滚、并发和prepared复用需要对应运行证据；静态或替身不能代替。旧`legacy-sqlite:*`、V3和承接工具只供明确的历史兼容任务，不恢复退役在线入口。

## 当前npm命令

`node scripts/test-process-content-checks.js`使用合成V8/V7材料验证内容分组、执行角色卡口、范围决定不能绕过缺项、规则不可用、旧v1至v3覆盖和稳定证据位置。不连接数据库、不读取外部业务材料。`test-v7-analysis-rules.js`保留原有八项规则的v3回归；新增v4内容覆盖由此脚本验证。

下表列出实际命令及执行前需核对的副作用类别。类别仅帮助选择，不能代替阅读源脚本；同一命令的环境和参数可能改变作用范围。

| npm run入口 | package.json执行值 | 执行前核对 |
|---|---|---|
| `test:architecture-seams` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-architecture-seams.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:native-office-versions` | `node scripts/test-native-office-versions.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `check:native-process-consistency` | `node scripts/check-native-process-consistency.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:v8-transition` | `node scripts/check-native-process-consistency.js && node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-v8-transition.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:v8-integration` | `node scripts/test-p25-candidate-integration.js --native-v8` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:system-admin` | `node scripts/manage-system-admin.js` | 按源脚本核对读取、生成或维护副作用 |
| `bootstrap:system-admin` | `node scripts/bootstrap-system-admin.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:system-admin` | `node scripts/test-system-admin.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `manage:process-v7-authoring` | `node scripts/manage-process-v7-authoring.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:process-v7-authoring` | `node scripts/test-process-v7-authoring.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-v7-authoring-issues` | `node scripts/test-process-v7-authoring-issues.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:upgrade-integration` | `node scripts/test-analysis-runs.js --p24 --p13 --p14 --p16 --p17 --p15` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:p25-candidate-integration` | `node scripts/test-p25-candidate-integration.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:issue-pool-list-scope` | `node scripts/test-issue-pool-list-scope.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `import:historical-review` | `node scripts/import-historical-review.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:historical-review` | `node scripts/test-historical-review.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:role-guide-browser` | `node scripts/test-role-guide-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:publications-browser` | `node scripts/test-publications-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:data-map-create-browser` | `node scripts/test-data-map-create-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:field-import-browser` | `node scripts/test-field-import-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:legacy-import-concurrency` | `node scripts/test-legacy-import-concurrency.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-identity-browser` | `node scripts/test-field-identity-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:field-export-browser` | `node scripts/test-field-export-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:native-diagrams-browser` | `node scripts/test-native-diagrams-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:data-map-read-browser` | `node scripts/test-data-map-read-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:quality-browser` | `node scripts/test-quality-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:identity-directory-browser` | `node scripts/test-identity-directory-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:role-management-browser` | `node scripts/test-role-management-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:dashboard-browser` | `node scripts/test-dashboard-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:office-workbench-browser` | `node scripts/test-office-workbench-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:data-governance-browser` | `node scripts/test-data-governance-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:role-workbench-browser` | `node scripts/test-role-workbench-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:process-formal-browser` | `node scripts/test-process-formal-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:process-preview-browser` | `node scripts/test-process-preview-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:ai-offline` | `node --test scripts/test-ai-offline.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:ai-offline-integration` | `node scripts/test-analysis-runs.js --p19 --p14` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:analysis-ai` | `node scripts/manage-analysis-ai.js` | 按源脚本核对读取、生成或维护副作用 |
| `manage:analysis-closure` | `node scripts/manage-analysis-closure.js` | 按源脚本核对读取、生成或维护副作用 |
| `manage:analysis-tasks` | `node scripts/manage-analysis-tasks.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:analysis-tasks` | `node scripts/test-analysis-runs.js --p17` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-api` | `node scripts/test-analysis-runs.js --p14` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-workbench` | `node scripts/test-analysis-runs.js --p14 --p15` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:handoff-analysis-rules` | `node scripts/test-handoff-analysis-rules.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:handoff-analysis` | `node scripts/test-design-handoffs.js --p12` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:fixed-handoff-set` | `node scripts/test-fixed-handoff-set.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:v7-analysis-rules` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-v7-analysis-rules.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:v7-analysis-worker` | `node scripts/test-v7-analysis-worker.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-format-admission` | `node scripts/test-analysis-format-admission.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-worker` | `node scripts/test-analysis-worker.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-dependency-readiness` | `node scripts/test-analysis-dependency-readiness.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:analysis-queue` | `node scripts/manage-analysis-queue.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `analysis:worker` | `node scripts/analysis-worker.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:data-map-management` | `node scripts/test-data-map-management.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:data-map-facts` | `node scripts/test-data-map-facts.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:data-map-facts` | `node scripts/manage-data-map-facts.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:master-data-template-import` | `node scripts/test-master-data-template-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `preview:master-data-template` | `node scripts/preview-master-data-template.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:master-data-template` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-master-data-template.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:data-map-definitions:inspect` | `node scripts/manage-data-map-definitions.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:data-map-definitions:dry-run` | `node scripts/manage-data-map-definitions.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:data-map-definitions:apply` | `node scripts/manage-data-map-definitions.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:data-map-definitions-mysql` | `node scripts/test-data-map-definitions-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:object-identity-preview` | `node scripts/test-object-identity-preview.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:data-map-legacy-compatibility` | `node scripts/manage-data-map-legacy-compatibility.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:data-map-legacy-compatibility` | `node scripts/test-data-map-legacy-compatibility.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `build:frontend` | `npm --prefix frontend run build` | 按源脚本核对读取、生成或维护副作用 |
| `dev:frontend` | `npm --prefix frontend run dev` | 按源脚本核对读取、生成或维护副作用 |
| `test:terms-conflicts-browser` | `node scripts/test-terms-conflicts-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:todo-inbox-browser` | `node scripts/test-todo-inbox-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:frontend-shell` | `npm --prefix frontend test && node scripts/test-frontend-shell.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:frontend-shell-browser` | `node scripts/test-frontend-shell-browser.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:retired-capabilities` | `node scripts/test-retired-capabilities.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-data-governance-mysql` | `node scripts/test-process-data-governance-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:offices:inspect` | `node scripts/manage-offices.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:offices:apply` | `node scripts/manage-offices.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:offices` | `node scripts/test-offices.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:publications:inspect` | `node scripts/manage-publications.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:publications:apply` | `node scripts/manage-publications.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:publications` | `node scripts/test-publications.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `prepare:launch-stage06` | `node scripts/inspect-launch-stage06.js --prepare` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `inspect:launch-stage06` | `node scripts/inspect-launch-stage06.js --inspect` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage06-preflight` | `node scripts/test-stage06-preflight.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:stage06-mysql-isolated` | `node scripts/test-stage06-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `start` | `node server/index.js` | 运行操作；核对目标与启停授权 |
| `bootstrap:admin` | `node scripts/bootstrap-admin.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `legacy-sqlite:smoke` | `node scripts/smoke-test.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:legacy-sqlite-entrypoints` | `node scripts/test-legacy-sqlite-entrypoints.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:org` | `node scripts/test-org-route.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mappings` | `npm run test:mappings-mysql` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:conflicts` | `npm run test:conflicts-mysql` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:terms` | `npm run test:terminology-mysql` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:export` | `node scripts/test-export-route.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:import` | `node scripts/test-import-route.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:route-write-audit` | `node scripts/test-route-write-audit.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:user-password-scripts` | `node scripts/test-user-password-scripts.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:password-audit` | `node scripts/test-password-audit.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:security` | `node scripts/test-stage04-local.js --security` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:project-roles` | `node scripts/test-project-role-access.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:role-workbench` | `node scripts/test-role-workbench-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:activity` | `npm run test:activity-mysql && node scripts/test-activity-heatmap-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:data-map-mysql` | `node scripts/test-data-map-mysql-repository.js && node scripts/test-data-map-contexts-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-entries-mysql` | `node scripts/test-field-entries-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-identities-mysql` | `node scripts/test-field-identities-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:data-map-import-export-mysql` | `node scripts/test-data-map-import-export-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:terminology-mysql` | `node scripts/test-terminology-mysql-repository.js && node scripts/test-terminology-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mappings-mysql` | `node scripts/test-mappings-mysql-repository.js && node scripts/test-mappings-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:conflicts-mysql` | `node scripts/test-conflicts-mysql-repository.js && node scripts/test-conflicts-mysql-api.js && node scripts/test-check-escalations-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:todos-mysql` | `node scripts/test-todos-mysql-repository.js && node scripts/test-todos-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:versions-mysql` | `node scripts/test-versions-mysql-repository.js && node scripts/test-versions-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:activity-mysql` | `node scripts/test-activity-mysql-repository.js && node scripts/test-activity-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-entries-mysql-identity` | `node scripts/test-field-entries-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:field-identities-mysql-identity` | `node scripts/test-field-identities-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:conflicts-mysql-identity` | `node scripts/test-conflicts-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mappings-mysql-identity` | `node scripts/test-mappings-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:terminology-mysql-identity` | `node scripts/test-terminology-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:role-workbench-mysql` | `node scripts/test-role-workbench-mysql-api.js && node scripts/test-role-workbench-process-governance-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:page-workflows` | `node scripts/test-page-workflows-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:frontend` | `node scripts/test-frontend-assets.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:rbac` | `node scripts/smoke-rbac.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:delete` | `node scripts/test-delete-routes.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:db-path` | `node scripts/test-db-path-isolation.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `legacy-sqlite:setup-local-baseline` | `node scripts/setup-local-baseline.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:local-baseline` | `node scripts/test-local-baseline-setup.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `legacy-sqlite:sync-organization-structure` | `node scripts/sync-organization-structure.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:organization-structure` | `node scripts/test-organization-structure-sync.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:roster-import` | `node scripts/test-roster-users-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-schema` | `node scripts/test-process-governance-schema.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-org` | `node scripts/test-process-governance-org-sync.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `import:process-governance-mysql` | `node scripts/import-process-governance-mysql.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `import:process-input-baseline-review` | `node scripts/import-process-input-baseline-review-mysql.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `smoke:process-governance-mysql` | `node scripts/smoke-process-governance-mysql.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:process-import` | `node scripts/test-process-governance-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-quality-import` | `node scripts/test-process-governance-quality-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-mapping-workspace` | `node scripts/test-process-mapping-workspace-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-api` | `node scripts/test-process-governance-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql` | `node scripts/test-process-governance-mysql-repository.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql-import` | `node scripts/test-process-governance-mysql-import.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql-smoke` | `node scripts/test-process-governance-mysql-smoke.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-sankey-mysql-api` | `node scripts/test-process-governance-sankey-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-mysql-identity` | `node scripts/test-process-governance-mysql-identity-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-input-baseline-review-mysql` | `node scripts/test-process-input-baseline-review-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-input-baseline-review-api` | `node scripts/test-process-input-baseline-review-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-governance-issue-pool` | `node scripts/test-process-governance-issue-pool-mysql-source-resolution.js && node scripts/test-process-governance-issue-pool-mysql-permission-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-rbac` | `node scripts/test-person-identity-schema-contract.js && node scripts/test-person-identity-mysql-repository.js && node scripts/test-governance-guidance-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-rbac-matrix` | `node scripts/test-person-rbac-matrix-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-payload` | `node scripts/test-person-identity-payload-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:department-responsibility` | `node scripts/test-department-responsibility-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-business-writes` | `node scripts/test-person-business-writes-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:no-new-user-identity-fields` | `node scripts/test-no-new-user-identity-fields.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:legacy-identity-inventory` | `node scripts/test-legacy-identity-inventory.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:guidance-workflow` | `node scripts/test-guidance-workflow-mysql-api.js && node scripts/test-guidance-affordances-mysql-repository.js && node scripts/test-guidance-visibility-mysql-repository.js && node scripts/test-guidance-person-validation-mysql-repository.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:guidance-workspace` | `node scripts/test-guidance-workspace-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-migration-rehearsal` | `node scripts/test-person-identity-migration-rehearsal-mysql.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `repair:person-identity-mysql` | `node scripts/repair-person-identity-mysql.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:person-identity-live-schema` | `node scripts/test-person-identity-live-schema-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:admin-permission-mysql` | `node scripts/test-admin-permission-mysql-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:person-identity-rbac-completion` | `npm run test:person-identity-rbac && npm run test:person-rbac-matrix && npm run test:person-identity-payload && npm run test:department-responsibility && npm run test:no-new-user-identity-fields && npm run test:guidance-workflow` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:identity-mysql` | `node scripts/test-identity-mysql-repository.js && node scripts/test-org-me-mysql-api.js && node scripts/test-roles-mysql-api.js && node scripts/test-auth-mysql-permission.js && npm run test:access-mysql && node scripts/test-import-rbac-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:auth-mysql` | `node scripts/test-auth-mysql-permission.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:access-mysql` | `node scripts/test-access-mysql-role-codes.js && node scripts/test-access-mysql-permissions.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:import-rbac-mysql` | `node scripts/test-import-rbac-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:roles-mysql` | `node scripts/test-roles-mysql-api.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:rbac-raci-v2:dry-run` | `node scripts/migrate-rbac-raci-v2.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:rbac-raci-v2:apply` | `node scripts/migrate-rbac-raci-v2.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:rbac-raci-v2:rollback` | `node scripts/migrate-rbac-raci-v2.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:rbac-raci-v2:compensate` | `node scripts/migrate-rbac-raci-v2.js --compensate` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:rbac-raci-v2` | `node scripts/test-rbac-raci-v2-model.js && node scripts/test-rbac-raci-v2-api.js && node scripts/test-rbac-raci-v2-migration-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:process-governance-unified:dry-run` | `node scripts/migrate-process-governance-unified.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-unified:apply` | `node scripts/migrate-process-governance-unified.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-unified:rollback` | `node scripts/migrate-process-governance-unified.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-unified:compensate` | `node scripts/migrate-process-governance-unified.js --compensate` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-v3:dry-run` | `node scripts/migrate-process-governance-v3.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-v3:apply` | `node scripts/migrate-process-governance-v3.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-governance-v3:rollback` | `node scripts/migrate-process-governance-v3.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:process-governance-v3-migration` | `node scripts/test-process-governance-v3-migration-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:process-v7-preview:dry-run` | `node scripts/migrate-process-v7-preview-review.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-preview:apply` | `node scripts/migrate-process-v7-preview-review.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-preview:rollback` | `node scripts/migrate-process-v7-preview-review.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-formal:dry-run` | `node scripts/migrate-process-v7-formal-foundation.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-formal:apply` | `node scripts/migrate-process-v7-formal-foundation.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-v7-formal:rollback` | `node scripts/migrate-process-v7-formal-foundation.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `inspect:process-v7-m0` | `node scripts/inspect-process-v7-m0-baseline.js` | 按源脚本核对读取、生成或维护副作用 |
| `rehearse:process-v7-m0-backup-restore` | `node scripts/rehearse-process-v7-m0-backup-restore.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `rehearse:process-v7-migrations-isolated` | `node scripts/rehearse-process-v7-migrations-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:process-v7-preview-review` | `node scripts/test-process-v7-preview-review.js && node scripts/test-process-v7-preview-migration-contract.js && node scripts/test-process-v7-formal-migration-contract.js && node scripts/test-process-v7-m0-baseline.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-v7-procedure` | `node scripts/test-process-v7-procedure-markdown.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:process-data-governance:dry-run` | `node scripts/migrate-process-data-governance.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-data-governance:apply` | `node scripts/migrate-process-data-governance.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:process-data-governance:rollback` | `node scripts/migrate-process-data-governance.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:process-data-governance` | `node scripts/test-process-data-governance.js && node scripts/test-process-data-governance-api.js && node scripts/test-process-data-governance-migration-contract.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-design` | `npm run test:retired-capabilities && npm run test:process-v7-preview-review && npm run test:process-v7-procedure` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:process-design-mysql-api` | `npm run test:retired-capabilities && npm run test:stage05-mysql-isolated` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `migrate:cross-dept-handoff-v2:dry-run` | `node scripts/migrate-cross-dept-handoff-v2.js --dry-run` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:cross-dept-handoff-v2:apply` | `node scripts/migrate-cross-dept-handoff-v2.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:cross-dept-handoff-v2:compensate` | `node scripts/migrate-cross-dept-handoff-v2.js --compensate` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:process-field-links` | `node scripts/test-process-governance-field-links.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `perf:local-concurrency` | `node scripts/perf-local-concurrency.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:process-governance` | `node scripts/test-process-governance-mysql-repository.js && node scripts/test-process-governance-mysql-import.js && node scripts/test-process-governance-mysql-smoke.js && node scripts/test-process-governance-sankey-mysql-api.js && node scripts/test-process-governance-mysql-identity-api.js && node scripts/test-process-input-baseline-review-mysql.js && node scripts/test-process-input-baseline-review-api.js && npm run test:process-design && node scripts/test-process-governance-field-links.js && npm run test:process-governance-issue-pool` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mainline` | `node scripts/test-organization-structure-sync.js && npm run test:rbac-raci-v2 && node scripts/test-role-workbench-api.js && node scripts/test-role-workbench-mysql-api.js && node scripts/test-role-workbench-process-governance-mysql-api.js && node scripts/test-identity-mysql-repository.js && node scripts/test-org-me-mysql-api.js && node scripts/test-roles-mysql-api.js && node scripts/test-auth-mysql-permission.js && npm run test:access-mysql && node scripts/test-import-rbac-mysql-api.js && npm run test:data-map-mysql && npm run test:field-entries-mysql && npm run test:field-identities-mysql && npm run test:field-entries-mysql-identity && npm run test:field-identities-mysql-identity && npm run test:data-map-import-export-mysql && npm run test:terminology-mysql && npm run test:mappings-mysql && npm run test:conflicts-mysql && npm run test:todos-mysql && npm run test:versions-mysql && npm run test:activity-mysql && npm run test:process-governance-mysql-identity && npm run test:conflicts-mysql-identity && npm run test:mappings-mysql-identity && npm run test:terminology-mysql-identity && node scripts/test-mainline-stability.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `init:mysql` | `node scripts/init-mysql-schema.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `smoke:data-map-mysql` | `node scripts/smoke-data-map-mysql.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:mysql-runtime-boundary` | `node scripts/test-mysql-runtime-boundary.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:mysql-config` | `node scripts/test-mysql-config.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `dev` | `nodemon server/index.js` | 运行操作；核对目标与启停授权 |
| `service:start` | `node scripts/mdm-service.js start` | 运行操作；核对目标与启停授权 |
| `service:stop` | `node scripts/mdm-service.js stop` | 运行操作；核对目标与启停授权 |
| `service:restart` | `node scripts/mdm-service.js restart` | 运行操作；核对目标与启停授权 |
| `service:check` | `node scripts/mdm-service.js check` | 只读核对自有Windows3000进程、健康、就绪、摘要和当前`/app/`内容；当前Docker按DOCKER.md检查 |
| `service:supervise` | `node scripts/mdm-service.js --supervise` | 运行操作；核对目标与启停授权 |
| `migrate:sessions:inspect` | `node scripts/manage-sessions.js --inspect` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:sessions:apply` | `node scripts/manage-sessions.js --apply` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `migrate:sessions:rollback` | `node scripts/manage-sessions.js --rollback` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `cleanup:sessions:inspect` | `node scripts/manage-sessions.js --cleanup --inspect` | 按源脚本核对读取、生成或维护副作用 |
| `cleanup:sessions:apply` | `node scripts/manage-sessions.js --cleanup --apply` | 按源脚本核对读取、生成或维护副作用 |
| `test:stage03-runtime` | `node scripts/test-stage03-runtime.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:stage03-mysql-isolated` | `node scripts/test-stage03-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage03-service` | `node scripts/test-stage03-service.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:launch-stage04` | `node scripts/test-stage04-local.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage04-mysql-isolated` | `node scripts/test-stage04-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:launch-stage05` | `node scripts/test-stage05-local.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `test:stage05-mysql-isolated` | `node scripts/test-stage05-mysql-isolated.js` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `migrate:v7-mappings` | `node scripts/manage-v7-mappings.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:v7-mappings` | `node scripts/test-v7-mappings.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:design-handoffs` | `node scripts/manage-design-handoffs.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:design-handoffs` | `node scripts/test-design-handoffs.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `migrate:analysis-runs` | `node scripts/manage-analysis-runs.js` | 维护入口；inspect/dry-run也可能连接目标，写入须有授权和恢复条件 |
| `test:analysis-comparison` | `node -r ./scripts/testHelpers/blockRealMysql.js --test scripts/test-analysis-comparison.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-comparison-mysql` | `node scripts/test-analysis-runs.js --p13` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:analysis-runs` | `node scripts/test-analysis-runs.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `manage:analysis-issues` | `node scripts/manage-analysis-issues.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:analysis-issues` | `node scripts/test-analysis-runs.js --p16` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:word-evidence` | `node scripts/test-word-evidence.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:excel-evidence` | `node scripts/test-excel-evidence.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:excel-evidence-integration` | `node scripts/test-analysis-runs.js --p18` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:excel-evidence` | `node scripts/manage-excel-evidence.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:word-evidence-integration` | `node scripts/test-analysis-runs.js --p18-word` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:word-evidence` | `node scripts/manage-word-evidence.js` | 按源脚本核对读取、生成或维护副作用 |
| `test:pdf-evidence` | `node scripts/test-pdf-evidence.js` | 验证入口；具体IO及夹具边界按源脚本核对 |
| `test:pdf-evidence-integration` | `node scripts/test-analysis-runs.js --p18-pdf` | 可能创建临时服务、MySQL或浏览器；先核对源脚本及隔离条件 |
| `manage:pdf-evidence` | `node scripts/manage-pdf-evidence.js` | 按源脚本核对读取、生成或维护副作用 |

## 参数与恢复说明

运行和结构维护具体变量、目标参数及恢复步骤见[运行与结构维护](../docs/Current-Runtime-Maintenance.md)及对应迁移手册。该说明包括办公室、发布目录与历史评审导入；不将迁移登记、就绪探测或软件包准备写成业务开启。

## 历史追溯

原脚本说明中每项测试的阶段场景、before要求、运行结果和失败记录保留在[历史快照](../../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/scripts/README.md.before.txt)。需要还原一次特定验证时读取相应条目；当前命令名称及执行值以本文件和源脚本为准。

## 本轮新增脚本（未注册 npm 入口）

`test-csp-browser.js --output <artifacts下全新目录>`在Edge100%、1699×828验证唯一页面入口、首次及本人改密、拒绝时输入保护、重登、导航和CSP；使用合成API，不连接数据库、不修改真实密码。

以下脚本随 R01–R13 本地整改加入，**没有**写入 `package.json`（新增 npm 入口需要单独授权），一律用 `node scripts/<名称>` 直接调用。需要隔离 MySQL 或浏览器的脚本还要求 `--output` 指向 `artifacts/` 下的全新目录。

| 脚本 | 作用 | 依赖 |
|---|---|---|
| `test-b02-login-identity-boundary.js` | 登录的精确身份边界：大整数保真、不可表示的身份拒绝登录 | 无（替身仓储） |
| `test-versions-scope-contract.js` | 历史读取范围：全局／同部门／异部门／无权限／管理员／已删除对象六类组合 | 无（替身仓储） |
| `test-versions-scope-mysql.js` | 同上，真实隔离库；并断言未删除任何历史行 | 隔离 MySQL |
| `test-login-admission-contract.js` | 登录准入：空白及大小写变体、并发成功与计数、容量拒绝、过期回收、在途释放 | 无 |
| `test-http-error-contract.js` | 请求错误契约：400/413/415 分类、analysis 既有码保留、凭据闸门 | 无 |
| `test-security-log-contract.js` | 安全日志字段及标量白名单、嵌套敏感对象拦截、sink 失败不影响业务 | 无 |
| `test-security-log-http.js` | 关联号可追溯、事件分类、日志故障不改变响应 | 无 |
| `audit-security-log-hygiene.js` | 静态守卫：不得再直接打印驱动错误或把异常文本写进日志 | 无 |
| `test-mysql-resource-budget-contract.js` | 池预算、登记簿、幂等关闭、提交不明语义；并静态断言无裸 `createPool` | 无 |
| `test-mysql-resource-budget-mysql.js` | 实际池查询超时、池耗尽、锁等待、数据库暂停、提交回执丢失、排空 | 隔离 MySQL（黑洞用例会 `docker pause` 自有容器） |
| `test-shutdown-drain-mysql.js` | 真实服务进程按普通路径停止并排空领域池 | 隔离 MySQL |
| `test-legacy-import-parser.js` | 旧字段台账解析：预算、损坏压缩包、并发门禁、取消 | 无 |
| `test-export-budget-contract.js` | 导出行数与并发预算、中断后不再二次发送 | 无 |
| `test-backend-resource-regressions.js` | 实际池执行、事务超时及迟到提交、回滚预算、取消等待、排空失败、导出计时、worker取消及精确身份投影 | 无，强制阻断真实MySQL |
| `test-export-read-regressions.js` | 仓储SQL行数预算、精确部门标识、字段与黄金源投影、断连后停止读取 | 无，强制阻断真实MySQL |
| `test-analysis-visible-page-contract.js` | 可见分页的行数及实际等待预算、游标语义、最终解析超时 | 无 |
| `test-csp-policy-contract.js` | 内容安全策略回归；LF/CRLF/CR 换行一致、真实脚本变化、缺失/额外脚本，以及事件属性引号形式的 CLI 正负例 | 无 |
| `audit-inline-script-inventory.js` | 当前前端源码及构建的脚本与事件处理器检查；不允许内联脚本、内联事件和旧UI专用哈希 | 无 |
