const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/entity/:type/:id', requireAuth, (req, res) => {
  const { type, id } = req.params;
  const changeSets = db.prepare('SELECT * FROM change_set WHERE entity_type=? AND entity_id=? ORDER BY operated_at DESC').all(type, id);
  const logs = db.prepare('SELECT * FROM version_log WHERE entity_type=? AND entity_id=? ORDER BY operated_at DESC').all(type, id);
  res.json({ changeSets, logs });
});

router.get('/mapping/:id', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT vl.*, u.name as operator_name
    FROM version_log vl
    LEFT JOIN users u ON vl.operated_by = u.id
    WHERE vl.entity_type='mapping' AND vl.entity_id=?
    ORDER BY vl.operated_at DESC
  `).all(req.params.id);
  res.json(logs);
});

router.get('/field/:id', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT vl.*, u.name as operator_name
    FROM version_log vl
    LEFT JOIN users u ON vl.operated_by = u.id
    WHERE vl.entity_type='field_entry' AND vl.entity_id=?
    ORDER BY vl.operated_at DESC
  `).all(req.params.id);
  res.json(logs);
});

module.exports = router;
