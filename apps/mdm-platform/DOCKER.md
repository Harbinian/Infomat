# 3000 的 Docker 部署与维护

当前 3000 已按 2026-10-13 用户授权部署侧边栏重构，提供“我的工作、流程治理、数据治理、成果查阅、管理与辅助”五个可折叠分组。镜像以 2026-10-12 已发布的工作台及预览修复版本为基线，只合入导航组件、样式、导航元数据及其前端构建；工作区其他改动未发布。沿用原 MySQL 试运行库、账号、会话密钥及权限，预览核对保持开启，正式流程、编制归属和数据治理开关仍关闭。

## 在 Docker Desktop 中识别 3000

| 对象 | Docker 中的名称 | 用途 |
| --- | --- | --- |
| 3000 应用容器 | `infomat-mdm-3000` | 在 Containers 中启动、停止或重启这个容器 |
| 3000 应用镜像 | `infomat-mdm:v8-20261013-sidebar-39555ef9` | 当前侧边栏重构镜像，预览核对已开启 |
| 3000 本次恢复镜像 | `infomat-mdm:v8-20261012-preview-8b1e0c4c` | 本次部署前的工作台及预览修复版本，预览开关开启 |
| 3000 历史恢复镜像 | `infomat-mdm:v8-20261008-4a17f6da` | 10 月 12 日发布前版本，预览开关关闭 |
| 已有 MySQL 容器 | `infomat-input-baseline-review-mysql` | 保存原试运行库，宿主机端口 3307 |
| Node 基础镜像 | `infomat-node:24.21.0` | 构建依赖，单独启动它不会提供 3000 网页 |

应用地址：[3000 新入口](http://127.0.0.1:3000/app/)，原入口：[3000 兼容入口](http://127.0.0.1:3000/)。本次保持本机访问，宿主机仅发布 `127.0.0.1:3000`。局域网和 HTTPS 范围尚未启用。

## 日常启动与停止

在 Docker Desktop 的 Containers 中确认 MySQL 容器正在运行，再启动 `infomat-mdm-3000`。两个容器的重启策略均为 `unless-stopped`：Docker 服务恢复时会自动启动，手工停止后需手工启动。当前镜像已验证替换后启动、健康、就绪，以及登录后的侧边栏折叠、键盘展开、导航和历史选中状态。工作台、预览和设计交接页面均取得实时读取及截图证据。

也可使用以下命令，每次只操作指定容器：

```powershell
docker start infomat-input-baseline-review-mysql
docker start infomat-mdm-3000
docker restart infomat-mdm-3000
docker stop infomat-mdm-3000
docker inspect infomat-mdm-3000 --format '{{.State.Status}} / {{.State.Health.Status}}'
```

启动后检查 `/api/health` 返回 HTTP 200，`/api/ready` 返回 HTTP 200、`ready=true`，来源摘要为 `39555ef9b35ed5e48ce86f66cc36604df2fbffa160b592304cad8696e8799bc8`。登录后核对 `/api/process-v7-preview/status` 返回 `enabled=true`、`formal_enabled=false`，工作台及预览案例列表返回 HTTP 200。数据库尚未就绪时，不能仅根据容器的 Running 状态判断应用可用。

## 当前部署边界

Linux amd64 沿用实际 Node 24.21.0／ABI 137 和原后端依赖，没有升级包版本。SQLite 原生安装脚本未运行，正式运行仍由 MySQL 边界检查约束。构建前逐文件核对当前部署的 587 项批准资产，以独立白名单覆盖层替换 3 个导航源码文件及 11 个前端构建文件，最终镜像核对 588 项资产。前端从已部署版本源码合入侧边栏组件、导航元数据和样式后构建，未合入其他登录或请求处理改动。本地 Cytoscape、许可证、包元数据及原依赖保留；原排除的历史测试输出未加入镜像，历史文件保留。

应用以 `node` 用户运行，容器根文件系统只读，全部 Linux capabilities 关闭，日志轮转。Express 继续监听容器回环地址，通过同容器原始 TCP 转发承接宿主机回环发布端口；不修改 HTTP、认证头或代理信任配置。数据库通过 `host.docker.internal:3307` 访问原容器，仍匹配原运行账号的 `@172.17.0.1` 限定，不修改 grants。

原 Windows DPAPI 凭据保留。Linux 运行配置使用同批次 `evidence/p25/docker-deployment-20261008-01/private/mdm-runtime.json`，宿主机 ACL 仅当前 Windows 用户及 SYSTEM，挂载到 `/run/secrets/mdm-runtime.json` 且只读。该文件含明文凭据，不能查看、分享、提交或放入构建上下文；凭据不进入镜像和 Docker 配置环境变量。请保留该受保护文件，否则容器重建或启动会失败。

`PROCESS_V7_PREVIEW_ENABLED=1`；`PROCESS_V7_FORMAL_ENABLED`、`PROCESS_V7_AUTHORING_ENABLED`、`PROCESS_DATA_GOVERNANCE_ENABLED` 仍为 0。原兼容名称覆盖当前 V8 及受支持 V7 的预览技术能力。Docker 启动入口读取并校验预览开关，其他三个开关继续固定关闭；容器重启保持本次配置。worker、AI、通知未开启。预览入口已开启，真实案例上传、部门核对及业务验收需按实际对象取得证据。

管理员工作台跳过个人办公室任务和问题复核查询；独立系统管理员不绑定人员。设计交接等定义仓储读取在原事务连接上复核有效系统账号、密码代次和现有全局读取权限，治理写操作继续拒绝；没有新增角色或权限。

## 构建、恢复与证据

`Dockerfile` 必须使用核对后的白名单构建上下文。不要以整个工作区直接构建，不把 Windows `node_modules`、私有配置、录音、上传资料或数据库放入镜像。`compose.yaml` 的输入为镜像标签、批准来源摘要、受保护配置文件路径及预览开关；预览开关默认 0，本次发布显式设置为 1。使用本次空环境文件隔离自动 `.env` 加载；实际部署配置和一次性发布入口保存在本次证据目录。

2026-10-08 的历史备份保存在原证据目录的 `private/`；当时 144 表、35 个迁移标记、113 行已在自有临时 MySQL 中完整恢复并核对，临时容器已清理。这不是当前数据库快照。本次仅替换应用及启用预览，未执行数据库迁移、导入、恢复或账号权限变更；正常登录和会话续期仍由应用处理。SQL 备份不能替代实例账号和 DPAPI 凭据的独立保护。

需要恢复本次部署前的代码并保留预览核对开启状态时，在仓库根执行：

```powershell
node artifacts/mdm-3000-sidebar-release-20261013-02/operate.cjs rollback
```

该入口核对当前 3000 镜像后，只替换 `infomat-mdm-3000`，恢复至 2026-10-12 镜像，复用原配置挂载、回环端口、网络及资源限制，并验证旧来源摘要和就绪状态；不导入 SQL、不恢复旧密码或权限。旧镜像已保留，最终镜像的恢复入口尚未执行。

需要退出 Docker 运行时，只停止准确的 `infomat-mdm-3000`，核对 3000 空闲后，才可使用保留的 Windows V8 副本及其原维护入口恢复对应历史代码版本；该副本不含当前 Docker 的侧边栏发布。原 `runtime/3000-20261008-03`、旧状态文件及历史镜像不删除；旧状态文件不代表当前正在运行。代码恢复不导入旧 SQL，不回退密码、会话或权限；后续有真实业务变化时需先重新核对兼容和当次恢复点。MySQL 原重启策略为 `no`，需撤销本次启动策略时仅对准确原容器恢复该设置，不重建容器或卷。

当前发布的白名单、合入源码、构建、镜像校验、容器配置和实时验证位于 `artifacts/mdm-3000-sidebar-release-20261013-02/`。10 月 12 日工作台及预览修复证据保留在 `artifacts/mdm-3000-preview-release-20261012-01/`；原 Docker 部署、历史数据库恢复演练和 Windows 副本证据保留在 `artifacts/mdm-3000-upgrade-20260916/p00-20260916-120151/evidence/p25/docker-deployment-20261008-01/`。浏览器验证期间出现过 `net::ERR_NO_BUFFER_SPACE`，后续接口读取及页面显式重试恢复；该现象与服务端 HTTP 503 分开记录。本次技术发布不表示真实案例上传、修订、部门核对或业务验收已完成。
