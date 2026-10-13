# 3000 运行与结构维护说明

本文整理当前工作树的技术行为和维护限制，实际启用、部署和验收分别核对目标实例。业务依据来自用户指定的外部原始材料及有权确认；实现不单独证明业务要求。文中代码路径以 `apps/mdm-platform/` 为基准。

## 正式运行与结构维护分离

3000应用入口`npm start`要求显式配置`MDM_IDENTITY_READ_MODEL=mysql`和`PROCESS_GOVERNANCE_READ_MODEL=mysql`，并提供`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。`MYSQL_CONNECTION_LIMIT`如提供，必须为正整数。配置缺失、读模型不一致或正式模式启用遗留测试时，进程在监听前退出。运行入口不使用MySQL配置函数中的开发默认值作为回退。

应用启动不连接SQLite，也不建表、补列、执行迁移或初始化固定角色。身份、流程治理、指导意见、字段、术语、映射、冲突、待办、审计及流程草稿仓储的首次取得只做必要表列的`SELECT … LIMIT 0`检查。缺表、缺列、无权限或断库返回不可用信息；失败的结构检查关闭对应连接池，下一次请求可以重新检查。该检查不检查完整字段类型、索引、外键及迁移记录一致性，不能替代迁移手册的dry-run和结构漂移检查，也不是业务就绪接口。

建表和结构维护仅由显式命令处理：`init:mysql`、身份修复及既有RBAC、承接、统一治理、V3和V7迁移。原来由流程草稿请求触发的表单结构补齐已纳入`init:mysql`；承接和统一治理仍分别使用已有迁移命令。已有库升级必须先按对应迁移手册检查、备份和演练，不能通过访问页面或重新登录修复结构。结构维护的实际执行以具体授权及目标记录核对。

运行账号和迁移账号应分开配置，以下是待目标环境落实的最小权限边界，说明本身不表示真实账号已配置：

| 账号用途 | 必要权限 | 不授予的权限 |
|---|---|---|
| 应用运行 | 对实际启用的业务表授予对应`SELECT/INSERT/UPDATE/DELETE`；固定部门和`roles/permissions/role_permissions`只需`SELECT`。账号管理需`person/user_accounts/person_roles`的`SELECT/INSERT/UPDATE`，访问事件需读取和追加；其他业务写表按现有API逐表核定 | 不授予`CREATE/ALTER/DROP/INDEX/REFERENCES`、`GRANT OPTION`或实例管理权限；不向固定权限模型表授予种子写权限 |
| 迁移维护 | 独立凭据仅在获准目标库和维护窗口使用；依选定迁移授予结构检查、必要DDL及数据补偿权限 | 不留在应用进程环境中，不默认使用实例root；不以库级全部权限作为长期运行权限 |

隔离验证入口为`npm run test:mysql-runtime-boundary`：脚本自行建立系统临时目录、合成身份和SQL监测替身，使用随机回环HTTP端口，阻止SQLite模块加载；不读取私有配置、不连接真实MySQL。固定的合成变量只用于测试。真实隔离MySQL最小权限账号、完整结构漂移、迁移中断及备份恢复仍须在后续数据演练阶段取证。

## 遗留入口与历史数据

正式服务不再注册`systems/capabilities/processes/views/org-units/positions/persons/product-families/products/class-nodes/attributes/external/integration`接口族及`/api/quality/dashboard`，对这些路径的请求落在未注册边界（HTTP 404，非JSON响应），`rejectLegacyRoute`的410不在请求路径上。这是存储边界隔离；旧业务功能是否纳入首发仍待确定，不代表相关能力已经迁移或需求已经取消。退役边界由`test:mysql-runtime-boundary`与`test:security-routes`断言；不得为迁就旧的410期望而复活这些路由。`/api/quality/field-identities/progress`及现有MySQL治理接口继续保留。

历史SQLite记录仍在原`MDM_DB_PATH`指定文件或历史`data/platform.db`内，由原维护方保管，具体接续维护人待确认；这些记录不得因维护当前功能而被自动移动、删除或导入。旧能力、流程和地图不等于V7正式流程版本；组织岗位、产品和集成历史也不得按同名表直接转入MySQL。未来如需承接，先确定业务范围、原记录ID、引用和目标模型，再按单独迁移方案处理。已有MySQL草稿、发布版本、审批记录和稳定引用不变。

遗留测试只有在非production环境显式设置`MDM_ALLOW_LEGACY_TEST_MODE=1`并指定独立`MDM_DB_PATH`时才能以隔离遗留模式启动（SQLite读取与内存会话；已退役的路由在任何模式下都不注册），禁止指向共享`data/platform.db`；公开SQLite维护命令继续使用`legacy-sqlite:`前缀。该模式不提供正式服务回退。测试助手只在其创建的临时目录中使用此模式。

登录公共初始化仅读取运行能力和部门目录；其他模块在进入对应页面后读取。工作台与页面提示复用MySQL待办和冲突仓储，流程上下文从当前MySQL快照读取。旧页面显示暂停与承接提示，质量页保留字段进度；这些提示不改写首发业务范围。


## 命令选择与维护边界

应用目录的`service:start`、`service:stop`、`service:restart`及`service:check`只管理3000。实际命令和源脚本统一查[当前脚本入口](../scripts/README.md#当前npm命令)，不复制已取消的旧测试或迁移链。Docker部署另见[DOCKER.md](../DOCKER.md)。

| 维护对象 | 具体说明 |
|---|---|
| 身份、授权及旧身份恢复 | [RBAC/RACI迁移](RBAC-RACI-Migration-Runbook.md)；独立系统管理员及锁后资格按[身份合同](Identity-Transaction-Contract.md)核对 |
| 原生预览、提升及正式基础 | [M1/M2迁移与恢复](Process-V7-Preview-Review-Migration-Runbook.md) |
| 固定版本数据治理工作包 | [工作包迁移与恢复](Process-Data-Governance-Migration-Runbook.md) |
| 发布目录及办公室关系 | [当前页面说明](Current-Frontend-Guide.md#手工导入与发布)中准确target、变量、空表及恢复边界 |
| 定义版本、映射、事实、设计及分析存储 | [固定来源与分析说明](Current-Analysis-Guide.md)中对应迁移键、前置依赖和逆序补偿 |

`init:mysql`属于结构准备，不用于修复一次在线请求。已有库必须按对应迁移核对结构、登记、当前数据及恢复点；不能通过重新初始化掩盖部分结构或真实漂移。涉及历史V3、承接和SQLite的工具只在明确兼容任务中读取，不恢复旧在线写入口。

验证按具体改动选用纯合同、替身、自有临时MySQL、随机HTTP或桌面浏览器。测试入口名称不证明只读；在读取源脚本和隔离条件前不执行聚合命令。隔离验证、软件包准备、实时开启和业务验收分别登记。

## 历史评审导入准备

历史评审来源适配器只读读取明确指定的63805快照目录，不访问63805服务或运行原重建脚本。当前入口只提供本地dry-run、隔离MySQL演练以及内部受限读取，不接入公开静态目录或新HTTP页面，不提供正式导入命令。正式历史导入、界面开启及关联办理仍须有明确范围和目标授权。

历史意见保留原ID、原内容、意见类型、JSON路径/Excel单元格、来源摘要和责任建议。批次键由适配器版本及固定来源文件的原始字节摘要派生，平台引用为history:<batch_key>:<original_id>。原件字节摘要与快照内容摘要分别记录；缺失、变更、证据不足单列。任何责任建议都不产生部门、人员或主数据身份。历史数量只作快照对账，不作当前事实或规则质量真值。

新增data_map_history_batches和data_map_history_opinions两张只追加历史表，由historicalReviewStore显式inspect/migrate/importSnapshot维护，启动不执行DDL；既有问题、待办、分析发现和审批状态不迁移、不回填。MySQL命名锁串行化同批次导入，事务保证整批成功或回滚；重复导入返回原批次，同键不同内容拒绝，来源改变生成新批次，旧批次不覆盖。DDL中断后先inspect，再补缺表；结构或排序规则漂移拒绝。回退停用新内部能力并保留历史表；有数据时使用完整备份恢复，不删除历史来重建。

getHistoricalReview复用当前账号/人员/auth_version验证，仅既有governance:read-global可读混合历史批次；部门建议不能授予范围。compareHistoricalReviewIssue由调用者指定准确原ID和既有issue_id，继续通过原getAnalysisIssue校验问题及全部关联来源，只返回comparison_only对照，不保存正式关联、不创建问题或待办。管理员保持只读。正式历史关联的有权确认及当前证据未落实前，formal_link_enabled保持false；不将办公室问题办理的逐问题关闭资格扩大为历史批次认定权。

命令及源脚本见[脚本说明](../scripts/README.md#当前npm命令)；阶段合同与运行证据按文末历史快照定位。技术演练不表示正式开启或业务验收。



## 3000 Docker本机部署

当前运行包已包含 2026-10-12 的工作台、预览及管理员读取修复和 2026-10-13 的侧边栏重构。工作区其余源码整改未发布。

当前容器`infomat-mdm-3000`，镜像`infomat-mdm:v8-20261013-sidebar-39555ef9`；访问`http://127.0.0.1:3000/app/`。沿用原MySQL试运行库、账号／会话配置及权限，预览核对开启，正式流程、编制归属和数据治理开关关闭。健康、就绪、登录后工作台、预览及设计交接读取和侧边栏交互已验证；真实案例流转与业务验收另行核对。容器／镜像识别、启动停止、受保护配置及限定恢复见[DOCKER.md](../DOCKER.md)；当前证据保存在`artifacts/mdm-3000-sidebar-release-20261013-02/`，原Docker批次和历史Windows副本／state保留。状态须以当前Docker及实时健康核对。


## 历史记录

阶段结果、曾用配置及未沿用方案见[整理前应用说明](../../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/README.md.before.txt)。按所查问题读取，当前操作不需要先加载全部阶段记录。

## 数据库预算、安全日志与就绪前置迁移

本节记录 R01–R13 本地整改引入的运行边界。数值是本地工程默认值，可经环境变量覆盖，不是已确认的生产容量或SLA。

数据库访问按领域设置等待与执行上限：`MYSQL_QUEUE_LIMIT`为排队上限，`MYSQL_CONNECT_TIMEOUT_MS`为连接建立上限，连接数上限沿用`MYSQL_CONNECTION_LIMIT`。`MYSQL_OPERATION_TIMEOUT_MS`默认10000毫秒，接入实际领域池的查询及连接获取；一次连接借用从开始等待到释放共用同一预算，包含其事务语句、提交和清理。超时销毁正在执行的连接，已取消的等待若随后获得连接则立即释放，不执行迟到语句。排队容量耗尽返回503；超时发生在提交期间时保留`MYSQL_COMMIT_UNKNOWN`或已有领域提交不明码，必须核对原请求回执，禁止自动重试。

领域池经`server/mysqlPoolRegistry.js`登记，正常关闭后移除登记，失败的关闭保留诊断。`MDM_SHUTDOWN_DRAIN_MS`默认5000毫秒，领域池、就绪检查和会话存储并行关闭并分别受此预算约束。成功输出`MDM_SHUTDOWN_DRAINED`及实际关闭池数；失败或超时以`MDM_SHUTDOWN_NOT_DRAINED`点名并退出1，不能报告正常退出。15秒硬退出仍是HTTP服务的兜底。

登录准入在密码核验前计数；同一地址的账号大小写及首尾空白变体共用窗口，地址另有独立窗口。成功仅清理已结束的账号失败记录，其他在途核验仍占用名额。容量回收只移除已过期且没有在途请求的记录；容量已满时拒绝新窗口并返回429及`Retry-After`，不淘汰仍有效的失败记录。旧字段台账解析在线程中执行，线程不继承服务环境变量；上传超过5MB返回413，客户端在解析期间取消后不再启动导入写入。

台账导出使用`MDM_EXPORT_MAX_ROWS`（默认20000行）、`MDM_EXPORT_MAX_CONCURRENCY`（默认2）及`MDM_EXPORT_TIMEOUT_MS`（默认60000毫秒）。先按可读取部门在SQL中检查行数，并限制上下文及字段读取规模，再流式生成原两个工作表。数据库连接还受操作预算约束。客户端断连或超时取消正在执行的读取及压缩归档，发送文件后发生错误时中断连接，不追加JSON；超限或超时不返回截断台账。

安全日志采用允许字段白名单（`event`、`code`、`route`、`method`、`status`、`duration_ms`、`request_id`、`actor_ref`、`at`），仅接收相应标量类型，不序列化嵌套对象、异常文本、SQL、参数、正文、Cookie、CSRF或claim。路径记录已匹配的路由模板；未匹配请求记录固定标记，不记录客户端任意路径。响应头带`X-Request-Id`，统一MySQL不可用及提交不明响应体还回传`request_id`；其他接口以响应头关联日志。日志写入失败不影响业务结果。日志轮转与集中存储属部署配置，须另行核对。

就绪检查要求`2026-09-28-todo-term-source-v1`迁移标记存在。基础结构已含`related_term_id`列，因此新库处于`unrecorded`状态并会被拒绝，必须先经`node scripts/manage-todo-term-source.js --apply --target <host:port/db>`登记（与集成测试夹具共用同一函数）。缺标记与结构漂移一律拒绝，不放宽ready断言。
