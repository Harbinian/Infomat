// CPU-only isolated rule evaluation. Parent terminates this thread on lease loss.
const { parentPort, workerData } = require('node:worker_threads');
try { parentPort.postMessage({ result: (workerData.step.parser_key === 'handoff_deterministic' ? require('./handoffAnalysisRules') : require('./v7AnalysisRules')).analyze(workerData) }); }
catch { parentPort.postMessage({ error: 'INVALID_INPUT' }); }
