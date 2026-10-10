#!/bin/sh
# 把仓库同步进 Docker 卷，供机器人快速读取。
#
# 为什么需要这一层：Docker Desktop 把 Windows 盘共享给容器的那一层极慢。
# 实测同一份内容（6942 个文件）遍历一次：
#     bind mount（读 Windows 盘）  4244 ms
#     Docker 卷（VM 内 ext4）         8 ms   —— 相差 530 倍
# 这个差距会让 ripgrep 的全树搜索撞上 60 秒硬超时，模型什么都拿不到。
# 所以让机器人读卷里的镜像，同步这层慢活交给后台循环。
#
# 注意：写入不走这里。负责人的写入档直接指向真实仓库的 bind mount，
# 保证改动能落到宿主机；代价是写入档的搜索仍然慢，这是有意的取舍。
set -u

SRC="${SYNC_SRC:-/src}"
DST="${SYNC_DST:-/dst}"
INTERVAL="${SYNC_INTERVAL:-300}"

# 排除生成物和依赖目录。这些占了仓库体积和文件数的绝大部分，却不承载业务内容。
# 这份清单刻意与仓库根的 .gitignore 对齐——那边已经在维护「什么不算仓库内容」，
# 另起一套只会漏（初版就漏了 .venv-paddleocr，一个目录 183M）。
EXCLUDES="--exclude=node_modules --exclude=artifacts --exclude=.git --exclude=output --exclude=build --exclude=.review_output --exclude=.playwright-cli --exclude=tmp --exclude=temp --exclude=.tmp --exclude=_tmp --exclude=test-results --exclude=__pycache__ --exclude=.pytest_cache --exclude=.venv --exclude=.venv-paddleocr --exclude=.claude/worktrees --exclude=*.log"

echo "[sync] 源 $SRC -> 目标 $DST，间隔 ${INTERVAL}s"
echo "[sync] 排除：$EXCLUDES"

while true; do
  t0=$(date +%s)

  # -rlt 递归+保留符号链接与时间；故意不用 -a，避免把宿主机的属主/权限原样搬进来，
  # 否则机器人以 node 用户读可能被拒。--chmod 统一放开读权限。
  # --delete-excluded 是必需的：rsync 默认会保护被排除的文件不被删除，
  # 缺少它时，后来才加进排除清单的目录（如 .venv-paddleocr）会作为陈旧数据永久留档。
  # shellcheck disable=SC2086
  if rsync -rlt --delete --delete-excluded --no-owner --no-group --chmod=ugo+rX $EXCLUDES "$SRC/" "$DST/"; then
    # 必须显式放开读权限：-rlt 不含 -p，rsync 不会修改已存在条目的权限，
    # 只按源权限创建新文件。而宿主机挂进来的目录可能是 700，
    # 机器人以 node(uid 1000) 读就会 Permission denied，而且报错很隐晦——
    # find 只是少列出一批文件，看起来像"镜像没同步全"。
    chmod -R a+rX "$DST" 2>/dev/null
    t1=$(date +%s)
    count=$(find "$DST" -type f 2>/dev/null | wc -l)
    echo "[sync] $(date -Iseconds) 同步完成：$count 个文件，耗时 $((t1 - t0)) 秒"
  else
    echo "[sync] $(date -Iseconds) 同步失败，${INTERVAL}s 后重试"
  fi

  sleep "$INTERVAL"
done
