const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createDocxParserPool(options = {}) {
  const maxConcurrent = Number(options.maxConcurrent || 2);
  const timeoutMs = Number(options.timeoutMs || 5000);
  const createWorker = options.createWorker || (() => new Worker(path.join(__dirname, 'docx-parser-worker.js')));
  const extractTables = options.extractTables || (() => []);
  let activeParsers = 0;

  function parse(buffer) {
    if (activeParsers >= maxConcurrent) {
      return Promise.reject(Object.assign(new Error('DOCX解析并发已满'), {
        publicCode: 'DOCX_PARSER_BUSY',
        publicMessage: '当前正在处理其他DOCX文件。请稍后重试。',
        statusCode: 429
      }));
    }
    activeParsers += 1;
    return new Promise((resolve, reject) => {
      let worker;
      let timer;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        activeParsers -= 1;
        if (worker) Promise.resolve(worker.terminate()).catch(() => {});
        callback(value);
      };
      try {
        worker = createWorker();
      } catch (error) {
        finish(reject, error);
        return;
      }
      timer = setTimeout(() => finish(reject, Object.assign(new Error('DOCX解析超时'), {
        publicCode: 'DOCX_PARSE_TIMEOUT',
        publicMessage: 'DOCX文件在5秒内未完成解析。请缩小文件或重新导出后重试。',
        statusCode: 422
      })), timeoutMs);
      worker.once('message', result => {
        if (!result?.ok) return finish(reject, new Error('DOCX解析失败'));
        return finish(resolve, { text: result.text, tables: extractTables(result.html) });
      });
      worker.once('error', error => finish(reject, error));
      worker.once('exit', code => {
        if (!settled && code !== 0) finish(reject, new Error('DOCX解析进程异常退出'));
      });
      worker.postMessage({ buffer });
    });
  }

  return {
    parse,
    activeCount: () => activeParsers
  };
}

module.exports = { createDocxParserPool };
