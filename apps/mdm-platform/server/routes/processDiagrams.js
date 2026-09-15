// Read-only shared renderers. Serve files locally; never connect to the 3001 service.
const express = require('express');
const path = require('node:path');
const { requireAuth } = require('../auth');
const router = express.Router();
const serviceRoot = path.resolve(__dirname, '../../../structured-output-service');
const assets = {
  'cytoscape.min.js': require.resolve('cytoscape/dist/cytoscape.min.js', { paths: [serviceRoot] }),
  'process-diagram.js': path.join(serviceRoot, 'public/process-diagram.js'),
  'data-relation-diagram.js': path.join(serviceRoot, 'public/data-relation-diagram.js')
};
router.get('/assets/:name', requireAuth, (req, res) => {
  const file = Object.prototype.hasOwnProperty.call(assets, req.params.name) && assets[req.params.name];
  if (!file) return res.status(404).json({ error: '图形资源不存在' });
  res.type('application/javascript').sendFile(file);
});
module.exports = router;
