/**
 * 容器健康检查：读机器人写的心跳文件，判断 Socket Mode 是否仍然连着。
 *
 * 为什么不用「进程还在不在」当健康标准：Socket Mode 是长连接，
 * 断线时进程照样活着、照样占着容器，只有心跳里的 state 能反映真实情况。
 */
const fs = require('node:fs');

const file = process.env.BOT_HEARTBEAT_FILE || '/data/heartbeat';
const STALE_MS = 120000;

try {
  const beat = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (beat.state !== 'connected') {
    console.error(`Socket Mode 未连接，当前状态：${beat.state}`);
    process.exit(1);
  }
  const ageMs = Date.now() - Date.parse(beat.at);
  if (!Number.isFinite(ageMs) || ageMs > STALE_MS) {
    console.error(`心跳已过期 ${ageMs} ms（阈值 ${STALE_MS} ms）`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error(`心跳文件不可读：${err.message}`);
  process.exit(1);
}
