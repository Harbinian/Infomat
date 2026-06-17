#!/usr/bin/env node
/**
 * Optional real MySQL smoke for the process governance read model.
 *
 * It runs only when MYSQL_HOST, MYSQL_USER and MYSQL_DATABASE are set.
 */
const { runProcessGovernanceMysqlSmoke } = require('./lib/processGovernanceMysqlSmoke');

runProcessGovernanceMysqlSmoke().catch(error => {
  console.error(error);
  process.exit(1);
});
