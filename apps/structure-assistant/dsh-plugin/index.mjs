import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_WORKSPACE_NAME = 100;

function workspaceError(status, code, message, details = {}) {
  return Object.assign(new Error(message), { status, code, ...details });
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function createWorkspaceStore(options = {}) {
  const now = options.now || Date.now;
  const workspaces = new Map();
  let activeWorkspaceId = null;

  function publicWorkspace(workspace, includeContent = false) {
    if (!workspace) return null;
    const result = {
      id: workspace.id,
      name: workspace.name,
      revision: workspace.revision,
      created_at: workspace.createdAt,
      updated_at: workspace.updatedAt
    };
    if (includeContent) result.content = clone(workspace.content);
    return result;
  }

  function normalizeName(value) {
    const name = String(value || '').trim();
    if (!name) throw workspaceError(400, 'WORKSPACE_NAME_REQUIRED', '请填写治理案例名称。');
    if (name.length > MAX_WORKSPACE_NAME || /[\u0000-\u001f\u007f]/.test(name)) {
      throw workspaceError(400, 'WORKSPACE_NAME_INVALID', '治理案例名称格式不正确。');
    }
    return name;
  }

  function create(nameValue) {
    const name = normalizeName(nameValue);
    const timestamp = new Date(now()).toISOString();
    const workspace = {
      id: crypto.randomUUID(),
      name,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      content: null
    };
    workspaces.set(workspace.id, workspace);
    activeWorkspaceId = workspace.id;
    return publicWorkspace(workspace);
  }

  function requireWorkspace(id) {
    const workspace = workspaces.get(String(id || ''));
    if (!workspace) throw workspaceError(404, 'WORKSPACE_NOT_FOUND', '治理工作区不存在或已经结束。');
    return workspace;
  }

  function activate(id) {
    const workspace = requireWorkspace(id);
    activeWorkspaceId = workspace.id;
    return publicWorkspace(workspace, true);
  }

  function save(id, expectedRevision, content) {
    const workspace = requireWorkspace(id);
    const expected = Number(expectedRevision);
    if (!Number.isInteger(expected) || expected !== workspace.revision) {
      throw workspaceError(409, 'STATE_CONFLICT', '工作区已有更新，请重新加载最新内容。', {
        currentRevision: workspace.revision
      });
    }
    workspace.content = clone(content);
    workspace.revision += 1;
    workspace.updatedAt = new Date(now()).toISOString();
    return publicWorkspace(workspace, true);
  }

  function remove(id) {
    const workspace = requireWorkspace(id);
    workspaces.delete(workspace.id);
    if (activeWorkspaceId === workspace.id) {
      activeWorkspaceId = workspaces.keys().next().value || null;
    }
  }

  function read() {
    const active = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;
    return {
      workspaces: [...workspaces.values()].map(item => publicWorkspace(item)),
      active_workspace_id: activeWorkspaceId,
      workspace: publicWorkspace(active, true)
    };
  }

  return { create, activate, save, remove, read };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw workspaceError(413, 'STATE_TOO_LARGE', '当前工作区内容过大，未保存。');
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw workspaceError(400, 'INVALID_JSON', '请求内容不是有效JSON。');
  }
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
}

function sendJson(res, status, value) {
  res.writeHead(status, securityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(value));
}

function sendError(res, error) {
  sendJson(res, Number(error?.status || 500), {
    error: Number(error?.status || 500) >= 500 ? 'DSH治理工作区暂时不可用。' : String(error?.message || '请求失败。'),
    code: String(error?.code || 'DSH_PLUGIN_FAILED'),
    ...(error?.code === 'STATE_CONFLICT' ? { current_revision: error.currentRevision } : {})
  });
}

function requireRuntimeToken(req, expectedToken) {
  if (!expectedToken || !safeEqual(req.headers['x-infomat-dsh-runtime'], expectedToken)) {
    throw workspaceError(401, 'DSH_RUNTIME_REQUIRED', '当前DSH运行实例不可用。');
  }
}

function dshIndex(source) {
  const workspaceCard = `
        <section class="api-key-card dsh-workspace-card" id="dshWorkspaceCard">
          <div>
            <p class="section-kicker">DSH治理工作区</p>
            <h2>当前治理案例</h2>
            <p id="dshWorkspaceStatus">正在读取当前登录会话内的治理案例……</p>
          </div>
          <div class="dsh-workspace-actions">
            <select id="dshWorkspaceSelect" aria-label="切换治理工作区"></select>
            <input id="dshWorkspaceName" maxlength="100" autocomplete="off" placeholder="输入新案例名称">
            <button class="button secondary" id="createDshWorkspaceButton" type="button">新建工作区</button>
            <button class="button secondary" id="reloadDshWorkspaceButton" type="button" hidden>重新加载最新状态</button>
            <button class="button ghost" id="endDshWorkspaceButton" type="button">结束当前工作区</button>
          </div>
        </section>`;
  return source
    .replace('<body>', '<body data-entry-mode="dsh">')
    .replace('<title>MDM-AI助手</title>', '<title>DSH · MDM-AI助手</title>')
    .replace('<h1>MDM-AI助手</h1>', '<h1>DSH流程与数据治理工作区</h1>')
    .replace('<section class="api-key-card" id="apiKeyCard"', `${workspaceCard}\n        <section class="api-key-card" id="apiKeyCard"`);
}

function contentType(filePath) {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

export const name = 'infomat-governance';
export const inject = ['webServer'];

export function apply(ctx, config = {}) {
  const publicRoot = path.resolve(String(config.publicRoot || ''));
  const structuredAssetsRoot = path.resolve(String(config.structuredAssetsRoot || ''));
  const runtimeToken = String(config.runtimeToken || '');
  const parentPid = Number(config.parentPid || 0);
  const store = createWorkspaceStore();
  const disposers = [];

  const route = (kind, routePath, handler) => {
    disposers.push(ctx.webServer.register({
      kind,
      path: routePath,
      handler: async (req, res) => {
        try {
          await handler(req, res);
        } catch (error) {
          sendError(res, error);
        }
      }
    }));
  };

  route('exact', '/', async (_req, res) => {
    const html = dshIndex(fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8'));
    res.writeHead(200, securityHeaders('text/html; charset=utf-8'));
    res.end(html);
  });
  route('exact', '/favicon.ico', async (_req, res) => {
    res.writeHead(204, securityHeaders('image/x-icon'));
    res.end();
  });

  const staticFiles = new Map([
    ['/app.js', path.join(publicRoot, 'app.js')],
    ['/styles.css', path.join(publicRoot, 'styles.css')],
    ['/assets/3001/cytoscape.min.js', path.join(structuredAssetsRoot, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js')],
    ['/assets/3001/process-diagram.js', path.join(structuredAssetsRoot, 'public', 'process-diagram.js')]
  ]);
  for (const [routePath, filePath] of staticFiles) {
    route('exact', routePath, async (_req, res) => {
      res.writeHead(200, securityHeaders(contentType(filePath)));
      fs.createReadStream(filePath).pipe(res);
    });
  }

  route('exact', '/infomat-health', async (req, res) => {
    requireRuntimeToken(req, runtimeToken);
    sendJson(res, 200, { ok: true, workspace_count: store.read().workspaces.length });
  });
  route('exact', '/infomat-state', async (req, res) => {
    requireRuntimeToken(req, runtimeToken);
    if (req.method !== 'GET') throw workspaceError(405, 'METHOD_NOT_ALLOWED', '请求方法不受支持。');
    sendJson(res, 200, store.read());
  });
  route('exact', '/infomat-state/active', async (req, res) => {
    requireRuntimeToken(req, runtimeToken);
    if (req.method !== 'PUT') throw workspaceError(405, 'METHOD_NOT_ALLOWED', '请求方法不受支持。');
    const body = await readJson(req);
    store.activate(body.workspace_id);
    sendJson(res, 200, store.read());
  });
  route('prefix', '/infomat-state/workspaces', async (req, res) => {
    requireRuntimeToken(req, runtimeToken);
    const pathname = new URL(req.url || '/', 'http://dsh.local').pathname;
    const id = decodeURIComponent(pathname.slice('/infomat-state/workspaces'.length).replace(/^\//, ''));
    if (!id && req.method === 'POST') {
      const body = await readJson(req);
      store.create(body.name);
    } else if (id && req.method === 'PUT') {
      const body = await readJson(req);
      store.save(id, body.expected_revision, body.content);
    } else if (id && req.method === 'DELETE') {
      store.remove(id);
    } else {
      throw workspaceError(405, 'METHOD_NOT_ALLOWED', '请求方法不受支持。');
    }
    sendJson(res, 200, store.read());
  });

  console.log(`infomat dsh ready: http://127.0.0.1:${String(ctx.webServer.port)}`);

  const parentMonitor = setInterval(() => {
    if (!Number.isInteger(parentPid) || parentPid <= 0) return;
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 2000);
  parentMonitor.unref();

  ctx.effect(() => () => {
    clearInterval(parentMonitor);
    for (const dispose of disposers.reverse()) dispose();
  }, 'infomat-governance.routes');
}

export default { name, inject, apply };
