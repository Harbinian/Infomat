import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from './api.js';
import { FormField, InputProtection, StatusPanel, useInputProtection, useUnsavedInput } from './components.jsx';
import './styles.css';
import { TemplateImport } from './TemplateImport.jsx';
import { ObjectManagement } from './ObjectManagement.jsx';
import { FactChecks } from './FactChecks.jsx';
import { DesignHandoffs } from './DesignHandoffs.jsx';
import { V7Mappings } from './V7Mappings.jsx';

const pages = { '/app/': '我的工作台', '/app/workbench': '我的工作台', '/app/identity': '当前身份', '/app/template-import':'模板导入', '/app/objects':'对象与字段', '/app/fact-checks':'事实核对', '/app/design-handoffs':'设计交接', '/app/v7-mappings':'V7 来源映射' };
const normalizedPath = () => window.location.pathname.replace(/\/$/, '') || '/';
function currentPath() { return normalizedPath() === '/app' ? '/app/' : normalizedPath(); }

function Login({ api, expired, onLoggedIn, onLegacy }) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [dirty, setDirty] = useUnsavedInput();
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const next = { loginName: !loginName.trim() ? '请填写工号或登录名。' : '', password: !password ? '请填写密码。' : '' };
    setErrors(next);
    if (next.loginName || next.password) { document.getElementById(next.loginName ? 'login-name' : 'login-password').focus(); return; }
    setBusy(true); setError(null);
    const controller = new AbortController(); active.current = controller;
    try {
      api.resetSession();
      await api.request('/api/org/login', { method: 'POST', body: { loginName: loginName.trim(), password }, signal: controller.signal });
      const identity = await api.request('/api/org/me', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDirty(false); setPassword(''); onLoggedIn(identity);
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(failure.status === 401 ? '工号或密码不正确，请核对后重试。' : failure.message);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <main className="login-layout">
    <section className="login-intro">
      <div className="brand"><img src="/logo.png" alt="" /><span>MDM 平台</span></div>
      <h1>从当前身份<br />进入治理工作</h1>
      <p>使用现有账号登录，继续查看和办理有权访问的事项。</p>
      <div className="intro-note"><strong>原有业务入口继续可用</strong><p>流程核对、数据治理和办公室办理仍在原入口完成。</p></div>
    </section>
    <section className="login-card" aria-labelledby="login-title">
      <span className="eyebrow">账号登录</span>
      <h2 id="login-title">{expired ? '请重新登录' : '登录 MDM 平台'}</h2>
      <p className="muted">{expired ? '登录状态已失效，请重新核对身份后继续。' : '沿用现有工号或登录名及密码。'}</p>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <FormField id="login-name" label="工号或登录名" autoComplete="username" value={loginName} disabled={busy} error={errors.loginName} onChange={e => { setLoginName(e.target.value); setDirty(Boolean(e.target.value || password)); }} />
        <FormField id="login-password" label="密码" type="password" autoComplete="current-password" value={password} disabled={busy} error={errors.password} onChange={e => { setPassword(e.target.value); setDirty(Boolean(loginName || e.target.value)); }} />
        {error && <StatusPanel kind="error" title="登录未完成">{error}</StatusPanel>}
        {dirty && <p className="input-notice">输入尚未提交，仅保留在当前页面。</p>}
        <button className="primary full" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
      </form>
      <a className="legacy-link" href="/" onClick={onLegacy}>使用原入口</a>
    </section>
  </main>;
}

function App() {
  const guard = useInputProtection();
  const [importDraft,setImportDraft] = useState(null);
  const [objectDraft,setObjectDraft] = useState(null);
  const [factDraft,setFactDraft] = useState(null);
  const [handoffDraft,setHandoffDraft] = useState(null);
  const [,setHandoffDirty] = useUnsavedInput();
  useEffect(()=>{setHandoffDirty(Boolean(handoffDraft?.dirty));},[handoffDraft]);
  const [mappingDraft,setMappingDraft] = useState(null);
  const [,setMappingDirty] = useUnsavedInput();
  useEffect(()=>{setMappingDirty(Boolean(mappingDraft?.dirty));},[mappingDraft]);
  const [,setFactDirty] = useUnsavedInput();
  useEffect(()=>{setFactDirty(Boolean(factDraft?.dirty));},[factDraft]);
  const [,setObjectDirty] = useUnsavedInput();
  useEffect(()=>{setObjectDirty(Boolean(objectDraft?.dirty));},[objectDraft]);
  const [,setImportDirty] = useUnsavedInput();
  useEffect(()=>{setImportDirty(Boolean(importDraft?.file&&!importDraft?.result));},[importDraft]);
  const [path, setPath] = useState(currentPath);
  const [session, setSession] = useState({ state: 'loading', user: null });
  const [requestState, setRequestState] = useState({ busy: false, error: null });
  const requestId = useRef(0);
  const active = useRef(null);
  const historyIndex = useRef(0);
  const skipPop = useRef(false);
  const heading = useRef(null);
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = createApiClient({ onUnauthorized: () => {
    setImportDraft(previous=>previous?{...previous,prepared:null}:previous);
    setSession({ state: 'expired', user: null });
  } });
  const api = apiRef.current;

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, mdmIndex: 0 }, '');
    const onPop = event => {
      if (skipPop.current) { skipPop.current = false; return; }
      const nextIndex = event.state?.mdmIndex ?? 0;
      if (!guard.confirmLeave()) {
        skipPop.current = true;
        window.history.go(historyIndex.current - nextIndex);
        return;
      }
      historyIndex.current = nextIndex; setImportDraft(null); setObjectDraft(null); setFactDraft(null); setMappingDraft(null); setHandoffDraft(null); setPath(currentPath());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [guard]);

  async function refresh(initial = false) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const id = ++requestId.current;
    setRequestState({ busy: true, error: null });
    try {
      if (initial) {
        const result = await api.request('/api/org/session', { signal: controller.signal });
        if (!result.authenticated) { setSession({ state: 'anonymous', user: null }); return; }
      }
      const user = await api.request('/api/org/me', { signal: controller.signal });
      if (id === requestId.current) setSession({ state: 'ready', user });
    } catch (error) {
      if (error.name !== 'AbortError' && id === requestId.current) {
        setRequestState({ busy: false, error, action: 'refresh' });
        if (initial && error.status !== 401) setSession({ state: 'error', user: null });
      }
    } finally {
      if (id === requestId.current) setRequestState(state => ({ ...state, busy: false }));
    }
  }
  useEffect(() => { refresh(true); return () => active.current?.abort(); }, []);
  useEffect(() => { if (session.state === 'ready') heading.current?.focus(); }, [path, session.state]);

  function navigate(event, target) {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    event?.preventDefault();
    if (!guard.confirmLeave()) return;
    if (!pages[target]) { window.location.assign(target); return; }
    if (path !== target) {
      setImportDraft(null);
      setObjectDraft(null);
      setFactDraft(null); setMappingDraft(null); setHandoffDraft(null);
      historyIndex.current += 1;
      window.history.pushState({ mdmIndex: historyIndex.current }, '', target); setPath(target);
    }
  }
  const legacy = event => navigate(event, event.currentTarget.getAttribute('href'));
  async function logout() {
    if (requestState.busy || !guard.confirmLeave()) return;
    active.current?.abort(); const id = ++requestId.current;
    setRequestState({ busy: true, error: null });
    try {
      await api.request('/api/org/logout', { method: 'POST' });
      api.resetSession(); setImportDraft(null); setObjectDraft(null); setFactDraft(null); setMappingDraft(null); setHandoffDraft(null); setSession({ state: 'anonymous', user: null });
    } catch (error) { if (error.name !== 'AbortError') setRequestState({ busy: false, error, action: 'logout' }); }
    finally { if (id === requestId.current) setRequestState(state => ({ ...state, busy: false })); }
  }
  if (session.state === 'loading') return <main className="startup"><StatusPanel kind="loading" title="正在核对登录状态…">请稍候。</StatusPanel></main>;
  if (session.state === 'error') return <main className="startup"><StatusPanel kind="error" title="暂时无法读取身份" onRetry={() => refresh(true)}>{requestState.error?.message}</StatusPanel><a href="/" onClick={legacy}>返回原入口</a></main>;
  if (session.state !== 'ready') return <Login api={api} expired={session.state === 'expired'} onLegacy={legacy} onLoggedIn={user => { ++requestId.current; setRequestState({ busy: false, error: null }); setSession({ state: 'ready', user }); }} />;

  const user = session.user;
  const roles = user.rbacRoles || [];
  return <div className="app-shell">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="app-header">
      <div className="brand"><img src="/logo.png" alt="" /><span>MDM 平台</span></div>
      <div className="header-identity"><strong>{user.personName || user.name}</strong><span>{user.departmentName || '部门待明确'}</span><button className="secondary" onClick={logout} disabled={requestState.busy}>退出登录</button></div>
    </header>
    <aside className="sidebar" aria-label="平台导航">
      <p className="nav-caption">我的工作</p>
      <a href="/app/workbench" aria-current={['/app/','/app/workbench'].includes(path) ? 'page' : undefined} onClick={e => navigate(e, '/app/workbench')}>我的工作台</a>
      <a href="/app/identity" aria-current={path === '/app/identity' ? 'page' : undefined} onClick={e => navigate(e, '/app/identity')}>当前身份</a>
      <a href="/app/template-import" aria-current={path === '/app/template-import' ? 'page' : undefined} onClick={e=>navigate(e,'/app/template-import')}>模板导入</a>
      <a href="/app/objects" aria-current={path === '/app/objects' ? 'page' : undefined} onClick={e=>navigate(e,'/app/objects')}>对象与字段</a>
      <a href="/app/fact-checks" aria-current={path === '/app/fact-checks' ? 'page' : undefined} onClick={e=>navigate(e,'/app/fact-checks')}>事实核对</a>
      <a href="/app/design-handoffs" aria-current={path === '/app/design-handoffs' ? 'page' : undefined} onClick={e=>navigate(e,'/app/design-handoffs')}>设计交接</a>
      <a href="/app/v7-mappings" aria-current={path === '/app/v7-mappings' ? 'page' : undefined} onClick={e=>navigate(e,'/app/v7-mappings')}>V7 来源映射</a>
      <div className="nav-footer"><p>现有业务办理</p><a href="/" onClick={legacy}>进入原入口 ↗</a></div>
    </aside>
    <main id="main" className="workspace">
      <div className="page-heading"><div><p className="eyebrow">MDM / {pages[path] || '页面'}</p><h1 ref={heading} tabIndex={-1}>{pages[path] || '未找到页面'}</h1></div><button className="secondary" disabled={requestState.busy} onClick={() => refresh()}>{requestState.busy ? '正在核对…' : '刷新身份'}</button></div>
      {requestState.error && <StatusPanel kind="error" title="操作未完成" onRetry={requestState.action === 'logout' ? logout : () => refresh()}>{requestState.error.message}</StatusPanel>}
      {path === '/app/design-handoffs' ? <DesignHandoffs key={`${user.personId}:${user.departmentId}`} api={api} draft={handoffDraft} setDraft={setHandoffDraft}/> : path === '/app/v7-mappings' ? <V7Mappings key={`${user.personId}:${user.departmentId}`} api={api} draft={mappingDraft} setDraft={setMappingDraft}/> : path === '/app/fact-checks' ? <FactChecks key={`${user.personId}:${user.departmentId}`} api={api} draft={factDraft} setDraft={setFactDraft}/> : path === '/app/objects' ? <ObjectManagement key={`${user.personId}:${user.departmentId}`} api={api} draft={objectDraft} setDraft={setObjectDraft}/> : path === '/app/template-import' ? <TemplateImport api={api} draft={importDraft} setDraft={setImportDraft}/> : path === '/app/identity' ? <>
        <section className="card"><h2>当前账号与归属</h2><p className="muted">以下信息来自当前登录身份；角色和访问范围由服务端核对。</p>
          <dl className="identity-grid"><div><dt>姓名</dt><dd>{user.personName || user.name || '未填写'}</dd></div><div><dt>工号</dt><dd>{user.employeeNo || '未填写'}</dd></div><div><dt>所属部门</dt><dd>{user.departmentName || '待明确'}</dd></div><div><dt>账号状态</dt><dd>{user.accountStatus === 'active' ? '有效' : '请核对账号状态'}</dd></div></dl>
        </section>
        <section className="card"><h2>有效工作角色</h2>{roles.length ? <ul className="role-list">{roles.map((role, index) => <li key={`${role.code}-${index}`}><strong>{role.name || role.code}</strong><span>{role.scope_type === 'global' || role.scopeType === 'global' ? '全局范围' : '按已授权范围'}</span></li>)}</ul> : <StatusPanel title="暂无有效工作角色">请联系账号管理人员核对授权。当前身份不会自动获得业务权限。</StatusPanel>}</section>
      </> : <>
        <section className="welcome card"><span className="badge">当前身份已核对</span><h2>我现在该做什么</h2><p>先进入现有工作台查看待办，再按事项进入对应办理页面。</p><a className="primary button-link" href="/#/roleWorkbench" onClick={legacy}>查看我的待办 ↗</a></section>
        <section className="card"><div className="section-heading"><h2>常用入口</h2><span className="muted">继续使用现有办理流程</span></div><div className="entry-grid"><a href="/#/processGovernance" onClick={legacy}><strong>流程与数据治理 <span>↗</span></strong><p>查看 V7 核对和数据治理工作。</p></a><a href="/#/dataMap" onClick={legacy}><strong>数据地图 <span>↗</span></strong><p>查阅有权访问的对象和字段。</p></a></div></section>
        <StatusPanel title="模板、台账与事实核对已接入新入口">可从导航导入模板，进入对象与字段补充事实、查看版本，再从事实核对办理清单答复定向问题。</StatusPanel>
      </>}
      <footer className="workspace-footer">办理权限以当前身份和事项范围为准。</footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<InputProtection><App /></InputProtection>);
