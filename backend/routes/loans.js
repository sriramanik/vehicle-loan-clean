const express = require('express');
const router = express.Router();
const db = require('../db');
const { getShiftInfo, getCurrentDuty, isLoanOverdue } = require('../shiftUtil');
const { STAFF_TEAMS } = require('../staffTeams');

// Current on-duty team + shift, for the dashboard header
router.get('/duty/current', (req, res) => {
  res.json(getCurrentDuty(new Date()));
});

// The fixed list of staff teams, for the loan form's "your team" dropdown
router.get('/teams', (req, res) => {
  res.json(STAFF_TEAMS);
});

// Issue a car (loan)
router.post('/issue', (req, res) => {
  const { car_id, staff_number, staff_name, team, inspection } = req.body;
  if (!car_id || !staff_number || !staff_name) {
    return res.status(400).json({ error: 'car_id, staff_number, staff_name are required' });
  }
  if (!team || !STAFF_TEAMS.includes(team)) {
    return res.status(400).json({ error: `team is required and must be one of: ${STAFF_TEAMS.join(', ')}` });
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
    INSERT INTO loans (car_id, car_number, reg_number, staff_number, staff_name, team, duty_team, shift, shift_date, issued_at, status, inspection_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `);
  const markLoaned = db.prepare(`UPDATE cars SET status = 'loaned' WHERE id = ?`);

  // Insert + status flip happen atomically so a crash mid-request can never leave a car
  // marked 'loaned' with no matching loan row, or vice versa.
  const issueLoan = db.transaction(() => {
    const result = insert.run(car.id, car.car_number, car.reg_number, staff_number.trim(), staff_name.trim(), team, duty_team, shift, shift_date, issuedAt, inspectionJson);
    markLoaned.run(car.id);
    return result;
  });
  const result = issueLoan();

  res.json({ success: true, loan_id: result.lastInsertRowid, shift, shift_date, duty_team, issued_at: issuedAt });
});

// Return a car
router.post('/return', (req, res) => {
  const { car_id, returned_by_staff_number, returned_by_name } = req.body;
  if (!car_id) return res.status(400).json({ error: 'car_id is required' });

  const loan = db.prepare(`SELECT * FROM loans WHERE car_id = ? AND status = 'active'`).get(car_id);
  if (!loan) return res.status(404).json({ error: 'No active loan found for this car' });

  const returnedAt = new Date().toISOString();

  const closeLoan = db.prepare(`
    UPDATE loans SET status = 'returned', returned_at = ?, returned_by_staff_number = ?, returned_by_name = ?
    WHERE id = ?
  `);
  const markAvailable = db.prepare(`UPDATE cars SET status = 'available' WHERE id = ?`);

  db.transaction(() => {
    closeLoan.run(returnedAt, returned_by_staff_number || loan.staff_number, returned_by_name || loan.staff_name, loan.id);
    markAvailable.run(car_id);
  })();

  res.json({ success: true, returned_at: returnedAt });
});

// Get active loans
router.get('/active', (req, res) => {
  const loans = db.prepare(`SELECT * FROM loans WHERE status = 'active' ORDER BY issued_at DESC`).all();
  const now = new Date();
  loans.forEach(l => { l.is_overdue = isLoanOverdue(l, now); });
  res.json(loans);
});

// Vehicle Control Sheet: all cars + their loan status for a given shift date
// Returns every car (ordered by allocation / car_number) together with the
// most-relevant loan record for the requested date:
//   • an active loan that started on or before the requested date, OR
//   • a returned loan whose shift_date matches the requested date
// Also returns the duty team and shift type so the sheet header can be auto-filled.
router.get('/control-sheet', (req, res) => {
  const { date, shift } = req.query;   // shift: 'day' | 'night' (optional, filters)

  // Default to today (UAE)
  const { getUAEParts, getShiftInfo, getCurrentDuty, getRosterForDate } = require('../shiftUtil');
  const now = new Date();
  const uaeParts = getUAEParts(now);
  const defaultDate = `${uaeParts.year}-${String(uaeParts.month + 1).padStart(2, '0')}-${String(uaeParts.day).padStart(2, '0')}`;
  const targetDate = date || defaultDate;

  // Determine duty team / shift for this date (using current time for today; for
  // past/future dates we derive from the date alone by using noon UAE time as anchor).
  let dutyInfo;
  if (targetDate === defaultDate) {
    dutyInfo = getCurrentDuty(now);
  } else {
    // Synthesise a noon-UTC+4 timestamp for the target date to get day-shift duty team
    const [ty, tm, td] = targetDate.split('-').map(Number);
    const anchor = new Date(Date.UTC(ty, tm - 1, td, 8, 0, 0)); // 08:00 UTC = 12:00 UAE
    dutyInfo = getCurrentDuty(anchor);
  }

  // All cars, ordered by allocation group then car_number
  const cars = db.prepare('SELECT * FROM cars ORDER BY allocation, car_number').all();

  // Active loans (may have started before targetDate)
  const activeLoans = db.prepare(`SELECT * FROM loans WHERE status = 'active'`).all();
  const activeByCarId = {};
  activeLoans.forEach(l => { activeByCarId[l.car_id] = l; });

  // Loans for the requested date that are returned or active
  let dateLoansQuery = `SELECT * FROM loans WHERE shift_date = ?`;
  const dateLoansParams = [targetDate];
  if (shift === 'day') { dateLoansQuery += ` AND shift LIKE '%Day%'`; }
  if (shift === 'night') { dateLoansQuery += ` AND shift LIKE '%Night%'`; }
  const dateLoans = db.prepare(dateLoansQuery).all(...dateLoansParams);
  const dateByCarId = {};
  dateLoans.forEach(l => { dateByCarId[l.car_id] = l; });

  const result = cars.map(car => {
    // Prefer the date-specific loan, fall back to any active loan
    const loan = dateByCarId[car.id] || activeByCarId[car.id] || null;
    return {
      car_id: car.id,
      car_number: car.car_number,
      reg_number: car.reg_number,
      allocation: car.allocation || null,
      status: car.status,
      loan: loan ? {
        id: loan.id,
        staff_number: loan.staff_number,
        staff_name: loan.staff_name,
        issued_at: loan.issued_at,
        returned_at: loan.returned_at || null,
        returned_by_staff_number: loan.returned_by_staff_number || null,
        returned_by_name: loan.returned_by_name || null,
        status: loan.status,
        shift: loan.shift
      } : null
    };
  });

  res.json({
    date: targetDate,
    shift: dutyInfo.shift,
    isDay: dutyInfo.isDay,
    duty_team: dutyInfo.team,
    cars: result
  });
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
