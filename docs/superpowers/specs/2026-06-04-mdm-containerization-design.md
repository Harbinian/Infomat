# MDM 平台容器化设计

> 编制日期：2026-06-04
> 定位：本地开发单机场景的 Docker 化方案，不涉及准生产/生产
> 适用范围：信息化项目组成员个人开发与测试
> 状态：方案 A（极简开发镜像），无 BuildKit 魔法、无多阶段、无 root 切换

---

## 一、目标与边界

### 1.1 目标

- 一行命令启动整套 MDM 平台（`docker compose up`）
- 改代码后 nodemon 自动重载，无需重建镜像
- SQLite 数据持久化在主机磁盘，便于备份与迁移
- 密钥不入库不入镜像，通过 `.env` 注入

### 1.2 明确不做

- 多阶段构建、BuildKit cache mount、非 root 用户、healthcheck
- 多 compose profile（默认仅 1 个主服务）
- CI/CD 集成、自动备份、镜像版本 tag 管理、日志轮转
- 准生产/生产部署（TLS、反向代理、密钥管理服务等）

### 1.3 范围

仅 `apps/mdm-platform/` 子项目；甘特图、H5 手册、PMO 驾驶舱等其他子项目不在本设计范围。

---

## 二、文件清单

所有新文件落在 `apps/mdm-platform/` 下，不污染仓库根：

```
apps/mdm-platform/
├── Dockerfile                      # 新增
├── docker-compose.yml              # 新增
├── docker-entrypoint.sh            # 新增
├── .dockerignore                   # 新增
├── .env.example                    # 新增（进 git）
├── .env                            # 新增（不进 git，开发者本地）
├── .gitignore                      # 追加一行 .env
├── server/                         # 既有，不动
├── public/                         # 既有，不动
├── scripts/                        # 既有，不动
└── data/                           # 既有，bind mount 目标
```

---

## 三、服务拓扑

```
┌────────────────────────── Docker 主机(Windows 11) ──────────────────────────┐
│                                                                              │
│   apps/mdm-platform/   (bind mount :./ → /app)                               │
│   ├── server/, public/, scripts/, package.json   ◄──── 实时反映 ─────┐      │
│   └── data/                                       ◄──── 持久化 ───┐  │      │
│                                                                  │  │      │
│   ┌─────────── mdm-platform container (linux/amd64) ──────────┐  │  │      │
│   │                                                           │  │  │      │
│   │   /app/server/, /app/public/  ◄───────────────────────────┼──┘  │      │
│   │   /app/data/                  ◄───────────────────────────┼─────┘      │
│   │   /app/node_modules (named volume 覆盖)                  │            │
│   │                                                           │            │
│   │   docker-entrypoint.sh                                    │            │
│   │     ├── node scripts/init-db.js    (建管理员)             │            │
│   │     └── exec npm run dev -- --legacy-watch                │            │
│   │                                                           │            │
│   │   3000  ◄──────────────►  0.0.0.0:3000  ◄─── 浏览器/局域网 │            │
│   └───────────────────────────────────────────────────────────┘            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 四、镜像构建

### 4.1 Dockerfile

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=3000 \
    NODE_ENV=development \
    MDM_DB_PATH=/app/data/platform.db

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

要点：

- **ENTRYPOINT 放在 `/usr/local/bin/`**：bind mount 覆盖的是 `/app`，放容器专属路径可避免被宿主文件意外遮蔽
- **`npm ci` 不带 `--omit=dev`**：开发期需要 nodemon（devDep），全量装开销可接受
- **不显式 `USER node`**：本地开发 root 跑无安全代价，反而能避开 Windows bind mount 的 UID/GID 不一致问题
- **不用多阶段、无 BuildKit cache mount**：小项目 `npm ci` 5–8 秒，多阶段换不来可读性
- **`COPY server public scripts`**：表面看和 bind mount 重复，意义是镜像能独立运行（不挂载也能起来），便于脱机诊断

### 4.2 `.dockerignore`

```
node_modules
data
.env
.env.*
!.env.example
docs
tmp-server-*.log
.smoke-cookie.txt
*.md
logo.png
.git
.gitignore
```

### 4.3 `docker-entrypoint.sh`

```sh
#!/bin/sh
set -e

mkdir -p "$(dirname "$MDM_DB_PATH")"
node scripts/init-db.js
exec npm run dev -- --legacy-watch
```

- `mkdir -p` 兜底，确保 `MDM_DB_PATH` 父目录存在
- `init-db.js` 幂等：有 `MDM_ADMIN_*` env 就建管理员，没有就 `process.exit(0)` 跳过
- `exec` 替换 shell 进程，让 SIGTERM 直接到 nodemon
- `--legacy-watch` 强制 polling，解决 Windows bind mount 上 inotify 不可靠的问题

---

## 五、运行时编排

### 5.1 `docker-compose.yml`

```yaml
services:
  mdm:
    build: .
    container_name: mdm-platform
    ports:
      - "3000:3000"                      # 局域网可访问
    env_file:
      - .env
    environment:
      NODE_ENV: development
      PORT: "3000"
      MDM_DB_PATH: /app/data/platform.db
    volumes:
      - ./:/app                          # bind mount 源
      - mdm_node_modules:/app/node_modules  # named volume 覆盖
    working_dir: /app
    tty: true
    stdin_open: true
    restart: unless-stopped

volumes:
  mdm_node_modules:
```

### 5.2 关键设计点

| 关注点 | 做法 | 原因 |
|--------|------|------|
| **node_modules 隔离** | bind mount 先于 named volume | 后挂载覆盖先挂载，`/app/node_modules` 始终是 Linux 编译版，Windows host 污染进不来 |
| **.env vs environment** | `env_file: .env` 放第一项 | compose 优先级 `environment < env_file < shell`，.env 永远赢 |
| **端口绑定 0.0.0.0** | 不写 `127.0.0.1:` 前缀 | 局域网可访问，方便同事/手机扫码预览 |
| **容器名固定** | `container_name: mdm-platform` | `docker logs mdm-platform` 比 hash 友好 |
| **`tty+stdin_open`** | 保活 + 允许 `docker attach` | nodemon 出错能现场看 stack |
| **restart: unless-stopped** | 意外崩溃自启，`docker compose stop` 后不会自启 | 开发期省心可控 |
| **不配 healthcheck** | 省略 | 单服务单机，看日志就够 |

### 5.3 `.env.example`

```env
# ============================================
# MDM 平台 · 容器化环境变量模板
# 用法: cp .env.example .env,再填入实际值
# .env 文件本身不进 git
# ============================================

# ---- 必填:首启动管理员 ----
MDM_ADMIN_EMPLOYEE_NO=admin-001
MDM_ADMIN_PASSWORD=please-change-me-12+chars
MDM_ADMIN_NAME=系统管理员

# ---- 必填:Express 会话签名密钥 ----
# 长度 ≥ 32 字符的随机串,可执行: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
SESSION_SECRET=replace-with-long-random-string
```

`PORT` / `MDM_DB_PATH` 在 compose 里已有默认值，不强制在 .env 写。

### 5.4 `.gitignore` 追加

```
.env
```

---

## 六、开发工作流

### 6.1 一次性启动

```bash
cd apps/mdm-platform
cp .env.example .env                                  # 填入管理员工号/密码/SESSION_SECRET
docker compose up --build
# 浏览器访问 http://<本机IP>:3000
```

### 6.2 日常命令

| 想做的事 | 命令 |
|----------|------|
| 启动（后台） | `docker compose up -d` |
| 实时日志 | `docker compose logs -f mdm` |
| 进入容器 shell | `docker exec -it mdm-platform sh` |
| 改完代码，等 nodemon 自动重载 | 啥也不用干，等 1–2 秒 |
| .env / entrypoint 改了 | `docker compose restart mdm` |
| package.json 改了（新增依赖） | `docker compose up --build` |
| 跑单个测试 + 隔离 DB | `docker compose exec -e MDM_DB_PATH=/tmp/test-iso.db mdm npm run test:org` |
| 跑全冒烟 + 隔离 DB | `docker compose exec -e MDM_DB_PATH=/tmp/smoke.db mdm npm run smoke` |
| 停服务（保留数据/卷） | `docker compose down` |
| 停服务 + 清 node_modules 卷 | `docker compose down -v` |
| 重建 SQLite 干净库 | `rm apps/mdm-platform/data/platform.db* && docker compose restart mdm` |

### 6.3 Windows 专项

| 现象 | 原因 | 已规避方式 |
|------|------|------------|
| 改完文件 nodemon 没反应 | WSL2/Hyper-V bind mount 的 inotify 不可靠 | entrypoint 传 `--legacy-watch`，polling 模式 1 秒轮询 |
| 容器里看到旧的 node_modules | 命名 volume 没覆盖 bind mount | mount 顺序保证 volume 后挂、覆盖先挂的 bind |
| `port is already allocated` | 3000 被其他进程占 | `netstat -ano \| findstr :3000` 找占用 PID |

### 6.4 速查（一行流）

```bash
docker compose -f apps/mdm-platform/docker-compose.yml up -d --build   # 起
docker compose -f apps/mdm-platform/docker-compose.yml logs -f mdm       # 看
docker compose -f apps/mdm-platform/docker-compose.yml down             # 停
```

---

## 七、错误处理与边界

### 7.1 启动期常见坑

| 症状 | 触发 | 排错 | 修复 |
|------|------|------|------|
| 容器秒退，日志 `MDM_ADMIN_PASSWORD must be at least 12 characters` | `.env` 密码不足 12 字符 | `docker logs mdm-platform \| tail -20` | 改 `.env` + `docker compose restart mdm` |
| 容器起来但 admin 登不进去 | 漏配 `MDM_ADMIN_EMPLOYEE_NO`（init-db 静默跳过） | `docker exec mdm-platform sqlite3 /app/data/platform.db "SELECT employee_no FROM users WHERE role='admin'"` | 补 env 后删 DB 重启，或手动 `INSERT` |
| `bind: address already in use` | 3000 被占 | `netstat -ano \| findstr :3000` | 杀占用 PID，或把 compose 端口改 `3001:3000` |
| 主页空白，Console 报 404 | 代码错误致 server 抛错 | `docker compose logs -f mdm` | 改回正确代码；或 `docker compose restart mdm` |

### 7.2 运行期坑

- **新增 `server/routes/xxx.js` 接口不生效**：`index.js` 用 `registerRouteIfExists()` 在启动时一次性扫描，需手动 `docker compose restart mdm`
- **nodemon 重启循环**：代码语法错误致 server 启动即挂；查 `docker logs` 改对代码即停
- **`NODE_MODULE_VERSION mismatch`**：极少数情况，host 重装 Node 或更新 Docker Desktop 导致镜像内预编译二进制失配；`docker compose down -v && docker compose up --build` 强制重装
- **WAL 文件残留（`platform.db-wal` / `-shm`）**：崩溃时可能未清理，SQLite 重启后自动恢复；反复失败可手动 `rm apps/mdm-platform/data/platform.db-*`

### 7.3 持久化边界

- 容器删除 ≠ 数据丢失：`./apps/mdm-platform/data` 是 bind mount 在 host 上，`docker compose down` 只删容器
- 只有 `rm -rf apps/mdm-platform/data` 才会丢库；`.gitignore` 里的 `data/*.db` 也挡着入库
- **不要同时开两个容器挂同一个 `data/`**：SQLite 文件锁，多进程并发写会损坏库

### 7.4 故意不做

| 不做 | 原因 |
|------|------|
| 容器内非 root 运行 | Windows bind mount UID/GID 不一致 |
| HEALTHCHECK | 单服务单机，看日志够用 |
| 自动备份 SQLite | 测试容器，数据可重建 |
| 镜像版本 tag | 单机自用，`mdm-platform:latest` 够用 |
| 日志轮转 | 单机跑，磁盘满前能察觉 |

---

## 八、测试策略

### 8.1 原则

- HTTP 测试必须在跑着 server 的容器内执行
- `MDM_DB_PATH` 是隔离的唯一开关，遵循项目既有 `test-db-path-isolation.js` 约定

### 8.2 日常测试命令

| 测试 | 命令 |
|------|------|
| 跑单个测试 + 隔离 DB | `docker compose exec -e MDM_DB_PATH=/tmp/test-iso.db mdm npm run test:org` |
| 跑全冒烟 + 隔离 DB | `docker compose exec -e MDM_DB_PATH=/tmp/smoke.db mdm npm run smoke` |
| 跑流程治理一组测试 | `docker compose exec -e MDM_DB_PATH=/tmp/pg.db mdm npm run test:process-governance` |
| 跑前端静态资源测试 | `docker compose exec mdm npm run test:frontend` |
| 重置主库后重测 | `rm apps/mdm-platform/data/platform.db* && docker compose restart mdm && sleep 2 && docker compose exec -e MDM_DB_PATH=/tmp/iso.db mdm npm run smoke` |

> **关键点**：`compose exec -e MDM_DB_PATH=...` **只影响测试脚本自己**，**不会**改变 server 正在使用的 DB。这是隔离的关键，别误以为会污染主库。

### 8.3 已知坑与对策

| 现象 | 原因 | 怎么避 |
|------|------|--------|
| 测试改完数据，主库也跟着变 | 部分早期测试脚本没接 `MDM_DB_PATH` | 跑测试**永远带 `-e MDM_DB_PATH=/tmp/...`**；CLAUDE.md 已规定不直接跑会污染主库的旧式测试 |
| `exec` 进去时 server 还没 ready | 首次 build 后第一次 exec 可能慢 | 等几秒再 exec，或 `sleep 2` 串起来 |
| 想重置测试环境反复跑 | 单次 `exec` 用 `/tmp/...db`，容器重启 `/tmp` 就清 | 不需要额外清理；用 bind mount 路径则自己 `rm` |

### 8.4 可选升级：一次性 test profile

```yaml
  mdm-test:
    profiles: ["test"]
    build: .
    container_name: mdm-platform-test
    environment:
      NODE_ENV: test
      PORT: "3001"
      MDM_DB_PATH: /tmp/mdm-test.db
      SESSION_SECRET: test-only-not-secret
      MDM_ADMIN_EMPLOYEE_NO: test-admin
      MDM_ADMIN_PASSWORD: test-only-password-12+chars
    volumes:
      - ./:/app
      - mdm_node_modules:/app/node_modules
    working_dir: /app
    command: >-
      sh -c "node scripts/init-db.js &&
             node server/index.js &
             sleep 3 &&
             npm run smoke &&
             kill %1"
    restart: "no"
```

跑法：`docker compose --profile test up --abort-on-container-exit`

**当前不做**。`docker compose exec -e MDM_DB_PATH=/tmp/...` 一行就够；真到了频繁跑测试、嫌麻烦的时候再 paste 这段 profile。

---

## 九、YAGNI 总结

明确不引入：多阶段、BuildKit cache、rootless、healthcheck、CI 集成、tag 管理、日志轮转、备份、test profile（默认）、Makefile。

引入它们的标准：单机自用场景出现明显摩擦（如 `npm ci` 单次超 30 秒、磁盘满、忘记启服务）时再加。
