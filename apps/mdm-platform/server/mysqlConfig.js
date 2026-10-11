// Connection configuration and per-domain budgets.
//
// The budgets below are local engineering defaults, not measured production capacity or a
// service-level agreement. They exist so that a database that stops answering cannot let a
// request, a queue or a connection accumulate without bound. Every value is overridable from the
// environment, and the whole point is the bound -- not the particular number.
const BUDGET_DEFAULTS = Object.freeze({
  connectionLimit: 10,
  queueLimit: 32,
  // The driver's own connect timeout is left as it is: tightening it is what makes a busy
  // database look unreachable, and the bound R04 asks for is the queue and the operation, not
  // the TCP handshake. Operators can still lower it per environment.
  connectTimeoutMs: 10000,
  operationTimeoutMs: 10000
});

// Domain labels are fixed here so a typo cannot silently create an unbudgeted pool. They follow
// mysqlRuntimeSchema.DOMAIN_TABLES where a domain exists there, plus the repositories that have
// no runtime-schema probe of their own.
const POOL_DOMAINS = Object.freeze({
  identity: { connectionLimit: 10, queueLimit: 32 },
  audit: { connectionLimit: 4, queueLimit: 16 },
  conflict: { connectionLimit: 4, queueLimit: 16 },
  dataMap: { connectionLimit: 8, queueLimit: 32 },
  mapping: { connectionLimit: 4, queueLimit: 16 },
  terminology: { connectionLimit: 4, queueLimit: 16 },
  todo: { connectionLimit: 4, queueLimit: 16 },
  guidance: { connectionLimit: 4, queueLimit: 16 },
  issuePool: { connectionLimit: 4, queueLimit: 16 },
  inputBaseline: { connectionLimit: 4, queueLimit: 16 },
  processGovernance: { connectionLimit: 8, queueLimit: 32 },
  processDesign: { connectionLimit: 4, queueLimit: 16 },
  processDataGovernance: { connectionLimit: 8, queueLimit: 32 },
  processPreviewReview: { connectionLimit: 4, queueLimit: 16 },
  governanceAccess: { connectionLimit: 4, queueLimit: 16 },
  offices: { connectionLimit: 4, queueLimit: 16 },
  publications: { connectionLimit: 4, queueLimit: 16 }
});

function poolBudget(domain) {
  const known = Object.prototype.hasOwnProperty.call(POOL_DOMAINS, String(domain || ''));
  const override = known ? POOL_DOMAINS[domain] : {};
  return { ...BUDGET_DEFAULTS, ...override, domain: known ? domain : 'shared' };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function mysqlConfigFromEnv(env = process.env, domain = null) {
  const budget = poolBudget(domain);
  const config = {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER || 'root',
    password: env.MYSQL_PASSWORD || '',
    database: env.MYSQL_DATABASE || 'infomat_mdm',
    waitForConnections: true,
    connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT || budget.connectionLimit),
    charset: 'utf8mb4'
  };
  // A bounded wait and a bounded operation are what keep a stalled database from turning into an
  // unbounded queue. The driver's own connectTimeout does not cover pool waiting or query time.
  config.queueLimit = positiveInteger(env.MYSQL_QUEUE_LIMIT, budget.queueLimit);
  config.connectTimeout = positiveInteger(env.MYSQL_CONNECT_TIMEOUT_MS, budget.connectTimeoutMs);
  config.maxIdle = positiveInteger(env.MYSQL_MAX_IDLE, config.connectionLimit);
  config.idleTimeout = positiveInteger(env.MYSQL_IDLE_TIMEOUT_MS, 60000);
  return config;
}

function redactMysqlConfig(config) {
  return {
    ...config,
    password: config.password ? '***' : ''
  };
}

// The bound applied to a single unit of work on a pool. Kept next to the pool budget so the two
// cannot drift apart.
function operationTimeoutMs(env = process.env, domain = null) {
  return positiveInteger(env.MYSQL_OPERATION_TIMEOUT_MS, poolBudget(domain).operationTimeoutMs);
}

module.exports = {
  BUDGET_DEFAULTS,
  POOL_DOMAINS,
  mysqlConfigFromEnv,
  redactMysqlConfig,
  poolBudget,
  operationTimeoutMs
};
