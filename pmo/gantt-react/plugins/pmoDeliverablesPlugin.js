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
  transitionDeliverableStatus,
} from '../src/utils/deliverableWorkflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DELIVERABLES_DIR = path.resolve(__dirname, '../../deliverables');
export const HISTORY_DIR = path.join(DELIVERABLES_DIR, '_history');

const FILENAME_RE = /^DLV-(\d{3})-[^/\\]+\.md$/u;
const API_ROOT = '/api/pmo/deliverables';
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

function isDeliverableMarkdown(fileName) {
  return FILENAME_RE.test(fileName);
}

function idFromFileName(fileName) {
  const match = FILENAME_RE.exec(fileName);
  return match ? `DLV-${match[1]}` : '';
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
  if (error?.code === 'WRITE_CONFLICT') return 409;
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

async function copySnapshot(filePath, id, historyRoot, event) {
  const action = event?.action || '';
  if (!['approve', 'archive'].includes(action)) return '';
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

function scanDeliverables({ deliverablesDir = DELIVERABLES_DIR, warn = console.warn } = {}) {
  cleanupTempFiles(deliverablesDir);
  const out = new Map();
  if (!fs.existsSync(deliverablesDir)) return out;

  const groups = new Map();
  for (const entry of fs.readdirSync(deliverablesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isDeliverableMarkdown(entry.name)) continue;
    const id = idFromFileName(entry.name);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry.name);
  }

  for (const [id, fileNames] of groups) {
    if (fileNames.length > 1) {
      warn(`[pmo-deliverables] ${id} 存在多份正本,已跳过: ${fileNames.join(', ')}`);
      continue;
    }
    const fileName = fileNames[0];
    const filePath = path.join(deliverablesDir, fileName);
    try {
      const item = readDeliverableFile(filePath);
      if (item.frontmatter.deliverableId !== id) {
        throw new DeliverableFsError('SCHEMA_INVALID', `${fileName} 的 deliverableId 与文件名不一致`);
      }
      out.set(id, item);
    } catch (error) {
      warn(`[pmo-deliverables] 跳过 ${fileName}: ${error.message}`);
    }
  }

  return out;
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
  };
}

export async function applyTransitionToFile(filePath, command, { historyRoot = HISTORY_DIR } = {}) {
  const beforeRaw = await fsp.readFile(filePath, 'utf8');
  const parsed = parseDeliverableFrontmatter(beforeRaw);
  validateDeliverableFrontmatter(parsed.frontmatter);
  const before = deliverableFromFrontmatter(parsed.frontmatter);
  const next = transitionDeliverableStatus(before, command);
  const event = next.workflowHistory.at(-1);
  const nextFrontmatter = {
    ...parsed.frontmatter,
    status: next.deliverableStatus,
    actualSubmitDate: next._actualSubmitDate || '',
    actualPassDate: next._actualPassDate || '',
    actualArchiveDate: next._actualArchiveDate || '',
    reviewOpinion: next.reviewOpinion || '',
    evidence: next.evidence || parsed.frontmatter.evidence || null,
    workflowHistory: next.workflowHistory || [],
  };
  const nextBody = upsertChangeLogTable(parsed.body, nextFrontmatter.workflowHistory);
  const nextRaw = stringifyDeliverableFrontmatter({ frontmatter: nextFrontmatter, body: nextBody });
  await writeAtomic(filePath, nextRaw);
  const snapshotPath = await copySnapshot(filePath, nextFrontmatter.deliverableId, historyRoot, event);
  const stat = await fsp.stat(filePath);
  return { mtime: stat.mtimeMs, status: nextFrontmatter.status, snapshotPath, event };
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

export function pmoDeliverablesPlugin({ deliverablesDir = DELIVERABLES_DIR, historyDir = HISTORY_DIR } = {}) {
  let cache = new Map();

  const refresh = () => {
    cache = scanDeliverables({ deliverablesDir });
    return cache;
  };

  const findItem = id => {
    refresh();
    return cache.get(id);
  };

  const filePathFor = (id, frontmatter) => {
    const existing = cache.get(id);
    if (existing) return existing.filePath;
    return path.join(deliverablesDir, safeDeliverableFileName(id, frontmatter.title || id));
  };

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
        archivePath: path.relative(deliverablesDir, archivePath).replace(/\\/g, '/'),
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

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith(API_ROOT)) {
          next();
          return;
        }

        try {
          const rest = decodeURIComponent(url.pathname.slice(API_ROOT.length));
          const idMatch = /^\/(DLV-\d{3})(?:\/(raw|transition|upload))?\/?$/u.exec(rest);

          if ((rest === '' || rest === '/') && req.method === 'GET') {
            refresh();
            json(res, 200, { ok: true, data: Array.from(cache.values()).map(itemSummary) });
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
  HISTORY_DIR,
  createChangeEventPayload,
  readDeliverableFile,
  registerDeliverablesWatcher,
  scanDeliverables,
  writeAtomic,
};
