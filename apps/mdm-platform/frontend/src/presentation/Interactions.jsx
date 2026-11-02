import { useEffect } from 'react';
import { usePresentation } from './PresentationProvider.jsx';
export default function Interactions() {
  const { schedule, monitor, quality } = usePresentation();
  useEffect(() => {
    let latest, current;
    const clear = () => { if (current) { current.style.removeProperty('--pointer-x'); current.style.removeProperty('--pointer-y'); current.style.removeProperty('--tilt-x'); current.style.removeProperty('--tilt-y'); current = null; } };
    const pointer = event => { latest = { target: event.target, x: event.clientX, y: event.clientY }; };
    const leave = () => { latest = null; clear(); };
    const click = event => {
      const button = event.target.closest('button, .button-link');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      const box = button.getBoundingClientRect();
      button.style.setProperty('--ripple-x', `${event.detail ? event.clientX - box.left : box.width / 2}px`);
      button.style.setProperty('--ripple-y', `${event.detail ? event.clientY - box.top : box.height / 2}px`);
      button.classList.remove('tech-ripple'); void button.offsetWidth; button.classList.add('tech-ripple');
      const end = monitor.effect('ripple');
      const timer = setTimeout(() => { button.classList.remove('tech-ripple'); end(); timers.delete(timer); }, 160); timers.set(timer, end);
    };
    const timers = new Map();
    const unsubscribe = schedule(() => {
      if (!latest || quality === 'basic') { clear(); return; }
      const { target, x, y } = latest; latest = null;
      const panel = target.closest('.login-intro, .dashboard-metrics .import-record, .wb-actions .import-record');
      if (target.closest('input,select,textarea,button,a,form')) { clear(); return; }
      if (panel !== current) clear();
      if (!panel) return;
      current = panel; const box = panel.getBoundingClientRect();
      const px = (x - box.left) / box.width, py = (y - box.top) / box.height;
      panel.style.setProperty('--pointer-x', `${px * 100}%`); panel.style.setProperty('--pointer-y', `${py * 100}%`);
      panel.style.setProperty('--tilt-x', `${(py - .5) * -6}deg`); panel.style.setProperty('--tilt-y', `${(px - .5) * 6}deg`);
    });
    const end = monitor.effect('pointer');
    document.addEventListener('pointermove', pointer, { passive: true }); document.addEventListener('pointerleave', leave); document.addEventListener('click', click);
    monitor.resource('listeners', 3);
    return () => { unsubscribe(); end(); clear(); timers.forEach((release, timer) => { clearTimeout(timer); release(); }); document.querySelectorAll('.tech-ripple').forEach(node => node.classList.remove('tech-ripple')); document.removeEventListener('pointermove', pointer); document.removeEventListener('pointerleave', leave); document.removeEventListener('click', click); monitor.resource('listeners', -3); };
  }, [schedule, monitor, quality]);
  return null;
}
