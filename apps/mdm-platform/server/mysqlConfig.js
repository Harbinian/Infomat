function mysqlConfigFromEnv(env = process.env) {
  return {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER || 'root',
    password: env.MYSQL_PASSWORD || '',
    database: env.MYSQL_DATABASE || 'infomat_mdm',
    waitForConnections: true,
    connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT || 10),
    charset: 'utf8mb4'
  };
}

function redactMysqlConfig(config) {
  return {
    ...config,
    password: config.password ? '***' : ''
  };
}

module.exports = {
  mysqlConfigFromEnv,
  redactMysqlConfig
};
