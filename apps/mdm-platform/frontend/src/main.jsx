import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from './api.js';
import { FormField, InputProtection, StatusPanel, useInputProtection, useUnsavedInput } from './components.jsx';
import './styles.css';
import { TemplateImport } from './TemplateImport.jsx';
import { ObjectManagement } from './ObjectManagement.jsx';
import { FactChecks } from './FactChecks.jsx';
import { DesignHandoffs } from './DesignHandoffs.jsx';
import { AnalysisWorkbench } from './AnalysisWorkbench.jsx';
import { ProcessPreview } from './ProcessPreview.jsx';
import { ProcessFormal } from './ProcessFormal.jsx';
import { AccountManagement } from './AccountManagement.jsx';
const GovernanceUtilities = lazy(() => import('./GovernanceUtilities.jsx').then(module => ({ default: module.GovernanceUtilities })));
import { AccessAudit } from './AccessAudit.jsx';
const Publications = lazy(() => import('./Publications.jsx').then(module => ({ default: module.Publications })));
import { Directory } from './Directory.jsx';
import { RoleManagement } from './RoleManagement.jsx';
const RoleGuide = lazy(() => import('./RoleGuide.jsx').then(module => ({ default: module.RoleGuide })));
const DataMapRead = lazy(() => import('./DataMapRead.jsx').then(module => ({ default: module.DataMapRead })));
const Quality = lazy(() => import('./Quality.jsx').then(module => ({ default: module.Quality })));
import { Dashboard } from './Dashboard.jsx';
import { OfficeWorkbench } from './OfficeWorkbench.jsx';
import { DataGovernance } from './DataGovernance.jsx';
import { RoleWorkbench } from './RoleWorkbench.jsx';
import { V7Mappings } from './V7Mappings.jsx';

const TodoInbox = lazy(() => import('./TodoInbox.jsx').then(module => ({ default: module.TodoInbox })));
const pages = { '/app/role-guide': '角色与责任', '/app/todos': '待办收到', '/app/data-map':'数据地图台账', '/app/quality':'数据质量', '/app/publications':'主数据发布', '/app/terms':'术语词典', '/app/conflicts':'冲突管理', '/app/accounts':'账号与授权办理', '/app/access-audit':'访问审计', '/app/organization':'组织架构', '/app/roster':'花名册', '/app/roles': '角色详细管理', '/app/dashboard': '统计看板', '/app/offices': '办公室工作台', '/app/data-governance': '正式数据治理工作包', '/app/process-formal': '流程正式流转', '/app/process-preview': '流程预览与核对', '/app/analysis': '分析检查台', '/app/': '我的工作台', '/app/workbench': '我的工作台', '/app/identity': '当前身份', '/app/template-import':'模板导入', '/app/objects':'对象与字段', '/app/fact-checks':'事实核对', '/app/design-handoffs':'设计交接', '/app/v7-mappings':'V7 来源映射' };
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
      <div className="intro-note"><strong>原有业务入口继续可用</strong><p>可在新入口办理流程预览与核对；正式流转也可在新入口办理；正式数据治理工作包已提供新页面，办公室办理已提供新页面。</p></div>
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
  const [fieldIdentityDraft, setFieldIdentityDraft] = useState(null);
  const [, setFieldIdentityDirty] = useUnsavedInput();
  useEffect(() => { setFieldIdentityDirty(Boolean(fieldIdentityDraft?.dirty)); }, [fieldIdentityDraft]);
  const [fieldImportDraft, setFieldImportDraft] = useState(null);
  const fieldImportRef = useRef(null);
  fieldImportRef.current = fieldImportDraft;
  const [, setFieldImportDirty] = useUnsavedInput();
  useEffect(() => { setFieldImportDirty(Boolean(fieldImportDraft?.dirty)); }, [fieldImportDraft]);
  const [contextDraft,setContextDraft]=useState(null);
  const [,setContextDirty]=useUnsavedInput();
  useEffect(()=>{setContextDirty(Boolean(contextDraft?.dirty));},[contextDraft]);
  const [utilityDraft,setUtilityDraft]=useState(null);
  const [,setUtilityDirty]=useUnsavedInput();
  useEffect(()=>{setUtilityDirty(Boolean(utilityDraft?.dirty));},[utilityDraft]);
  const [identityDraft,setIdentityDraft]=useState(null);
  const [,setIdentityDirty]=useUnsavedInput();
  useEffect(()=>{setIdentityDirty(Boolean(identityDraft?.dirty));},[identityDraft]);
  const [officeDraft, setOfficeDraft] = useState(null);
  const [, setOfficeDirty] = useUnsavedInput();
  useEffect(() => { setOfficeDirty(Boolean(officeDraft?.dirty)); }, [officeDraft]);
  const [governanceDraft, setGovernanceDraft] = useState(null);
  const [, setGovernanceDirty] = useUnsavedInput();
  useEffect(() => { setGovernanceDirty(Boolean(governanceDraft?.dirty)); }, [governanceDraft]);
  const [formalDraft, setFormalDraft] = useState(null);
  const [, setFormalDirty] = useUnsavedInput();
  useEffect(() => { setFormalDirty(Boolean(formalDraft?.dirty)); }, [formalDraft]);
  const [previewDraft, setPreviewDraft] = useState(null);
  const [, setPreviewDirty] = useUnsavedInput();
  useEffect(() => { setPreviewDirty(Boolean(previewDraft?.dirty)); }, [previewDraft]);
  const [analysisDraft,setAnalysisDraft] = useState(null);
  const [,setAnalysisDirty] = useUnsavedInput();
  useEffect(()=>{setAnalysisDirty(Boolean(analysisDraft?.dirty));},[analysisDraft]);
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
  const activePath = useRef(path); activePath.current = path;
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
      // Diagram history changes only the selected read-only source; keep neighboring drafts.
      if (activePath.current === '/app/data-map' && currentPath() === '/app/data-map') { historyIndex.current = nextIndex; return; }
      if (!guard.confirmLeave()) {
        skipPop.current = true;
        window.history.go(historyIndex.current - nextIndex);
        return;
      }
      historyIndex.current = nextIndex; setImportDraft(null); setObjectDraft(null); setFactDraft(null); setMappingDraft(null); setHandoffDraft(null); setAnalysisDraft(null); setPreviewDraft(null); setFormalDraft(null); setGovernanceDraft(null); setOfficeDraft(null); setIdentityDraft(null); setUtilityDraft(null); setContextDraft(null); setFieldImportDraft(null); setFieldIdentityDraft(null); setPath(currentPath());
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
      setFactDraft(null); setMappingDraft(null); setHandoffDraft(null); setAnalysisDraft(null); setPreviewDraft(null); setFormalDraft(null); setGovernanceDraft(null); setOfficeDraft(null); setIdentityDraft(null); setUtilityDraft(null); setContextDraft(null); setFieldImportDraft(null); setFieldIdentityDraft(null);
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
      api.resetSession(); setImportDraft(null); setObjectDraft(null); setFactDraft(null); setMappingDraft(null); setHandoffDraft(null); setAnalysisDraft(null); setPreviewDraft(null); setFormalDraft(null); setGovernanceDraft(null); setOfficeDraft(null); setIdentityDraft(null); setUtilityDraft(null); setContextDraft(null); setFieldImportDraft(null); setFieldIdentityDraft(null); setSession({ state: 'anonymous', user: null });
    } catch (error) { if (error.name !== 'AbortError') setRequestState({ busy: false, error, action: 'logout' }); }
    finally { if (id === requestId.current) setRequestState(state => ({ ...state, busy: false })); }
  }
  if (session.state === 'loading') return <main className="startup"><StatusPanel kind="loading" title="正在核对登录状态…">请稍候。</StatusPanel></main>;
  if (session.state === 'error') return <main className="startup"><StatusPanel kind="error" title="暂时无法读取身份" onRetry={() => refresh(true)}>{requestState.error?.message}</StatusPanel><a href="/" onClick={legacy}>返回原入口</a></main>;
  if (session.state !== 'ready') return <Login api={api} expired={session.state === 'expired'} onLegacy={legacy} onLoggedIn={user => { if (contextDraft?.owner !== `${user.personId}:${user.departmentId}`) setContextDraft(null); if (fieldImportDraft?.owner !== `${user.personId}:${user.departmentId}`) setFieldImportDraft(null); if (fieldIdentityDraft?.owner !== `${user.personId}:${user.departmentId}`) setFieldIdentityDraft(null); if (utilityDraft?.owner !== `${user.personId}:${user.departmentId}`) setUtilityDraft(null); if (identityDraft?.owner !== `${user.personId}:${user.departmentId}`) setIdentityDraft(null); if (officeDraft?.owner !== `${user.personId}:${user.departmentId}`) setOfficeDraft(null); if (governanceDraft?.owner !== `${user.personId}:${user.departmentId}`) setGovernanceDraft(null); if (formalDraft?.owner !== `${user.personId}:${user.departmentId}`) setFormalDraft(null); if (previewDraft?.owner !== `${user.personId}:${user.departmentId}`) setPreviewDraft(null); if (analysisDraft?.owner !== `${user.personId}:${user.departmentId}`) setAnalysisDraft(null); ++requestId.current; setRequestState({ busy: false, error: null }); setSession({ state: 'ready', user }); }} />;

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
      <a href="/app/terms" aria-current={path === "/app/terms" ? "page" : undefined} onClick={e=>navigate(e,"/app/terms")}>术语词典</a>
      <a href="/app/conflicts" aria-current={path === "/app/conflicts" ? "page" : undefined} onClick={e=>navigate(e,"/app/conflicts")}>冲突管理</a>
      <a href="/app/accounts" aria-current={path === '/app/accounts' ? 'page' : undefined} onClick={e=>navigate(e,'/app/accounts')}>账号与授权办理</a>
      <a href="/app/access-audit" aria-current={path === '/app/access-audit' ? 'page' : undefined} onClick={e=>navigate(e,'/app/access-audit')}>访问审计</a>
      <a href="/app/organization" aria-current={path === '/app/organization' ? 'page' : undefined} onClick={e=>navigate(e,'/app/organization')}>组织架构</a>
      <a href="/app/publications" aria-current={path === '/app/publications' ? 'page' : undefined} onClick={e=>navigate(e,'/app/publications')}>主数据发布</a>
      <a href="/app/roster" aria-current={path === '/app/roster' ? 'page' : undefined} onClick={e=>navigate(e,'/app/roster')}>花名册</a>
      <a href="/app/roles" aria-current={path === '/app/roles' ? 'page' : undefined} onClick={e => navigate(e, '/app/roles')}>角色详细管理</a>
      <a href="/app/role-guide" aria-current={path === '/app/role-guide' ? 'page' : undefined} onClick={e => navigate(e, '/app/role-guide')}>角色与责任</a>
      <a href="/app/data-map" aria-current={path === '/app/data-map' ? 'page' : undefined} onClick={e => navigate(e, '/app/data-map')}>数据地图台账</a>
      <a href="/app/todos" aria-current={path === "/app/todos" ? "page" : undefined} onClick={e => navigate(e, "/app/todos")}>待办收到</a>
      <a href="/app/quality" aria-current={path === '/app/quality' ? 'page' : undefined} onClick={e => navigate(e, '/app/quality')}>数据质量</a>
      <a href="/app/dashboard" aria-current={path === '/app/dashboard' ? 'page' : undefined} onClick={e => navigate(e, '/app/dashboard')}>统计看板</a>
      <a href="/app/offices" aria-current={path === '/app/offices' ? 'page' : undefined} onClick={e => navigate(e, '/app/offices')}>办公室工作台</a>
      <a href="/app/identity" aria-current={path === '/app/identity' ? 'page' : undefined} onClick={e => navigate(e, '/app/identity')}>当前身份</a>
      <a href="/app/template-import" aria-current={path === '/app/template-import' ? 'page' : undefined} onClick={e=>navigate(e,'/app/template-import')}>模板导入</a>
      <a href="/app/objects" aria-current={path === '/app/objects' ? 'page' : undefined} onClick={e=>navigate(e,'/app/objects')}>对象与字段</a>
      <a href="/app/fact-checks" aria-current={path === '/app/fact-checks' ? 'page' : undefined} onClick={e=>navigate(e,'/app/fact-checks')}>事实核对</a>
      <a href="/app/design-handoffs" aria-current={path === '/app/design-handoffs' ? 'page' : undefined} onClick={e=>navigate(e,'/app/design-handoffs')}>设计交接</a>
      <a href="/app/data-governance" aria-current={path === '/app/data-governance' ? 'page' : undefined} onClick={e => navigate(e, '/app/data-governance')}>正式数据治理工作包</a>
      <a href="/app/process-formal" aria-current={path === '/app/process-formal' ? 'page' : undefined} onClick={e => navigate(e, '/app/process-formal')}>流程正式流转</a>
      <a href="/app/process-preview" aria-current={path === '/app/process-preview' ? 'page' : undefined} onClick={e => navigate(e, '/app/process-preview')}>流程预览与核对</a>
      <a href="/app/v7-mappings" aria-current={path === '/app/v7-mappings' ? 'page' : undefined} onClick={e=>navigate(e,'/app/v7-mappings')}>V7 来源映射</a>
      <a href="/app/analysis" aria-current={path === '/app/analysis' ? 'page' : undefined} onClick={e=>navigate(e,'/app/analysis')}>分析检查台</a>
      <div className="nav-footer"><p>现有业务办理</p><a href="/" onClick={legacy}>进入原入口 ↗</a></div>
    </aside>
    <main id="main" className="workspace">
      <div className="page-heading"><div><p className="eyebrow">MDM / {pages[path] || '页面'}</p><h1 ref={heading} tabIndex={-1}>{pages[path] || '未找到页面'}</h1></div><button className="secondary" disabled={requestState.busy} onClick={() => refresh()}>{requestState.busy ? '正在核对…' : '刷新身份'}</button></div>
      {requestState.error && <StatusPanel kind="error" title="操作未完成" onRetry={requestState.action === 'logout' ? logout : () => refresh()}>{requestState.error.message}</StatusPanel>}
      {path === '/app/role-guide' ? <Suspense fallback={<StatusPanel kind="loading" title="正在载入角色与责任…"/>}><RoleGuide key={`${user.personId}:${user.departmentId}:${(user.permissions || []).join(',')}`} api={api} user={user} onLegacy={legacy} onQueryChange={(url,push)=>{if(push)historyIndex.current+=1;history[push?'pushState':'replaceState']({...history.state,mdmIndex:historyIndex.current},'',url);}} /></Suspense> : path === '/app/todos' ? <Suspense fallback={<StatusPanel kind="loading" title="正在载入待办…"/>}><TodoInbox user={user} key={`${user.personId}:${user.departmentId}:${(user.permissions || []).join(',')}`} api={api} onLegacy={legacy} onNavigate={navigate} onQueryChange={(url,push)=>{if(push)historyIndex.current+=1;history[push?'pushState':'replaceState']({...history.state,mdmIndex:historyIndex.current},'',url);}} /></Suspense> : path === '/app/data-map' ? <Suspense fallback={<StatusPanel kind="loading" title="正在载入数据地图…"/>}><DataMapRead identityDraft={fieldIdentityDraft?.owner === `${user.personId}:${user.departmentId}` ? fieldIdentityDraft : null} setIdentityDraft={value => setFieldIdentityDraft(value ? {...value, owner: `${user.personId}:${user.departmentId}`} : null)} onQueryChange={(url,push)=>{if(push)historyIndex.current+=1;history[push?'pushState':'replaceState']({...history.state,mdmIndex:historyIndex.current},'',url);}} isFieldAttemptCurrent={id => fieldImportRef.current?.attemptId === id && currentPath() === "/app/data-map"} fieldDraft={fieldImportDraft?.owner === `${user.personId}:${user.departmentId}` ? fieldImportDraft : null} setFieldDraft={value => setFieldImportDraft(value ? {...value, owner: `${user.personId}:${user.departmentId}`} : null)} user={user} draft={contextDraft?.owner === `${user.personId}:${user.departmentId}` ? contextDraft : null} setDraft={value=>setContextDraft(value?{...value,owner:`${user.personId}:${user.departmentId}`}:null)} key={`${user.personId}:${user.departmentId}:${(user.permissions || []).join(',')}`} api={api} onLegacy={legacy} /></Suspense> : path === '/app/quality' ? <Suspense fallback={<StatusPanel kind="loading" title="正在载入质量页面…"/>}><Quality key={`${user.personId}:${user.departmentId}:${(user.permissions || []).join(',')}`} api={api} onLegacy={legacy} /></Suspense> : path === '/app/publications' ? <Suspense fallback={<StatusPanel kind="loading" title="正在载入发布页面…"/>}><Publications key={`publications:${user.personId}:${user.departmentId}:${(user.permissions||[]).join(',')}`} api={api} draft={identityDraft?.owner === `${user.personId}:${user.departmentId}` ? identityDraft : null} setDraft={value=>setIdentityDraft(value?{...value,owner:`${user.personId}:${user.departmentId}`}:null)} onLegacy={legacy} onQueryChange={(url,push)=>{if(push)historyIndex.current+=1;history[push?'pushState':'replaceState']({...history.state,mdmIndex:historyIndex.current},'',url);}} /></Suspense> : ["/app/terms","/app/conflicts"].includes(path) ? <Suspense fallback={<StatusPanel kind="loading" title="正在载入办理页面…"/>}><GovernanceUtilities onQueryChange={(url,push)=>{if(push)historyIndex.current+=1;history[push?"pushState":"replaceState"]({...history.state,mdmIndex:historyIndex.current},"",url);}} key={`${path}:${user.personId}:${user.departmentId}:${(user.permissions||[]).join(",")}`} api={api} user={user} kind={path === "/app/terms"?"terms":"conflicts"} draft={utilityDraft?.owner === `${user.personId}:${user.departmentId}` ? utilityDraft : null} setDraft={value=>setUtilityDraft(value?{...value,owner:`${user.personId}:${user.departmentId}`}:null)} onLegacy={legacy}/></Suspense> : path === "/app/accounts" ? <AccountManagement key={`accounts:${user.personId}:${user.departmentId}:${(user.permissions||[]).join(",")}`} api={api} user={user} draft={identityDraft?.owner === `${user.personId}:${user.departmentId}` ? identityDraft : null} setDraft={value=>setIdentityDraft(value?{...value,owner:`${user.personId}:${user.departmentId}`}:null)} onLegacy={legacy}/> : path === "/app/access-audit" ? <AccessAudit key={`${user.personId}:${user.departmentId}:${(user.permissions||[]).join(",")}`} api={api} onLegacy={legacy}/> : ["/app/organization","/app/roster"].includes(path) ? <Directory key={`${path}:${user.personId}:${user.departmentId}:${(user.permissions||[]).join(",")}`} api={api} kind={path === "/app/organization"?"organization":"roster"} draft={identityDraft?.owner === `${user.personId}:${user.departmentId}` ? identityDraft : null} setDraft={value=>setIdentityDraft(value?{...value,owner:`${user.personId}:${user.departmentId}`}:null)} onLegacy={legacy}/> : path === "/app/roles" ?  <RoleManagement key={`${user.personId}:${user.departmentId}:${(user.permissions || []).join(',')}`} api={api} onLegacy={legacy} /> : path === '/app/dashboard' ? <Dashboard key={`${user.personId}:${user.departmentId}:${(user.permissions || []).join(',')}`} api={api} user={user} onLegacy={legacy} /> : path === '/app/offices' ? <OfficeWorkbench key={`${user.personId}:${user.departmentId}`} api={api} draft={officeDraft?.owner === `${user.personId}:${user.departmentId}` ? officeDraft : null} setDraft={value => setOfficeDraft(value ? {...value, owner: `${user.personId}:${user.departmentId}`} : null)} onLegacy={legacy} /> : path === '/app/data-governance' ? <DataGovernance key={`${user.personId}:${user.departmentId}`} api={api} draft={governanceDraft?.owner === `${user.personId}:${user.departmentId}` ? governanceDraft : null} setDraft={value => setGovernanceDraft(value ? {...value, owner: `${user.personId}:${user.departmentId}`} : null)} onLegacy={legacy} /> : path === '/app/process-formal' ? <ProcessFormal key={`${user.personId}:${user.departmentId}`} api={api} draft={formalDraft?.owner === `${user.personId}:${user.departmentId}` ? formalDraft : null} setDraft={value => setFormalDraft(value ? {...value, owner: `${user.personId}:${user.departmentId}`} : null)} /> : path === '/app/process-preview' ? <ProcessPreview key={`${user.personId}:${user.departmentId}`} api={api} draft={previewDraft?.owner === `${user.personId}:${user.departmentId}` ? previewDraft : null} setDraft={value => setPreviewDraft(value ? {...value, owner: `${user.personId}:${user.departmentId}`} : null)} /> : path === '/app/analysis' ? <AnalysisWorkbench key={`${user.personId}:${user.departmentId}`} api={api} draft={analysisDraft?.owner === `${user.personId}:${user.departmentId}` ? analysisDraft : null} setDraft={value=>setAnalysisDraft(value ? {...value,owner:`${user.personId}:${user.departmentId}`} : null)}/> : path === '/app/design-handoffs' ? <DesignHandoffs key={`${user.personId}:${user.departmentId}`} api={api} draft={handoffDraft} setDraft={setHandoffDraft}/> : path === '/app/v7-mappings' ? <V7Mappings key={`${user.personId}:${user.departmentId}`} api={api} draft={mappingDraft} setDraft={setMappingDraft}/> : path === '/app/fact-checks' ? <FactChecks key={`${user.personId}:${user.departmentId}`} api={api} draft={factDraft} setDraft={setFactDraft}/> : path === '/app/objects' ? <ObjectManagement key={`${user.personId}:${user.departmentId}`} api={api} draft={objectDraft} setDraft={setObjectDraft}/> : path === '/app/template-import' ? <TemplateImport api={api} draft={importDraft} setDraft={setImportDraft}/> : path === '/app/identity' ? <>
        <section className="card"><h2>当前账号与归属</h2><p className="muted">以下信息来自当前登录身份；角色和访问范围由服务端核对。</p>
          <dl className="identity-grid"><div><dt>姓名</dt><dd>{user.personName || user.name || '未填写'}</dd></div><div><dt>工号</dt><dd>{user.employeeNo || '未填写'}</dd></div><div><dt>所属部门</dt><dd>{user.departmentName || '待明确'}</dd></div><div><dt>账号状态</dt><dd>{user.accountStatus === 'active' ? '有效' : '请核对账号状态'}</dd></div></dl>
        </section>
        <section className="card"><h2>有效工作角色</h2>{roles.length ? <ul className="role-list">{roles.map((role, index) => <li key={`${role.code}-${index}`}><strong>{role.name || role.code}</strong><span>{role.scope_type === 'global' || role.scopeType === 'global' ? '全局范围' : '按已授权范围'}</span></li>)}</ul> : <StatusPanel title="暂无有效工作角色">请联系账号管理人员核对授权。当前身份不会自动获得业务权限。</StatusPanel>}</section>
      </> : <RoleWorkbench key={`${user.personId}:${user.departmentId}:${(user.roleCodes || []).join(',')}`} api={api} onNavigate={legacy} />}
      <footer className="workspace-footer">办理权限以当前身份和事项范围为准。</footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<InputProtection><App /></InputProtection>);
