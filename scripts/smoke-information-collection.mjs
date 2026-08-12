import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(scriptDir, 'information-collection.config.json'), 'utf8'));

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  return { status: response.status, body };
}

const adminUrl = `http://${config.admin.host}:${config.admin.port}`;
const respondentUrl = `http://${config.respondent.host}:${config.respondent.port}`;
const [admin, respondent, adminSession, respondentSession, adminBoundary, respondentBoundary] = await Promise.all([
  getJson(`${adminUrl}/api/health`), getJson(`${respondentUrl}/api/health`),
  getJson(`${adminUrl}/api/v1/auth/session`), getJson(`${respondentUrl}/api/v1/auth/session`),
  getJson(`${adminUrl}/api/v1/admin/forms`), getJson(`${respondentUrl}/api/v1/tasks`)
]);

const pass = admin.status === 200 && admin.body.surface === 'admin'
  && respondent.status === 200 && respondent.body.surface === 'respondent'
  && adminSession.status === 200 && adminSession.body.authenticated === false
  && respondentSession.status === 200 && respondentSession.body.authenticated === false
  && adminBoundary.status === 401 && respondentBoundary.status === 401;

console.log(JSON.stringify({
  status: pass ? 'PASS' : 'FAIL',
  admin: { url: adminUrl, health: admin.body.status, sessionProbe: adminSession.status, unauthenticatedApi: adminBoundary.status },
  respondent: { url: respondentUrl, health: respondent.body.status, sessionProbe: respondentSession.status, unauthenticatedApi: respondentBoundary.status },
  database: admin.body.database,
  attachmentEnabled: respondent.body.attachmentEnabled
}, null, 2));

if (!pass) process.exit(1);
