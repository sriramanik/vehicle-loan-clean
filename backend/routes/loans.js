const express = require('express');
const router = express.Router();
const db = require('../db');
const { getShiftInfo, getCurrentDuty } = require('../shiftUtil');

// Current on-duty team + shift, for the dashboard header
router.get('/duty/current', (req, res) => {
  res.json(getCurrentDuty(new Date()));
});

// Issue a car (loan)
router.post('/issue', (req, res) => {
  const { car_id, staff_number, staff_name, inspection } = req.body;
  if (!car_id || !staff_number || !staff_name) {
    return res.status(400).json({ error: 'car_id, staff_number, staff_name are required' });
  }

  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(car_id);
  if (!car) return res.status(404).json({ error: 'Car not found' });
  if (car.status !== 'available') return res.status(409).json({ error: 'Car is not available' });

  const now = new Date();
  const { shift, shift_date } = getShiftInfo(now);
  const { team: duty_team } = getCurrentDuty(now);
  const issuedAt = now.toISOString();
  const inspectionJson = inspection ? JSON.stringify(inspection) : null;

  const insert = db.prepare(`
    INSERT INTO loans (car_id, car_number, reg_number, staff_number, staff_name, duty_team, shift, shift_date, issued_at, status, inspection_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `);
  const result = insert.run(car.id, car.car_number, car.reg_number, staff_number.trim(), staff_name.trim(), duty_team, shift, shift_date, issuedAt, inspectionJson);

  db.prepare(`UPDATE cars SET status = 'loaned' WHERE id = ?`).run(car.id);

  res.json({ success: true, loan_id: result.lastInsertRowid, shift, shift_date, duty_team, issued_at: issuedAt });
});

// Return a car
router.post('/return', (req, res) => {
  const { car_id, returned_by_staff_number, returned_by_name } = req.body;
  if (!car_id) return res.status(400).json({ error: 'car_id is required' });

  const loan = db.prepare(`SELECT * FROM loans WHERE car_id = ? AND status = 'active'`).get(car_id);
  if (!loan) return res.status(404).json({ error: 'No active loan found for this car' });

  const returnedAt = new Date().toISOString();

  db.prepare(`
    UPDATE loans SET status = 'returned', returned_at = ?, returned_by_staff_number = ?, returned_by_name = ?
    WHERE id = ?
  `).run(returnedAt, returned_by_staff_number || loan.staff_number, returned_by_name || loan.staff_name, loan.id);

  db.prepare(`UPDATE cars SET status = 'available' WHERE id = ?`).run(car_id);

  res.json({ success: true, returned_at: returnedAt });
});

// Get active loans
router.get('/active', (req, res) => {
  const loans = db.prepare(`SELECT * FROM loans WHERE status = 'active' ORDER BY issued_at DESC`).all();
  res.json(loans);
});

// History with filters: date, shift, staff_number, car_number, team
router.get('/history', (req, res) => {
  const { date, shift, staff_number, car_number, team } = req.query;
  let query = 'SELECT * FROM loans WHERE 1=1';
  const params = [];

  if (date) { query += ' AND shift_date = ?'; params.push(date); }
  if (shift) { query += ' AND shift LIKE ?'; params.push(`%${shift}%`); }
  if (staff_number) { query += ' AND staff_number = ?'; params.push(staff_number); }
  if (car_number) { query += ' AND car_number = ?'; params.push(car_number); }
  if (team) { query += ' AND duty_team = ?'; params.push(team); }

  query += ' ORDER BY issued_at DESC';
  const loans = db.prepare(query).all(...params);
  res.json(loans);
});

module.exports = router;
