// Explicit target; no .env, DDL, HTTP listener or daemon installation.
// start/status/stop/recover. stop requires this worker's UUID, never a process scan.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { lazyMysqlPool, withMysqlDeadline } = require('../server/boundedMysql');
const { argumentsFor } = require('./manage-data-map-definitions');
const { inspectAnalysisQueue } = require('../server/analysisQueueMigration');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { work } = require('../server/analysisWorker');
async function main(args = process.argv.slice(2), env = process.env) {
  const command = args[0];
  if (!['start', 'status', 'stop', 'recover'].includes(command)) throw Error('ARGUMENT_INVALID');
  const workerArg = args.indexOf('--worker-id');
  let supplied;
  if (workerArg >= 0) {
    supplied = args[workerArg + 1];
    if (command !== 'stop' || !/^[a-f0-9-]{36}$/.test(supplied || '')) throw Error('ARGUMENT_INVALID');
    args = args.filter((_, i) => i !== workerArg && i !== workerArg + 1);
  }
  if (command === 'stop' && !supplied) throw Error('ARGUMENT_INVALID');
  argumentsFor(['--inspect', ...args.slice(1)], env);
  const pool = lazyMysqlPool(env, 4, 5000, { queueLimit: 16 });
  let lock, registered, stopped = false;
  const log = entry => console.log(JSON.stringify({ ...entry, at: new Date().toISOString() }));
  const query = fn => withMysqlDeadline(pool, fn, 10000);
  const signalStop = () => { stopped = true; };
  try {
    if (!(await query(inspectAnalysisQueue)).ready) throw Error('ANALYSIS_QUEUE_MIGRATION_REQUIRED');
    if (command === 'status') {
      const status = await query(async db => ({
        workers: (await db.execute(`SELECT worker_id,runtime_json,stop_requested,
          DATE_FORMAT(started_at,'%Y-%m-%dT%H:%i:%s.%fZ') started_at,
          DATE_FORMAT(heartbeat_at,'%Y-%m-%dT%H:%i:%s.%fZ') heartbeat_at,
          DATE_FORMAT(stopped_at,'%Y-%m-%dT%H:%i:%s.%fZ') stopped_at
          FROM data_map_analysis_workers ORDER BY data_map_analysis_workers.started_at DESC LIMIT 100`))[0],
        queue: (await db.execute('SELECT state,COUNT(*) count FROM data_map_analysis_queue GROUP BY state'))[0]
      })); log(status); return status;
    }
    if (command === 'stop') {
      const [r] = await query(db => db.execute('UPDATE data_map_analysis_workers SET stop_requested=TRUE WHERE worker_id=? AND stopped_at IS NULL', [supplied]));
      if (!r.affectedRows) throw Error('ANALYSIS_WORKER_NOT_RUNNING');
      log({ event: 'stop_requested', worker_id: supplied }); return;
    }
    const repo = makeDataMapDefinitionRepository(pool);
    if (command === 'recover') { log(await repo.recoverAnalysisQueue()); return; }
    // Dedicated connection holds a database-specific singleton lock for the process lifetime.
    lock = await pool.getConnection();
    const lockName = 'mdm_analysis_worker_' + crypto.createHash('sha256').update(env.MYSQL_DATABASE).digest('hex').slice(0, 32);
    const [[r]] = await lock.execute('SELECT GET_LOCK(?,0) acquired', [lockName]);
    if (Number(r.acquired) !== 1) throw Error('ANALYSIS_WORKER_BUSY');
    const worker = crypto.randomUUID();
    const runtime = { node_version: process.version, worker_version: 'analysis-worker-v3', handoff_rule_version: require('../server/handoffAnalysisRules').VERSION, rule_version: require('../server/v7AnalysisRules').VERSION, pid: process.pid,
      code_sha256: Object.fromEntries([__filename, require.resolve('../server/analysisWorker'), require.resolve('../server/analysisQueue'), require.resolve('../server/v7AnalysisRules'), require.resolve('../server/v7AnalysisThread'), require.resolve('../server/handoffAnalysisRules'), require.resolve('../../../scripts/process-governance/v7-validator'), ...require('../server/v7AnalysisRules').schemaFiles].map(file => [require('node:path').basename(file), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
    await lock.execute('INSERT INTO data_map_analysis_workers(worker_id,runtime_json,started_at,heartbeat_at) VALUES (?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [worker, JSON.stringify(runtime)]);
    registered = worker;
    process.on('SIGINT', signalStop); process.on('SIGTERM', signalStop);
    process.on('message', signalStop);
    const stop = async () => {
      if (stopped) return true;
      // Loss of the singleton connection terminates this process, even if its lease remains.
      const [[r]] = await lock.execute('SELECT stop_requested FROM data_map_analysis_workers WHERE worker_id=?', [worker]);
      stopped = !!r.stop_requested;
      await lock.execute('UPDATE data_map_analysis_workers SET heartbeat_at=UTC_TIMESTAMP(3) WHERE worker_id=?', [worker]);
      return stopped;
    };
    log({ event: 'worker_started', worker_id: worker });
    await work(repo, worker, { stop, log });
  } finally {
    process.removeListener('SIGINT', signalStop); process.removeListener('SIGTERM', signalStop); process.removeListener('message', signalStop);
    if (lock) {
      if (registered) { try { await lock.execute('UPDATE data_map_analysis_workers SET stopped_at=UTC_TIMESTAMP(3) WHERE worker_id=?', [registered]); } catch {} }
      lock.destroy();
    }
    await pool.end();
    if (registered) log({ event: 'worker_stopped', worker_id: registered });
  }
}
if (require.main === module) main().catch(e => { console.error(/^ANALYSIS_[A-Z_]+$/.test(e.message) ? e.message : 'ANALYSIS_WORKER_FAILED'); process.exitCode = 1; });
module.exports = { main };
