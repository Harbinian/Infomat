const express = require('express');
const { createRegisteredPool } = require('../mysqlPoolRegistry');
const { requireDirectoryClient } = require('../directoryIntegrationAuth');
const { securityLog, logRequestFailure } = require('../securityLog');
const router = express.Router();
let repository, repositoryFactory;
const fields = {
  departments: ['id','code','name','parent_id','department_type','status','final_responsible_person_id','data_owner_person_id'],
  persons: ['person_id','employee_no','person_name','current_department_id','employment_status','status','office_ids'],
  offices: ['id','code','name','department_id','manager_person_id','status']
};
function basicRows(rows, type) {
  return rows.map(row => Object.fromEntries(fields[type].filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
}
function repo() {
  if (repositoryFactory) return repositoryFactory();
  if (!repository) repository = require('../directoryRepository').makeDirectoryRepository(createRegisteredPool(process.env, 'directory-integration'));
  return repository;
}

router.get('/directory', requireDirectoryClient, async (req, res) => {
  try {
    // System clients receive only the public contract, never contacts or permissions.
    const snapshot = await repo().snapshot({ includeContacts: false });
    const { schema_version, source, snapshot_hash, departments, persons, offices } = snapshot;
    res.json({ schema_version, source, snapshot_hash, departments:basicRows(departments,'departments'), persons:basicRows(persons,'persons'), offices:basicRows(offices,'offices') });
    securityLog(req).write({ event: 'directory_read', code: 'DIRECTORY_V1_READ', actor_ref: 'directory-client:' + req.directoryClientId, status: 200 });
  } catch (error) {
    logRequestFailure(req, error, { status: 503 });
    res.status(503).json({ code: 'DIRECTORY_UNAVAILABLE', error: '组织与员工目录暂不可用' });
  }
});
router.all('/directory', (_req, res) => res.set('Allow', 'GET').status(405).json({ code: 'DIRECTORY_READ_ONLY', error: '系统间目录接口仅支持读取' }));
router.setRepositoryFactory = factory => { repositoryFactory = factory; repository = null; };
module.exports = router;
