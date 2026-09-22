const { parentPort, workerData } = require('node:worker_threads');
try {
  parentPort.postMessage({ result: require('./wordEvidenceParser').extract(Buffer.from(workerData.bytes), workerData.name) });
} catch (e) {
  parentPort.postMessage({ error: { code: /^DEFINITION_WORD_/.test(e.code || '') ? e.code : 'DEFINITION_WORD_DAMAGED', statusCode: e.statusCode || 400 } });
}
