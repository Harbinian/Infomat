const express = require('express');
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { sessionSubject, identityInteger } = require('../sessionSubject');
const { createRegisteredPool } = require('../mysqlPoolRegistry');
const { logRequestFailure, securityLog } = require('../securityLog');
const { makeGovernanceResponsibilitiesRepository, assertResponsibilityScope } = require('../governanceResponsibilities');
const router = express.Router();
let repositoryFactory = null, actorFactory = null, repository = null;
function getRepository() {
  if (repositoryFactory) return repositoryFactory();
  if (!repository) repository = makeGovernanceResponsibilitiesRepository(createRegisteredPool(process.env, 'governanceResponsibilities'));
  return repository;
}
async function currentActor(req) {
  if (actorFactory) return actorFactory(req);
  const subject = sessionSubject(req.session, req.identity);
  const permissions = await getUserEffectivePermissionsAsync(subject.principal);
  return { identityKind: subject.kind, personId: identityInteger(subject.personId), accountId: identityInteger(subject.accountId),
    authVersion: identityInteger(subject.authVersion), departmentId: identityInteger(req.session.departmentId), permissions: permissions.permSet };
}
function run(res, action) {
  return Promise.resolve().then(action).catch(error => {
    if (error.code === 'RESPONSIBILITY_COMMIT_UNKNOWN') securityLog(res).write({ event: 'commit_unknown', code: error.code, status: 503 });
    if (error.statusCode) return res.status(error.statusCode).json(error.payload || { code: error.code, error: error.message });
    logRequestFailure(res, error);
    return res.status(500).json({ code: 'RESPONSIBILITY_UNAVAILABLE', error: '治理职责暂不可用' });
  });
}
router.use(requireAuth);
router.get('/workbench', (req, res) => run(res, async () => res.json(await (await getRepository()).workbench(await currentActor(req)))));
for (const [path, type] of [['cases', 'case'], ['work-packages', 'work_package']]) {
  router.get(`/${path}/:id`, (req, res) => run(res, async () => {
    assertResponsibilityScope(type);
    res.json(await (await getRepository()).describe(type, req.params.id, await currentActor(req)));
  }));
  router.put(`/${path}/:id/:kind`, (req, res) => run(res, async () => {
    assertResponsibilityScope(type, { write: true });
    res.json(await (await getRepository()).assign(type, req.params.id, req.params.kind, req.body || {}, await currentActor(req)));
  }));
}
router.post('/cases/:id/work-records', (req, res) => run(res, async () => {
  assertResponsibilityScope('case', { write: true });
  res.status(201).json(await (await getRepository()).recordWork(req.params.id, req.body || {}, await currentActor(req)));
}));
router.setRepositoryFactory = factory => { repositoryFactory = factory; repository = null; };
router.setActorFactory = factory => { actorFactory = factory; };
router.resetFactories = () => { repositoryFactory = null; actorFactory = null; repository = null; };
module.exports = router;
