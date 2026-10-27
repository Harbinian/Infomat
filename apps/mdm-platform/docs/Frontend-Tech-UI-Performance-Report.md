# 3000 第一期桌面候选构建与验证报告

日期：2026-10-14。第一期已在现有React前端实现并完成隔离验证，随后按用户明确授权替换至3000，实时技术检查通过；第二期多端未开展。本文是技术验证记录，不提供治理依据或业务验收结论。

## 交付、基线与保护证据

工作树基线为master、`e6dc1ab4d138b6772fac7fa130d3bb6bd67f2ebc`。已有账号、角色、目录发布及其他应用的改动保留；没有暂存、提交或推送。记录见 `artifacts/mdm-tech-ui/20261014-desktop-01/git-status-before.txt`、`existing-mdm-changes.patch`、`baseline-source/`及任务后的状态。

正式候选为 `artifacts/mdm-tech-ui/20261014-desktop-01/complete/build/`，其中 `index.html`、按需分块、Worker、WASM和动画JSON组成完整同源构建。目录中没有业务材料、私有配置或服务端源码。原候选对照为 `baseline-build/`；中间构建和失败证据保留用于追溯，不能代替正式候选结果。

候选开发阶段的`runtime-protection.json`确认Windows工作区 `frontend/dist` 的全部文件SHA256与阶段开始时一致，3000监听进程前后均为10148，HEAD和分支保持。该阶段未启动、停止、重启或重新绑定3000，也未操作3001、PMO、正式数据库、通知或业务开关。前端 `api.js`、`sessionGate.js`、`protocol.js` 前后哈希一致；共享 `browserProtocol.js`没有本期变更。哈希清单见 `build-report.json`。此记录保留为发布前证据，不代表下述授权发布后的运行状态。

## 授权发布与实时检查

用户后续明确授权“替换吧，我验收一下”。发布证据写入新的 `artifacts/3000-tech-ui-release-20261014-01/`，以实际运行的部门角色镜像为基线，仅替换交付候选的24个文件及 `server/cspPolicy.js`。完整 `/app` 文件核对显示变化只在该范围，其余5086个文件一致，原业务服务端、共享资源、依赖和12部门角色配置保留。没有从脏工作区整体构建，也没有覆盖Windows `frontend/dist`。

当前镜像为 `infomat-mdm:tech-ui-20261014-beef0770`，来源摘要为 `beef0770d3fd35eb2375c5576bb7ddadfb9e7b2b5d4edc1985e47bb431c8d8be`。`deployment.json`及 `runtime-verification.json`记录实际切换、健康/就绪、27入口HTML哈希、22公开资产哈希、同源Worker/WASM与响应CSP。原配置挂载、业务开关、网络和资源限制一致，其他容器未变。没有执行数据库迁移、目录导入、账号、权限或业务数据修改。

`runtime-browser-verification.json`及两张截图记录实际3000的匿名登录页面：Edge100%、1699×828 CSS像素，真实同源场景Worker和canvas启动，暂停/恢复及减少动态效果有效，无横向溢出、CSP违规、页面异常、外域请求或浏览器持久存储。该检查没有登录真实账号、提交密码或开展业务办理，人工体验和业务验收仍待用户完成。停止的完整恢复容器为 `infomat-mdm-3000-rollback-tech-ui-20261014-9791600e`；应用恢复不回退数据库，操作入口见[Docker说明](../DOCKER.md)。

## 入口、业务与表现层验证

当前协议有27个页面入口，包括25个导航项、本人改密及工作台根别名；数量从实际协议生成，不作为未来上限。所有入口均在真实Edge、100%、1699×828 CSS像素下呈现，检查标题焦点、页面横向溢出及受限身份的错误/禁用/只读状态，并逐页截图。正常办理和输入保护通过下列自有临时MySQL专项补充；错误页截图没有替代正常办理证据。完整页面、子组件、操作节点、权限键、定位参数和状态登记见 `source-coverage.json`、`coverage-matrix.md`。

`verification-summary.json`汇总20项实际退出0且有结果明细的业务专项，以及最终4项表现层/安全专项，共192条检查记录。前端36项与CSP合同2项另见 `final/contracts.json`及同目录日志；最后打印变更仅修改媒体样式，不改变这些已核对的请求、会话及CSP逻辑。首次失败记录保持，汇总只引用对应的通过执行。

| 验证组 | 实际结果与证据目录 |
|---|---|
| 前端请求、会话、历史路由、并发、取消与诊断合同 | 前端36项测试通过；CSP精确指令2项通过，资源及退役入口检查通过 |
| 首次/本人改密、错误输入、取消离页、重登、内联脚本/JS eval/blob Worker阻断 | `complete/csp-evidence/`，合成API及同源外部负向探针通过 |
| 全部协议页、同源Worker/WASM、减少/暂停、高对比、打印及20次SPA切页 | `complete/ui-evidence-02/`通过；无CSP违规、无页面异常、无外域请求、无浏览器持久存储；实际输入文字/边界、按钮悬停与白底打印标题分别核对对比度 |
| Worker/WASM/OffscreenCanvas不可用 | `complete/resilience-evidence/`通过；登录错误文字、输入和重试保持，静态回退有效 |
| WebGL上下文丢失与质量降档 | `complete/controls-evidence/`通过；实际Worker上下文丢失释放场景，延迟rAF显式模拟检验两个可见窗口后逐级降档 |
| 工作台、统计看板、角色详细管理 | `business-suite-final-02/test-role-workbench-browser/`、`test-dashboard-browser/`、`test-role-management-browser/`通过；有真实V8事项、受支持V7核对、职责图、独立统计和身份范围证据 |
| 角色说明、办公室、流程预览 | `repair-suite/test-role-guide-browser/`、`test-office-workbench-browser/`、`test-process-preview-browser/`通过；历史目标转换、原输入、范围卡口与核对依据保持 |
| 正式流转、数据治理工作包、数据地图读取/创建、字段身份及导出、质量 | `business-suite-final-02/`中对应专项通过；原固定版本、审核历史、字段身份、两张Excel工作表、403/409/会话范围与结果不明核对保持 |
| 字段导入、组织/花名册、待办收到 | `import-directory-retest/test-field-import-browser/`、`remaining-suite/test-identity-directory-browser/`、`test-todo-inbox-browser/`通过；整批回滚、去重、下载原列和值、输入保留及跨身份保护已检查 |
| 发布历史、术语、冲突 | `business-suite-final-02/test-publications-browser/`及`test-terms-conflicts-browser/`通过；脚本退出0且各自结果包含完成的检查明细 |
| 原生流程与数据关系图 | `native-diagrams-retest/test-native-diagrams-browser/`通过；真实几何、箭头、节点原文、当前/历史固定版本、键盘、版本检索、PNG来源和打印样式保持 |
| 原生V8连续链路 | `complete/v8-chain/test-p25-candidate-integration/`通过；同一交付候选贯通独立管理员首次改密卡口、角色为空的明确编制者、审核/发布、工作包、固定对象/字段定义与映射、实际分析Worker、问题答复、办公室任务、独立复核关闭、旧版本保护及自有合成库完整备份恢复 |
| 流程治理合同与固定角色访问 | `test:process-governance`、`test:project-roles`、`test:role-workbench`通过；隔离/替身检查不解释为正式库或业务验收 |

共享Lottie库销毁播放器后保留一个空闲缓存Worker。20次SPA切换后没有持续绘制的Lottie实例或累积的场景Worker，新增展示观察器、监听及调度计数回到基线；空闲共享线程与活动渲染分别报告，不声称所有Worker数量为零。计数与实际Worker目标检查见 `complete/ui-evidence-02/after-20-switches.json`。一次性效果记录实际启停区间；该次失败结果反馈的开始、加载及完成停止可在同目录 `pilot-diagnostics.json` 定位，不把播放器持有时间等同于连续播放时间。

初次失败及其修复证据保留：旧测试正常样本缺编制元信息、动作名称/说明或判断出口；目录测试仍寻找已经改为按钮的旧下载链接；候选Node预加载曾进入有界解析Worker并影响其预算；Lottie短加载在取消时曾输出中止日志。连续链路的旧首次改密文案及“待核实”样本也与当前入口、待确认分类不一致，已按明确合成材料修正。测试样本、定位和预加载边界已修正，动画JSON改为小型只读缓存后复验。Worker目标关闭的固定450ms等待曾在并发测试时过早断言，已改为有界等待真实关闭条件后复验20次切页。安装中断造成缺失的公开类型声明已从同版本官方包补齐并核对SHA，见 `package-verify/`；没有改写第三方运行代码。没有降低服务端卡口、放宽权限、猜测迁移或覆盖真实材料。办公室一次环境缓冲不足已在隔离重跑通过。

## 性能数据与适用范围

测量使用同一合成登录场景、同一Vite优化方式，5秒预热后各取30秒可见区间并保存DevTools轨迹。实际CPU为i5-12600KF、Edge155.0.4283.45，无头浏览器，视口1699×828、缩放1。rAF周期约13.3ms；未取得显示器刷新率和GPU实际呈现证据，不将约75fps的调度估计解释为指定60Hz办公电脑验收。

| 指标 | 本次实测 | 判断 |
|---|---|---|
| 首屏同步JS gzip增量 | 3643字节，约3.6KB；相同gzip方法比较 | 低于50KB预算；见 `build-report.json` |
| 原候选／当前候选估计帧率 | 均约74.97fps | 仅本机可见登录区间的rAF估计 |
| 两构建帧间隔P95 | 均约13.6ms | 本机样本满足18ms目标；指定办公硬件未验证 |
| 新增自研调度回调P95 | 约0.10ms | 该区间低于2ms预算，含指针与采样，不代表整页业务脚本耗时 |
| 当前候选长任务／Long Animation Frame | 30秒区间记录0项；API均支持 | 没有用“不支持”填零；不推断其他首屏、压力和业务场景均无长任务 |
| 交互INP | null | 没有可靠整页聚合，不用单次事件延迟代替，≤200ms门槛尚未验收 |
| 20次切页稳定性 | 新增场景、播放器和监听/观察器无累积；一个空闲库缓存Worker | 技术专项通过，见资源与实际Worker目标记录 |

原/当前构建的连续场景轨迹、采样及截图位于 `complete/resilience-evidence/`。输入文字15.38:1、输入边界3.94:1、主要按钮悬停13.05:1和白底打印标题14.31:1是实际DOM计算值，见 `complete/ui-evidence-02/control-contrast.json` 与 `print-contrast.json`；这些代表性检查不代替整站WCAG人工评估。图形正常办理、接口延迟和异常负载的功能证据另见业务专项；本轮没有据此建立业务容量结论，指定办公电脑的常用/压力场景性能仍未验收。

依赖审计的原清单与当前清单均检出两个high项，涉及现有Vite8.0.14和source-map-js依赖链；没有为视觉升级擅自升级原工具栈。记录见 `baseline-dependency-audit.json` 与 `dependency-audit.json`。这些现有风险需要独立受控升级和验证，不能把本次技术通过解释为依赖审计无风险。

## 状态与剩余验收

已实现：当前全部页面及子组件的公共视觉、交互反馈、按需Worker动效、同源资源、源码CSP、降级和清理。已准备：候选构建、设计令牌、组件保护、动效规格、功能覆盖、可重跑脚本、截图、轨迹和哈希。隔离技术检查取得上述证据。

已开启：实际3000已按明确授权运行本次桌面构建及最小CSP，装饰Worker动效已取得实时页面证据；业务开关保持原状态。没有执行MySQL迁移、账号/权限或业务数据修改，也没有操作通知。i5-10400/16GB/UHD630/60Hz实机性能、可靠INP、人工中文IME、密码管理器与辅助技术体验、完整WCAG2.2符合性及业务验收尚未完成。第二期平板/手机全功能适配、真实设备与窄屏验证未开展，计划仍保留。

隔离服务和临时容器只使用合成数据，结束时按进程归属、容器label/name、无持久挂载及tmpfs边界清理。初次中断留下的自有资源另行完成归属核对并清理，证据为 `owned-container-cleanup.json`、`owned-process-cleanup-results.json`及各通过专项的fixture清理记录。已有历史输出和私有配置没有被清理或移动；授权发布仅将原3000应用容器停止并改为明确的恢复名称，原容器、镜像及更早恢复资产均保留。
