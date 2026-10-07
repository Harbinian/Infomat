// One cancellable worker owns each layout request. Late replies cannot publish geometry.
const abortError = () => Object.assign(new Error('布局已取消'), { name: 'AbortError' });
export function createFlowLayoutScheduler({ workerFactory = () => new Worker(new URL('./flow-layout.worker.mjs', import.meta.url), { type: 'module' }), timeoutMs = 30000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let generation = 0, active = null, destroyed = false;
  function cancel() {
    generation += 1;
    const previous = active;
    active = null;
    if (!previous) return;
    clearTimer(previous.timer);
    previous.worker.terminate();
    previous.reject(abortError());
  }
  function layout(input, identity = {}) {
    cancel();
    if (destroyed) return Promise.reject(abortError());
    const captured = generation;
    const sourceIdentity = { ...identity, documentKey: identity.documentKey || input.documentFingerprint };
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = workerFactory(); } catch (error) { reject(error); return; }
      const request = { worker, reject, timer: null };
      active = request;
      const finish = (error, result) => {
        if (destroyed || generation !== captured || active !== request) return;
        clearTimer(request.timer);
        active = null;
        worker.terminate();
        if (error) reject(error); else resolve(result);
      };
      worker.onmessage = event => {
        const response = event.data;
        if (response?.generation !== captured || JSON.stringify(response.identity) !== JSON.stringify(sourceIdentity)) return;
        if (response.error) finish(new Error(`流程图布局失败：${response.error}`));
        else finish(null, { graph: response.graph, identity: sourceIdentity });
      };
      worker.onerror = event => { event.preventDefault?.(); finish(new Error(`本地流程图布局失败：${event.message || 'Worker无法运行'}`)); };
      worker.onmessageerror = () => finish(new Error('本地流程图布局返回的数据无法读取。'));
      request.timer = setTimer(() => finish(new Error('流程图布局超过处理时限，请检查文件中的复杂路线后重试。')), timeoutMs);
      try { worker.postMessage({ generation: captured, identity: sourceIdentity, graph: input.graph }); } catch (error) { finish(error); }
    });
  }
  function destroy() { destroyed = true; cancel(); }
  return { layout, cancel, destroy };
}
