# 3000 的 Docker 部署与维护

当前3000已按2026-10-13用户要求停用并删除旧版UI，仅提供同源React前端。访问根路径`/`返回302并转向`/app/`；`/index.html`和`/mdm-protocol.js`返回410，运行镜像中不再包含这两个旧文件。登录、首次改密和本人改密均在当前前端完成；不提供旧页面回退。

## 当前运行对象

| 对象 | 名称或地址 | 用途 |
| --- | --- | --- |
| 3000应用容器 | `infomat-mdm-3000` | 当前唯一运行的3000应用 |
| 当前应用镜像 | `infomat-mdm:department-head-20261019-02` | 2026-10-19 17:38沿用同一镜像开启正式流转 |
| 页面入口 | [3000平台](http://127.0.0.1:3000/app/) | 当前前端 |
| 已有MySQL容器 | `infomat-input-baseline-review-mysql` | 原试运行库，宿主机端口3307 |
| 本次开关恢复容器 | `infomat-mdm-3000-rollback-formal-enable-20261019-01` | 保留同一镜像与正式开关关闭的原配置，保持停止；撤回开关不恢复旧数据 |
| 历史单入口恢复容器 | `infomat-mdm-3000-rollback-entry-csp-20261013` | 单入口恢复版本，旧UI仍已关闭 |
| 原版历史恢复容器 | `infomat-mdm-3000-rollback-single-entrAX4261013` | 保存退役前应用及配置，保持停止 |
| 本次替换前镜像 | `infomat-mdm:v8-20261013-checks-dacded86` | 历史恢复资产，含旧UI |

当前来源摘要为`6a555c3019367b84ab023e292e3862eb8a72e8e493d535c95a03967030746beb`，镜像标识为`sha256:b9d2f749506c1a039608870ca0b912766a7d1a49c6b70a5638c5f97923e2aa46`，容器为`46a328e98da8d4488fc1ddd3f952a41c83818e3f44459a5dc84a8dc5dfc4c0be`。运行模型保持`rbac-raci-v4-2026-10-19`及独立部门确认策略`department-accountability-v1`；本次只改变正式开关，不构建工作区或迁移模型。维护时以实际镜像和`/api/health`、`/api/ready`复核。

宿主机仅发布`127.0.0.1:3000`，局域网及HTTPS尚未启用。应用继续使用原MySQL试运行库及已有账号、会话配置和授权；本次正式开关切换没有执行迁移、导入、正式库恢复或账号授权变更，备份恢复核对只在自有临时库执行。正常会话检查及续期仍由原应用处理。

## 日常操作与可用性核对

在Docker Desktop的Containers中只操作准确的`infomat-mdm-3000`。数据库已在运行时不要重启其他容器；应用手工停止后可执行：

```powershell
docker start infomat-mdm-3000
docker restart infomat-mdm-3000
docker stop infomat-mdm-3000
docker inspect infomat-mdm-3000 --format '{{.Config.Image}} / {{.State.Status}} / {{.State.Health.Status}}'
```

可用结论须同时核对：`/api/health`为HTTP200，`/api/ready`为HTTP200、`ready=true`且来源摘要匹配，容器为`healthy`，根路径转向当前前端，旧文件地址为410。当前版本已经取得这些实时证据，以及Edge100%、1699×828桌面的实际登录页、布局和CSP证据。未使用真实账号登录或修改密码；改密、导航及输入保护使用合成API在隔离HTTP和Edge中验证，不等于正式数据库办理、人工体验或业务验收。

## 保留的运行边界

Linux amd64继续使用实际Node24.21.0及原后端依赖，没有新增包或升级依赖。MySQL为正式技术主线，SQLite只保留历史迁移及隔离测试，不启用正式回退。

应用以`node`用户运行，根文件系统只读，Linux capabilities全部关闭，沿用原网络、资源限制、日志轮转及`unless-stopped`策略。Express继续使用原容器回环监听和同容器TCP转发，不修改认证头或代理信任。数据库连接仍使用`host.docker.internal:3307`及原账号范围，不修改grants。

运行配置继续由原受保护文件只读挂载到`/run/secrets/mdm-runtime.json`。该文件位于原Docker部署证据的`private/`目录，不能查看、分享、提交或放入构建上下文。凭据不进入镜像或Docker环境变量；本次只核对挂载路径、存在性和只读属性。原Windows DPAPI凭据及历史恢复资料保留。

当前`PROCESS_V7_PREVIEW_ENABLED=1`、`PROCESS_V7_FORMAL_ENABLED=1`；`PROCESS_V7_AUTHORING_ENABLED`、`PROCESS_DATA_GOVERNANCE_ENABLED`保持0。API、表名和开关的V7兼容名称继续覆盖实际受支持的原生V8及V7，不按名称推断正文版本。worker、AI和通知的原有开关保持，正式流程仍按现有权限及部门卡口办理，不自动授予人员角色。

公开资源只有当前前端构建及明确允许的`logo.png`、`echarts.min.js`、`template.xlsx`。共用请求和页面合同移至`shared/browserProtocol.js`，通过构建供当前前端使用；不再公开旧协议脚本，不允许任意`public/`文件重新开放页面。CSP脚本策略为同源`'self'`，移除了旧HTML专用内联脚本哈希。

## 正式流转开启与恢复

2026-10-19 17:38按用户请求开启正式流转。此前部署保留`PROCESS_V7_FORMAL_ENABLED=0`；此次回读确认M1/M2迁移结构、所需应用表权限和开启探测全部满足，独立部门确认策略就绪。只以同一镜像重新创建3000容器，将该变量改为1；不构建脏工作区、不替换代码、不迁移模型或表结构、不修改人员及数据库授权。预览中的原案例继续保留。

本次证据位于`artifacts/3000-formal-enable-20261019-01/`：`inspection.json`记录只读前置检查，`database-backup.json`与`restore-rehearsal.json`记录149表完整备份及独立恢复，`deployment.json`和`runtime-verification.json`记录实际开关、同一镜像、健康、23项前端资源及数据保留。`department-rule-readback.json`确认12个未配置部门均拒绝最终确认；`formal-enable-online-browser-verification.json`记录实际Edge100%、1699×828登录页、同源Worker、无溢出及无页面/CSP异常。正式业务写入没有在实际库中试办，人员配置及业务验收仍待用户完成。

同一镜像的V8/V7正式流转、并发任命、唯一登记和交接失效检查复用已冻结验证，哈希及镜像绑定见`frozen-evidence-reuse.json`。本批`operate.cjs`的prepare、deploy已完成，不得重放。需要关闭正式流转时，先停止业务写入并核对后续办理，再切回本表所列同一镜像的开关恢复容器；只撤回功能开关，保留已写入的正式记录，不把旧dump覆盖回目标库。备份private目录仅当前维护用户及SYSTEM可访问。

## 历史单入口镜像构建、恢复及证据

2026-10-13单入口镜像以当时替换前不可变运行镜像为基线，只合入本次入口、前端、协议及包命令调整。前端从该基线源码应用本次补丁后构建，逐文件镜像清单确认其他服务端和公开资产未变；旧HTML、旧公开协议脚本及过期前端构建文件已移除。不要使用整个脏工作区直接构建，不把Windows依赖、私有配置、录音、上传材料或数据库放入镜像。

本次批准覆盖层、构建、镜像清单、容器配置、替换及验证证据位于`artifacts/3000-retire-old-ui-20261013/`，其中`final/deployment.json`记录该历史批次的发布及恢复对象，`final/runtime-verification.json`记录实时HTTP、健康、就绪、CSP和其他容器未变，`runtime-browser.json`记录实际登录页验证。旧恢复容器保持停止，其代码不会由当前3000提供。

下列入口仅用于对应2026-10-13单入口历史镜像，不能用于撤回当前正式开关。处理该历史版本时须重新核对目标并取得授权，其原命令为：

```powershell
node artifacts/3000-retire-old-ui-20261013/final/operate.cjs rollback
```

该历史入口只识别其批次镜像与恢复容器，只替换3000应用，复用原配置挂载、回环端口、网络及资源限制，并核对恢复版本的来源摘要和就绪状态；不恢复SQL、旧密码或权限。该入口恢复至仍已关闭旧UI的单入口版本，未恢复旧UI；恢复入口尚未演练。更早的原版恢复资产继续保留并停止，未经用户重新授权不得开启。本次容器切换具有异常时自动恢复机制，实际发布已成功。

历史业务检查发布证据保留在`artifacts/3000-business-checks-20261013/`，侧边栏和工作台发布证据分别保留在`artifacts/mdm-3000-sidebar-release-20261013-02/`及`artifacts/mdm-3000-preview-release-20261012-01/`。原Docker部署、历史数据库恢复演练和Windows副本仍保存在原`artifacts/mdm-3000-upgrade-20260916/`批次；这些资料用于追溯，不作为当前运行入口或业务真源。
