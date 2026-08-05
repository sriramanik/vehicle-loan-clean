const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const db = require('../db');
const adminAuth = require('../adminAuth');
const archiveUtil = require('../archiveUtil');

const upload = multer({ storage: multer.memoryStorage() });

const DOC_TYPES = ['Insurance', 'Mulkiya / Registration', 'Airport Vehicle Permit', 'Other'];

// Documents are stored on disk under data/car-documents/<car_id>/
const docsUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const carDir = path.join(db.docsDir, String(req.params.id));
      if (!fs.existsSync(carDir)) fs.mkdirSync(carDir, { recursive: true });
      cb(null, carDir);
    },
    filename: (req, file, cb) => {
      const safeType = (req.body.doc_type || 'document').replace(/[^a-z0-9]/gi, '_');
      const ext = path.extname(file.originalname) || '';
      cb(null, `${safeType}_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per document
});

// Login (just validates password against env var)
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Incorrect password' });
  }
});

// Everything below requires the admin header
router.use(adminAuth);

// ---- AUDIT LOG ----
// There's still one shared admin password (not individual logins), but the frontend asks
// for a "your name" at login and sends it on every request via x-admin-name so changes are
// at least attributable to a person, not just "admin".
function logAudit(req, action, details) {
  const adminName = (req.header('x-admin-name') || '').trim() || 'Unknown admin';
  db.prepare('INSERT INTO audit_log (admin_name, action, details) VALUES (?, ?, ?)').run(adminName, action, details || null);
}

router.get('/audit-log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit));
});

// ---- SETTINGS ----
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

router.put('/settings', (req, res) => {
  const allowedKeys = ['inspection_mode'];
  const updates = Object.entries(req.body).filter(([k]) => allowedKeys.includes(k));
  if (updates.length === 0) return res.status(400).json({ error: 'No valid settings provided' });

  if (req.body.inspection_mode && !['quick', 'detailed'].includes(req.body.inspection_mode)) {
    return res.status(400).json({ error: "inspection_mode must be 'quick' or 'detailed'" });
  }

  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  updates.forEach(([key, value]) => upsert.run(key, String(value)));
  logAudit(req, 'settings.update', updates.map(([k, v]) => `${k} = ${v}`).join(', '));
  res.json({ success: true });
});

// ---- CARS ----
router.get('/cars', (req, res) => {
  res.json(db.prepare('SELECT * FROM cars ORDER BY car_number').all());
});

router.post('/cars', (req, res) => {
  const { car_number, reg_number, allocation, status } = req.body;
  if (!car_number || !reg_number) return res.status(400).json({ error: 'car_number and reg_number required' });
  const result = db.prepare(`
    INSERT INTO cars (car_number, reg_number, allocation, status) VALUES (?, ?, ?, ?)
  `).run(car_number.trim(), reg_number.trim(), allocation || null, status || 'available');
  logAudit(req, 'car.create', `Added car #${car_number.trim()} (${reg_number.trim()})`);
  res.json({ success: true, id: result.lastInsertRowid });
});

// CSV import: column A = car #, column B = reg #, column C (optional) = allocation.
// Cars imported without an allocation stay hidden from the dashboard until one is set,
// but remain fully visible/editable here in the admin panel.
router.post('/cars/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let records;
  try {
    records = parse(req.file.buffer, { skip_empty_lines: true, relax_column_count: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  }

  const insert = db.prepare('INSERT INTO cars (car_number, reg_number, allocation) VALUES (?, ?, ?)');
  let imported = 0;
  let skipped = 0;

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const carNumber = (row[0] || '').toString().trim();
      const regNumber = (row[1] || '').toString().trim();
      const allocation = (row[2] || '').toString().trim();
      if (!carNumber || !regNumber) { skipped++; continue; }
      // skip a probable header row
      if (imported === 0 && skipped === 0 && /car\s*#|car\s*number/i.test(carNumber)) { skipped++; continue; }
      insert.run(carNumber, regNumber, allocation || null);
      imported++;
    }
  });
  tx(records);

  logAudit(req, 'car.import', `Imported ${imported} car(s), skipped ${skipped}`);
  res.json({ success: true, imported, skipped });
});

router.put('/cars/:id', (req, res) => {
  const { car_number, reg_number, allocation, status } = req.body;
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  // Status can only be changed manually between available/maintenance.
  // 'loaned' is only ever set by the loan-issue flow, and a car must be returned
  // (via /cars/:id/return) before its status can be changed away from 'loaned'.
  if (status !== undefined) {
    if (status === 'loaned') {
      return res.status(400).json({ error: "Status can't be set to Loaned Out directly - that happens automatically when a car is loaned." });
    }
    if (car.status === 'loaned') {
      return res.status(409).json({ error: 'This car is currently loaned out. Return it first.' });
    }
  }

  db.prepare(`
    UPDATE cars SET car_number = ?, reg_number = ?, allocation = ?, status = ? WHERE id = ?
  `).run(
    car_number ?? car.car_number,
    reg_number ?? car.reg_number,
    allocation ?? car.allocation,
    status ?? car.status,
    req.params.id
  );
  logAudit(req, 'car.update', `Updated car #${car.car_number} (id ${car.id})`);
  res.json({ success: true });
});

// Admin return: close out the active loan on this car (staff forgot to return it in the app)
router.post('/cars/:id/return', (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });

  const loan = db.prepare(`SELECT * FROM loans WHERE car_id = ? AND status = 'active'`).get(car.id);
  if (!loan) {
    // No active loan on record - just make sure the car isn't stuck in 'loaned' status
    db.prepare(`UPDATE cars SET status = 'available' WHERE id = ?`).run(car.id);
    return res.json({ success: true, note: 'No active loan found - car status reset to available.' });
  }

  const returnedAt = new Date().toISOString();
  const closeLoan = db.prepare(`
    UPDATE loans SET status = 'returned', returned_at = ?, returned_by_staff_number = ?, returned_by_name = ?
    WHERE id = ?
  `);
  const markAvailable = db.prepare(`UPDATE cars SET status = 'available' WHERE id = ?`);

  db.transaction(() => {
    closeLoan.run(returnedAt, loan.staff_number, loan.staff_name, loan.id);
    markAvailable.run(car.id);
  })();

  logAudit(req, 'car.force_return', `Force-returned car #${car.car_number} (was with ${loan.staff_name} #${loan.staff_number})`);
  res.json({ success: true, returned_at: returnedAt });
});

router.delete('/cars/:id', (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });
  const activeLoan = db.prepare(`SELECT * FROM loans WHERE car_id = ? AND status='active'`).get(req.params.id);
  if (activeLoan) return res.status(409).json({ error: 'Cannot delete a car that is currently on loan' });
  db.prepare('DELETE FROM cars WHERE id = ?').run(req.params.id);
  // clean up any uploaded documents for this car
  const carDir = path.join(db.docsDir, String(req.params.id));
  if (fs.existsSync(carDir)) fs.rmSync(carDir, { recursive: true, force: true });
  logAudit(req, 'car.delete', `Deleted car #${car.car_number} (${car.reg_number})`);
  res.json({ success: true });
});

// ---- CAR DOCUMENTS ----
router.get('/cars/:id/documents', (req, res) => {
  const docs = db.prepare('SELECT * FROM car_documents WHERE car_id = ?').all(req.params.id);
  res.json({ doc_types: DOC_TYPES, documents: docs });
});

router.post('/cars/:id/documents', docsUpload.single('file'), (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Car not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const docType = req.body.doc_type;
  if (!DOC_TYPES.includes(docType)) {
    return res.status(400).json({ error: 'Invalid document type' });
  }

  // remove any previous file for this car+doc_type before recording the new one
  const existing = db.prepare('SELECT * FROM car_documents WHERE car_id = ? AND doc_type = ?').get(car.id, docType);
  if (existing) {
    const oldPath = path.join(db.docsDir, String(car.id), existing.stored_filename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  db.prepare(`
    INSERT INTO car_documents (car_id, doc_type, original_name, stored_filename)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(car_id, doc_type) DO UPDATE SET original_name = excluded.original_name, stored_filename = excluded.stored_filename, uploaded_at = datetime('now')
  `).run(car.id, docType, req.file.originalname, req.file.filename);

  logAudit(req, 'car.document.upload', `Uploaded ${docType} for car #${car.car_number}`);
  res.json({ success: true });
});

router.get('/cars/:id/documents/:docType/file', (req, res) => {
  const doc = db.prepare('SELECT * FROM car_documents WHERE car_id = ? AND doc_type = ?').get(req.params.id, req.params.docType);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(db.docsDir, String(req.params.id), doc.stored_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
  res.download(filePath, doc.original_name);
});

router.delete('/cars/:id/documents/:docType', (req, res) => {
  const doc = db.prepare('SELECT * FROM car_documents WHERE car_id = ? AND doc_type = ?').get(req.params.id, req.params.docType);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(db.docsDir, String(req.params.id), doc.stored_filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM car_documents WHERE id = ?').run(doc.id);
  logAudit(req, 'car.document.delete', `Deleted ${req.params.docType} for car id ${req.params.id}`);
  res.json({ success: true });
});

// ---- STAFF ----
router.get('/staff', (req, res) => {
  res.json(db.prepare('SELECT * FROM staff ORDER BY name').all());
});

router.post('/staff', (req, res) => {
  const { staff_number, name } = req.body;
  if (!staff_number || !name) return res.status(400).json({ error: 'staff_number and name required' });
  try {
    db.prepare('INSERT INTO staff (staff_number, name) VALUES (?, ?)').run(String(staff_number).trim(), String(name).trim());
    logAudit(req, 'staff.create', `Added staff #${String(staff_number).trim()} (${String(name).trim()})`);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Staff number already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/staff/:staffNumber', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  db.prepare('UPDATE staff SET name = ? WHERE staff_number = ?').run(name.trim(), req.params.staffNumber);
  logAudit(req, 'staff.update', `Renamed staff #${req.params.staffNumber} to "${name.trim()}"`);
  res.json({ success: true });
});

router.delete('/staff/:staffNumber', (req, res) => {
  db.prepare('DELETE FROM staff WHERE staff_number = ?').run(req.params.staffNumber);
  logAudit(req, 'staff.delete', `Deleted staff #${req.params.staffNumber}`);
  res.json({ success: true });
});

// CSV import: column A = staff_number, column B = name. No header assumed, but skips a row if it looks like a header.
router.post('/staff/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let records;
  try {
    records = parse(req.file.buffer, { skip_empty_lines: true, relax_column_count: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  }

  const insert = db.prepare('INSERT INTO staff (staff_number, name) VALUES (?, ?) ON CONFLICT(staff_number) DO UPDATE SET name = excluded.name');
  let imported = 0;
  let skipped = 0;

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const staffNumber = (row[0] || '').toString().trim();
      const name = (row[1] || '').toString().trim();
      if (!staffNumber || !name) { skipped++; continue; }
      // skip a probable header row
      if (imported === 0 && skipped === 0 && /staff.*number/i.test(staffNumber)) { skipped++; continue; }
      insert.run(staffNumber, name);
      imported++;
    }
  });
  tx(records);

  logAudit(req, 'staff.import', `Imported ${imported} staff record(s), skipped ${skipped}`);
  res.json({ success: true, imported, skipped });
});

// ---- LOANS (history / manual correction) ----
router.get('/loans', (req, res) => {
  const { date, shift, staff_number, car_number, status, team, staff_team, month } = req.query;
  let query = 'SELECT * FROM loans WHERE 1=1';
  const params = [];
  if (date) { query += ' AND shift_date = ?'; params.push(date); }
  if (shift) { query += ' AND shift LIKE ?'; params.push(`%${shift}%`); }
  if (staff_number) { query += ' AND staff_number = ?'; params.push(staff_number); }
  if (car_number) { query += ' AND car_number = ?'; params.push(car_number); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (team) { query += ' AND duty_team = ?'; params.push(team); }
  if (staff_team) { query += ' AND team = ?'; params.push(staff_team); }
  if (month) { query += ' AND shift_date LIKE ?'; params.push(`${month}%`); }
  query += ' ORDER BY issued_at DESC';
  res.json(db.prepare(query).all(...params));
});

// Export CSV (optionally filtered by date/team/month)
router.get('/loans/export', (req, res) => {
  const { date, shift, team, staff_team, month } = req.query;
  let query = 'SELECT * FROM loans WHERE 1=1';
  const params = [];
  if (date) { query += ' AND shift_date = ?'; params.push(date); }
  if (shift) { query += ' AND shift LIKE ?'; params.push(`%${shift}%`); }
  if (team) { query += ' AND duty_team = ?'; params.push(team); }
  if (staff_team) { query += ' AND team = ?'; params.push(staff_team); }
  if (month) { query += ' AND shift_date LIKE ?'; params.push(`${month}%`); }
  query += ' ORDER BY issued_at DESC';
  const loans = db.prepare(query).all(...params);
  const csv = archiveUtil.buildCsv(loans);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="vehicle_loans_export.csv"`);
  res.send(csv);
});

// ---- MONTHLY ARCHIVES ----

// List months present in the DB with counts + whether an archive file already exists
router.get('/archives/months', (req, res) => {
  res.json(archiveUtil.listMonths());
});

// Download a snapshot CSV for a month without deleting anything
router.get('/archives/export/:month', (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.params.month)) return res.status(400).json({ error: 'Invalid month format, expected YYYY-MM' });
  const csv = archiveUtil.exportMonthCsv(req.params.month);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="vehicle_loans_${req.params.month}.csv"`);
  res.send(csv);
});

// Archive a past month to disk and delete its (returned) records from the live DB
router.post('/archives/:month/create', (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.params.month)) return res.status(400).json({ error: 'Invalid month format, expected YYYY-MM' });
  try {
    const result = archiveUtil.archiveAndClearMonth(req.params.month);
    logAudit(req, 'archive.create', `Archived ${result.archived} record(s) for ${req.params.month}`);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List archived CSV files on disk
router.get('/archives/files', (req, res) => {
  res.json(archiveUtil.listArchiveFiles());
});

// Download a previously archived file
router.get('/archives/files/:filename', (req, res) => {
  if (!/^\d{4}-\d{2}\.csv$/.test(req.params.filename)) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = archiveUtil.archiveFilePath(req.params.filename.replace('.csv', ''));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archive file not found' });
  res.download(filePath, req.params.filename);
});

module.exports = router;
