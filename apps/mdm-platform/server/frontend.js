// Serve only the dedicated public build and explicitly registered page routes.
// No database, startup build, source directory exposure or catch-all API fallback.
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const {pages} = require('../shared/browserProtocol');

function frontendRouter(dist = path.resolve(__dirname, '../frontend/dist')) {
  const router = express.Router();
  router.use('/assets', express.static(path.join(dist, 'assets'), {
    dotfiles: 'deny', index: false, immutable: true, maxAge: '1y', fallthrough: true
  }));
  router.get(pages.map(page=>page.serverPath), (req, res, next) => {
    const index = path.join(dist, 'index.html');
    if (!fs.existsSync(index)) {
      return res.set('Cache-Control', 'no-store').status(503).type('text').send('平台页面尚未构建，请联系维护人员完成前端构建。');
    }
    res.set('Cache-Control', 'no-store').sendFile(index, error => { if (error) next(error); });
  });
  router.use((req, res) => res.status(404).type('text').send('未找到页面或静态资源。'));
  return router;
}

function publicEntryRouter(directory = path.resolve(__dirname, '../public')) {
  const router = express.Router();
  router.get('/', (req, res) => res.set('Cache-Control', 'no-store').redirect(302, '/app/'));
  router.get(['/index.html', '/mdm-protocol.js'], (req, res) =>
    res.set('Cache-Control', 'no-store').status(410).type('text').send('旧版页面已退役，请访问 /app/。'));
  // Only resources consumed by the current frontend are public. A restored old
  // index file or an accidental new public file cannot reopen another frontend.
  for (const name of ['logo.png', 'echarts.min.js', 'template.xlsx']) {
    router.get('/' + name, (req, res, next) => res.sendFile(path.join(directory, name), error => { if (error && !req.aborted && !res.headersSent) next(error); }));
  }
  return router;
}

module.exports = { frontendRouter, publicEntryRouter };
