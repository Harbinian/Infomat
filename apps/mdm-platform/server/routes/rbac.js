const express = require('express');
const { requireAuth } = require('../auth');
const { getAccessModel } = require('../roleDefinitions');

const router = express.Router();

router.get('/model', requireAuth, (req, res) => {
  res.json(getAccessModel());
});

router.all('/model', requireAuth, (req, res) => {
  res.status(405).json({
    error: '核心角色、权限和责任矩阵由固定治理模型维护，页面只提供查看',
    code: 'CORE_GOVERNANCE_MODEL_READ_ONLY'
  });
});

module.exports = router;
