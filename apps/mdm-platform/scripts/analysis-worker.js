// Explicit target; no .env, DDL, HTTP listener or daemon installation.
// start/status/inspect/stop/recover. inspect/status are metadata-only, not recovery.
// stop requires this worker's UUID, never a process scan or PID authorization.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { operationTimeoutMs } = require('../server/mysqlConfig');
const { argumentsFor } = require('./manage-data-map-definitions');
const { inspectAnalysisQueue } = require('../server/analysisQueueMigration');
const { inspectWorkerDependencies, readWorkerStatus, inspectionScope } = require('../server/analysisDependencyReadiness');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { work } = require('../server/analysisWorker');
function runtimeCodeDigests() {
  const files = [__filename, require.resolve('../server/analysisDependencyReadiness'), require.resolve('../server/analysisWorker'), require.resolve('../server/analysisAiOffline'), require.resolve('../server/analysisAiThread'), require.resolve('../server/analysisQueue'), require.resolve('../server/v7AnalysisRules'), require.resolve('../server/processContentChecks'), require.resolve('../../structured-output-service/public/structure-score'), require.resolve('../../structured-output-service/public/process-data-availability'), require.resolve('../server/v7AnalysisThread'), require.resolve('../server/handoffAnalysisRules'), require.resolve('../server/excelEvidenceRules'), require.resolve('../server/wordEvidenceRules'), require.resolve('../server/pdfEvidenceRules'), require.resolve('../../../scripts/process-governance/v7-validator'), ...require('../server/v7AnalysisRules').schemaFiles];
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const hashes = Object.fromEntries(files.map(file => [require('node:path').basename(file), sha(file)]));
  // Preserve current dependency keys. Historical files have the same basenames,
  // so retain their scoped paths rather than overwriting the current digests.
  for (const name of ['index.js', 'processContentChecks.js', 'structure-score.js']) {
    hashes['rules/v7-content-v4/' + name] = sha(require.resolve('../server/rules/v7-content-v4/' + name));
  }
  return hashes;
}
async function main(args = process.argv.slice(2), env = process.env) {
  const command = args[0];
  if (!['start', 'status', 'inspect', 'stop', 'recover'].includes(command)) throw Error('ARGUMENT_INVALID');
  const workerArg = args.indexOf('--worker-id');
  let supplied;
  if (workerArg >= 0) {
    supplied = args[workerArg + 1];
    if (command !== 'stop' || !/^[a-f0-9-]{36}$/.test(supplied || '')) throw Error('ARGUMENT_INVALID');
    args = args.filter((_, i) => i !== workerArg && i !== workerArg + 1);
  }
  if (command === 'stop' && !supplied) throw Error('ARGUMENT_INVALID');
  argumentsFor(['--inspect', ...args.slice(1)], env);
  const timeoutMs = operationTimeoutMs(env);
  const pool = lazyMysqlPool(env, 4, 5000, { queueLimit: 16, operationTimeoutMs: timeoutMs });
  // The singleton lock lasts for the worker lifetime; each command on it has its own deadline.
  const lockPool = lazyMysqlPool(env, 1, 5000);
  let lock, registered, stopped = false;
  const log = entry => console.log(JSON.stringify({ ...entry, at: new Date().toISOString() }));
  const query = fn => withMysqlDeadline(pool, fn, timeoutMs);
  const signalStop = () => {
    stopped = true;
    pool.cancelActive(Object.assign(new Error('worker stopped'), { code: 'ABORTED' }));
    if (lock) lock.destroy();
  };
  const lockQuery = (sql, params) => withMysqlDeadline({ async getConnection() {
    return { execute: (...args) => lock.execute(...args), destroy: () => lock.destroy(), release() {} };
  } }, db => db.execute(sql, params), timeoutMs);
  try {
    if (['start', 'status', 'inspect'].includes(command)) {
      const status = await query(db => inspectionScope(db, async () => {
        const readiness = await inspectWorkerDependencies(db, env);
        if (!readiness.ready) return { readiness, workers: null, queue: null, worker_state: 'not_checked', worker_process: 'not_checked' };
        return { readiness, ...await readWorkerStatus(db) };
      })).catch(() => ({ readiness: { ready: false, state: 'not_checked', reason: 'DIAGNOSTIC_UNAVAILABLE' },
        workers: null, queue: null, worker_state: 'not_checked', worker_process: 'not_checked' }));
      if (command !== 'start') { log(status); if (!status.readiness.ready) process.exitCode = 1; return status; }
      if (!status.readiness.ready) throw Error('ANALYSIS_DEPENDENCY_UNAVAILABLE');
    }
    // A stopped/disabled fixed source must not prevent an explicit UUID stop.
    if (['stop', 'recover'].includes(command) && !(await query(inspectAnalysisQueue)).ready) throw Error('ANALYSIS_QUEUE_MIGRATION_REQUIRED');
    if (command === 'stop') {
      const [r] = await query(db => db.execute('UPDATE data_map_analysis_workers SET stop_requested=TRUE WHERE worker_id=? AND stopped_at IS NULL', [supplied]));
      if (!r.affectedRows) throw Error('ANALYSIS_WORKER_NOT_RUNNING');
      log({ event: 'stop_requested', worker_id: supplied }); return;
    }
    const repo = makeDataMapDefinitionRepository(pool);
    if (command === 'recover') { log(await repo.recoverAnalysisQueue()); return; }
    // Dedicated connection holds a database-specific singleton lock for the process lifetime.
    lock = await withMysqlDeadline({ async getConnection() {
      const db = await lockPool.getConnection();
      return { raw: db, destroy: () => db.destroy(), release() {} };
    } }, db => db.raw, timeoutMs);
    const lockName = 'mdm_analysis_worker_' + crypto.createHash('sha256').update(env.MYSQL_DATABASE).digest('hex').slice(0, 32);
    const [[r]] = await lockQuery('SELECT GET_LOCK(?,0) acquired', [lockName]);
    if (Number(r.acquired) !== 1) throw Error('ANALYSIS_WORKER_BUSY');
    const worker = crypto.randomUUID();
    const runtime = { node_version: process.version, worker_version: 'analysis-worker-v6', ai_offline_version: require('../server/analysisAiOffline').VERSION, pdf_rule_version: require('../server/pdfEvidenceRules').VERSION, word_rule_version: require('../server/wordEvidenceRules').VERSION, excel_rule_version: require('../server/excelEvidenceRules').VERSION, handoff_rule_version: require('../server/handoffAnalysisRules').VERSION, rule_version: require('../server/v7AnalysisRules').VERSION, pid: process.pid,
      dependency_check_version: 'analysis-dependency-readiness-v1',
      code_sha256: runtimeCodeDigests() };
    await lockQuery('INSERT INTO data_map_analysis_workers(worker_id,runtime_json,started_at,heartbeat_at) VALUES (?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [worker, JSON.stringify(runtime)]);
    registered = worker;
    process.on('SIGINT', signalStop); process.on('SIGTERM', signalStop);
    process.on('message', signalStop);
    const stop = async () => {
      if (stopped) return true;
      // Loss of the singleton connection terminates this process, even if its lease remains.
      const [[r]] = await lockQuery('SELECT stop_requested FROM data_map_analysis_workers WHERE worker_id=?', [worker]);
      stopped = !!r.stop_requested;
      await lockQuery('UPDATE data_map_analysis_workers SET heartbeat_at=UTC_TIMESTAMP(3) WHERE worker_id=?', [worker]);
      return stopped;
    };
    log({ event: 'worker_started', worker_id: worker });
    await work(repo, worker, { stop, log });
  } finally {
    process.removeListener('SIGINT', signalStop); process.removeListener('SIGTERM', signalStop); process.removeListener('message', signalStop);
    if (lock) {
      if (registered) { try { await query(db => db.execute('UPDATE data_map_analysis_workers SET stopped_at=UTC_TIMESTAMP(3) WHERE worker_id=?', [registered])); } catch {} }
      lock.destroy();
    }
    let timer;
    try {
      await Promise.race([Promise.all([pool.end(), lockPool.end()]), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('worker drain failed'), { code: 'ANALYSIS_WORKER_DRAIN_TIMEOUT' })), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
    if (registered) log({ event: 'worker_stopped', worker_id: registered });
  }
}
if (require.main === module) main().catch(e => {
  const code = /^ANALYSIS_[A-Z_]+$/.test(e.code || '') ? e.code : /^ANALYSIS_[A-Z_]+$/.test(e.message) ? e.message : 'ANALYSIS_WORKER_FAILED';
  console.error(code);
  // main already attempted bounded cleanup. A broken driver's still-open socket must not keep
  // this owned CLI process alive after it reported failure; failure remains visible as exit 1.
  process.exit(1);
});
module.exports = { main, runtimeCodeDigests };
