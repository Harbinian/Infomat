import { useEffect, useRef, useState } from 'react';
import { usePresentation } from './PresentationProvider.jsx';
export default function Scene() {
  const { monitor, quality, schedule } = usePresentation();
  const host = useRef(null), workerRef = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (failed || !HTMLCanvasElement.prototype.transferControlToOffscreen || !globalThis.Worker || !globalThis.IntersectionObserver) { monitor.record('fallback', 'scene-unsupported-or-failed'); return; }
    let worker, observer, intersection, timeout, disposalTimer, released = false, active = true, ended = null, latestPointer;
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); host.current.appendChild(canvas);
    const release = () => { if (released) return; released = true; clearTimeout(disposalTimer); worker?.terminate(); monitor.resource('workers', -1); monitor.resource('scenes', -1); };
    const fallback = reason => { if (active) { monitor.record('fallback', reason); setFailed(true); } };
    const send = data => { if (active && worker && !released) worker.postMessage(data); };
    const size = () => { const box = canvas.getBoundingClientRect(); send({ type: 'size', width: Math.max(1, box.width), height: Math.max(1, box.height), ratio: Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1) }); };
    const pointer = event => { latestPointer = { type: 'pointer', x: event.offsetX, y: event.offsetY }; };
    let unsubscribe;
    try {
      worker = new Worker(new URL('./scene.worker.js', import.meta.url), { type: 'module', name: 'mdm-presentation-scene' }); workerRef.current = worker;
      monitor.resource('workers', 1); monitor.resource('scenes', 1);
      worker.onerror = event => { event.preventDefault(); fallback('scene-worker-error'); };
      worker.onmessage = event => {
        if (event.data.type === 'disposed') return release();
        if (!active) return;
        if (event.data.type === 'ready') { clearTimeout(timeout); host.current.dataset.ready = 'true'; }
        if (event.data.type === 'error') fallback(event.data.reason);
      };
      const offscreen = canvas.transferControlToOffscreen(); worker.postMessage({ type: 'init', canvas: offscreen, quality }, [offscreen]);
      timeout = setTimeout(() => fallback('scene-load-timeout'), 6000);
      observer = new ResizeObserver(size); observer.observe(canvas);
      intersection = new IntersectionObserver(entries => { const visible = entries.some(entry => entry.isIntersecting); send({ type: 'visible', value: visible }); ended?.(); ended = visible ? monitor.effect('scene', true) : null; }); intersection.observe(canvas);
      monitor.resource('observers', 2);
      const pointerHost = host.current.parentElement.parentElement;
      pointerHost.addEventListener('pointermove', pointer, { passive: true }); monitor.resource('listeners', 1);
      unsubscribe = schedule(() => { if (latestPointer) { send(latestPointer); latestPointer = null; } });
      size();
      return () => {
        active = false; clearTimeout(timeout); ended?.(); unsubscribe?.(); observer.disconnect(); intersection.disconnect(); monitor.resource('observers', -2);
        pointerHost.removeEventListener('pointermove', pointer); monitor.resource('listeners', -1); workerRef.current = null;
        canvas.remove(); worker.postMessage({ type: 'dispose' }); disposalTimer = setTimeout(release, 300);
      };
    } catch {
      active = false; clearTimeout(timeout); observer?.disconnect(); intersection?.disconnect(); canvas.remove(); if (worker) release(); monitor.record('fallback', 'scene-initialization-failed'); setFailed(true);
    }
  }, [monitor, schedule, failed]);
  useEffect(() => { workerRef.current?.postMessage({ type: 'quality', value: quality }); }, [quality]);
  return failed ? null : <div className="tech-scene-canvas" ref={host} data-scene-host />;
}
