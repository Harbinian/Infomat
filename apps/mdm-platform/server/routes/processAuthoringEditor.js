const express = require('express');
const editor = require('../processAuthoringEditor');
const { requireAuth } = require('../auth');
const { logRequestFailure } = require('../securityLog');
let pool;
const enabled = () => process.env.PROCESS_AUTHORING_WORKSPACE_ENABLED === '1';
function createRouter({ isEnabled = enabled, authorization, readDepartments } = {}) {
  const router = express.Router();
  // Public technical contracts and non-personal department hints need a valid
  // session; draft content and every write are separately authorized by workspace.
  router.use(['/editor', '/assets'], authorization || requireAuth);
  router.use(['/editor', '/assets'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!isEnabled()) return res.status(503).json({ code: 'PROCESS_AUTHORING_DISABLED', error: '3000流程编制尚未开启。' });
    return next();
  });
  const action = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(error => {
    if (error.statusCode) return res.status(error.statusCode).json({ code: error.code, error: error.message, ...(error.path ? { path: error.path } : {}) });
    logRequestFailure(res, error);
    return res.status(503).json({ code: 'PROCESS_AUTHORING_EDITOR_UNAVAILABLE', error: '编制检查暂不可用，当前输入仍保留。' });
  });
  router.get('/editor/schema', action((req, res) => {
    const result = editor.schema(req.query.version);
    res.set('X-Infomat-Schema-Digest', result.digest).json(result.data);
  }));
  router.get('/editor/template', action((req, res) => res.json(editor.template(req.query.version))));
  router.post('/editor/validate', action((req, res) => res.json(editor.validate(req.body))));
  router.get('/editor/enums', action(async (req, res) => {
    const rows = readDepartments ? await readDepartments(req) : await (async () => {
      pool ||= require('../mysqlPoolRegistry').createRegisteredPool(process.env, 'processAuthoringEditor');
      const [departments] = await pool.execute("SELECT name FROM departments WHERE status='active' ORDER BY id");
      return departments;
    })();
    res.json(editor.enums(rows));
  }));
  router.get('/assets/:file', (req, res, next) => {
    const file = editor.asset(req.params.file);
    if (!file) return res.status(404).json({ code: 'PROCESS_AUTHORING_ASSET_NOT_FOUND', error: '未找到编制资源。' });
    return res.sendFile(file, error => { if (error && !req.aborted && !res.headersSent) next(error); });
  });
  return router;
}
const router = createRouter();
module.exports = router;
module.exports.createRouter = createRouter;
