import 'elkjs/lib/elk-worker.min.js';

// Use the actual ELK worker dispatcher. elk.bundled's fake-worker constructor is
// intentionally unavailable in DedicatedWorkerGlobalScope, so it cannot be nested here.
// This is one local worker, with no nested worker, remote scripts or data requests.
const dispatch = self.onmessage;
const publish = self.postMessage.bind(self);
let pending = null;
if (typeof dispatch !== 'function') throw new Error('本地ELK Worker未完成初始化。');
self.postMessage = response => {
  if (!pending) return;
  if (response.error) {
    publish({ ...pending, error: response.error.message || response.error.detailMessage || 'ELK无法完成布局' });
    pending = null;
  } else if (response.id === 1) {
    publish({ ...pending, graph: response.data });
    pending = null;
  }
};
self.onmessage = event => {
  const { generation, identity, graph } = event.data;
  pending = { generation, identity };
  // Commands are the pinned elkjs 0.12.0 public API's register/layout worker protocol.
  dispatch({ data: { id: 0, cmd: 'register', algorithms: ['layered'] } });
  if (pending) dispatch({ data: { id: 1, cmd: 'layout', graph, layoutOptions: graph.layoutOptions } });
};
