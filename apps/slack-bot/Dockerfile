ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

# 构建期需要代理才能访问 npm registry（大陆网络下 registry.npmjs.org 不可直连）。
# compose.yaml 会传入 host.docker.internal 形式的地址，不能用 127.0.0.1。
ARG HTTP_PROXY
ARG HTTPS_PROXY

# Claude Code CLI 必须装进镜像：宿主机上装的是 Windows 版 claude.exe，容器内无法执行。
# 版本与宿主机保持一致，避免 CLI 参数行为出现差异。
ARG CLAUDE_CODE_VERSION=2.1.296
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      --allow-scripts=@anthropic-ai/claude-code \
 && npm cache clean --force \
 && claude --version

# rsync：同步服务把仓库灌进 Docker 卷用（见 sync.sh 里的性能说明）
# git：写入档开启 Bash 后要能执行 git（回滚、看 diff 是 Bash 的主要用途）。
#      没有它时 Bash 只能做文件操作，反而更危险——出错无法回退。
#      必须配 safe.directory：bind mount 进来的仓库属主与容器内 node 用户不一致，
#      否则 git 会以 dubious ownership 直接拒绝工作。
RUN apt-get update \
 && apt-get install -y --no-install-recommends rsync git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory /repo-write \
 && git config --system --add safe.directory /repo

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY healthcheck.cjs ./
COPY sync.sh ./
RUN chmod +x sync.sh

# /data 存会话记忆与心跳；/home/node 是 Claude Code 的 HOME，它需要写 ~/.claude。
# 根文件系统是只读的（见 compose.yaml），这两处必须预建并授权，由 volume 覆盖。
RUN mkdir -p /data /home/node/.claude && chown -R node:node /data /home/node

ENV NODE_ENV=production
USER node

CMD ["node", "src/index.js"]
