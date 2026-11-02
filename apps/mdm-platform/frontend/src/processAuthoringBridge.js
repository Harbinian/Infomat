import { DOMAIN_MODULE_FILES } from '../../../structured-output-service/frontend/bridge.mjs';
let loaded;
export function loadAuthoringModules() {
  if (!loaded) loaded = (async () => {
    for (const { name, file } of DOMAIN_MODULE_FILES) {
      if (globalThis[name]) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/api/process-authoring/assets/${file}`;
        script.async = false; script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('本地编制资源加载失败，请重试。')); };
        document.head.appendChild(script);
      });
    }
    return Object.freeze(Object.fromEntries(DOMAIN_MODULE_FILES.map(({ name }) => [name, globalThis[name]])));
  })().catch(error => { loaded = undefined; throw error; });
  return loaded;
}
export function scopedEditorCss(css) {
  // The shared stylesheet contains flat rules only. Reject future at-rules rather
  // than accidentally exposing document-wide styles in the host application.
  if (css.includes('@')) throw new Error('共享编制样式需要更新隔离规则。');
  return css.replace(/(?:body|#root)\{[^}]*\}/g, '').replaceAll('height:100vh', 'height:100%').replace(/([^{}]+)\{/g, (_, selectors) => selectors.split(',').map(selector => {
    const trimmed = selector.trim();
    if ([':root', 'body', '#root'].includes(trimmed)) return '.process-authoring-editor';
    return `.process-authoring-editor ${trimmed.replace(/^:root\s+/, '')}`;
  }).join(',') + '{');
}
