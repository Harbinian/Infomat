// An empty environment and a serializable fixed task; no session, DB or API handles.
const { parentPort, workerData } = require('node:worker_threads');
require('./analysisAiOffline').analyze(workerData).then(result => parentPort.postMessage({ result }))
  .catch(() => parentPort.postMessage({ error: 'AI_ADAPTER_FAILED' }));
