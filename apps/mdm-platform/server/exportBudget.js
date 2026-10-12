// R09 export budget.
//
// The ledger export used to gather every visible row, build the whole workbook in memory and only
// then start writing, with no bound on any of it and no way to stop when the client went away.
//
// These are local engineering defaults, not measured production capacity. What matters is that a
// number exists, that it is enforced before the workbook is built, and that exceeding it is
// reported rather than silently truncated.
const positiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const EXPORT_LIMITS = Object.freeze({
  get maxRows() { return positiveInteger(process.env.MDM_EXPORT_MAX_ROWS, 20000); },
  get maxConcurrency() { return positiveInteger(process.env.MDM_EXPORT_MAX_CONCURRENCY, 2); },
  get timeoutMs() { return positiveInteger(process.env.MDM_EXPORT_TIMEOUT_MS, 60000); }
});

const fail = (name, statusCode, message) => Object.assign(new Error(message), { code: `EXPORT_${name}`, statusCode });

let active = 0;

// One slot per in-flight export. A refused request is not queued: it is told to come back, which
// is what keeps peak memory a function of the budget instead of the number of waiting clients.
function acquireExportSlot() {
  if (active >= EXPORT_LIMITS.maxConcurrency) throw fail('BUSY', 503, '正在生成其他导出，请稍后重试');
  active += 1;
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    active = Math.max(0, active - 1);
  };
}

function activeExportCount() {
  return active;
}

// Client departure has to stop the work, not just the response. `close` fires when the connection
// goes away; a response that already finished is not a departure.
function createAbortScope(req, res, { timeoutMs = EXPORT_LIMITS.timeoutMs } = {}) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(fail('ABORTED', 499, '导出已取消')); };
  req.on('aborted', abort);
  res.on('close', abort);
  const timer = setTimeout(() => controller.abort(fail('TIMEOUT', 503, '导出超过时间上限，请稍后重试')), timeoutMs);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    get aborted() { return controller.signal.aborted; },
    check() { if (controller.signal.aborted) throw controller.signal.reason; },
    async run(operation) {
      if (controller.signal.aborted) throw controller.signal.reason;
      let onAbort;
      try {
        return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
          onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        })]);
      } finally { controller.signal.removeEventListener('abort', onAbort); }
    },
    dispose() { clearTimeout(timer); req.off('aborted', abort); res.off('close', abort); }
  };
}

module.exports = { EXPORT_LIMITS, acquireExportSlot, activeExportCount, createAbortScope, fail };
