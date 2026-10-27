import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { badWindow, createDiagnostics, frameWindow, lowerQuality, percentile } from './performance.js';
import { PresentationBoundary } from './PresentationBoundary.jsx';
const PresentationContext = createContext(null);
const Interactions = lazy(() => import('./Interactions.jsx'));
export const usePresentation = () => useContext(PresentationContext);
export function PresentationProvider({ children }) {
  const diagnostics = useRef(null); if (!diagnostics.current) diagnostics.current = createDiagnostics();
  const [mode, setMode] = useState('auto'), [quality, setQuality] = useState('standard');
  const [paused, setPaused] = useState(false), [visible, setVisible] = useState(!document.hidden);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const reduced = systemReduced || mode === 'reduced';
  const running = !reduced && !paused && visible;
  const monitor = diagnostics.current;
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReduced(preference.matches), visibility = () => setVisible(!document.hidden);
    preference.addEventListener('change', change); document.addEventListener('visibilitychange', visibility);
    monitor.resource('listeners', 2);
    return () => { preference.removeEventListener('change', change); document.removeEventListener('visibilitychange', visibility); monitor.resource('listeners', -2); };
  }, [monitor]);
  useEffect(() => {
    document.documentElement.dataset.presentation = reduced ? 'reduced' : quality;
    document.documentElement.dataset.motionPaused = String(!running);
    return () => { delete document.documentElement.dataset.presentation; delete document.documentElement.dataset.motionPaused; };
  }, [reduced, running, quality]);
  useEffect(() => {
    const observers = [];
    for (const type of ['longtask', 'long-animation-frame', 'event']) {
      if (monitor.metrics[type] === null) continue;
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          monitor.metrics[type].push({ duration: entry.duration, at: entry.startTime, interactionId: type === 'event' ? entry.interactionId : undefined });
          if (monitor.metrics[type].length > 120) monitor.metrics[type].shift();
        }
      });
      observer.observe({ type, buffered: false, ...(type === 'event' ? { durationThreshold: 16 } : {}) }); observers.push(observer);
    }
    monitor.resource('observers', observers.length);
    return () => { observers.forEach(observer => observer.disconnect()); monitor.resource('observers', -observers.length); };
  }, [monitor]);
  // Pointer updates and frame sampling share this scheduler. No per-frame React update.
  const callbacks = useRef(new Set());
  const schedule = useCallback(callback => { callbacks.current.add(callback); return () => callbacks.current.delete(callback); }, []);
  useEffect(() => {
    if (!running) { monitor.record('interval', reduced ? 'reduced' : paused ? 'paused' : 'hidden'); return; }
    let frame, previous, started, intervals = [], warmup = [], period = null, bad = 0;
    function tick(now) {
      const costStart = performance.now();
      const continuous = [...monitor.effects.values()].some(effect => effect.continuous);
      if (continuous) {
        if (previous !== undefined) {
          const delta = now - previous;
          if (warmup.length < 60) warmup.push(delta);
          else { period ??= percentile(warmup, .5); intervals.push(delta); }
        }
        previous = now; started ??= now;
        if (period && now - started >= 2000 && intervals.length) {
          const sample = frameWindow(intervals, period); monitor.window({ ...sample, at: now, quality, mode, visible: true, effects: [...new Set([...monitor.effects.values()].map(effect => effect.id))] });
          bad = badWindow(sample) ? bad + 1 : 0;
          if (bad >= 2 && quality !== 'basic') { monitor.record('downgrade', 'two-slow-visible-windows'); setQuality(lowerQuality(quality)); }
          intervals = []; started = now;
        }
      } else { previous = undefined; started = undefined; intervals = []; }
      callbacks.current.forEach(callback => callback(now));
      monitor.costs.push(performance.now() - costStart); if (monitor.costs.length > 1800) monitor.costs.shift();
      frame = requestAnimationFrame(tick);
    }
    monitor.resource('schedules', 1); frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); monitor.resource('schedules', -1); };
  }, [running, mode, quality, monitor, reduced, paused]);
  const value = useMemo(() => ({ mode, quality, reduced, running, paused, visible, systemReduced, monitor, diagnosticOpen,
    setDiagnosticOpen, setPaused, setMode(value) { setMode(value); setQuality(value === 'enhanced' ? 'high' : 'standard'); },
    retest() { setQuality(mode === 'enhanced' ? 'high' : 'standard'); monitor.record('retest', 'user-request'); },
    schedule
  }), [mode, quality, reduced, running, paused, visible, systemReduced, monitor, diagnosticOpen, schedule]);
  return <PresentationContext.Provider value={value}>{children}<PresentationBoundary monitor={monitor} reason="interaction-module-failed"><Suspense fallback={null}>{running && <Interactions />}</Suspense></PresentationBoundary></PresentationContext.Provider>;
}
export function PresentationControls() {
  const view = usePresentation();
  const [snapshot, setSnapshot] = useState(null);
  if (!view) return null;
  return <div className="presentation-controls" aria-label="显示与动效设置">
    <label>显示效果<select aria-label="显示效果" value={view.mode} onChange={event => view.setMode(event.target.value)}><option value="auto">自动</option><option value="enhanced">增强</option><option value="reduced">减少动态效果</option></select></label>
    <button className="secondary" type="button" aria-pressed={view.paused} onClick={() => view.setPaused(!view.paused)}>{view.paused ? '恢复动效' : '暂停动效'}</button>

  </div>;
}
