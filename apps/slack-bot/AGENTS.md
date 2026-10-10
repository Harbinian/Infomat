# AGENTS.md

本目录是把 Claude Code CLI 的无头模式接到 Slack 上的问答机器人：同事在频道 `@机器人` 或私聊提问，它在 Infomat 仓库内检索材料后作答。本文件只保留目录级硬规则和任务路由；镜像结构、性能实测和运维命令按任务读取 `README.md`。

## 修改边界

- 可以修改本目录的 `src/`、`Dockerfile`、`compose.yaml`、`sync.sh`、`healthcheck.cjs`、`package.json`、`.env.example` 和说明文档。
- 不读取或修改 `.env`（含真实凭据）；不修改被挂载的仓库其他目录，除非用户明确扩大范围并确认主责资产。
- 不把 Slack token、模型密钥或宿主机私有路径写进任何会被提交或被构建的文件。`.env` 与 `.dockerignore` 的组合保证凭据不进镜像层，改动其中之一时核对另一处仍成立。
- 仅调整说明文字时，不得改变权限判定、挂载方式、同步排除清单或工具集配置。

## 不可违反的边界

- 默认只读。只读档只加载 `Read`、`Grep`、`Glob`，Bash / Edit / Write 在子进程里根本不存在，而不是靠提示词约束；写入档仅对 `BOT_WRITE_USERS` 列出的 Slack 用户开放。
- **权限按提问者判定，不按 Slack 线程。** 每条消息都以 `event.user` 单独判定档位；档位与该线程已存会话不一致时必须重建会话，不得 `--resume`。否则负责人用写入档开过的线程，会被进来追问的同事继承写入能力。
- 只读档读 `/repo`，那是 rsync 同步进 Docker 卷的镜像，挂载为只读；写入档读写 `/repo-write`，那是宿主机仓库的直接挂载，改动落到真实文件。
- 写入档的 `BOT_WRITE_TOOLS` 若含 `Bash`，等于把工作区的完整操作权交给对话方：它能执行命令、删文件、改 git 历史。**CLI 自带的命令过滤是模式匹配，不能当安全边界**（实测同一条 `rm -rf` 带 `&&` 被拒、去掉即放行）。改动这一项前，先确认用户已存档（`git stash` 或 commit），并在提示词里维持只读命令的约束。
- 机器人不联网检索，不主动推送，不读取未被 @ 的频道消息。它只把答案发回发起提问的那条线程。
- 机器人的输出是问答结果，不是业务结论、治理决定或审批意见。涉及事实判断时仍按根入口的治理口径回到有权主体和用户指定材料。

## 为什么读的是卷镜像

宿主机全仓 23.6 万个文件，而 Docker Desktop 共享 Windows 盘那一层遍历慢 530 倍，会让 ripgrep 的全树搜索撞上 60 秒硬超时并颗粒无收。因此只读档改读 `repo-sync` 容器 rsync 出来的卷镜像，排除清单一律对齐仓库根 `.gitignore`。改动挂载方式或排除规则前先读 `sync.sh` 顶部说明，不要另起一套。

容器另有四处非显然配置，都在 `compose.yaml` 里带注释，不要顺手删：显式 DNS（宿主机解析器不稳定，否则表现为 `getaddrinfo EAI_AGAIN` 加退避重试）、`read_only` 根文件系统下的 `/tmp` 内存盘、Socket Mode 的 `dispatcher` 代理注入、以及心跳文件驱动的 healthcheck。

## 任务路由

| 任务需要 | 按需读取 |
|---|---|
| 镜像结构、性能实测数据、日常运维命令 | `README.md` |
| 同步为什么存在、排除规则怎么写 | `sync.sh` 顶部注释 |
| 权限档位、工具集、会话记忆与心跳逻辑 | `src/index.js` 顶部注释与 `profiles` 定义 |
| 容器配置、挂载点、DNS、健康检查 | `compose.yaml`、`healthcheck.cjs` |
| Slack 侧 scope、事件订阅、安装步骤 | `README.md` 的 Slack 侧配置章节 |
| 本目录的归属与收纳边界 | `../../DIRECTORY_OWNERSHIP.md`、`../../REPOSITORY_BOUNDARY.md` |

## 运行与验证入口

- 语法检查：`node --check src/index.js`
- 构建启动：`docker compose up -d --build`；状态应为 `Up (healthy)`
- 同步进度与耗时：`docker compose logs -f repo-sync`
- 只读是否真的生效：`docker exec infomat-slack-bot touch /repo/__probe`，应报 `Read-only file system`
- 写入档是否仍指向真实仓库：`docker exec infomat-slack-bot touch /repo-write/.probe`，应成功
- 协作入口或路由变化时，从仓库根目录运行 `npm run test:codex-context`
