import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import {
  DeliverableFsError,
  deliverableToFrontmatter,
  parseDeliverableFrontmatter,
  safeDeliverableFileName,
  stringifyDeliverableFrontmatter,
  upsertChangeLogTable,
  validateDeliverableFrontmatter,
} from '../src/utils/deliverableFrontmatter.js';
import {
  DELIVERABLE_ACTIONS,
  applyDeliverableCommand,
} from '../src/utils/deliverableWorkflow.js';
import { parseRosterMarkdown, rosterDepartments } from '../src/utils/pmoRoster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DELIVERABLES_DIR = path.resolve(__dirname, '../../deliverables');
export const RUNTIME_ROOT = process.env.PMO_DELIVERABLE_RUNTIME_DIR
  ? path.resolve(process.env.PMO_DELIVERABLE_RUNTIME_DIR)
  : path.resolve(process.cwd(), '..', '..', 'artifacts', 'pmo', 'deliverables');
export const HISTORY_DIR = path.join(RUNTIME_ROOT, '_history');

const FILENAME_RE = /^DLV-(\d{3})-[^/\\]+\.md$/u;
const API_ROOT = '/api/pmo/deliverables';
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const ROSTER_PATH = path.resolve(__dirname, '../../信息化项目_部门主备对接人名单.md');

// 行动项事件的 URL 段 → 事件名（形态与既有 /transition 保持一致）
const EVENT_ACTIONS = {
  publish: 'publish',
  acknowledge: 'acknowledge',
  'submit-result': 'submitResult',
  close: 'close',
  reopen: 'reopen',
  'due-date': 'changeDueDate',
};

/** 解析责任部门名册真源；文件缺失或格式变化时返回空表，由调用方降级处理。 */
function readRoster() {
  try {
    return parseRosterMarkdown(fs.readFileSync(ROSTER_PATH, 'utf8'));
  } catch (error) {
    console.warn(`[pmo-deliverables] 读取主备对接人名单失败: ${error.message}`);
    return [];
  }
}

function isDeliverableMarkdown(fileName) {
  return FILENAME_RE.test(fileName);
}

function idFromFileName(fileName) {
  const match = FILENAME_RE.exec(fileName);
  return match ? `DLV-${match[1]}` : '';
}

function duplicateFileNamesFor(id, deliverablesDir = DELIVERABLES_DIR) {
  if (!fs.existsSync(deliverablesDir)) return [];
  const fileNames = fs.readdirSync(deliverablesDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && isDeliverableMarkdown(entry.name) && idFromFileName(entry.name) === id)
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
  return fileNames.length > 1 ? fileNames : [];
}

function assertNoDuplicateDeliverable(id, deliverablesDir = DELIVERABLES_DIR) {
  const duplicates = duplicateFileNamesFor(id, deliverablesDir);
  if (!duplicates.length) return;
  throw new DeliverableFsError(
    'DUPLICATE_DELIVERABLE',
    `${id} 存在多份正本,请先保留唯一正本: ${duplicates.join(', ')}`,
  );
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sanitizeUploadFileName(fileName) {
  return Array.from(String(fileName || 'upload.bin'))
    .map(char => (char.charCodeAt(0) < 32 ? '-' : char))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'upload.bin';
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function errorJson(res, statusCode, code, message, extra = {}) {
  json(res, statusCode, { ok: false, error: { code, message, ...extra } });
}

function statusFromError(error) {
  if (error?.code === 'SCHEMA_INVALID' || error?.code === 'PARSE_FRONT_MATTER') return 400;
  if (error?.code === 'WRITE_CONFLICT' || error?.code === 'DUPLICATE_DELIVERABLE') return 409;
  if (error?.code === 'UPLOAD_TOO_LARGE' || error?.code === 'UPLOAD_UNSUPPORTED_EXT') return 400;
  if (error?.code === 'CONVERTER_FAILED' || error?.code === 'STATUS_TRANSITION_DENIED') return 422;
  return 500;
}

async function readTextRequest(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

async function readJsonRequest(req) {
  const raw = await readTextRequest(req);
  return raw ? JSON.parse(raw) : {};
}

async function parseMultipartRequest(req) {
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: 'half',
  });
  return request.formData();
}

async function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp`;
  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(tempPath, content, 'utf8');
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw new DeliverableFsError('ATOMIC_WRITE_FAILED', `文件写入失败: ${error.message}`, error);
  }
}

// 值得留档的事件：状态定版与归档，以及改变行动项责任或期限的发布/关闭/期限调整
const SNAPSHOT_ACTIONS = ['approve', 'archive', 'publish', 'close', 'changeDueDate'];

async function copySnapshot(filePath, id, historyRoot, event) {
  const action = event?.action || '';
  if (!SNAPSHOT_ACTIONS.includes(action)) return '';
  const dir = path.join(historyRoot, id);
  await fsp.mkdir(dir, { recursive: true });
  const from = event.from || 'unknown';
  const to = event.to || 'unknown';
  const snapshotName = `${timestampForFile()}-snapshot-${from}_to_${to}.md`.replace(/[\\/:*?"<>|]/g, '-');
  const target = path.join(dir, snapshotName);
  await fsp.copyFile(filePath, target);
  return target;
}

function readDeliverableFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseDeliverableFrontmatter(raw);
  validateDeliverableFrontmatter(parsed.frontmatter);
  const stat = fs.statSync(filePath);
  return {
    deliverableId: parsed.frontmatter.deliverableId,
    fileName: path.basename(filePath),
    filePath,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    raw,
    mtime: stat.mtimeMs,
  };
}

function cleanupTempFiles(deliverablesDir = DELIVERABLES_DIR) {
  if (!fs.existsSync(deliverablesDir)) return;
  for (const entry of fs.readdirSync(deliverablesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue;
    fs.rmSync(path.join(deliverablesDir, entry.name), { force: true });
  }
}

/**
 * 扫描受控交付物正本。
 *
 * 返回值从 Map 改为 { items, errors }：跳过的文件以前只 console.warn 就丢弃，
 * 导致「正本存在却不在台账上」无法被发现。现在错误一并上报给对账视图。
 */
function scanDeliverables({ deliverablesDir = DELIVERABLES_DIR, warn = console.warn } = {}) {
  cleanupTempFiles(deliverablesDir);
  const items = new Map();
  const errors = [];
  if (!fs.existsSync(deliverablesDir)) return { items, errors };

  const groups = new Map();
  for (const entry of fs.readdirSync(deliverablesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isDeliverableMarkdown(entry.name)) continue;
    const id = idFromFileName(entry.name);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry.name);
  }

  for (const [id, fileNames] of groups) {
    if (fileNames.length > 1) {
      const message = `${id} 存在多份正本，已全部跳过：${fileNames.join('、')}`;
      warn(`[pmo-deliverables] ${message}`);
      errors.push({ code: 'FILE_DUPLICATE_ID', deliverableId: id, fileName: fileNames.join('、'), message });
      continue;
    }

    const fileName = fileNames[0];
    const filePath = path.join(deliverablesDir, fileName);

    let item;
    try {
      item = readDeliverableFile(filePath);
    } catch (error) {
      const message = error?.message || '正本读取失败';
      warn(`[pmo-deliverables] 跳过 ${fileName}: ${message}`);
      errors.push({ code: 'FILE_SCHEMA_INVALID', deliverableId: id, fileName, message });
      continue;
    }

    if (item.frontmatter.deliverableId !== id) {
      const message = `${fileName} 的 deliverableId（${item.frontmatter.deliverableId}）与文件名（${id}）不一致`;
      warn(`[pmo-deliverables] 跳过 ${fileName}: ${message}`);
      errors.push({ code: 'FILE_ID_MISMATCH', deliverableId: id, fileName, message });
      continue;
    }

    items.set(id, item);
  }

  return { items, errors };
}

/**
 * 建议下一个受控编号：取 DLV-001~DLV-899 中的最大号 +1。
 *
 * 刻意不回收历史空缺号（DLV-005、DLV-008 从未分配过），
 * 避免浏览器端按编号缓存的陈旧凭证挂到新交付物上。
 */
function suggestNextDeliverableId(items) {
  const used = [...items.keys()]
    .map(id => Number(String(id).slice(4)))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 899);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return next > 899 ? '' : `DLV-${String(next).padStart(3, '0')}`;
}

function deliverableFromFrontmatter(frontmatter) {
  return {
    deliverableId: frontmatter.deliverableId,
    deliverableName: frontmatter.title,
    deliverableStatus: frontmatter.status,
    deliverableType: frontmatter.deliverableType,
    deliverableLevel: frontmatter.deliverableLevel,
    department: frontmatter.department,
    reviewer: frontmatter.reviewer,
    plannedFinish: frontmatter.plannedFinish,
    taskRisk: frontmatter.risk || '中',
    evidence: frontmatter.evidence || null,
    workflowHistory: Array.isArray(frontmatter.workflowHistory) ? frontmatter.workflowHistory : [],
    _actualSubmitDate: frontmatter.actualSubmitDate || '',
    _actualPassDate: frontmatter.actualPassDate || '',
    _actualArchiveDate: frontmatter.actualArchiveDate || '',
    reviewOpinion: frontmatter.reviewOpinion || '',
    action: frontmatter.action || null,
  };
}

export async function applyTransitionToFile(filePath, command, { historyRoot = HISTORY_DIR, departments = [] } = {}) {
  const beforeRaw = await fsp.readFile(filePath, 'utf8');
  const parsed = parseDeliverableFrontmatter(beforeRaw);
  validateDeliverableFrontmatter(parsed.frontmatter);
  const before = deliverableFromFrontmatter(parsed.frontmatter);
  // 单一分派：状态迁移与行动项事件共用此入口，调用方无需区分动作属于哪一轴
  const next = applyDeliverableCommand(before, command, { departments });
  const event = next.workflowHistory.at(-1);
  const nextFrontmatter = {
    ...parsed.frontmatter,
    status: next.deliverableStatus,
    actualSubmitDate: next._actualSubmitDate || '',
    actualPassDate: next._actualPassDate || '',
    actualArchiveDate: next._actualArchiveDate || '',
    reviewOpinion: next.reviewOpinion || '',
    evidence: next.evidence || parsed.frontmatter.evidence || null,
    action: next.action || null,
    workflowHistory: next.workflowHistory || [],
  };
  const nextBody = upsertChangeLogTable(parsed.body, nextFrontmatter.workflowHistory);
  const nextRaw = stringifyDeliverableFrontmatter({ frontmatter: nextFrontmatter, body: nextBody });
  await writeAtomic(filePath, nextRaw);
  const snapshotPath = await copySnapshot(filePath, nextFrontmatter.deliverableId, historyRoot, event);
  const stat = await fsp.stat(filePath);
  return {
    mtime: stat.mtimeMs,
    status: nextFrontmatter.status,
    state: nextFrontmatter.action?.state || null,
    snapshotPath,
    event,
  };
}

function createChangeEventPayload(filePath, eventName, deliverablesDir = DELIVERABLES_DIR) {
  const relative = path.relative(deliverablesDir, filePath);
  if (!relative || relative.startsWith('..')) return null;
  const parts = relative.split(path.sep);
  if (parts.includes('_history')) return null;
  const id = idFromFileName(path.basename(filePath));
  if (!id) return null;
  return {
    type: 'custom',
    event: 'pmo:deliverables-changed',
    data: { id, kind: eventName },
  };
}

function registerDeliverablesWatcher(server, { deliverablesDir = DELIVERABLES_DIR } = {}) {
  server.watcher.add(deliverablesDir);
  for (const eventName of ['add', 'change', 'unlink']) {
    server.watcher.on(eventName, filePath => {
      const payload = createChangeEventPayload(path.resolve(filePath), eventName, deliverablesDir);
      if (payload) server.ws.send(payload);
    });
  }
}

async function convertXlsxToMarkdown(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return '# 空工作簿\n';
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false });
  if (!rows.length) return `# ${sheetName}\n`;
  const width = Math.max(...rows.map(row => row.length));
  const normalized = rows.map(row => Array.from({ length: width }, (_, index) => String(row[index] ?? '').replace(/\|/g, '/')));
  const header = normalized[0];
  const body = normalized.slice(1);
  return [
    `# ${sheetName}`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

async function convertUploadToMarkdown(file, buffer) {
  const ext = path.extname(file.name || '').toLowerCase();
  if (ext === '.md' || ext === '.markdown') return buffer.toString('utf8');
  if (ext === '.docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return `# ${path.basename(file.name, ext)}\n\n${(result.value || '').trim()}\n`;
    } catch (error) {
      throw new DeliverableFsError('CONVERTER_FAILED', `docx 转 markdown 失败: ${error.message}`, error);
    }
  }
  if (ext === '.xlsx' || ext === '.xls') {
    try {
      return convertXlsxToMarkdown(buffer);
    } catch (error) {
      throw new DeliverableFsError('CONVERTER_FAILED', `xlsx 转 markdown 失败: ${error.message}`, error);
    }
  }
  throw new DeliverableFsError('UPLOAD_UNSUPPORTED_EXT', '仅支持 docx/xlsx/md');
}

function itemSummary(item) {
  return {
    deliverableId: item.deliverableId,
    fileName: item.fileName,
    mtime: item.mtime,
    frontmatter: item.frontmatter,
  };
}

export function pmoDeliverablesPlugin({
  deliverablesDir = DELIVERABLES_DIR,
  runtimeRoot = RUNTIME_ROOT,
  historyDir = path.join(runtimeRoot, '_history'),
} = {}) {
  let cache = new Map();
  let scanErrors = [];

  const refresh = () => {
    const result = scanDeliverables({ deliverablesDir });
    cache = result.items;
    scanErrors = result.errors;
    return cache;
  };

  const findItem = id => {
    refresh();
    assertNoDuplicateDeliverable(id, deliverablesDir);
    return cache.get(id);
  };

  const filePathFor = (id, frontmatter) => {
    const existing = cache.get(id);
    if (existing) return existing.filePath;
    return path.join(deliverablesDir, safeDeliverableFileName(id, frontmatter.title || id));
  };

  /** 提升为受控：从候选池创建一份新的正本骨架。 */
  async function handleCreate(req, res) {
    refresh();
    const payload = await readJsonRequest(req);
    const title = String(payload.title || '').trim();
    if (!title) throw new DeliverableFsError('SCHEMA_INVALID', 'title 必填');

    const requested = String(payload.deliverableId || '').trim();
    const deliverableId = requested || suggestNextDeliverableId(cache);
    if (!/^DLV-\d{3}$/u.test(deliverableId)) {
      throw new DeliverableFsError('SCHEMA_INVALID', `deliverableId 非法: ${deliverableId || '(空)'}`);
    }
    // 新建语义：编号已被占用即拒绝。assertNoDuplicateDeliverable 只覆盖「同号多份文件」，
    // 触发不了「新增一个与既有编号同名的文件」，故此处先查扫描缓存。
    if (cache.has(deliverableId)) {
      throw new DeliverableFsError('DUPLICATE_DELIVERABLE', `${deliverableId} 已存在正本，不能重复创建`);
    }
    assertNoDuplicateDeliverable(deliverableId, deliverablesDir);

    const frontmatter = deliverableToFrontmatter(
      {
        deliverableId,
        deliverableName: title,
        deliverableType: payload.deliverableType || '过程记录类',
        deliverableLevel: payload.deliverableLevel || 'C',
        department: payload.department || '',
        owner: payload.owner || '',
        reviewer: payload.reviewer || '',
        plannedFinish: payload.plannedFinish || '',
        taskRisk: payload.risk || payload.taskRisk || '中',
      },
      {
        ...(payload.taskId != null && payload.taskId !== '' ? { taskId: payload.taskId } : {}),
        ...(payload.normalizedWbs ? { normalizedWbs: payload.normalizedWbs } : {}),
        ...(payload.ownerNote ? { ownerNote: payload.ownerNote } : {}),
      },
    );

    validateDeliverableFrontmatter(frontmatter);
    const body = String(payload.body || `# ${title}\n`);
    const filePath = path.join(deliverablesDir, safeDeliverableFileName(deliverableId, title));
    await writeAtomic(filePath, stringifyDeliverableFrontmatter({ frontmatter, body }));
    refresh();
    const created = cache.get(deliverableId);

    json(res, 201, {
      ok: true,
      data: {
        deliverableId,
        fileName: created?.fileName || path.basename(filePath),
        mtime: created?.mtime || 0,
        suggestedNextId: suggestNextDeliverableId(cache),
      },
    });
  }

  /** 行动项事件：发布 / 接收 / 提交结果 / 关闭 / 重新开启 / 期限调整。 */
  async function handleEvent(id, req, res, action) {
    const item = findItem(id);
    if (!item) {
      errorJson(res, 404, 'NOT_FOUND', `${id} not found`);
      return;
    }
    const ifMatch = req.headers['if-match'];
    if (ifMatch && Number(ifMatch) !== item.mtime) {
      errorJson(res, 409, 'WRITE_CONFLICT', 'mtime 不匹配', { currentMtime: item.mtime });
      return;
    }

    const payload = await readJsonRequest(req);
    try {
      const result = await applyTransitionToFile(
        item.filePath,
        { ...payload, action },
        { historyRoot: historyDir, departments: rosterDepartments(readRoster()) },
      );
      refresh();
      json(res, 200, { ok: true, data: { deliverableId: id, ...result } });
    } catch (error) {
      if (!(error instanceof DeliverableFsError)) {
        throw new DeliverableFsError('STATUS_TRANSITION_DENIED', error.message, error);
      }
      throw error;
    }
  }

  /** 发布文本归档：工作群是正式沟通渠道，台账侧只留痕，不负责送达。 */
  async function handlePublishTextArchive(req, res) {
    const payload = await readJsonRequest(req);
    const text = String(payload.text || '');
    if (!text.trim()) throw new DeliverableFsError('SCHEMA_INVALID', 'text 不能为空');

    const dir = path.join(runtimeRoot, '_publish');
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${timestampForFile()}-publish.md`);
    await fsp.writeFile(target, text, 'utf8');

    json(res, 200, {
      ok: true,
      data: { path: path.relative(runtimeRoot, target).replace(/\\/g, '/'), runtimeRoot },
    });
  }

  async function handlePut(id, req, res) {
    const item = findItem(id);
    const ifMatch = req.headers['if-match'];
    if (ifMatch && item && Number(ifMatch) !== item.mtime) {
      errorJson(res, 409, 'WRITE_CONFLICT', 'mtime 不匹配', { currentMtime: item.mtime });
      return;
    }
    const raw = await readTextRequest(req);
    const parsed = parseDeliverableFrontmatter(raw);
    parsed.frontmatter.deliverableId = parsed.frontmatter.deliverableId || id;
    // 保护：raw PUT 可能只提交正文或部分字段，不得因此静默清空磁盘上的行动项记录
    if (!parsed.frontmatter.action && item?.frontmatter?.action) {
      parsed.frontmatter.action = item.frontmatter.action;
    }
    validateDeliverableFrontmatter(parsed.frontmatter);
    if (parsed.frontmatter.deliverableId !== id) {
      throw new DeliverableFsError('SCHEMA_INVALID', `${id} 与 frontmatter.deliverableId 不一致`);
    }
    const body = upsertChangeLogTable(parsed.body, parsed.frontmatter.workflowHistory || []);
    const nextRaw = stringifyDeliverableFrontmatter({ frontmatter: parsed.frontmatter, body });
    const filePath = filePathFor(id, parsed.frontmatter);
    await writeAtomic(filePath, nextRaw);
    refresh();
    const next = cache.get(id);
    json(res, 200, { ok: true, data: { deliverableId: id, mtime: next?.mtime || 0 } });
  }

  async function handleTransition(id, req, res) {
    const item = findItem(id);
    if (!item) {
      errorJson(res, 404, 'NOT_FOUND', `${id} not found`);
      return;
    }
    const ifMatch = req.headers['if-match'];
    if (ifMatch && Number(ifMatch) !== item.mtime) {
      errorJson(res, 409, 'WRITE_CONFLICT', 'mtime 不匹配', { currentMtime: item.mtime });
      return;
    }
    const command = await readJsonRequest(req);
    try {
      const result = await applyTransitionToFile(item.filePath, command, { historyRoot: historyDir });
      refresh();
      json(res, 200, { ok: true, data: { deliverableId: id, ...result } });
    } catch (error) {
      if (!(error instanceof DeliverableFsError)) {
        throw new DeliverableFsError('STATUS_TRANSITION_DENIED', error.message, error);
      }
      throw error;
    }
  }

  async function handleUpload(id, req, res) {
    const form = await parseMultipartRequest(req);
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new DeliverableFsError('UPLOAD_UNSUPPORTED_EXT', '缺少上传文件');
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_UPLOAD_SIZE) {
      throw new DeliverableFsError('UPLOAD_TOO_LARGE', '上传文件超过 25MB');
    }

    const item = findItem(id);
    const metadata = (() => {
      try {
        return JSON.parse(form.get('metadata') || '{}');
      } catch {
        return {};
      }
    })();
    const baseFrontmatter = item?.frontmatter || deliverableToFrontmatter({
      ...metadata,
      deliverableId: id,
      deliverableName: metadata.deliverableName || metadata.title || id,
      deliverableStatus: metadata.deliverableStatus || '未提交',
      plannedFinish: metadata.plannedFinish || new Date().toISOString().slice(0, 10),
      department: metadata.department || 'PMO',
    });

    const convertedBody = await convertUploadToMarkdown(file, buffer);
    const archiveDir = path.join(historyDir, id);
    await fsp.mkdir(archiveDir, { recursive: true });
    const archiveName = `${timestampForFile()}-upload-${sanitizeUploadFileName(file.name)}`;
    const archivePath = path.join(archiveDir, archiveName);
    await fsp.writeFile(archivePath, buffer);

    const uploadedAt = new Date().toISOString();
    const nextFrontmatter = {
      ...baseFrontmatter,
      evidence: {
        fileName: file.name,
        fileSize: buffer.length,
        fileType: file.type || 'application/octet-stream',
        uploadedAt,
        source: '上传转码',
      },
    };

    if (nextFrontmatter.status === '未提交') {
      nextFrontmatter.status = '已提交';
      nextFrontmatter.actualSubmitDate = uploadedAt.slice(0, 10);
      nextFrontmatter.workflowHistory = [
        ...(nextFrontmatter.workflowHistory || []),
        {
          action: 'submit',
          label: DELIVERABLE_ACTIONS.submit.label,
          from: '未提交',
          to: '已提交',
          actor: metadata.department || nextFrontmatter.department || 'PMO',
          at: uploadedAt,
          note: '上传凭证并提交',
        },
      ];
    }

    validateDeliverableFrontmatter(nextFrontmatter);
    const body = upsertChangeLogTable(convertedBody, nextFrontmatter.workflowHistory || []);
    const filePath = filePathFor(id, nextFrontmatter);
    await writeAtomic(filePath, stringifyDeliverableFrontmatter({ frontmatter: nextFrontmatter, body }));
    refresh();
    const next = cache.get(id);
    json(res, 200, {
      ok: true,
      data: {
        deliverableId: id,
        mtime: next?.mtime || 0,
        archivePath: path.relative(runtimeRoot, archivePath).replace(/\\/g, '/'),
        runtimeRoot,
      },
    });
  }

  return {
    name: 'pmo-deliverables',
    apply: 'serve',
    configureServer(server) {
      refresh();
      registerDeliverablesWatcher(server, { deliverablesDir });
      console.log(`[pmo-deliverables] plugin mounted, watching ${deliverablesDir}, scanned ${cache.size} deliverables`);

      // 名册缺失时发布行动项的责任部门下拉会为空。静默空列表会让人以为是前端问题，故显式告警。
      if (!readRoster().length) {
        console.warn(`[pmo-deliverables] 未读取到责任部门名册：${ROSTER_PATH}（发布行动项的责任部门下拉将为空）`);
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith(API_ROOT)) {
          next();
          return;
        }

        try {
          const rest = decodeURIComponent(url.pathname.slice(API_ROOT.length));
          const idMatch = /^\/(DLV-\d{3})(?:\/(raw|transition|upload|publish|acknowledge|submit-result|close|reopen|due-date))?\/?$/u.exec(rest);

          if ((rest === '' || rest === '/') && req.method === 'GET') {
            refresh();
            json(res, 200, { ok: true, data: Array.from(cache.values()).map(itemSummary) });
            return;
          }

          if ((rest === '' || rest === '/') && req.method === 'POST') {
            await handleCreate(req, res);
            return;
          }

          if (rest === '/ledger' && req.method === 'GET') {
            refresh();
            json(res, 200, {
              ok: true,
              data: {
                controlled: Array.from(cache.values()).map(itemSummary),
                errors: scanErrors,
                suggestedNextId: suggestNextDeliverableId(cache),
              },
            });
            return;
          }

          if (rest === '/roster' && req.method === 'GET') {
            json(res, 200, { ok: true, data: readRoster() });
            return;
          }

          if (rest === '/publish-text' && req.method === 'POST') {
            await handlePublishTextArchive(req, res);
            return;
          }

          if (!idMatch) {
            next();
            return;
          }

          const [, id, action] = idMatch;
          const item = findItem(id);

          if (!action && req.method === 'GET') {
            if (!item) {
              errorJson(res, 404, 'NOT_FOUND', `${id} not found`);
              return;
            }
            json(res, 200, {
              ok: true,
              data: {
                deliverableId: id,
                fileName: item.fileName,
                frontmatter: item.frontmatter,
                body: item.body,
                raw: item.raw,
                mtime: item.mtime,
              },
            });
            return;
          }

          if (action === 'raw' && req.method === 'GET') {
            if (!item) {
              errorJson(res, 404, 'NOT_FOUND', `${id} not found`);
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.end(item.raw);
            return;
          }

          if (!action && req.method === 'PUT') {
            await handlePut(id, req, res);
            return;
          }

          if (action === 'transition' && req.method === 'POST') {
            await handleTransition(id, req, res);
            return;
          }

          if (action === 'upload' && req.method === 'POST') {
            await handleUpload(id, req, res);
            return;
          }

          if (action && EVENT_ACTIONS[action] && req.method === 'POST') {
            await handleEvent(id, req, res, EVENT_ACTIONS[action]);
            return;
          }

          errorJson(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} not allowed`);
        } catch (error) {
          const code = error.code || 'INTERNAL';
          errorJson(res, statusFromError(error), code, error.message || 'internal error');
        }
      });
    },
  };
}

export const _internal = {
  DELIVERABLES_DIR,
  RUNTIME_ROOT,
  HISTORY_DIR,
  createChangeEventPayload,
  readDeliverableFile,
  registerDeliverablesWatcher,
  scanDeliverables,
  writeAtomic,
};
