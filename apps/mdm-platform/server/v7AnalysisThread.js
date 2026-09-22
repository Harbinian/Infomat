// CPU-only isolated rule evaluation. Parent terminates this thread on lease loss.
const { parentPort, workerData } = require('node:worker_threads');
try { parentPort.postMessage({ result: (workerData.step.parser_key === 'pdf_evidence' ? require('./pdfEvidenceRules') : workerData.step.parser_key === 'word_evidence' ? require('./wordEvidenceRules') : workerData.step.parser_key === 'excel_evidence' ? require('./excelEvidenceRules') : workerData.step.parser_key === 'handoff_deterministic' ? require('./handoffAnalysisRules') : require('./v7AnalysisRules')).analyze(workerData) }); }
catch { parentPort.postMessage({ error: 'INVALID_INPUT' }); }
