import { useCallback, useEffect, useRef, useState } from 'react';
import { DotLottieWorkerReact, setWasmUrl, setWorkerUrl } from '@lottiefiles/dotlottie-react';
import workerUrl from '@lottiefiles/dotlottie-web/dotlottie.worker.js?url';
import wasmUrl from '@lottiefiles/dotlottie-web/dotlottie-player.wasm?url';
import loadingUrl from './assets/loading.json?url';
import successUrl from './assets/success.json?url';
import errorUrl from './assets/error.json?url';
import { usePresentation } from './PresentationProvider.jsx';
import { StaticStatus } from './StatusDecoration.jsx';
setWorkerUrl(workerUrl); setWasmUrl(wasmUrl);
const sources = { loading: loadingUrl, success: successUrl, error: errorUrl };
const animationData = new Map();
function readAnimation(kind) {
  if (!animationData.has(kind)) {
    const request = fetch(sources[kind], { credentials: 'omit', cache: 'force-cache' }).then(response => {
      if (!response.ok) throw new Error('Animation unavailable'); return response.text();
    }).catch(error => { animationData.delete(kind); throw error; });
    animationData.set(kind, request);
  }
  return animationData.get(kind);
}
export default function LottieFeedback({ kind }) {
  const { running, monitor } = usePresentation();
  const [player, setPlayer] = useState(null), [failed, setFailed] = useState(false);
  const [data, setData] = useState(null);
  const alive = useRef(true), generation = useRef(0);
  const endEffect = useRef(null);
  const callback = useCallback(value => { if (alive.current) setPlayer(value); }, []);
  useEffect(() => {
    let cancelled = false;
    // Small decorative assets share a cache independent of short pending states.
    // A late response owns no player and cannot restart an unmounted animation.
    readAnimation(kind).then(value => { if (!cancelled) setData(value); }).catch(() => {
      if (!cancelled) { monitor.record('fallback', 'animation-asset-unavailable'); setFailed(true); }
    });
    return () => { cancelled = true; };
  }, [kind, monitor]);
  useEffect(() => {
    if (failed || !data) return;
    alive.current = true; const end = monitor.effect(`lottie-${kind}`, kind === 'loading'); monitor.resource('lottie', 1);
    endEffect.current = end;
    return () => { alive.current = false; ++generation.current; end(); monitor.resource('lottie', -1); };
  }, [monitor, kind, failed, data]);
  useEffect(() => {
    if (!player || failed) return;
    let cancelled = false; const current = ++generation.current;
    const fail = () => { if (!cancelled && alive.current) { monitor.record('fallback', 'lottie-load-or-render-failed'); setFailed(true); } };
    const synchronize = async () => {
      try { if (running) { await player.unfreeze(); if (!cancelled && current === generation.current) await player.play(); } else { await player.pause(); await player.freeze(); }
        if (cancelled || current !== generation.current) { await player.pause(); await player.freeze(); }
      } catch { fail(); }
    };
    let timer = setTimeout(fail, 6000);
    const loaded = () => { clearTimeout(timer); monitor.record('ready', `lottie-${kind}`); synchronize(); };
    const completed = () => { if (!cancelled && kind !== 'loading') endEffect.current?.(); };
    player.addEventListener('load', loaded); player.addEventListener('loadError', fail); player.addEventListener('renderError', fail);
    player.addEventListener('complete', completed);
    if (player.isLoaded) loaded();
    synchronize();
    return () => { cancelled = true; ++generation.current; clearTimeout(timer); player.removeEventListener('load', loaded); player.removeEventListener('loadError', fail); player.removeEventListener('renderError', fail); player.removeEventListener('complete', completed); player.pause().catch(() => {}); player.freeze().catch(() => {}); };
  }, [player, running, failed, monitor, kind]);
  return failed || !data ? <StaticStatus kind={kind}/> : <DotLottieWorkerReact data={data} workerId="mdm-status-feedback" autoplay={false} loop={kind === 'loading'} dotLottieRefCallback={callback} renderConfig={{ devicePixelRatio: 1, autoResize: true }} className="status-lottie"/>;
}
