// Shared request and page contracts for Express and the current Vite frontend.
(function(root,factory){ const value=factory(); root.MdmProtocol=value; if(typeof module==='object'&&module.exports)module.exports=value; })(typeof globalThis!=='undefined'?globalThis:this,function(){
  // Two-level navigation: each navigable page declares its parent group; groups
  // and pages are ordered along the actual governance business flow, so the
  // retained `navigation` sequence already carries the flattened display order.
  const navigationGroups=Object.freeze([
    { "code": "myWork", "title": "我的工作" },
    { "code": "processGovernance", "title": "流程治理" },
    { "code": "dataGovernance", "title": "数据治理" },
    { "code": "outcomes", "title": "成果查阅" },
    { "code": "management", "title": "管理与辅助" }
  ].map(Object.freeze));
  const pages=Object.freeze([
  {
    "href": "/app/workbench",
    "title": "我的工作台",
    "serverPath": "/workbench",
    "navigation": 0,
    "group": "myWork"
  },
  {
    "href": "/app/todos",
    "title": "待办收到",
    "serverPath": "/todos",
    "navigation": 1,
    "group": "myWork"
  },
  {
    "href": "/app/offices",
    "title": "办公室工作台",
    "serverPath": "/offices",
    "navigation": 2,
    "group": "myWork"
  },
  {
    "href": "/app/identity",
    "title": "当前身份",
    "serverPath": "/identity",
    "navigation": 3,
    "group": "myWork"
  },
  {
    "href": "/app/process-preview",
    "title": "流程预览与核对",
    "serverPath": "/process-preview",
    "navigation": 4,
    "group": "processGovernance"
  },
  {
    "href": "/app/process-formal",
    "title": "流程正式流转",
    "serverPath": "/process-formal",
    "navigation": 5,
    "group": "processGovernance"
  },
  {
    "href": "/app/v7-mappings",
    "title": "固定来源映射",
    "serverPath": "/v7-mappings",
    "navigation": 6,
    "group": "processGovernance"
  },
  {
    "href": "/app/design-handoffs",
    "title": "设计交接",
    "serverPath": "/design-handoffs",
    "navigation": 7,
    "group": "processGovernance"
  },
  {
    "href": "/app/analysis",
    "title": "分析检查台",
    "serverPath": "/analysis",
    "navigation": 8,
    "group": "processGovernance"
  },
  {
    "href": "/app/data-governance",
    "title": "正式数据治理工作包",
    "serverPath": "/data-governance",
    "navigation": 9,
    "group": "dataGovernance"
  },
  {
    "href": "/app/data-map",
    "title": "数据地图台账",
    "serverPath": "/data-map",
    "navigation": 10,
    "group": "outcomes"
  },
  {
    "href": "/app/publications",
    "title": "主数据发布",
    "serverPath": "/publications",
    "navigation": 11,
    "group": "outcomes"
  },
  {
    "href": "/app/organization",
    "title": "组织架构",
    "serverPath": "/organization",
    "navigation": 12,
    "group": "management"
  },
  {
    "href": "/app/roster",
    "title": "花名册",
    "serverPath": "/roster",
    "navigation": 13,
    "group": "management"
  },
  {
    "href": "/app/roles",
    "title": "角色详细管理",
    "serverPath": "/roles",
    "navigation": 14,
    "group": "management"
  },
  {
    "href": "/app/role-guide",
    "title": "角色与责任",
    "serverPath": "/role-guide",
    "navigation": 15,
    "group": "management"
  },
  {
    "href": "/app/terms",
    "title": "术语词典",
    "serverPath": "/terms",
    "navigation": 16,
    "group": "management"
  },
  {
    "href": "/app/conflicts",
    "title": "冲突管理",
    "serverPath": "/conflicts",
    "navigation": 17,
    "group": "management"
  },
  {
    "href": "/app/quality",
    "title": "数据质量",
    "serverPath": "/quality",
    "navigation": 18,
    "group": "management"
  },
  {
    "href": "/app/accounts",
    "title": "账号与授权办理",
    "serverPath": "/accounts",
    "navigation": 19,
    "group": "management"
  },
  {
    "href": "/app/access-audit",
    "title": "访问审计",
    "serverPath": "/access-audit",
    "navigation": 20,
    "group": "management"
  },
  {
    "href": "/app/dashboard",
    "title": "统计看板",
    "serverPath": "/dashboard",
    "navigation": 21,
    "group": "management"
  },
  {
    "href": "/app/template-import",
    "title": "模板导入",
    "serverPath": "/template-import",
    "navigation": 22,
    "group": "management"
  },
  {
    "href": "/app/objects",
    "title": "对象与字段",
    "serverPath": "/objects",
    "navigation": 23,
    "group": "management"
  },
  {
    "href": "/app/fact-checks",
    "title": "事实核对",
    "serverPath": "/fact-checks",
    "navigation": 24,
    "group": "management"
  },
  {
    "href": "/app/password",
    "title": "修改本人密码",
    "serverPath": "/password",
    "navigation": null
  },
  {
    "href": "/app/",
    "title": "我的工作台",
    "serverPath": "/",
    "navigation": null
  }
].map(Object.freeze));
  function aborted() { return new DOMException('Request replaced', 'AbortError'); }
  function waitFor(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted()); };
      signal.addEventListener('abort', cancel, { once: true });
      promise.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
    });
  }
  // A session belongs to one client. A cancelled waiter never cancels another
  // caller's shared CSRF read; only invalidation or reset owns that cancellation.
  function createRequestSession() {
    let generation = 0, tokenEpoch = 0, token = null, pending = null;
    const loads = new Set();
    function invalidate() {
      tokenEpoch++; token = null; pending = null;
      for (const controller of loads) controller.abort();
      loads.clear();
    }
    return Object.freeze({
      get generation() { return generation; },
      reset() { generation++; invalidate(); },
      invalidateToken: invalidate,
      csrf(load, { share = true, signal } = {}) {
        if (signal?.aborted) return Promise.reject(aborted());
        if (token) return Promise.resolve(token);
        const started = generation, startedEpoch = tokenEpoch;
        if (!pending || !share) {
          const controller = new AbortController(); loads.add(controller);
          const attempt = Promise.resolve().then(() => load({ signal: controller.signal })).then(value => {
            if (started !== generation || startedEpoch !== tokenEpoch) throw aborted();
            token = value; return value;
          });
          attempt.finally(() => { loads.delete(controller); if (pending === attempt) pending = null; }).catch(() => {});
          if (!share) return waitFor(attempt, signal);
          pending = attempt;
        }
        return waitFor(pending, signal);
      }
    });
  }
  class RequestError extends Error {
    constructor(status, body, code) {
      const receipt = errorReceipt(status, body);
      super(receipt.message);
      Object.assign(this, receipt, { body, code: code || receipt.code });
      this.name = 'RequestError';
    }
  }
  function apiPath(input, origin) {
    const value = typeof input === 'string' ? input : input?.url;
    if (typeof value !== 'string' || /[\\\s]/.test(value) || value.includes('..')) throw new Error('Only same-origin API paths are allowed.');
    let path = value;
    if (!value.startsWith('/api/')) {
      if (!origin) throw new Error('Only same-origin API paths are allowed.');
      const url = new URL(value, origin);
      if (url.origin !== origin) throw new Error('Only same-origin API paths are allowed.');
      path = url.pathname + url.search;
    }
    if (!path.startsWith('/api/') || path.includes('#')) throw new Error('Only same-origin API paths are allowed.');
    // Reject encoded traversal and backslashes before sending credentials.
    let decoded;
    try { decoded = decodeURIComponent(path.split('?')[0]); } catch { throw new Error('Only same-origin API paths are allowed.'); }
    if (decoded.includes('..') || decoded.includes('\\')) throw new Error('Only same-origin API paths are allowed.');
    return path;
  }
  // Transport, cancellation, CSRF, response ownership and authentication are
  // implemented once. UI adapters only choose encoding and error presentation.
  // Construction does no IO; fetch and timers can be injected for isolated tests.
  function createRequestClient({ fetchImpl = globalThis.fetch, onUnauthorized = () => {}, timeoutMs = 15000, origin = globalThis.location?.origin, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const session = createRequestSession();
    const loginPath = '/api/org/login';
    function context(input, options) {
      const controller = new AbortController();
      const externalSignal = options.signal || (typeof input === 'object' ? input.signal : undefined);
      const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
      const timer = timeoutMs > 0 ? setTimer(() => controller.abort(), timeoutMs) : null;
      return { path: apiPath(input, origin), generation: session.generation, controller, externalSignal, signal, timer, silentUnauthorized: !!options.silentUnauthorized };
    }
    function guard(state) {
      if (state.signal.aborted || state.generation !== session.generation) throw aborted();
    }
    function settleStatus(response, state) {
      if (response.status === 401 && state.path !== loginPath) {
        session.reset();
        // This response may still deliver its own error body. Other responses
        // from the expired session are rejected by their earlier generation.
        state.generation = session.generation;
        onUnauthorized({ url: state.path, silentUnauthorized: state.silentUnauthorized });
      }
      if (response.status === 403) session.invalidateToken();
    }
    function failure(error, state) {
      if (error instanceof RequestError) return error;
      if (state.externalSignal?.aborted || state.generation !== session.generation) return aborted();
      if (error.name === 'AbortError' && !state.controller.signal.aborted) return error;
      return new RequestError(0, null, state.controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    }
    async function readCsrf({ signal }) {
      const state = context('/api/csrf-token', { signal });
      try {
        guard(state);
        const response = await fetchImpl('/api/csrf-token', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: state.signal });
        guard(state);
        const data = await response.json().catch(() => null);
        guard(state); settleStatus(response, state);
        if (!response.ok) throw new RequestError(response.status, data);
        if (!data || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new RequestError(502, data, 'INVALID_RESPONSE');
        return data.csrfToken;
      } catch (error) { throw failure(error, state); }
      finally { if (state.timer !== null) clearTimer(state.timer); }
    }
    async function exchange(input, options, state) {
      guard(state);
      const method = String(options.method || (typeof input === 'object' ? input.method : '') || 'GET').toUpperCase();
      const headers = new Headers(options.headers || (typeof input === 'object' ? input.headers : undefined));
      const requestOptions = { ...options, method, headers, credentials: 'same-origin', cache: 'no-store', signal: state.signal };
      for (const key of ['responseType', 'bodyEncoding', 'silentUnauthorized']) delete requestOptions[key];
      if (options.body !== undefined && options.bodyEncoding === 'json') {
        const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
        if (!multipart) { headers.set('Content-Type', 'application/json'); requestOptions.body = JSON.stringify(options.body); }
      }
      if (isApiWrite(state.path, method)) {
        headers.set('X-CSRF-Token', await session.csrf(readCsrf, { signal: state.signal }));
        guard(state);
      }
      const names = { accept: 'Accept', 'content-type': 'Content-Type', 'x-csrf-token': 'X-CSRF-Token' };
      requestOptions.headers = Object.fromEntries(Array.from(headers, ([name, value]) => [names[name] || name, value]));
      const response = await fetchImpl(input, requestOptions);
      guard(state); return response;
    }
    async function request(input, options = {}) {
      // Validate before allocating a timer, so rejected paths own no resources.
      apiPath(input, origin);
      const state = context(input, options);
      try {
        const response = await exchange(input, options, state);
        const responseType = options.responseType || 'json';
        let data;
        if (responseType === 'text-json') {
          const text = await response.text();
          data = {};
          if (text) { try { data = JSON.parse(text); } catch { data = text; } }
        } else {
          data = response.status === 204 ? null : response.ok && responseType === 'blob' ? await response.blob() : await response.json().catch(() => null);
        }
        guard(state); settleStatus(response, state);
        if (!response.ok) throw new RequestError(response.status, data);
        if (data === null && response.status !== 204 && responseType !== 'text-json') throw new RequestError(502, data, 'INVALID_RESPONSE');
        return data;
      } catch (error) { throw failure(error, state); }
      finally { if (state.timer !== null) clearTimer(state.timer); }
    }
    function guardedResponse(response, state) {
      const readers = new Set(['text', 'json', 'blob', 'arrayBuffer', 'formData', 'bytes']);
      return new Proxy(response, { get(target, property) {
        if (readers.has(property) && typeof target[property] === 'function') return async (...args) => {
          guard(state); const value = await target[property](...args); guard(state); return value;
        };
        if (property === 'clone') return () => { guard(state); return guardedResponse(target.clone(), state); };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    async function fetch(input, options = {}) {
      apiPath(input, origin);
      const state = context(input, options);
      try {
        const response = await exchange(input, options, state);
        settleStatus(response, state);
        return guardedResponse(response, state);
      } catch (error) { throw failure(error, state); }
      finally { if (state.timer !== null) clearTimer(state.timer); }
    }
    async function ensureCsrfToken({ signal } = {}) {
      const state = context('/api/csrf-token', { signal });
      try {
        guard(state);
        const token = await session.csrf(readCsrf, { signal: state.signal });
        guard(state); return token;
      } catch (error) { throw failure(error, state); }
      finally { if (state.timer !== null) clearTimer(state.timer); }
    }
    return Object.freeze({ request, fetch, ensureCsrfToken, resetSession: () => session.reset(), invalidateToken: () => session.invalidateToken(), get generation() { return session.generation; } });
  }
  function errorReceipt(status,body){const data=body&&typeof body==='object'?body:{};return {status,code:data.code,fieldErrors:data.field_errors||{},importStatus:data.import_status,details:data.details,message:data.error||'HTTP '+status};}
  function isApiWrite(url,method){return typeof url==='string'&&url.startsWith('/api/')&&url!=='/api/org/login'&&!['GET','HEAD','OPTIONS'].includes(String(method||'GET').toUpperCase());}
function targetHref(target) {
  if (typeof target !== 'string' || /[\\\s]/.test(target)) return null;
  const aliases = { roleWorkbench:'workbench', todos:'todos', officeWorkbench:'offices',
    dataMap:'data-map', quality:'quality', publications:'publications', orgUnits:'organization',
    persons:'roster', rbac:'accounts', roleGuide:'role-guide', dashboard:'dashboard',
    terms:'terms', conflicts:'conflicts', templateImport:'template-import',
    objectManagement:'objects', factChecks:'fact-checks', v7Mappings:'v7-mappings',
    designHandoffs:'design-handoffs', analysis:'analysis', processFormal:'process-formal' };
  if (!target.startsWith('/app/')) {
    // Historical stored API targets remain readable, but always resolve to current pages.
    const match = target.match(/^(?:#\/)?([A-Za-z][A-Za-z0-9]*)(?:\?([^#]*))?$/);
    if (!match) return null;
    const query = new URLSearchParams(match[2] || '');
    let route = aliases[match[1]];
    if (match[1] === 'processGovernance') {
      const workspace = query.get('workspace'); query.delete('workspace');
      route = workspace === 'dataGovernance' ? 'data-governance' : workspace === 'v7Preview' ? 'process-preview' : null;
      if (query.has('v7Case')) { query.set('case', query.get('v7Case')); query.delete('v7Case'); }
    }
    if (!route) return null;
    target = '/app/' + route + (query.size ? '?' + query.toString() : '');
  }
  try {
    const url = new URL(target, 'http://mdm.invalid');
    if (url.origin !== 'http://mdm.invalid' || !pages.some(page => page.href === url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
  return Object.freeze({pages,navigationGroups,createRequestSession,createRequestClient,RequestError,errorReceipt,isApiWrite,targetHref});
});
