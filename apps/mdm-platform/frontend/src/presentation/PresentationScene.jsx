import { lazy, Suspense, useEffect, useState } from 'react';
import { usePresentation } from './PresentationProvider.jsx';
import { PresentationBoundary } from './PresentationBoundary.jsx';
const Scene = lazy(() => import('./Scene.jsx'));
export function PresentationScene({ variant = 'banner' }) {
  const view = usePresentation();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!view?.running || view.quality === 'basic') { setReady(false); return; }
    const callback = () => setReady(true);
    const id = globalThis.requestIdleCallback ? requestIdleCallback(callback, { timeout: 1200 }) : setTimeout(callback, 400);
    return () => { if (globalThis.cancelIdleCallback) cancelIdleCallback(id); else clearTimeout(id); };
  }, [view?.running, view?.quality]);
  return <div className={`tech-scene tech-scene-${variant}`} aria-hidden="true">
    <svg className="tech-scene-static" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id={`tech-gradient-${variant}`}><stop stopColor="var(--accent)"/><stop offset="1" stopColor="var(--decoration)"/></linearGradient></defs><g fill="none" stroke={`url(#tech-gradient-${variant})`} strokeWidth="1" opacity=".35"><path d="M80 100 150 30 220 100 150 170Z M150 30 340 60 400 100 340 140 150 170 M220 100H520 M340 60V140"/><circle cx="400" cy="100" r="60"/><circle cx="400" cy="100" r="85"/></g></svg>
    {ready && view?.running && view.quality !== 'basic' && <PresentationBoundary monitor={view.monitor} reason="scene-module-failed"><Suspense fallback={null}><Scene /></Suspense></PresentationBoundary>}
  </div>;
}
