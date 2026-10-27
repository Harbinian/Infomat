const express = require('express');
const { requireAuth } = require('../auth');
const { sessionSubject } = require('../sessionSubject');
const { createRegisteredPool } = require('../mysqlPoolRegistry');
const { logRequestFailure } = require('../securityLog');
const { makeProcessAuthoringWorkspace } = require('../processAuthoringWorkspace');
const router = express.Router();
let factory = null, instance = null;
function repository() { return factory ? factory() : instance || (instance = makeProcessAuthoringWorkspace(createRegisteredPool(process.env, 'processAuthoringWorkspace'))); }
function actor(req) {
  const subject = sessionSubject(req.session, req.identity);
  return { identityKind: subject.kind, personId: subject.personId, accountId: subject.accountId, authVersion: subject.authVersion };
}
function run(res, action, created = false) {
  return Promise.resolve().then(action).then(result => res.status(created && !result.idempotent ? 201 : 200).json(result)).catch(error => {
    if (error.statusCode) return res.status(error.statusCode).json(error.payload || { error: error.message, code: error.code });
    logRequestFailure(res, error); return res.status(500).json({ error: '服务器错误' });
  });
}
router.use(requireAuth);
router.get('/status', (req, res) => run(res, () => repository().status()));
router.get('/drafts', (req, res) => run(res, () => repository().list(actor(req), req.query)));
router.post('/drafts', (req, res) => run(res, () => repository().create(req.body || {}, actor(req)), true));
router.post('/drafts/from-case/:caseId', (req, res) => run(res, () => repository().create(req.body || {}, actor(req), req.params.caseId), true));
router.get('/drafts/:id', (req, res) => run(res, () => repository().get(req.params.id, actor(req))));
router.put('/drafts/:id', (req, res) => run(res, () => repository().save(req.params.id, req.body || {}, actor(req))));
router.post('/drafts/:id/submit', (req, res) => run(res, () => repository().submit(req.params.id, req.body || {}, actor(req))));
router.setRepositoryFactory = value => { factory = value; instance = null; };
router.resetRepositoryFactory = () => { factory = null; instance = null; };
module.exports = router;
