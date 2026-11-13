# MDM平台 Docker部署与维护

本文件说明当前技术运行和恢复方式，不作为业务规则真源。2026-11-05用户明确授权将本轮5项体验修复部署到MDM平台；17:40（北京时间）完成切换。修复已上线，原功能开关保持；上线后技术复验已完成，真实业务验收和真实使用者评分仍须独立取得。V9技术契约的candidate状态不因此改变。

2026-11-12按用户要求将3000发布范围改为全部IPv4接口。仅重建容器的端口映射，应用镜像、功能开关、运行文件和挂载保持；`/api/health`、`/api/ready`及回环和两块网卡地址的页面检查均通过。本次未执行数据库迁移、授权或数据恢复。当前监听回执及原容器见[网络调整记录](../../artifacts/workspace-style-20261112/all-ip/state.json)。

## 当前运行

| 项目 | 当前配置及对应验证时点 |
|---|---|
| 入口 | [MDM平台](http://127.0.0.1:3000/app/)，绑定0.0.0.0:3000，另可通过192.168.19.199及192.168.10.184访问 |
| 容器 | infomat-mdm-3000，8ceff8c7426b，运行且healthy，unless-stopped |
| 镜像 | infomat-mdm:role-experience-20261105-6e611d0e3d23；[准确镜像ID](../../artifacts/3000-role-experience-deploy-20261105-01/image.json) |
| 来源摘要 | 877aa3f740ca8b943f505705b3ed95f63e405b4921bba0497da1170e154a0119 |
| 健康及就绪 | /api/health为200、ok；/api/ready为200、ready=true；摘要匹配冻结镜像 |
| 数据库 | 既有infomat-input-baseline-review-mysql-3307及infomat_mdm_upgrade_20260916；201张表为2026-11-05核对记录，本次未迁移 |
| 身份与格式 | person身份、HR v5固定9角色/22权限、13项RACI说明；原生V9及受支持V8/V7保留 |
| 前端 | 2026-11-05已核对27个冻结资源及313个发布文件；本次沿用同一镜像，未重建前端 |
| 3001 | 原容器保留，已有全IPv4发布；2026-11-12页面及健康检查通过，未改样式 |

当前 MySQL 容器名为 `infomat-input-baseline-review-mysql-3307`，宿主机端口为 `3307`。

人工质量审计保持QUALITY_AUDIT_ENABLED=1。编制工作台、预览、正式流转、数据治理、设计交接及术语治理开关沿用，旧V7编制入口仍关闭。仅更新来源摘要配置，没有调整真实人员角色、负责人登记、分派、密码或业务审批。

本次修复覆盖项目决定退回修订待办及指引、首屏办理入口、质量成功回执提示、冲突历史时间显示和访问审计时间读取。只替换4个服务端文件及完整已验证前端，其余运行载荷、依赖、启动逻辑和配置描述沿用原镜像；不从脏工作区混入其他应用。见[部署报告](../../artifacts/3000-role-experience-deploy-20261105-01/report.md)、[运行核验](../../artifacts/3000-role-experience-deploy-20261105-01/runtime-verification.json)和[部署回执](../../artifacts/3000-role-experience-deploy-20261105-01/deployment.json)。

## 配置、账号及结构准备

沿用原受保护运行文件、SQL账号及只读挂载；数据库认证、会话密钥和既有双密码策略未调整。未读取或展示正式凭据，未写入Docker Env。当前运行账号88条实际授权保持原表、列范围；本次没有GRANT、DDL、迁移或业务数据回填。

账号首次启用仍使用MDM_ACCOUNT_INITIAL_PASSWORD_FILE=/run/secrets/account-initial-password，挂载沿用原受控文件。首次登录必须改密及原重置策略保持。[当前挂载元数据检查](../../artifacts/3000-role-experience-deploy-20261105-01/account-mount-inspection.json)只证明普通文件和只读挂载前提，不代替真实账号启用验收。

在宿主仓库apps/mdm-platform目录运行：

    npm run inspect:account-initial-password -- --container infomat-mdm-3000

该命令不读取密码、不连接数据库。管理CLI以宿主当前源码及配套证据定位；本次运行镜像未覆盖旧scripts目录，不假定容器内管理CLI已经同步。

人工质量的三张表及迁移标记已在此前授权发布中准备，必要SQL列权限也已补齐，历史凭证见[质量与角色交接发布报告](../../artifacts/3000-governance-deploy-20261105-01/report.md)。本次仅验证并保留其当前状态，不重放旧迁移、补授或激活入口。

后续新增结构仍须使用相应版本的scripts/manage-governance-deployment.js，明确目标、服务器UUID和当次部署编号，完成授权、停写、实际备份、独立恢复及当前盘点。运行请求不执行DDL。新写链还须以实际表/列授权验证；ready、人员权限读取或宽DML夹具不能代替运行SQL写能力验证。

## 本次备份与保全

先只读核对正式版本和上轮发布后的增量；本次前检未发现201表字段摘要、结构或授权变化。随后停止准确MDM平台应用并禁用自动重启，取得新的完整备份，例程、触发器及事件实际均为0。备份保存在仅当前执行用户及System可访问的private目录，不输出内容。

该备份已在独立network-none、tmpfs MySQL实际恢复；201张表全部字段摘要、列、索引、约束、引用、字符集和排序规则一致。正常与同版只读镜像在恢复副本上通过就绪、结构、既有账号权限及V9/V8/V7检查，副本数据未变。切换前后及上线后复查，正式201表全部字段摘要、结构和88条授权仍完全一致，包括会话表。此结论限记录时点，不要求后续正常业务写入继续等于该快照。

[备份回执](../../artifacts/3000-role-experience-deploy-20261105-01/backup.json)、[实际恢复回执](../../artifacts/3000-role-experience-deploy-20261105-01/restore-receipt.json)、[双镜像验证](../../artifacts/3000-role-experience-deploy-20261105-01/image-probes.json)及[数据保全](../../artifacts/3000-role-experience-deploy-20261105-01/runtime-verification.json)保留准确目标与摘要。正式库未导入任何dump。

上线后，正式入口、登录门槛、健康和全部公开资源已直接核对；写链路在来源摘要与正式镜像一致的合成自有环境执行。63次真实HTTP及真实Edge覆盖相关角色入口、退回续修、质量回执、冲突交接和时间显示。正式真实业务办理及人工输入法体验不由这些技术检查代替。

## 当前恢复入口

全IP调整前的同版容器`infomat-mdm-3000-before-all-ip-20261112`保持停止，准确ID保存在上述网络调整记录中。原`recover.cjs`绑定该旧容器ID，不能直接对新ID执行维护切换。若需使用原同版只读维护入口，先在当次维护授权范围内，从仓库根执行`node artifacts/workspace-style-20261112/bindings.mjs rollback mdm`恢复同版原容器及原回环发布，再运行下述`recover.cjs check`和维护命令。该监听回退复用当前挂载和数据，不回灌旧备份；其他网页服务不受影响。

切换前容器infomat-mdm-3000-before-role-experience-20261105保留停止，原镜像和备份保留追溯。不能回灌本次或更旧dump覆盖上线后增量；不将旧写版本直接当作当前恢复入口。

同版只读备用为infomat-mdm-3000-role-experience-readonly-20261105，准确ID为ffd1f3962f5f2fc8ee7fc96ed5904c3f530f2b52822e12401f0eb9a2a4928f46，保持停止。其代码和来源与当前版本一致，沿用当前运行文件及初始密码只读挂载。外层门禁拒绝业务写入，仅保留登录/退出会话，停止待办后台生成；该效果已在独立恢复副本验证，正式备用未激活。

从仓库根核对元数据：

    node artifacts/3000-role-experience-deploy-20261105-01/recover.cjs check

该检查不连接数据库、不切换服务。需要维护时，按当次授权执行同入口activate-readonly --authorized-readonly-maintenance。入口绑定当前及备用准确ID，从停写开始覆盖故障补偿，保存当时数据、结构和授权摘要后切换同版只读服务。保留正常容器及全部当前增量，不恢复dump；补偿失败会记录实际容器状态，不误报恢复成功。

## 历史定位

本次更新前说明保留于[DOCKER.before](../../artifacts/3000-role-experience-deploy-20261105-01/documentation-before/DOCKER.md)。上轮质量审计及SQL列授权发布见[历史报告](../../artifacts/3000-governance-deploy-20261105-01/report.md)，本轮5项修复的发现和上线前隔离体验见[体验报告](../../artifacts/3000-postlaunch-role-experience-20261105-01/report.md)。更旧初始密码恢复、V9更新和3001记录按历史链追溯。

旧发布及恢复脚本绑定的活动容器ID已过期，仅用于追溯；当前维护使用上文新入口。所有正式备份、原受控配置和历史镜像保留，已清理本次自有测试服务、数据库及浏览器。未暂存、提交或推送。
