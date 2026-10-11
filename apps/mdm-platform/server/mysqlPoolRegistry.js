// R04/R11: one place that knows every domain pool the process owns.
//
// Before this, twenty-odd modules each created their own pool with no queue bound and no record
// of what existed. Shutdown could not drain them because nothing knew about them, and a stalled
// database had no process-wide ceiling.
//
// The registry only accounts for pools; it does not create connections, verify schemas or decide
// policy. Registration happens where the pool is created.
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, poolBudget } = require('./mysqlConfig');

const pools = new Map(); // domain -> Set of {pool, config}
let closePromise = null;

function registerPool(domain, pool, config) {
  const label = String(domain || 'shared');
  if (!pools.has(label)) pools.set(label, new Set());
  pools.get(label).add({ pool, config });
  return pool;
}

function createRegisteredPool(env = process.env, domain = null) {
  const config = mysqlConfigFromEnv(env, domain);
  return registerPool(domain, mysql.createPool(config), config);
}

// Read-only totals for diagnostics and for tests that need to prove a queue drained.
function totalPoolBudget() {
  let connections = 0;
  let queues = 0;
  const domains = [];
  for (const [domain, entries] of pools) {
    let domainConnections = 0;
    let domainQueue = 0;
    for (const { config } of entries) {
      domainConnections += Number(config.connectionLimit || 0);
      domainQueue += Number(config.queueLimit || 0);
    }
    connections += domainConnections;
    queues += domainQueue;
    domains.push({ domain, pools: entries.size, connectionLimit: domainConnections, queueLimit: domainQueue });
  }
  domains.sort((a, b) => a.domain.localeCompare(b.domain));
  return { domains, pools: [...pools.values()].reduce((sum, set) => sum + set.size, 0), connections, queues };
}

function registeredPoolCount() {
  return [...pools.values()].reduce((sum, set) => sum + set.size, 0);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Idempotent: the runtime calls it on shutdown, and a second call reuses the first result. A pool
// that will not close within the budget is reported rather than waited on forever -- the process
// still has its hard exit, and the report says which domain did not drain.
function closeAllPools({ timeoutMs = 5000 } = {}) {
  if (closePromise) return closePromise;
  closePromise = (async () => {
    const entries = [];
    for (const [domain, set] of pools) for (const entry of set) entries.push({ domain, ...entry });
    pools.clear();
    const results = await Promise.all(entries.map(async ({ domain, pool }) => {
      let timedOut = false;
      await Promise.race([
        pool.end().catch(() => {}),
        sleep(timeoutMs).then(() => { timedOut = true; })
      ]);
      return { domain, timedOut };
    }));
    const notDrained = results.filter(result => result.timedOut).map(result => result.domain);
    return { closed: results.length, notDrained };
  })();
  return closePromise;
}

// Test seam: forget the registry so an isolated case starts from a clean account.
function resetPoolRegistry() {
  pools.clear();
  closePromise = null;
}

module.exports = {
  createRegisteredPool,
  registerPool,
  totalPoolBudget,
  registeredPoolCount,
  closeAllPools,
  resetPoolRegistry,
  poolBudget
};
