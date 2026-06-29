#!/usr/bin/env node
/**
 * Initialize MySQL tables for input baseline review.
 *
 * Required env:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */
import { createMysqlPoolFromEnv, makeInputBaselineReviewRepository } from './input-baseline-review-core.mjs';

const pool = await createMysqlPoolFromEnv();
try {
  const repo = makeInputBaselineReviewRepository(pool);
  await repo.initSchema();
  console.log('input_baseline_review_mysql_schema=ready');
} finally {
  await pool.end();
}
