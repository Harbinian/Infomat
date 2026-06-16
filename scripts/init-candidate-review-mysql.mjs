#!/usr/bin/env node
/**
 * Initialize MySQL tables for candidate review.
 *
 * Required env:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */
import { createMysqlPoolFromEnv, makeCandidateReviewRepository } from './candidate-review-core.mjs';

const pool = await createMysqlPoolFromEnv();
try {
  const repo = makeCandidateReviewRepository(pool);
  await repo.initSchema();
  console.log('candidate_review_mysql_schema=ready');
} finally {
  await pool.end();
}
