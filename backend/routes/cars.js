const express = require('express');
const router = express.Router();
const db = require('../db');

const MAX_REMARKS_PER_CAR = 5;

// GET all cars with active loan info if loaned, plus their current remarks
router.get('/', (req, res) => {
  const cars = db.prepare(`
    SELECT c.*,
      l.id as active_loan_id, l.staff_number as loaned_to_staff_number,
      l.staff_name as loaned_to_name, l.issued_at as loaned_at, l.shift as loan_shift
    FROM cars c
    LEFT JOIN loans l ON l.car_id = c.id AND l.status = 'active'
    ORDER BY c.car_number
  `).all();

  const remarksStmt = db.prepare('SELECT * FROM car_remarks WHERE car_id = ? ORDER BY created_at ASC');
  cars.forEach(car => {
    car.remarks = remarksStmt.all(car.id);
  });

  res.json(cars);
});

// GET only available cars (for loan dropdown)
router.get('/available', (req, res) => {
  const cars = db.prepare(`SELECT * FROM cars WHERE status = 'available' ORDER BY car_number`).all();
  res.json(cars);
});

// List remarks for a single car
router.get('/:id/remarks', (req, res) => {
  const remarks = db.prepare('SELECT * FROM car_remarks WHERE car_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(remarks);
});

// Add a remark (open to anyone using the dashboard - matches the paper process where any
// staff member could flag an issue on the sheet). Capped at MAX_REMARKS_PER_CAR per car.
router.post('/:id/remarks', (req, res) => {
  const { staff_number, staff_name, remark_text } = req.body;
  if (!remark_text || !remark_text.trim()) {
    return res.status(400).json({ error: 'remark_text is required' });
  }
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  const count = db.prepare('SELECT COUNT(*) as c FROM car_remarks WHERE car_id = ?').get(car.id).c;
  if (count >= MAX_REMARKS_PER_CAR) {
    return res.status(409).json({ error: `This car already has ${MAX_REMARKS_PER_CAR} remarks - clear one before adding another.` });
  }

  const result = db.prepare(`
    INSERT INTO car_remarks (car_id, remark_text, staff_number, staff_name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(car.id, remark_text.trim(), staff_number || null, staff_name || null, new Date().toISOString());

  res.json({ success: true, id: result.lastInsertRowid });
});

// Clear one specific remark
router.delete('/:id/remarks/:remarkId', (req, res) => {
  const remark = db.prepare('SELECT * FROM car_remarks WHERE id = ? AND car_id = ?').get(req.params.remarkId, req.params.id);
  if (!remark) return res.status(404).json({ error: 'Remark not found' });
  db.prepare('DELETE FROM car_remarks WHERE id = ?').run(remark.id);
  res.json({ success: true });
});

module.exports = router;
