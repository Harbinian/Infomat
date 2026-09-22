const { parentPort, workerData } = require('node:worker_threads');
require('./excelEvidenceParser').extract(Buffer.from(workerData.bytes), workerData.name)
  .then(result => parentPort.postMessage({ result }))
  .catch(e => parentPort.postMessage({ error: { code: /^DEFINITION_EXCEL_/.test(e.code || '') ? e.code : 'DEFINITION_EXCEL_' + (/LIMIT/.test(e.code || '') ? 'LIMIT' : /ACTIVE/.test(e.code || '') ? 'ACTIVE_CONTENT' : 'DAMAGED'), statusCode: e.statusCode || 400 } }));
