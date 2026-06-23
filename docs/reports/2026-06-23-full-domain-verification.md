# 2026-06-23 全域测试记录

执行时间：2026-06-23 20:59:50 +08:00

复测闭环时间：2026-06-23 22:12:53 +08:00

当前状态：已闭环

## 结论

本轮再次覆盖仓库资料、流程治理、PMO 流程地图、MDM 平台正式测试入口与本地联动烟测。

正式测试入口和本地联动烟测均已通过。

本轮先发现联动烟测未闭环：MDM 健康检查已通过，但管理员登录依赖的 MySQL 身份读取模型不可用。排查确认 `127.0.0.1:3307` 不通，但 `localhost:3307` / `::1:3307` 可通。根因是固定启动合同将 MySQL host 写成 `127.0.0.1`，而当前 Docker/WSL 端口转发只在 `localhost` / `::1` 可达。

已将 MySQL 固定 host 调整为 `localhost`，并修复 Windows PowerShell 5 下 TCP 探测 IPv6 localhost 的兼容问题。随后重新运行固定启动入口和联动烟测，管理员登录、角色工作台、流程治理、数据地图和术语接口均通过。

## 覆盖范围

| 范围 | 结果 | 说明 |
|---|---|---|
| 仓库边界与资料清单 | 通过 | 部门域、工程技术部资料清单、norms 清单、源文件 hash 均通过 |
| PMO 流程地图静态链路 | 通过 | 任务、WBS 语义深度、驾驶舱数据、流程地图解析均通过 |
| 流程治理候选与证据 | 通过 | 候选、证据、客户文件边界、客户文件承接审计均通过 |
| DCM/BBM 质检脚本 | 通过运行 | 脚本无失败退出；当前仍有质量账本缺口，见下方 |
| MDM 平台正式测试 | 通过 | 主线、流程治理、前端、安全、MySQL 配置、角色工作台等测试均通过 |
| PMO/MDM 本地联动烟测 | 通过 | 固定入口重启后，MDM 管理员登录和流程治理链路均通过 |

## 关键数据

| 指标 | 本轮结果 |
|---|---:|
| 部门映射文件 | 9 |
| 源文件 hash 覆盖 | 1615 |
| 工程技术部候选文件 | 47 |
| PMO 任务 | 467 |
| PMO WBS 父节点 | 85 |
| 客户文件承接任务 | 234 |
| A1 行数 | 1415 |
| A1 传递证据审计 findings | 0 |
| PMO 驾驶舱节点 | 1915 |
| PMO 驾驶舱连线 | 3475 |

## 已通过的正式入口

- `npm run test:dept-domain-mapping`
- `npm run test:engineering-source-manifest`
- `npm run test:norms-source-manifest`
- `npm run test:pmo-task-data`
- `npm run test:pmo-wbs-semantic-depth`
- `npm run test:source-manifest-hashes`
- `npm run test:infomat-services-config`
- `npm run test:process-candidates`
- `npm run test:process-candidate-review`
- `npm run test:sankey-preview-status`
- `npm run test:process-evidence-skill`
- `npm run test:customer-file-boundary`
- `npm run test:customer-file-acceptance-audit`
- `npm run test:customer-file-sankey-labels`
- `npm run audit:customer-file-acceptance`
- `node scripts/audit-a1-transfer-evidence.mjs --no-write`
- `node scripts/check-dcm-bbm.mjs --no-fail`
- `npm run test:process-governance-mainline`
- `node scripts/parse-sankey-data.mjs`
- `node scripts/check-dashboard-data.mjs`
- `npm run test:ocr-source`
- `npm run test:process-evidence-evolution`
- `npm run test:mainline`
- `npm run test:process-governance`
- `npm run test:frontend`
- `npm run test:security`
- `npm run test:mysql-config`
- `npm run test:views`
- `npm run test:rbac`
- `npm run test:delete`
- `npm run test:org`
- `npm run test:catalog`
- `npm run test:activity`
- `npm run test:local-baseline`
- `npm run test:auth-mysql`
- `npm run test:products`
- `npm run test:page-workflows`
- `npm run test:project-roles`
- `npm run test:role-workbench`

## DCM/BBM 质量账本

`node scripts/check-dcm-bbm.mjs --no-fail` 已完成并刷新 `docs/reports/dcm-bbm-quality-report.md`。

当前账本仍显示：

| 严重度 | 数量 |
|---|---:|
| BLOCK | 247 |
| WARN | 660 |
| INFO | 0 |

这不是脚本失败，但说明正式映射仍有待补齐或待确认项，后续应按部门和源文件继续收敛。

## 本地联动烟测

初次烟测发现：

`npm run smoke:infomat-services` 的前半段通过：

- PMO root：通过
- PMO tasks：通过，任务数 467
- PMO source manifest：通过，清单数 8
- PMO procedure dashboard data：通过，节点 1915、连线 3475
- MDM health：通过

阻塞点：

- MDM admin login 曾返回 503：`身份 MySQL 读取模型不可用`
- 固定合同目标 MySQL：`127.0.0.1:3307`
- 实际可通入口：`localhost:3307` / `::1:3307`
- 直接 MySQL 探针：`127.0.0.1` 失败，`localhost` 成功，`::1` 成功

修复后复跑：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

复测结果：

| 检查项 | 结果 |
|---|---|
| PMO root page | 通过 |
| PMO tasks data | 通过，467 |
| PMO source manifest | 通过，8 |
| PMO procedure dashboard data | 通过，节点 1915、连线 3475 |
| MDM health | 通过 |
| MDM admin login | 通过，`ADMIN001 / 系统管理员 / admin` |
| MDM current user | 通过 |
| MDM departments | 通过，10 |
| MDM users | 通过，82 |
| MDM roles | 通过，10 |
| MDM role workbench | 通过，roles 10、todos 0 |
| MDM process governance current | 通过，snapshot 19、active |
| MDM process governance data | 通过，节点 1793、连线 3284 |
| MDM data map contexts | 通过，1 |
| MDM terminology types | 通过，11 |

## 修复记录

- `scripts/infomat-services.config.json`：MySQL host 从 `127.0.0.1` 调整为 `localhost`，端口仍固定为 3307。
- `scripts/start-infomat-services.ps1`：TCP 探测按 DNS 解析出的地址逐个连接，并按 IP address family 创建 `TcpClient`，兼容 Windows PowerShell 5 的 IPv6 localhost。
- `scripts/test-infomat-services-config.mjs`：补充启动合同回归，防止 MySQL host 和 IPv4/IPv6 探测逻辑回退。
- README 与角色使用说明同步更新 MySQL 固定入口为 `localhost:3307`。

## 本轮刷新产物

- `docs/reports/customer-file-acceptance-impact.md`
- `docs/reports/dcm-bbm-quality-report.md`
- `docs/reports/2026-06-23-full-domain-verification.md`
- `scripts/infomat-services.config.json`
- `scripts/start-infomat-services.ps1`
- `scripts/test-infomat-services-config.mjs`
