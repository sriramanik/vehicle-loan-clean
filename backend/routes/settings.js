const express = require('express');
const router = express.Router();
const db = require('../db');

// Public - the dashboard needs to know which inspection mode to render
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

module.exports = router;
