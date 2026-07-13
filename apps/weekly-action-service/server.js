const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.WEEKLY_ACTION_PORT || process.env.PORT || 3002);
const DATA_DIR = path.resolve(process.env.WEEKLY_ACTION_DATA_DIR || path.join(__dirname, '..', '..', 'artifacts', 'weekly-actions'));
const DATA_FILE = path.join(DATA_DIR, 'weekly-action-ledger-v1.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const ISSUE_TYPES = [
  {
    key: 'action',
    label: '周会行动项',
    ledgerName: '行动项台账',
    closeRule: '输出物完成并被 PMO 确认，或形成可追溯的关闭说明'
  },
  {
    key: 'risk',
    label: '风险事项',
    ledgerName: '风险台账',
    closeRule: '风险消除、降级或应对措施完成，并确认不再影响本周期判断'
  },
  {
    key: 'issue',
    label: '问题事项',
    ledgerName: '问题台账',
    closeRule: '处理结论、责任方、补充材料或整改结果已确认'
  },
  {
    key: 'change',
    label: '变更事项',
    ledgerName: '变更台账',
    closeRule: '变更结论已确认，影响已同步到计划、交付物或执行口径'
  },
  {
    key: 'responsibility',
    label: '责任池事项',
    ledgerName: '责任池',
    closeRule: '责任边界、承接人、升级路径或默认处理口径已确认'
  }
];

const STATUSES = [
  { key: 'open', label: '待处理' },
  { key: 'doing', label: '处理中' },
  { key: 'blocked', label: '需升级' },
  { key: 'closed', label: '已关闭' }
];

const TYPE_BY_KEY = Object.fromEntries(ISSUE_TYPES.map(item => [item.key, item]));
const STATUS_KEYS = new Set(STATUSES.map(item => item.key));

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeeklyRange(value = new Date()) {
  const current = parseDate(value) || new Date();
  const start = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  const day = start.getDay();
  const offset = day >= 4 ? day - 4 : day + 3;
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    weekId: formatDate(start),
    start: formatDate(start),
    end: formatDate(end),
    label: `${formatDate(start)} 至 ${formatDate(end)}`
  };
}

function idFor(type) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${String(type || 'W').toUpperCase()}-${stamp}-${random}`;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanDate(value) {
  const parsed = parseDate(value);
  return parsed ? formatDate(parsed) : '';
}

function typeFor(value) {
  return TYPE_BY_KEY[value] || TYPE_BY_KEY.action;
}

function normalizeItem(input = {}, fallbackWeek = getWeeklyRange()) {
  const type = typeFor(input.type);
  const status = STATUS_KEYS.has(input.status) ? input.status : 'open';
  const now = new Date().toISOString();
  const createdAt = input.createdAt || now;
  const week = input.weekId ? getWeeklyRange(input.weekId) : fallbackWeek;
  return {
    id: normalizeText(input.id) || idFor(type.key),
    weekId: week.weekId,
    type: type.key,
    ledgerName: type.ledgerName,
    title: normalizeText(input.title),
    owner: normalizeText(input.owner) || 'PMO',
    dueDate: cleanDate(input.dueDate),
    status,
    source: normalizeText(input.source) || '周会现场',
    related: normalizeText(input.related),
    closeCriteria: normalizeText(input.closeCriteria) || type.closeRule,
    closeEvidence: normalizeText(input.closeEvidence),
    delayReason: normalizeText(input.delayReason),
    note: normalizeText(input.note),
    createdAt,
    updatedAt: input.updatedAt || now
  };
}

function readLedger() {
  ensureDataDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(item => normalizeItem(item, getWeeklyRange(item.weekId))).filter(item => item.title)
      : [];
    return { version: 1, items };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, items: [] };
    throw error;
  }
}

function writeLedger(ledger) {
  ensureDataDir();
  const payload = JSON.stringify({ version: 1, items: ledger.items || [] }, null, 2);
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function summarize(items) {
  const summary = {
    total: items.length,
    active: 0,
    closed: 0,
    blocked: 0,
    byType: Object.fromEntries(ISSUE_TYPES.map(item => [item.key, 0])),
    byStatus: Object.fromEntries(STATUSES.map(item => [item.key, 0]))
  };
  for (const item of items) {
    if (item.status === 'closed') summary.closed += 1;
    else summary.active += 1;
    if (item.status === 'blocked') summary.blocked += 1;
    if (summary.byType[item.type] != null) summary.byType[item.type] += 1;
    if (summary.byStatus[item.status] != null) summary.byStatus[item.status] += 1;
  }
  return summary;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk.toString();
      if (raw.length > 1024 * 1024) {
        reject(new Error('请求内容过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('请求内容格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function publicStorageLabel() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const relative = path.relative(repoRoot, DATA_DIR);
  return relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : 'service data directory';
}

function filterItems(items, searchParams) {
  const weekId = searchParams.get('weekId') || getWeeklyRange(searchParams.get('date') || new Date()).weekId;
  const type = searchParams.get('type') || 'all';
  const status = searchParams.get('status') || 'active';
  const keyword = normalizeText(searchParams.get('q')).toLowerCase();
  return items
    .filter(item => !weekId || item.weekId === weekId)
    .filter(item => type === 'all' || item.type === type)
    .filter(item => {
      if (status === 'all') return true;
      if (status === 'active') return item.status !== 'closed';
      return item.status === status;
    })
    .filter(item => {
      if (!keyword) return true;
      return [
        item.title,
        item.owner,
        item.source,
        item.related,
        item.closeCriteria,
        item.closeEvidence,
        item.delayReason,
        item.note
      ].some(value => String(value || '').toLowerCase().includes(keyword));
    })
    .sort((left, right) => {
      if ((left.status === 'closed') !== (right.status === 'closed')) return left.status === 'closed' ? 1 : -1;
      return String(left.dueDate || '9999-99-99').localeCompare(String(right.dueDate || '9999-99-99'))
        || String(right.updatedAt).localeCompare(String(left.updatedAt));
    });
}

function serveStatic(req, res, pathname) {
  const target = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  const resolved = path.resolve(target);
  if (!resolved.startsWith(PUBLIC_DIR)) return sendText(res, 403, '禁止访问');
  fs.readFile(resolved, (error, data) => {
    if (error) return sendText(res, 404, '未找到页面');
    const ext = path.extname(resolved).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
        : ext === '.js' ? 'application/javascript; charset=utf-8'
          : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'weekly-action-service',
      port: PORT,
      storage: {
        mode: 'server_file',
        location: publicStorageLabel()
      },
      weekCycle: '周四至下周三'
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/meta') {
    return sendJson(res, 200, {
      issueTypes: ISSUE_TYPES,
      statuses: STATUSES,
      currentWeek: getWeeklyRange(url.searchParams.get('date') || new Date())
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/items') {
    const ledger = readLedger();
    const items = filterItems(ledger.items, url.searchParams);
    return sendJson(res, 200, {
      week: getWeeklyRange(url.searchParams.get('weekId') || url.searchParams.get('date') || new Date()),
      summary: summarize(items),
      items
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/items') {
    const body = await readBody(req);
    const week = getWeeklyRange(body.weekId || body.dueDate || new Date());
    const item = normalizeItem(body, week);
    if (!item.title) return sendJson(res, 400, { error: '请填写事项内容' });
    const ledger = readLedger();
    ledger.items.unshift(item);
    writeLedger(ledger);
    return sendJson(res, 201, { item });
  }

  const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch && req.method === 'PUT') {
    const itemId = decodeURIComponent(itemMatch[1]);
    const body = await readBody(req);
    const ledger = readLedger();
    const index = ledger.items.findIndex(item => item.id === itemId);
    if (index < 0) return sendJson(res, 404, { error: '未找到事项' });
    const current = ledger.items[index];
    const next = normalizeItem({ ...current, ...body, id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString() }, getWeeklyRange(current.weekId));
    if (!next.title) return sendJson(res, 400, { error: '请填写事项内容' });
    ledger.items[index] = next;
    writeLedger(ledger);
    return sendJson(res, 200, { item: next });
  }

  if (itemMatch && req.method === 'DELETE') {
    const itemId = decodeURIComponent(itemMatch[1]);
    const ledger = readLedger();
    const nextItems = ledger.items.filter(item => item.id !== itemId);
    if (nextItems.length === ledger.items.length) return sendJson(res, 404, { error: '未找到事项' });
    writeLedger({ ...ledger, items: nextItems });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: '未找到接口' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return sendJson(res, 500, { error: '服务处理失败', detail: error.message });
  }
});

if (require.main === module) {
  ensureDataDir();
  server.listen(PORT, () => {
    console.log(`weekly action service listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  DATA_FILE,
  ISSUE_TYPES,
  STATUSES,
  getWeeklyRange,
  normalizeItem,
  summarize,
  server
};
