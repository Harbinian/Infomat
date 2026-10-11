// Worker entry for the bounded legacy field-ledger parse. It receives bytes and answers with
// rows, or with a classified failure -- never with the file's own text.
const { parentPort, workerData } = require('node:worker_threads');
const { extractLegacyFieldsFromBytes } = require('./legacyImportParser');

extractLegacyFieldsFromBytes(
  Buffer.from(workerData.bytes), workerData.originalName, workerData.contextId, workerData.submittedBy
)
  .then(result => parentPort.postMessage({ result }))
  .catch(error => parentPort.postMessage({
    error: {
      name: /^LEGACY_IMPORT_/.test(error.code || '') ? String(error.code).replace('LEGACY_IMPORT_', '') : 'DAMAGED',
      statusCode: error.statusCode || 400,
      message: error.statusCode && error.statusCode < 500 ? error.message : '字段台账解析失败'
    }
  }));
