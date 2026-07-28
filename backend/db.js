const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const archivesDir = path.join(dataDir, 'archives');
if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });

const docsDir = path.join(dataDir, 'car-documents');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const db = new Database(path.join(dataDir, 'vehicle_loans.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_number TEXT NOT NULL,
  reg_number TEXT NOT NULL,
  allocation TEXT,
  status TEXT NOT NULL DEFAULT 'available', -- available | loaned | maintenance
  remark_text TEXT,
  remark_by_staff_number TEXT,
  remark_by_name TEXT,
  remark_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff (
  staff_number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  car_number TEXT,
  reg_number TEXT,
  staff_number TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  team TEXT,
  duty_team TEXT,               -- rotation team on duty (A/B/C/D) at time of issue
  shift TEXT NOT NULL,          -- 'Day (06:00-18:00)' | 'Night (18:00-06:00)'
  shift_date TEXT NOT NULL,     -- date the shift started, YYYY-MM-DD
  issued_at TEXT NOT NULL,
  returned_at TEXT,
  returned_by_staff_number TEXT,
  returned_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | returned
  inspection_data TEXT,          -- JSON: exterior/interior checklist, fuel level, remarks
  FOREIGN KEY (car_id) REFERENCES cars(id)
);

CREATE TABLE IF NOT EXISTS car_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,       -- Insurance | Mulkiya / Registration | Airport Vehicle Permit | Other
  original_name TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now')),
  UNIQUE(car_id, doc_type),
  FOREIGN KEY (car_id) REFERENCES cars(id)
);

CREATE TABLE IF NOT EXISTS car_remarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  remark_text TEXT NOT NULL,
  staff_number TEXT,
  staff_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (car_id) REFERENCES cars(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Seed default settings if not already present
const defaultSettings = { inspection_mode: 'quick' };
const settingsInsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  settingsInsert.run(key, value);
}

// Simple migration guards for DBs created before these columns existed
const migrations = [
  'ALTER TABLE loans ADD COLUMN duty_team TEXT',
  'ALTER TABLE loans ADD COLUMN inspection_data TEXT',
  'ALTER TABLE cars ADD COLUMN remark_text TEXT',
  'ALTER TABLE cars ADD COLUMN remark_by_staff_number TEXT',
  'ALTER TABLE cars ADD COLUMN remark_by_name TEXT',
  'ALTER TABLE cars ADD COLUMN remark_at TEXT'
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (err) { /* column already exists - ignore */ }
}

// One-time data migration: move any old single-remark values into the new car_remarks table
try {
  const oldRemarks = db.prepare('SELECT * FROM cars WHERE remark_text IS NOT NULL').all();
  if (oldRemarks.length) {
    const insert = db.prepare('INSERT INTO car_remarks (car_id, remark_text, staff_number, staff_name, created_at) VALUES (?, ?, ?, ?, ?)');
    const clear = db.prepare('UPDATE cars SET remark_text = NULL, remark_by_staff_number = NULL, remark_by_name = NULL, remark_at = NULL WHERE id = ?');
    oldRemarks.forEach(c => {
      insert.run(c.id, c.remark_text, c.remark_by_staff_number, c.remark_by_name, c.remark_at || new Date().toISOString());
      clear.run(c.id);
    });
  }
} catch (err) { /* car_remarks table not ready yet on very first run - ignore */ }

module.exports = db;
module.exports.dataDir = dataDir;
module.exports.archivesDir = archivesDir;
module.exports.docsDir = docsDir;
