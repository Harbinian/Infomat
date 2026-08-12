'use strict';

const assert = require('assert');

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { response, body };
}

async function main() {
  const host = process.env.COLLECTION_SMOKE_HOST || '127.0.0.1';
  const adminPort = Number(process.env.COLLECTION_ADMIN_PORT || 4000);
  const respondentPort = Number(process.env.COLLECTION_RESPONDENT_PORT || 4001);
  const [admin, respondent] = await Promise.all([
    json(`http://${host}:${adminPort}/api/health`),
    json(`http://${host}:${respondentPort}/api/health`)
  ]);
  assert.equal(admin.response.status, 200);
  assert.equal(admin.body.surface, 'admin');
  assert.equal(admin.body.port, adminPort);
  assert.equal(respondent.response.status, 200);
  assert.equal(respondent.body.surface, 'respondent');
  assert.equal(respondent.body.port, respondentPort);
  const session = await json(`http://${host}:${adminPort}/api/v1/auth/session`);
  assert.equal(session.response.status, 200);
  assert.equal(session.body.authenticated, false);
  const unauthenticated = await json(`http://${host}:${respondentPort}/api/v1/tasks`);
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.code, 'AUTH_REQUIRED');
  console.log(JSON.stringify({ status: 'PASS', admin: admin.body, respondent: respondent.body, authBoundary: 'PASS' }));
}

main().catch(error => {
  console.error(`[information-collection] smoke failed: ${error.stack || error.message}`);
  process.exit(1);
});
