import { useEffect, useRef, useState } from 'react';
import { FormField, StatusPanel, useUnsavedInput } from './components.jsx';

export function PasswordChange({ api, user, required = false, onChanged, onLogout }) {
  const [values, setValues] = useState({ current: '', next: '', repeat: '' });
  const [errors, setErrors] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [, setDirty] = useUnsavedInput();
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  function update(key, value) {
    const next = { ...values, [key]: value }; setValues(next);
    setDirty(Object.values(next).some(Boolean));
  }
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    const issues = { current: !values.current ? '请填写当前密码。' : '',
      next: !values.next ? '请填写新密码。' : '',
      repeat: !values.repeat ? '请再次填写新密码。' : values.next !== values.repeat ? '两次新密码不一致。' : '' };
    setErrors(issues);
    const first = Object.keys(issues).find(key => issues[key]);
    if (first) { document.getElementById('change-password-' + first)?.focus(); return; }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try {
      await api.request('/api/org/me/password', { method: 'POST',
        body: { current_password: values.current, new_password: values.next }, signal: controller.signal });
      if (controller.signal.aborted) return;
      setValues({ current: '', next: '', repeat: '' }); setDirty(false); onChanged();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.status === 400 || failure.status === 403
        ? '密码修改未完成，请核对当前密码、新密码要求及登录状态后重试。'
        : failure.message);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="card password-change" aria-labelledby="password-required-title">
    <h2 id="password-required-title" tabIndex={-1}>{required ? '请先修改当前账号密码' : '修改本人密码'}</h2>
    <p>当前账号：{user.personName || user.name || user.employeeNo || '系统维护账号'}。{required ? '完成修改并重新登录后才能办理业务。' : '修改成功后需要使用新密码重新登录。'}</p>
    <p>新密码至少 10 位，同时包含字母和数字，不能包含工号；最终由服务端校验。</p>
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <FormField id="change-password-current" label="当前密码" type="password" autoComplete="current-password" disabled={busy} value={values.current} error={errors.current} onChange={e => update('current', e.target.value)} />
      <FormField id="change-password-next" label="新密码" type="password" autoComplete="new-password" disabled={busy} value={values.next} error={errors.next} onChange={e => update('next', e.target.value)} />
      <FormField id="change-password-repeat" label="再次填写新密码" type="password" autoComplete="new-password" disabled={busy} value={values.repeat} error={errors.repeat} onChange={e => update('repeat', e.target.value)} />
      {error && <StatusPanel kind="error" title="密码修改未完成">{error}</StatusPanel>}
      <div className="button-row"><button className="primary" type="submit" disabled={busy}>{busy ? '正在修改…' : '修改密码并重新登录'}</button>{onLogout && <button className="secondary" type="button" disabled={busy} onClick={onLogout}>退出登录</button>}</div>
    </form>
  </section>;
}
