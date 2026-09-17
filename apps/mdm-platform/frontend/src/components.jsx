import { createContext, useContext, useEffect, useRef, useState } from 'react';

const InputContext = createContext(null);
export function InputProtection({ children }) {
  const pending = useRef(new Set());
  const [dirty, setDirty] = useState(false);
  const registry = useRef({
    update(id, value) {
      value ? pending.current.add(id) : pending.current.delete(id);
      setDirty(pending.current.size > 0);
    },
    confirmLeave() {
      return pending.current.size === 0 || window.confirm('当前有未提交的输入。离开会放弃这些输入，是否继续？');
    }
  }).current;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  return <InputContext.Provider value={registry}>{children}</InputContext.Provider>;
}

export function useInputProtection() { return useContext(InputContext); }

export function useUnsavedInput() {
  const registry = useInputProtection();
  const key = useRef(Symbol('form'));
  const [dirty, setDirty] = useState(false);
  useEffect(() => () => registry.update(key.current, false), [registry]);
  return [dirty, value => { registry.update(key.current, value); setDirty(value); }];
}

export function StatusPanel({ kind = 'empty', title, children, onRetry }) {
  return <section className={`status-panel status-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
    <strong>{title}</strong>{children && <p>{children}</p>}
    {onRetry && <button type="button" className="secondary" onClick={onRetry}>重试</button>}
  </section>;
}

export function FormField({ id, label, error, ...inputProps }) {
  return <div className="form-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...inputProps} />
    {error && <p id={`${id}-error`} className="field-error">{error}</p>}
  </div>;
}
