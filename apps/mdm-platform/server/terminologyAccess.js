const { getDepartmentByIdAsync } = require('./auth');
const { hasGlobalViewAsync } = require('./access');

// Shared by the existing terminology routes and explicit todo source creation.
async function terminologyScope(req, options = {}) {
  const canViewAll = options.canViewAll === undefined ? await hasGlobalViewAsync(req) : options.canViewAll;
  const department = await getDepartmentByIdAsync(req.session.departmentId);
  return {
    canViewAll,
    userId: req.session.userId,
    departmentId: req.session.departmentId || null,
    departmentName: department && department.name || req.session.departmentName || ''
  };
}

module.exports = { terminologyScope };
