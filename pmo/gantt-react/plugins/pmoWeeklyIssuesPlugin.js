// plugins/pmoWeeklyIssuesPlugin.js — PMO 周会事项台账的文件正本
//
// 《信息化项目协同工作规则》6.1：信息化工作群是正式沟通渠道，**PMO 行动台账是正式跟踪记录**。
//
// 在本次提升之前，周会事项只存在浏览器 localStorage 里，换浏览器或换端口即丢失，
// 无法承担「正式跟踪记录」的角色。本插件把它落盘为仓库文件正本：
// 登记、状态流转、关闭结论与期限调整全部持久化，并随版本管理可追溯。
//
// 存储形态刻意保持轻量（规则 6.3 的「轻量行动台账」）：单个 ledger.json，
// 而不是像交付物那样一事一文件 —— 事项只记四要素，没有独立正文。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyWeeklyIssuePatch,
  createWeeklyIssueItem,
  normalizeWeeklyIssueItems,
} from '../src/utils/weeklyIssueUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 路径可被环境变量覆盖（与 deliverable 插件的 PMO_DELIVERABLE_RUNTIME_DIR 同模式），
// 供隔离测试使用，避免测试写入仓库正本。
export const WEEKLY_ISSUES_DIR = process.env.PMO_WEEKLY_ISSUES_DIR
  ? path.resolve(process.env.PMO_WEEKLY_ISSUES_DIR)
  : path.resolve(__dirname, '../../weekly-issues');
export const LEDGER_FILE = path.join(WEEKLY_ISSUES_DIR, 'ledger.json');
export const LEDGER_VERSION = 1;

const API_ROOT = '/api/pmo/weekly-issues';
const MAX_REQUEST_BYTES = 1024 * 1024;

export class WeeklyIssueFsError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'WeeklyIssueFsError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function statusFromError(error) {
  if (error?.code === 'SCHEMA_INVALID' || error?.code === 'LEDGER_PARSE_FAILED') return 400;
  if (error?.code === 'WRITE_CONFLICT' || error?.code === 'DUPLICATE_ISSUE') return 409;
  if (error?.code === 'NOT_FOUND') return 404;
  if (error?.code === 'RULE_VIOLATION') return 422;
  return 500;
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function errorJson(res, statusCode, code, message, extra = {}) {
  json(res, statusCode, { ok: false, error: { code, message, ...extra } });
}

async function readJsonRequest(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_REQUEST_BYTES) {
      throw new WeeklyIssueFsError('SCHEMA_INVALID', '请求体过大');
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new WeeklyIssueFsError('SCHEMA_INVALID', `请求体不是合法 JSON: ${error.message}`, error);
  }
}

async function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp`;
  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(tempPath, content, 'utf8');
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw new WeeklyIssueFsError('ATOMIC_WRITE_FAILED', `台账写入失败: ${error.message}`, error);
  }
}

function readLedger(ledgerFile) {
  let raw;
  try {
    raw = fs.readFileSync(ledgerFile, 'utf8');
  } catch (error) {
    // 台账尚未建立是正常状态：第一次登记时创建
    if (error?.code === 'ENOENT') return { items: [], updatedAt: '', mtime: 0 };
    throw new WeeklyIssueFsError('READ_FAILED', `读取周会事项台账失败: ${error.message}`, error);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WeeklyIssueFsError('LEDGER_PARSE_FAILED', `周会事项台账 JSON 解析失败: ${error.message}`, error);
  }

  return {
    items: normalizeWeeklyIssueItems(parsed?.items),
    updatedAt: parsed?.updatedAt || '',
    mtime: fs.statSync(ledgerFile).mtimeMs,
  };
}

async function writeLedger(items, ledgerFile) {
  const updatedAt = new Date().toISOString();
  const payload = { version: LEDGER_VERSION, updatedAt, items };
  await writeAtomic(ledgerFile, `${JSON.stringify(payload, null, 2)}\n`);
  return { updatedAt, mtime: fs.statSync(ledgerFile).mtimeMs };
}

export function pmoWeeklyIssuesPlugin({ ledgerFile = LEDGER_FILE } = {}) {
  const read = () => readLedger(ledgerFile);

  async function handleCreate(req, res) {
    const payload = await readJsonRequest(req);
    const item = createWeeklyIssueItem(payload);
    if (!item.title) throw new WeeklyIssueFsError('SCHEMA_INVALID', '事项标题必填');

    const ledger = read();
    if (ledger.items.some(existing => existing.id === item.id)) {
      throw new WeeklyIssueFsError('DUPLICATE_ISSUE', `${item.id} 已存在`);
    }

    const items = [item, ...ledger.items];
    const { updatedAt, mtime } = await writeLedger(items, ledgerFile);
    json(res, 201, { ok: true, data: { item, updatedAt, mtime } });
  }

  async function handleUpdate(id, req, res) {
    const ledger = read();
    const index = ledger.items.findIndex(item => item.id === id);
    if (index < 0) throw new WeeklyIssueFsError('NOT_FOUND', `${id} 不存在`);

    const ifMatch = req.headers['if-match'];
    if (ifMatch && Number(ifMatch) !== ledger.mtime) {
      errorJson(res, 409, 'WRITE_CONFLICT', '台账已被其他会话修改，请刷新后重试', { currentMtime: ledger.mtime });
      return;
    }

    const payload = await readJsonRequest(req);
    let next;
    try {
      next = applyWeeklyIssuePatch(ledger.items[index], payload);
    } catch (error) {
      // 规则校验失败（6.4 关闭依据 / 8.1 期限调整同意人）统一转 422
      throw new WeeklyIssueFsError('RULE_VIOLATION', error.message, error);
    }

    const items = [...ledger.items];
    items[index] = next;
    const { updatedAt, mtime } = await writeLedger(items, ledgerFile);
    json(res, 200, { ok: true, data: { item: next, updatedAt, mtime } });
  }

  return {
    name: 'pmo-weekly-issues',
    apply: 'serve',
    configureServer(server) {
      const initial = read();
      console.log(`[pmo-weekly-issues] plugin mounted, ledger ${ledgerFile}, ${initial.items.length} items`);

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith(API_ROOT)) {
          next();
          return;
        }

        try {
          const rest = decodeURIComponent(url.pathname.slice(API_ROOT.length));
          const idMatch = /^\/([A-Za-z0-9_-]+)\/?$/u.exec(rest);

          if ((rest === '' || rest === '/') && req.method === 'GET') {
            const ledger = read();
            json(res, 200, {
              ok: true,
              data: { items: ledger.items, updatedAt: ledger.updatedAt, mtime: ledger.mtime },
            });
            return;
          }

          if ((rest === '' || rest === '/') && req.method === 'POST') {
            await handleCreate(req, res);
            return;
          }

          if (idMatch && req.method === 'PUT') {
            await handleUpdate(idMatch[1], req, res);
            return;
          }

          errorJson(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} not allowed`);
        } catch (error) {
          const code = error?.code || 'INTERNAL';
          errorJson(res, statusFromError(error), code, error.message || 'internal error');
        }
      });
    },
  };
}

export const _internal = { readLedger, writeLedger, readJsonRequest };
