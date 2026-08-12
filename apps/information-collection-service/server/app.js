'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createAuth } = require('./auth');
const { acceptUploadedFile, removeTemporaryUpload, storagePath, uploadMiddleware } = require('./files');
const { sendXlsx, sendZip } = require('./export');
const { makeService, publicForm } = require('./service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  next();
}

function requestContext(req, res, next) {
  req.requestId = /^[0-9a-f-]{36}$/i.test(String(req.get('X-Request-Id') || ''))
    ? req.get('X-Request-Id')
    : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function createAudit(pool) {
  return async function audit(req, event, executor = pool) {
    const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
    await executor.execute(
      `INSERT INTO collection_audit_events
        (actor_person_id, action_code, entity_type, entity_id, owner_department_id, request_id, ip_address, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.actorPersonId || null, event.actionCode, event.entityType, event.entityId || null,
        event.ownerDepartmentId || null, req?.requestId || crypto.randomUUID(), req?.ip || null, JSON.stringify(detail)]
    );
  };
}

function baseApp(config, publicDir) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(publicDir, { etag: true, maxAge: 0 }));
  return app;
}

function registerAuthRoutes(app, auth, surface) {
  app.post('/api/v1/auth/login', asyncRoute(async (req, res) => {
    const identity = await auth.login(req, res);
    res.json({ identity, surface });
  }));
  app.get('/api/v1/auth/session', asyncRoute(async (req, res) => {
    const identity = await auth.loadSession(req);
    res.json({ authenticated: Boolean(identity), identity, surface });
  }));
  app.use('/api/v1', auth.requireAuth);
  app.get('/api/v1/auth/me', (req, res) => res.json({ identity: req.identity, surface }));
  app.get('/api/v1/auth/csrf-token', asyncRoute(async (req, res) => res.json({ csrfToken: await auth.issueCsrf(req) })));
  app.use('/api/v1', auth.requireCsrf);
  app.post('/api/v1/auth/logout', asyncRoute(async (req, res) => {
    await auth.logout(req, res);
    res.status(204).end();
  }));
}

function createAdminApp({ pool, config, service, audit }) {
  const publicDir = path.join(__dirname, '..', 'public', 'admin');
  const app = baseApp(config, publicDir);
  const auth = createAuth({ pool, config, surface: 'admin', audit });
  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'information-collection-service', surface: 'admin', port: config.adminPort, database: config.mysql.database, attachmentEnabled: config.attachment.enabled }));
  registerAuthRoutes(app, auth, 'admin');

  app.get('/api/v1/admin/directory', asyncRoute(async (req, res) => res.json(await service.listDirectory(req.identity, req.query.q))));
  app.get('/api/v1/admin/grants', asyncRoute(async (req, res) => res.json({ grants: await service.listGrants(req.identity) })));
  app.post('/api/v1/admin/grants', asyncRoute(async (req, res) => res.status(201).json({ grant: await service.grantAccess(req.identity, req.body, req) })));
  app.post('/api/v1/admin/grants/:grantId/revoke', asyncRoute(async (req, res) => res.json({ grant: await service.revokeGrant(req.identity, req.params.grantId, req) })));

  app.get('/api/v1/admin/forms', asyncRoute(async (req, res) => res.json({ forms: await service.listForms(req.identity, { includeArchived: req.query.includeArchived === '1' }) })));
  app.post('/api/v1/admin/forms', asyncRoute(async (req, res) => res.status(201).json({ form: await service.createForm(req.identity, req.body, req) })));
  app.get('/api/v1/admin/forms/:formId', asyncRoute(async (req, res) => res.json({ form: publicForm(await service.getForm(req.params.formId, req.identity)) })));
  app.put('/api/v1/admin/forms/:formId/draft', asyncRoute(async (req, res) => res.json(await service.saveDraft(req.identity, req.params.formId, req.body, req))));
  app.post('/api/v1/admin/forms/:formId/archive', asyncRoute(async (req, res) => res.json({ form: await service.archiveForm(req.identity, req.params.formId, req) })));
  app.delete('/api/v1/admin/forms/:formId', asyncRoute(async (req, res) => res.json({ form: await service.deleteForm(req.identity, req.params.formId, req) })));
  app.get('/api/v1/admin/forms/:formId/versions', asyncRoute(async (req, res) => res.json({ versions: await service.listFormVersions(req.identity, req.params.formId) })));

  app.post('/api/v1/admin/tasks/target-preview', asyncRoute(async (req, res) => res.json(await service.previewTargets(req.identity, req.body))));
  app.get('/api/v1/admin/tasks', asyncRoute(async (req, res) => res.json({ tasks: await service.listTasks(req.identity) })));
  app.post('/api/v1/admin/tasks', asyncRoute(async (req, res) => res.status(201).json({ task: await service.publishTask(req.identity, req.body, req) })));
  for (const action of ['close', 'reopen', 'extend', 'cancel']) {
    app.post(`/api/v1/admin/tasks/:taskId/${action}`, asyncRoute(async (req, res) => res.json({ task: await service.actOnTask(req.identity, req.params.taskId, action, req.body, req) })));
  }
  app.get('/api/v1/admin/tasks/:taskId/dashboard', asyncRoute(async (req, res) => res.json(await service.taskDashboard(req.identity, req.params.taskId, req))));
  app.get('/api/v1/admin/tasks/:taskId/submissions', asyncRoute(async (req, res) => res.json({ submissions: await service.listSubmissions(req.identity, req.params.taskId, req) })));
  app.get('/api/v1/admin/tasks/:taskId/export.xlsx', asyncRoute(async (req, res) => {
    const task = await service.getTask(req.params.taskId, req.identity);
    const result = await sendXlsx(pool, req.params.taskId, res);
    await audit(req, { actorPersonId: req.identity.personId, actionCode: 'task.export_xlsx', entityType: 'task', entityId: task.task_id, ownerDepartmentId: task.owner_department_id, detail: { rowCount: result.rowCount } });
  }));
  app.get('/api/v1/admin/tasks/:taskId/export.zip', asyncRoute(async (req, res) => {
    const task = await service.getTask(req.params.taskId, req.identity);
    const result = await sendZip(pool, req.params.taskId, res, config);
    await audit(req, { actorPersonId: req.identity.personId, actionCode: 'task.export_zip', entityType: 'task', entityId: task.task_id, ownerDepartmentId: task.owner_department_id, detail: { rowCount: result.rowCount, fileCount: result.fileCount } });
  }));
  app.get('/api/v1/admin/files/:fileId', asyncRoute(async (req, res) => {
    const file = await service.getAdminFile(req.identity, req.params.fileId);
    await audit(req, { actorPersonId: req.identity.personId, actionCode: 'file.download_admin', entityType: 'file', entityId: file.file_id, ownerDepartmentId: file.owner_department_id, detail: {} });
    res.download(storagePath(config, file.storage_key), file.original_name);
  }));

  registerFallbacks(app, publicDir);
  return app;
}

function createRespondentApp({ pool, config, service, audit }) {
  const publicDir = path.join(__dirname, '..', 'public', 'respondent');
  const app = baseApp(config, publicDir);
  const auth = createAuth({ pool, config, surface: 'respondent', audit });
  const upload = uploadMiddleware(config);
  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'information-collection-service', surface: 'respondent', port: config.respondentPort, database: config.mysql.database, attachmentEnabled: config.attachment.enabled }));
  registerAuthRoutes(app, auth, 'respondent');

  app.get('/api/v1/directory', asyncRoute(async (req, res) => res.json(await service.listDirectory(req.identity, req.query.q))));
  app.get('/api/v1/tasks', asyncRoute(async (req, res) => res.json({ tasks: await service.listRespondentTasks(req.identity) })));
  app.get('/api/v1/tasks/:taskId', asyncRoute(async (req, res) => res.json(await service.respondentTask(req.identity, req.params.taskId))));
  app.put('/api/v1/tasks/:taskId/submission', asyncRoute(async (req, res) => res.json({ submission: await service.saveSubmission(req.identity, req.params.taskId, req.body, req) })));
  app.post('/api/v1/tasks/:taskId/submit', asyncRoute(async (req, res) => res.json({ submission: await service.submitSubmission(req.identity, req.params.taskId, req.body, req) })));
  app.post('/api/v1/tasks/:taskId/edit', asyncRoute(async (req, res) => res.json({ submission: await service.editSubmission(req.identity, req.params.taskId, req.body, req) })));
  app.post('/api/v1/tasks/:taskId/files', (req, res, next) => upload(req, res, err => err ? next(err) : next()), asyncRoute(async (req, res) => {
    let accepted;
    try {
      const fieldKey = String(req.body?.fieldKey || '');
      await service.submissionForFile(req.identity, req.params.taskId, fieldKey);
      accepted = await acceptUploadedFile(req.file, config);
      const result = await service.registerFile(req.identity, req.params.taskId, fieldKey, accepted, req);
      res.status(201).json({ file: result });
    } catch (err) {
      if (accepted?.storagePath) await fs.promises.rm(accepted.storagePath, { force: true }).catch(() => {});
      throw err;
    } finally {
      await removeTemporaryUpload(req.file);
    }
  }));
  app.delete('/api/v1/tasks/:taskId/files/:fileId', asyncRoute(async (req, res) => res.json({ file: await service.removeFile(req.identity, req.params.taskId, req.params.fileId, req.body?.expectedRevision, req) })));
  app.get('/api/v1/files/:fileId', asyncRoute(async (req, res) => {
    const file = await service.getRespondentFile(req.identity, req.params.fileId);
    await audit(req, { actorPersonId: req.identity.personId, actionCode: 'file.download_respondent', entityType: 'file', entityId: file.file_id, ownerDepartmentId: file.owner_department_id, detail: {} });
    res.download(storagePath(config, file.storage_key), file.original_name);
  }));

  registerFallbacks(app, publicDir);
  return app;
}

function registerFallbacks(app, publicDir) {
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在', code: 'API_NOT_FOUND' }));
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '附件超过允许大小', code: 'ATTACHMENT_TOO_LARGE', requestId: req.requestId });
    const status = Number(err.status || 500);
    if (status >= 500) console.error(`[information-collection] request=${req.requestId} code=${err.code || 'INTERNAL_ERROR'} message=${err.message}`);
    res.status(status).json({
      error: status >= 500 && !err.status ? '服务暂时不可用，请稍后重试' : err.message,
      code: err.code || 'INTERNAL_ERROR',
      details: err.details || undefined,
      requestId: req.requestId
    });
  });
}

function createApps({ pool, config }) {
  const audit = createAudit(pool);
  const service = makeService({ pool, audit });
  return {
    adminApp: createAdminApp({ pool, config, service, audit }),
    respondentApp: createRespondentApp({ pool, config, service, audit }),
    audit,
    service
  };
}

module.exports = { createApps };
