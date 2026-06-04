# MDM 平台容器化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `apps/mdm-platform` 通过 `docker compose up --build` 一键起,带 nodemon 热重载、SQLite 持久化、`.env` 注入密钥。

**Architecture:** 单阶段 `node:20-slim` 镜像 + bind mount 源到 `/app` + named volume 覆盖 `/app/node_modules` 解决 Windows host / Linux container 跨平台二进制冲突;entrypoint 脚本 `init-db` 后 `exec npm run dev -- --legacy-watch` 跑 nodemon(polling 模式适配 Windows bind mount)。

**Tech Stack:** Docker Desktop 29.5.2、Docker Compose v2、Node.js 20-slim、Express 4.18、better-sqlite3 12.9、nodemon 3.x。

**Spec:** 详见 `docs/superpowers/specs/2026-06-04-mdm-containerization-design.md`。

**前置条件:**
- Docker Desktop 已安装并运行(本机已确认:Engine 29.5.2)
- 工作目录在仓库根(`E:\CA001\Infomat`)
- 当前分支:`codex/pmo-deliverable-dashboard`(可工作分支即可,无特殊要求)

**注意事项:**
- 计划只创建/修改 `apps/mdm-platform/` 下的文件,**不动**仓库根的现有未提交改动
- 每次 `git add` 用具体文件路径,不用 `git add -A` 或 `git add .`
- 容器内 `data/` 是 bind mount 到 host 的 `apps/mdm-platform/data/`,持久化数据走 host 磁盘

---

### Task 1: 创建 .dockerignore

**Files:**
- Create: `apps/mdm-platform/.dockerignore`

- [ ] **Step 1: 创建文件,写入排除规则**

在 `apps/mdm-platform/.dockerignore` 写入:

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

- [ ] **Step 2: 验证文件内容**

```bash
cat apps/mdm-platform/.dockerignore
```

Expected: 终端打印上面 11 行内容,顺序与文件一致。

- [ ] **Step 3: Commit**

```bash
git add apps/mdm-platform/.dockerignore
git commit -m "chore(mdm): add .dockerignore for container build"
```

---

### Task 2: 创建 docker-entrypoint.sh

**Files:**
- Create: `apps/mdm-platform/docker-entrypoint.sh`

- [ ] **Step 1: 创建脚本文件**

在 `apps/mdm-platform/docker-entrypoint.sh` 写入:

```sh
#!/bin/sh
set -e

mkdir -p "$(dirname "$MDM_DB_PATH")"
node scripts/init-db.js
exec npm run dev -- --legacy-watch
```

- [ ] **Step 2: 给予可执行权限**

```bash
chmod +x apps/mdm-platform/docker-entrypoint.sh
```

Expected: 命令无输出,无报错。

- [ ] **Step 3: 验证 shell 语法**

```bash
sh -n apps/mdm-platform/docker-entrypoint.sh
```

Expected: 无输出(语法正确)。

- [ ] **Step 4: 验证可执行位**

```bash
ls -l apps/mdm-platform/docker-entrypoint.sh
```

Expected: 输出形如 `-rwxr-xr-x ... docker-entrypoint.sh`,首字符为 `-`,第二段是 `rwx`。

- [ ] **Step 5: Commit**

```bash
git add apps/mdm-platform/docker-entrypoint.sh
git commit -m "chore(mdm): add docker entrypoint script with init-db + nodemon"
```

---

### Task 3: 创建 Dockerfile

**Files:**
- Create: `apps/mdm-platform/Dockerfile`

- [ ] **Step 1: 创建文件**

在 `apps/mdm-platform/Dockerfile` 写入:

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

- [ ] **Step 2: 验证镜像可构建(可能拉取 node:20-slim,首次 ~1-2 分钟)**

```bash
cd apps/mdm-platform
docker build -t mdm-platform:dev-build-check .
cd ../..
```

Expected: 末尾输出 `naming to docker.io/library/mdm-platform:dev-build-check` 或类似成功消息,无 `ERROR` 字样。

- [ ] **Step 3: 清理验证用镜像**

```bash
docker rmi mdm-platform:dev-build-check
```

Expected: 无输出或 `Untagged: mdm-platform:dev-build-check`。

- [ ] **Step 4: Commit**

```bash
git add apps/mdm-platform/Dockerfile
git commit -m "chore(mdm): add Dockerfile based on node:20-slim"
```

---

### Task 4: 创建 docker-compose.yml

**Files:**
- Create: `apps/mdm-platform/docker-compose.yml`

- [ ] **Step 1: 创建文件**

在 `apps/mdm-platform/docker-compose.yml` 写入:

```yaml
services:
  mdm:
    build: .
    container_name: mdm-platform
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      NODE_ENV: development
      PORT: "3000"
      MDM_DB_PATH: /app/data/platform.db
    volumes:
      - ./:/app
      - mdm_node_modules:/app/node_modules
    working_dir: /app
    tty: true
    stdin_open: true
    restart: unless-stopped

volumes:
  mdm_node_modules:
```

- [ ] **Step 2: 验证 compose 文件语法**

```bash
cd apps/mdm-platform
docker compose config
cd ../..
```

Expected: 输出解析后的 YAML,包含 `services.mdm` 块,有 `name: mdm-platform` 容器名,`volumes` 块有 `mdm_node_modules`。**不要有 `ERROR` 或 `WARN`。**

- [ ] **Step 3: Commit**

```bash
git add apps/mdm-platform/docker-compose.yml
git commit -m "chore(mdm): add docker-compose for local dev"
```

---

### Task 5: 创建 .env.example

**Files:**
- Create: `apps/mdm-platform/.env.example`

- [ ] **Step 1: 创建文件**

在 `apps/mdm-platform/.env.example` 写入:

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

- [ ] **Step 2: 验证文件存在且 4 个必填变量都在**

```bash
grep -E '^(MDM_ADMIN_EMPLOYEE_NO|MDM_ADMIN_PASSWORD|MDM_ADMIN_NAME|SESSION_SECRET)=' apps/mdm-platform/.env.example
```

Expected: 4 行输出,每行一个变量赋值。

- [ ] **Step 3: Commit**

```bash
git add apps/mdm-platform/.env.example
git commit -m "chore(mdm): add .env.example template"
```

---

### Task 6: 更新 .gitignore 屏蔽 .env

**Files:**
- Modify: `apps/mdm-platform/.gitignore`(末尾追加一行)

- [ ] **Step 1: 查看当前 .gitignore**

```bash
cat apps/mdm-platform/.gitignore
```

Expected: 当前内容是:
```
node_modules/
data/*.db
data/*.db-*
*.log
```

- [ ] **Step 2: 追加 `.env` 行**

```bash
printf '\n.env\n' >> apps/mdm-platform/.gitignore
```

Expected: 无输出。

- [ ] **Step 3: 验证追加成功且不重复**

```bash
cat apps/mdm-platform/.gitignore
```

Expected: 文件末尾多了一行 `.env`,且仅出现一次:

```
node_modules/
data/*.db
data/*.db-*
*.log

.env
```

- [ ] **Step 4: Commit**

```bash
git add apps/mdm-platform/.gitignore
git commit -m "chore(mdm): ignore .env to keep secrets out of git"
```

---

### Task 7: 创建实际 .env 并首次启动

**Files:**
- Create: `apps/mdm-platform/.env`(本地,不入库)

- [ ] **Step 1: 复制模板**

```bash
cp apps/mdm-platform/.env.example apps/mdm-platform/.env
```

- [ ] **Step 2: 生成实际密钥并写入 .env**

```bash
cd apps/mdm-platform
# 生成 SESSION_SECRET
SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
# 用 sed 替换占位符(Windows + bash 环境下,GIT Bash 可用 sed -i)
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
sed -i "s|^MDM_ADMIN_PASSWORD=.*|MDM_ADMIN_PASSWORD=dev-admin-pwd-1234|" .env
sed -i "s|^MDM_ADMIN_EMPLOYEE_NO=.*|MDM_ADMIN_EMPLOYEE_NO=devadmin|" .env
cd ../..
```

Expected: 无输出,所有 sed 命令成功。

- [ ] **Step 3: 验证 .env 已生效(仅在本机查看,不打印到日志)**

```bash
grep -E '^(SESSION_SECRET|MDM_ADMIN_PASSWORD|MDM_ADMIN_EMPLOYEE_NO)=' apps/mdm-platform/.env
```

Expected: 3 行,SESSION_SECRET 是 96 字符的十六进制串,MDM_ADMIN_PASSWORD 是 `dev-admin-pwd-1234`,MDM_ADMIN_EMPLOYEE_NO 是 `devadmin`。

- [ ] **Step 4: 确认 .env 未被 git 追踪**

```bash
git status --short apps/mdm-platform/.env
```

Expected: 无输出(`.env` 已被 `.gitignore` 屏蔽,git 不追踪)。

- [ ] **Step 5: 首次构建并启动(后台)**

```bash
cd apps/mdm-platform
docker compose up -d --build
cd ../..
```

Expected: 末尾出现 `Container mdm-platform  Started`,无 ERROR。

- [ ] **Step 6: 等待服务就绪**

```bash
sleep 5
```

无输出,等待 5 秒让 nodemon 完成首次启动。

- [ ] **Step 7: 验证健康检查**

```bash
curl -sS http://localhost:3000/api/health
```

Expected: 输出 `{"status":"ok"}`。

- [ ] **Step 8: 查看启动日志确认 init-db 创建了管理员**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml logs mdm | grep -E "(Admin account|MDM 平台|nodemon)"
```

Expected: 至少出现以下几行(顺序可能略有差异):
- `Admin account created: devadmin`(init-db 成功)
- `MDM 平台 running on http://localhost:3000`
- `nodemon` 启动相关行

---

### Task 8: 验证热重载

- [ ] **Step 1: 在容器内 /app/server/index.js 追加一行临时 console.log**

```bash
# 用 sed 在 app.listen 之前注入一行日志
cd apps/mdm-platform
docker exec mdm-platform sh -c "sed -i 's|app.listen(PORT|console.log(\"===HOT-RELOAD-MARKER===\"); app.listen(PORT|' server/index.js"
cd ../..
```

Expected: 无输出。

- [ ] **Step 2: 等待 nodemon 检测变化(轮询间隔 1 秒)**

```bash
sleep 4
```

- [ ] **Step 3: 验证日志里出现新标记**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml logs mdm --tail 30 | grep "HOT-RELOAD-MARKER"
```

Expected: 至少一行 `===HOT-RELOAD-MARKER===` 输出。如果没看到,再 `sleep 3` 重试。

- [ ] **Step 4: 验证服务依然健康**

```bash
curl -sS http://localhost:3000/api/health
```

Expected: 输出 `{"status":"ok"}`(服务没崩)。

- [ ] **Step 5: 还原 server/index.js 改动**

```bash
cd apps/mdm-platform
docker exec mdm-platform sh -c "sed -i '/===HOT-RELOAD-MARKER===/d' server/index.js"
cd ../..
```

Expected: 无输出。

- [ ] **Step 6: 确认还原成功**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml logs mdm --tail 20 | grep -c "HOT-RELOAD-MARKER"
```

Expected: 数字 ≥ 1(说明历史日志还在,但**新**启动不会再有)。用 `git diff apps/mdm-platform/server/index.js` 应显示无差异。

---

### Task 9: 验证数据持久化(bind mount)

- [ ] **Step 1: 验证登录接口可用**

```bash
curl -sS -X POST http://localhost:3000/api/org/login \
  -H "Content-Type: application/json" \
  -d '{"employee_no":"devadmin","password":"dev-admin-pwd-1234"}'
```

Expected: HTTP 200,返回 `{"id":1,"name":"系统管理员","role":"admin",...}` 之类(JSON 含 `id` 和 `role` 字段)。如果返回 401,看 `docker compose logs mdm | tail -20` 检查 init-db 是否真的创建了管理员。

- [ ] **Step 2: 直接往主库写一条标记行(确认 bind mount 真实工作)**

```bash
docker exec mdm-platform node -e "
const db = require('better-sqlite3')('/app/data/platform.db');
db.prepare('INSERT OR IGNORE INTO users (employee_no, name, password_hash, role) VALUES (?, ?, ?, ?)').run('persist-test-user', 'persist-test', 'x', 'submitter');
console.log('inserted');
"
```

Expected: 输出 `inserted`。

- [ ] **Step 3: 重启容器(模拟崩溃后重启)**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml restart mdm
```

Expected: `Container mdm-platform  Started`。

- [ ] **Step 4: 等待服务就绪**

```bash
sleep 5
curl -sS http://localhost:3000/api/health
```

Expected: `{"status":"ok"}`。

- [ ] **Step 5: 在 host 上直接查 SQLite,验证数据文件真实存在于 host**

```bash
ls -la apps/mdm-platform/data/
```

Expected: 看到 `platform.db`(以及可能的 `platform.db-wal`、`platform.db-shm`)文件,且修改时间是最近(刚才创建过数据)。

- [ ] **Step 6: 在 host 上直接读 SQLite,确认刚才的标记行还在**

```bash
docker exec mdm-platform node -e "
const db = require('better-sqlite3')('/app/data/platform.db');
const r = db.prepare(\"SELECT employee_no, role FROM users WHERE employee_no='persist-test-user'\").get();
console.log(r ? 'persisted: ' + JSON.stringify(r) : 'LOST');
"
```

Expected: 输出 `persisted: {"employee_no":"persist-test-user","role":"submitter"}`。

- [ ] **Step 7: 清理标记行(可选,避免污染)**

```bash
docker exec mdm-platform node -e "
const db = require('better-sqlite3')('/app/data/platform.db');
db.prepare(\"DELETE FROM users WHERE employee_no='persist-test-user'\").run();
console.log('cleaned');
"
```

Expected: 输出 `cleaned`。

---

### Task 10: 验证测试隔离(MDM_DB_PATH)

- [ ] **Step 1: 跑单个测试,使用隔离 DB**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml exec -e MDM_DB_PATH=/tmp/iso-org.db mdm npm run test:org
```

Expected: 测试通过(exit 0),输出形如 `✓ org routes ... passed`。**关键**:脚本里所有 sqlite 操作走的是 `/tmp/iso-org.db`,不是主库。

- [ ] **Step 2: 确认主库未被污染**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml exec mdm sh -c \
  'ls -la /app/data/ && echo "---tmp---" && ls -la /tmp/iso-org.db 2>&1 | head -3'
```

Expected:
- `/app/data/` 里有 `platform.db` 等主库文件
- `/tmp/iso-org.db` 在容器内存在(测试刚生成的临时库)
- 两个文件互不干扰

- [ ] **Step 3: 跑全冒烟测试**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml exec -e MDM_DB_PATH=/tmp/iso-smoke.db mdm npm run smoke
```

Expected: 冒烟测试通过(exit 0),主库 `/app/data/platform.db` 未被修改(通过 `/tmp/iso-smoke.db` 隔离)。

---

### Task 11: 验证容器内 nodemon 用 polling 模式

- [ ] **Step 1: 确认 nodemon 进程用了 --legacy-watch**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml exec mdm sh -c \
  'ps -ef | grep -E "node|nodemon" | grep -v grep'
```

Expected: 输出包含 `npm run dev -- --legacy-watch` 或 `nodemon` 启动参数含 `--legacy-watch`。

- [ ] **Step 2: 确认容器内 /app/node_modules 是 Linux 版本(不是 Windows 污染)**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml exec mdm sh -c \
  'ls -la /app/node_modules/better-sqlite3/build/Release/ 2>&1 | head -5'
```

Expected: 看到 `better_sqlite3.node` 文件存在。如果是空或报"No such file",说明 named volume 没正确挂载,需 `docker compose down -v && docker compose up -d --build` 重来。

- [ ] **Step 3: 确认容器在 host 网络 0.0.0.0:3000 监听**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml port mdm 3000
```

Expected: 输出 `0.0.0.0:3000`(表示对外暴露在所有接口)。

---

### Task 12: 收尾:停服务 + 清理验证残留

- [ ] **Step 1: 停服务(保留数据卷)**

```bash
docker compose -f apps/mdm-platform/docker-compose.yml down
```

Expected: `Container mdm-platform  Removed`,`Volume mdm-platform_mdm_node_modules  ...`(保留)。

- [ ] **Step 2: 确认主库文件还在 host 上**

```bash
ls -la apps/mdm-platform/data/
```

Expected: `platform.db` 仍存在(数据没丢)。

- [ ] **Step 3: 最终 git 状态确认**

```bash
git status --short apps/mdm-platform/
```

Expected: 看到若干 `A`/`M` 行(Dockerfile、.dockerignore、.env.example、docker-compose.yml、docker-entrypoint.sh、.gitignore 改动),**不**应有 `apps/mdm-platform/.env`(.env 已屏蔽)。

- [ ] **Step 4: 最终提交(如有遗漏)**

```bash
git status --short apps/mdm-platform/
# 如果上面有任何未跟踪或未提交的改动:
# git add <具体文件>
# git commit -m "chore(mdm): finalize containerization setup"
```

Expected: 工作区在 `apps/mdm-platform/` 下是干净的(已 commit)。

---

## 验收清单

执行完所有 Task 后,逐条确认:

- [ ] `apps/mdm-platform/Dockerfile` 存在并能 `docker build`
- [ ] `apps/mdm-platform/docker-compose.yml` 存在且 `docker compose config` 无错
- [ ] `apps/mdm-platform/.env.example` 存在,4 个必填变量齐全
- [ ] `apps/mdm-platform/.gitignore` 含 `.env` 行
- [ ] `apps/mdm-platform/.env` **存在**但**未被 git 追踪**
- [ ] `docker compose up -d --build` 成功启动
- [ ] `curl http://localhost:3000/api/health` 返回 `{"status":"ok"}`
- [ ] 编辑 `server/index.js` 后,日志出现重启标记,服务不挂
- [ ] host 上 `apps/mdm-platform/data/platform.db` 持续存在
- [ ] `docker compose exec -e MDM_DB_PATH=/tmp/...` 跑测试不污染主库
- [ ] named volume `mdm_node_modules` 正确覆盖 bind mount,容器内 `node_modules/better-sqlite3/build/Release/` 存在 `.node` 文件
- [ ] nodemon 用 `--legacy-watch` 模式(polling)
- [ ] 所有新增/修改文件已 commit

---

## 故障速查(执行时遇到再回看)

| 现象 | 原因 | 处理 |
|------|------|------|
| `docker build` 卡在 `npm ci` | 网络问题拉 npm 包 | 重试;或 `docker compose down -v` 清卷后重 build |
| 容器秒退,日志 `MDM_ADMIN_PASSWORD must be at least 12 characters` | `.env` 密码不足 12 字符 | 改 `.env` 中 `MDM_ADMIN_PASSWORD`(至少 12 字符),`docker compose restart mdm` |
| 容器秒退,日志 `bind: address already in use` | host 3000 被占 | `netstat -ano \| findstr :3000` 找 PID 杀掉 |
| `curl /api/health` 没响应,日志无明显错误 | server 还没起完 | 多等几秒重试 |
| 热重载不触发 | polling 间隔问题 | 确认日志里有 `--legacy-watch`;再 `sleep 2` 后看 |
| `better_sqlite3.node` 找不到 | named volume 没生效 | `docker compose down -v && docker compose up -d --build` |

---

## 范围外(明确不做)

- **多阶段镜像**:单机开发不需要
- **BuildKit cache mount**:`npm ci` 已经够快
- **非 root 用户**:Windows bind mount UID/GID 不一致,反而难搞
- **HEALTHCHECK**:单服务单机,看日志就够
- **test profile**:当前不需要,`exec -e MDM_DB_PATH` 一行就够
- **CI/CD 集成、镜像 tag、日志轮转、自动备份**:单机自用,过度工程
