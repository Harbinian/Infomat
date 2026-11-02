const express = require('express');
const { requireAuth } = require('../auth');
const { getAccessModel } = require('../roleDefinitions');

const router = express.Router();

router.get('/model', requireAuth, (req, res) => {
  res.json(getAccessModel());
});

router.get('/department-role-requirements', requireAuth, (req, res) => {
  try {
    const config = require('../../config/department-role-requirements.json');
    res.json(require('../departmentRoleRequirements').departmentRoleRequirements(config));
  } catch (_) {
    res.status(503).json({ error: '部门角色配置暂不可用，请核对配置及来源', code: 'DEPARTMENT_ROLE_REQUIREMENTS_UNAVAILABLE' });
  }
});

router.all('/department-role-requirements', requireAuth, (req, res) => {
  res.status(405).json({ error: '部门角色配置只提供查看，人员授权另行办理', code: 'DEPARTMENT_ROLE_REQUIREMENTS_READ_ONLY' });
});

router.all('/model', requireAuth, (req, res) => {
  res.status(405).json({
    error: '核心角色、权限和责任矩阵由固定治理模型维护，页面只提供查看',
    code: 'CORE_GOVERNANCE_MODEL_READ_ONLY'
  });
});

module.exports = router;
