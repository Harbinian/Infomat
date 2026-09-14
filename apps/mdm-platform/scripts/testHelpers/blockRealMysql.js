// Simulation suites may replace these factories with explicit test doubles.
// Any missed injection fails before a socket can reach a default/configured DB.
for (const name of ['mysql2', 'mysql2/promise']) {
  const driver = require(name);
  for (const factory of ['createPool', 'createConnection', 'createPoolCluster']) {
    driver[factory] = () => { throw new Error('ISOLATED_TEST_REAL_MYSQL_FORBIDDEN'); };
  }
}
