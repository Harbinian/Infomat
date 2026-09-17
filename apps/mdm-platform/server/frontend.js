// Serve only the dedicated public build and explicitly registered page routes.
// No database, startup build, source directory exposure or catch-all API fallback.
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

function frontendRouter(dist = path.resolve(__dirname, '../frontend/dist')) {
  const router = express.Router();
  router.use('/assets', express.static(path.join(dist, 'assets'), {
    dotfiles: 'deny', index: false, immutable: true, maxAge: '1y', fallthrough: true
  }));
  router.get(['/', '/workbench', '/identity', '/template-import', '/objects', '/fact-checks', '/v7-mappings', '/design-handoffs', '/analysis'], (req, res, next) => {
    const index = path.join(dist, 'index.html');
    if (!fs.existsSync(index)) {
      return res.status(503).type('text').send('新入口尚未构建，请使用原入口。');
    }
    res.set('Cache-Control', 'no-store').sendFile(index, error => { if (error) next(error); });
  });
  router.use((req, res) => res.status(404).type('text').send('未找到页面或静态资源。'));
  return router;
}

module.exports = { frontendRouter };
