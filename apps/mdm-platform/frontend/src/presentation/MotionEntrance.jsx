import { useEffect } from 'react';
import { LazyMotion, animate } from 'motion/react';
import * as m from 'motion/react-m';
import { usePresentation } from './PresentationProvider.jsx';
const features = () => import('./motionFeatures.js').then(module => module.default);
export default function MotionEntrance({ page }) {
  const { running, monitor } = usePresentation();
  useEffect(() => {
    if (!running) return;
    const heading = document.querySelector('.page-heading');
    if (!heading) return;
    const end = monitor.effect('entrance');
    const playback = animate(heading, { opacity: [0.65, 1], y: [6, 0] }, { duration: .2 });
    playback.then(end);
    return () => { playback.stop(); heading.style.removeProperty('opacity'); heading.style.removeProperty('transform'); end(); };
  }, [page, running, monitor]);
  return <LazyMotion strict features={features}><m.div className="tech-route-line" aria-hidden="true" initial={false} animate={{ opacity: running ? 1 : .7 }} transition={{ duration: .12 }}/></LazyMotion>;
}
