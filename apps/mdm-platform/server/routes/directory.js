const express = require('express');
const {requireAuth,requireAnyPermission,requirePermission,getUserEffectivePermissionsAsync,getUserRoleCodesAsync} = require('../auth');
const {sessionSubject} = require('../sessionSubject');
const {makeDirectoryRepository} = require('../directoryRepository');
const {createRegisteredPool} = require('../mysqlPoolRegistry');
const {error} = require('../directoryContract');
const router = express.Router();
let repository, repositoryFactory;
function repo() { return repositoryFactory ? repositoryFactory() : repository || (repository = makeDirectoryRepository(createRegisteredPool(process.env,'directory'))); }
function run(action) { return (req,res) => Promise.resolve().then(() => action(req,res)).catch(err => res.status(err.statusCode || 503).json({code:err.statusCode ? err.code : 'DIRECTORY_UNAVAILABLE',error:err.statusCode ? err.message : '组织与人员目录暂不可用',...(err.details || {})})); }
async function canMaintain(req) {
  const subject = sessionSubject(req.session,req.identity);
  if (subject.kind === 'system_admin') return false;
  const [{permSet},roles] = await Promise.all([getUserEffectivePermissionsAsync(subject.principal),getUserRoleCodesAsync(subject.principal)]);
  return permSet.has('directory:maintain') && !roles.some(role => (role.code || role.role_code) === 'admin');
}
router.get('/v1',requireAuth,requireAnyPermission('directory:read','identity:read'),run(async(req,res) => {
  const maintain = await canMaintain(req), includeContacts = req.query.include_contacts === 'true';
  if (includeContacts && !maintain) throw error('联系信息仅供目录维护人员读取', 'DIRECTORY_ACCESS_DENIED', 403);
  res.set('Cache-Control','no-store');
  res.json({...await repo().snapshot({includeContacts}),canMaintain:maintain});
}));
router.post('/preview',requireAuth,requirePermission('directory:maintain'),run(async(req,res) => res.json(await repo().preview(req.body,req.session))));
router.post('/changes',requireAuth,requirePermission('directory:maintain'),run(async(req,res) => {
  const result = await repo().save(req.body,req.session); res.status(result.idempotent ? 200 : 201).json(result);
}));
router.setRepositoryFactory = factory => {repositoryFactory=factory;repository=null;};
module.exports = router;
