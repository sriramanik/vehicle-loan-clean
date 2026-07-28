const express = require('express');
const router = express.Router();
const db = require('../db');

// Verify a staff number exists
router.get('/verify/:staffNumber', (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE staff_number = ?').get(req.params.staffNumber.trim());
  if (staff) {
    res.json({ found: true, staff });
  } else {
    res.json({ found: false });
  }
});

// Self-service add if staff number not found (used during loan flow)
router.post('/', (req, res) => {
  const { staff_number, name } = req.body;
  if (!staff_number || !name) {
    return res.status(400).json({ error: 'staff_number and name are required' });
  }
  const trimmedNum = String(staff_number).trim();
  const trimmedName = String(name).trim();

  try {
    db.prepare('INSERT INTO staff (staff_number, name) VALUES (?, ?)').run(trimmedNum, trimmedName);
    res.json({ success: true, staff: { staff_number: trimmedNum, name: trimmedName } });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Staff number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
