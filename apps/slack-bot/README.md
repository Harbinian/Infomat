# Slack 问答机器人

把 Claude Code CLI 接入 Slack：同事在频道里 `@机器人` 或私聊提问，机器人在 Infomat 仓库内检索材料后用中文作答。

> **默认只读**：所有人只加载 `Read`、`Grep`、`Glob` 三个工具，Bash / Edit / Write 等具备执行或写入能力的工具**根本不存在**，而非仅靠提示词约束。只有 `BOT_WRITE_USERS` 里列出的 Slack 用户能拿到写入档。机器人不联网。

## 1. 运行前提

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20.6（用到内置 `--env-file`，无需 dotenv） |
| Claude Code CLI | 已安装并在 PATH 中，`claude --version` 可执行 |
| 模型通道 | 沿用本机 Claude Code 的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` |
| 网络 | 需能访问 `slack.com`（Socket Mode 出站长连接）与模型端点 |
| Slack 权限 | 工作区允许安装 App（免费版 Slack 也可，Socket Mode 不占公网端口） |

## 2. Slack 侧配置（一次性，只能由人在浏览器完成）

1. 打开 <https://api.slack.com/apps> → **Create New App** → **From scratch**，起名并选择工作区。
2. **Socket Mode** 页 → 打开开关 → 生成 App-Level Token，scope 勾 `connections:write`，得到 `xapp-…`。
3. **OAuth & Permissions** 页 → Bot Token Scopes 添加：
   - `app_mentions:read` — 接收频道里的 @提及
   - `chat:write` — 发消息、改消息
   - `im:history` — 接收私聊消息
   - `users:read` — 启动时校验身份
4. **Event Subscriptions** 页 → 打开开关 → Subscribe to bot events 添加：
   - `app_mention`
   - `message.im`
5. **App Home** 页 → 打开 **Messages Tab**，并勾选 *Allow users to send Slash commands and messages from the messages tab*（否则私聊发不出消息）。
6. **Install App** 页 → Install to Workspace → 授权，得到 Bot User OAuth Token `xoxb-…`。
7. 把机器人拉进需要的频道：频道内输入 `/invite @你的机器人名`。

> 改动 scopes 或事件订阅后必须**重新安装** App，否则不生效。

## 3. 启动

```bash
cd apps/slack-bot
cp .env.example .env      # 填入两个 Slack token
npm install
npm start                 # 前台运行，Ctrl+C 停止
```

启动后会打印工作目录、代理、模型通道、白名单状态和 Slack 身份，并输出 `✓ Socket Mode 已连接`。

冒烟验证：在 Slack 里私聊机器人发一句 `这个仓库是做什么的？`，应看到「正在查阅仓库材料…」被替换为答案。

## 3.1 容器化部署（推荐）

`compose.yaml` 沿用仓库房规：`restart: unless-stopped`、`init: true`、`read_only: true`、`cap_drop: ALL`、日志轮转。

```bash
docker compose up -d --build
docker compose logs -f          # 看启动日志
docker compose ps               # 应显示 Up (healthy)
```

停止与卸载：

```bash
docker compose down             # 停止并删除容器（命名卷保留）
docker compose down -v          # 连命名卷一起删（会话记忆清零）
```

### 与直接运行的区别

| 项 | 直接运行 | 容器 |
|---|---|---|
| 仓库路径 | `E:/CA001/Infomat` | 挂载到 `/repo`，**只读** |
| 只读保证 | 仅靠工具集限制 | 工具集限制 + 内核级 `:ro` 拦截 |
| 代理 | `HTTP(S)_PROXY` 环境变量 | `BOT_PROXY=http://host.docker.internal:7892` |
| Claude CLI | 宿主机 Windows 版 | 镜像内 Linux 版，版本号对齐 |
| 会话记忆 | `apps/slack-bot/sessions.json` | 命名卷 `slack-bot-state` |
| 健康检查 | 无 | 心跳文件 + Socket Mode 连接状态 |

### 三个容器特有的坑

1. **`read_only: true` 会锁死 `/tmp`**，而 Claude Code 需要创建 `/tmp/claude-<uid>`，表现为 `EROFS: read-only file system`。已用 `tmpfs: /tmp` 单独放开。
2. **`.env` 里的 `ANTHROPIC_AUTH_TOKEN` 仍是模板占位符**。宿主机上它被用户级环境变量盖住（Node 的 `--env-file` 不覆盖已存在的变量），所以一直没暴露；容器里没有系统环境变量，会直接 401。`compose.yaml` 的 `environment` 段从宿主机同名变量注入真实值，**密钥不进文件**。若宿主机没有该变量，机器人会在启动时直接失败并说明原因。
3. **构建期同样需要代理**，且不能用 `127.0.0.1`（构建容器里那是它自己）。已通过 build args 传入 `host.docker.internal` 形式。

### 开机自启

`restart: unless-stopped` 只管「容器退出后自动重启」，**不等于开机自启**。还需 Docker Desktop 处于随登录启动状态：Settings → General → Start Docker Desktop when you sign in。

### 性能：为什么读的是「卷镜像」而不是直接挂载仓库

Docker Desktop 把 Windows 盘共享给容器的那一层极慢。同一份内容（6,942 个文件）遍历一次：

| 存储位置 | 耗时 | 相对 |
|---|---|---|
| Docker bind mount（读写 Windows 盘） | 4,244 ms | 基准 |
| 宿主机原生 | 409 ms | 快 10× |
| **Docker 卷（VM 内 ext4）** | **8 ms** | **快 530×** |

仓库有 23.6 万个文件。在这个速度下，ripgrep 的全树搜索会撞上 **60 秒硬超时**并返回错误 —— 模型什么都拿不到，还得换个姿势重试，一次会话能白烧 120 秒。

同一道题（「仓库里有哪些脚本负责流程或数据的校验」）逐步优化的实测：

| 阶段 | 耗时 | 说明 |
|---|---|---|
| 改造前（bind mount） | **276 秒** | 两次 ripgrep 60 秒超时，工具耗时占 120 秒 |
| 换成卷镜像 | **19 秒** | 工具耗时降到 0，瓶颈变成「轮数 × 每轮延迟」 |
| 加并行工具调用要求 | **11 秒** | 轮数从 19 降到 7 |

简单问题（只需读单个文件）约 **4 秒 / 3 轮**。

### 为什么会有下限

工具耗时已经归零，剩下的全是模型生成的往返次数：每轮约 0.9 秒，而回答一个仓库问题至少要 5~7 轮（查说明、定位文件、读内容、综合）。**瓶颈是轮数，不是单次速度。**

系统提示里因此写了硬性要求：互不依赖的读取和搜索必须并行发出。实测未加时 19 轮里有 0 轮并行，加上后降到 7 轮 —— 这是收益最大的一条改动，比调低推理档（`--effort`）有效得多。

想再快就只能减少信息收集本身，比如把常用说明文件预置进系统提示，或另建检索索引。那是另一个量级的改动。

### 写入档为什么仍然慢（已知并接受）

写入档不能用镜像卷 —— 镜像卷是给只读档用的快照，而写入档要改真实文件。所以它直接读写宿主机仓库，而那个挂载走的是 **9p 协议**：

```
E:\134 /repo-write 9p rw,...msize=65536,trans=fd...
```

9p 是 WSL2 访问 Windows 盘的固有方式，单条消息上限 64KB。这是 530 倍差距的来源，**不是配置错误**。实测：

| 操作 | 写入档（容器内） | 宿主机原生 |
|---|---|---|
| `git status` | **36 秒** | 3 秒 |
| 全仓目录遍历（15 万文件） | 120 秒 | — |

**日常提问受影响不大**：ripgrep 会跳过 `node_modules`、`artifacts` 等被忽略目录，写入档单次检索实测约 2 秒。真正贵的是 `git status` 这类必须全扫工作区的命令。

2026-10-10 与用户确认：这是 WSL2 + Docker Desktop 访问 Windows 盘的固有代价，换后端能改但会影响仓库里所有容器，**决定接受**。若日后要根治，只有把仓库搬进 WSL2 文件系统或改回宿主机原生运行两条路。

所以架构分成两条路：

- **只读档读 `/repo`** = `repo-mirror` 卷，由 `repo-sync` 容器每 5 分钟从真实仓库 rsync 一份进来（排除 `node_modules`、`artifacts`、`.git` 等生成物）。读的是快照，可能滞后几分钟。
- **写入档写 `/repo-write`** = 真实仓库的 bind mount，改动直接落到宿主机。**代价是写入档的搜索仍然慢** —— 这是为了正确性付的代价，系统提示里已让模型避开全树通配。

首次同步要穿过慢速 bind mount 拉几万个文件，**需要几分钟**。这段时间只读档会看到空仓库。看进度：

```bash
docker compose logs -f repo-sync
```

调整同步间隔（秒，默认 300）：

```bash
SLACK_BOT_SYNC_INTERVAL=60 docker compose up -d repo-sync
```

### 验证只读确实生效

```bash
docker exec infomat-slack-bot touch /repo/__probe   # 应报 Read-only file system
```

## 4. 配置项（`.env`）

| 变量 | 说明 |
|---|---|
| `SLACK_BOT_TOKEN` | 必填，`xoxb-…` |
| `SLACK_APP_TOKEN` | 必填，`xapp-…` |
| `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` | 模型通道；本机已设系统环境变量时可留空 |
| `BOT_PROXY` | **大陆网络下必填**。Socket Mode 的 WebSocket 不读 `HTTP(S)_PROXY`，必须显式指定；留空时依次回退到 `HTTPS_PROXY` / `HTTP_PROXY`（含小写），都没有则直连 |
| `BOT_WORKDIR` | 只读档的工作目录，默认仓库根目录；容器里为 `/repo`（只读挂载） |
| `BOT_WRITE_WORKDIR` | 写入档的工作目录；容器里为 `/repo-write`（可写挂载） |
| `BOT_WRITE_USERS` | **留空 = 所有人只读**。逗号分隔的 Slack 用户 ID，只有这些人拿到写入档 |
| `BOT_WRITE_TOOLS` | 写入档可用工具，默认 `Read,Grep,Glob,Edit,Write`（不含 Bash） |
| `BOT_MAX_BUDGET_USD` | 单次提问预算上限，默认 `0.5`。**注意**：这是 CLI 按 Anthropic 价目做的估算，模型走 DeepSeek 时实际计费低于此值，只宜当作熔断阈值而非账单依据 |
| `BOT_TIMEOUT_MS` | 单次回答超时，默认 `600000`（10 分钟）。**别设太短**：全仓库检索类问题实测要 15 轮、4~5 分钟，180 秒会把这类问题误判成超时 |
| `BOT_MAX_CONCURRENT` | 同时处理的问题数上限，默认 3 |
| `BOT_ALLOWED_USERS` / `BOT_ALLOWED_CHANNELS` | 逗号分隔的白名单；留空 = 工作区内所有人可用 |
| `BOT_SESSIONS_FILE` | 会话记忆文件路径，默认 `sessions.json` |

## 4.1 写入权限（按人分配）

默认**所有人只读**。给特定的人开写入：

1. 查自己的 Slack 用户 ID：点自己头像 → 个人资料 → 右上角 `⋯` → 复制成员 ID（形如 `U01ABC2DEF3`）。
2. 写进 `.env`：`BOT_WRITE_USERS=U01ABC2DEF3`
3. `docker compose up -d`（只改 `.env` 不需要 `--build`）。

### 权限按「提问者」判定，不按「线程」

这是本功能的安全关键。若把权限绑在线程上，负责人用写入档开过的线程，同事进来追问就会继承写入能力。本实现的处理：

- 每条消息都按 `event.user` 单独判定档位；
- 当前档位与该线程已存会话的档位不一致时，**强制重建会话**，绝不 `--resume`。

### 两档对比

| | 只读档 | 写入档 |
|---|---|---|
| 谁能用 | 工作区内所有人 | 仅 `BOT_WRITE_USERS` 列出的用户 |
| 可用工具 | `Read,Grep,Glob` | `BOT_WRITE_TOOLS`（默认含 `Edit,Write`） |
| 工作目录 | `/repo`（`:ro` 挂载） | `/repo-write`（可写挂载） |
| 权限模式 | `dontAsk`（需批准的一律拒绝） | `acceptEdits`（编辑免交互落盘） |
| 内核级保护 | **有**，`/repo` 物理不可写 | 无（设计如此） |

两档指向**同一份仓库**——compose 把宿主目录挂了两次，只是一个只读、一个可写。你在写入档改的文件，同事在只读档立刻能读到。

### Bash 能力

写入档默认**不含** `Bash`，只能改文件。开启方式：

```
BOT_WRITE_TOOLS=Read,Grep,Glob,Edit,Write,Bash
```

镜像里已装 git（2.39.5）并配好 `safe.directory`，可直接用 `git status` / `diff` / `log`。

**开启前必须知道的四件事：**

1. **CLI 自带的命令过滤不是安全边界。** 实测同一条 `rm -rf <路径>`：带 `&&` 链式写法被拒，去掉 `&&` 就放行。它是模式匹配，换个写法即可绕过。
2. **机器人能删你的文件。** 容器里没有 `curl` / `wget`，外发数据不容易；但改坏、删掉工作区文件是完全够用的。
3. **这个仓库随时可能有上千处未提交改动。** 一次误操作的代价是几天的活白做。**开启前先 `git stash` 或 `git commit` 存档。**
4. 系统提示里已要求它停在只读命令（`git status`/`diff`/`log`），丢弃类操作（`commit`/`reset`/`clean`/`checkout --`/`stash`/`push`/`rm`）必须先经你同意。但这是提示词层面的约束，**不是技术强制**。

容器内可用的命令：`bash`、`git`、`node`、`npm`、`grep`、`sed`、`awk`、`find`、`sort`、`xargs`、`tar`、`gzip`、`diff`。不可用：`curl`、`wget`、`make`、`python3`、`jq`。

### 写入档的风险提示

写入档直接改你工作区里的文件，**没有撤销**。这个仓库当前有大量未提交改动，建议先 `git commit` 或 `git stash` 存个档，或者把写入目录指向一个 git worktree，出事好回退。

## 5. 数据边界

- **不写仓库**：子进程无写入工具；`BOT_WORKDIR` 内的文件只被读取。
- **不落业务数据**：应用自身只写 `sessions.json`（Slack 线程 → Claude 会话 ID 的映射），已在 `.gitignore` 中。
- **凭据不入库**：`.env` 已在 `.gitignore` 中，真实 token 与 API key 不得提交。
- **不外发**：机器人只把答案发回发起提问的 Slack 线程，不做定时推送或群发。
- **会话记忆范围**：同一 Slack 线程内追问会接续上下文；不同线程之间互不可见。

## 6. 已知限制

- 只能在有代理出口、且 `slack.com` 可达的机器上运行；电脑休眠或关机即掉线。
- **最常见故障：WebSocket 连不上而 HTTP 正常。** 表现为启动时刷 `SMWebsocketError` 但 `auth.test` 能成功。原因是 Slack 的 HTTP 走 Node 原生 fetch（会读代理环境变量），而 Socket Mode 的 WebSocket 走 npm 版 undici（不读）。修复方式见 `src/index.js` 中构造 `SocketModeReceiver` 的注释——必须显式注入 `dispatcher`，设置 undici 全局 dispatcher 是无效的，因为 `@slack/socket-mode` 会自建 Agent 顶掉它。
- 本机 Claude Code 的模型通道是 DeepSeek 兼容端点，`claude -p` 每次会向 stderr 打印一行 `[claude-code:unrecognized_model]` 诊断，属正常现象，不影响解析（stdout 始终是单行纯净 JSON）。
- **响应时间差异很大**：简单问题十几秒；需要全仓库检索的问题实测可跑到 15 轮、4~5 分钟。等待期间占位消息每 45 秒刷新一次时间戳（「已 N 秒」），刷不动才是真卡住。
- Slack 单条消息约 4000 字符，超长答案会按行自动切成多条接续发送。
- 机器人只回答，不主动参与；不会读取未被 @ 的频道消息。
