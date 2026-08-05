const fs = require('fs');
const path = require('path');
const db = require('./db');
const { getUAEParts } = require('./shiftUtil');

const archivesDir = db.archivesDir;

function pad(n) { return String(n).padStart(2, '0'); }

function currentUAEMonth() {
  const p = getUAEParts(new Date());
  return `${p.year}-${pad(p.month + 1)}`;
}

function fmtLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function csvEscape(v) {
  return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
}

function summarizeInspection(inspectionJson) {
  if (!inspectionJson) return { fuel: '', issues: '', remarks: '' };
  let data;
  try { data = JSON.parse(inspectionJson); } catch (e) { return { fuel: '', issues: '', remarks: '' }; }

  const issues = [];

  if (data.mode === 'quick' || data.mode === 'detailed') {
    // New schema (Fleet Control redesign)
    if (data.mode === 'quick' && data.all_ok === false) issues.push('Flagged at pickup');
    if (data.mode === 'detailed') {
      if (data.exterior_ok === false) issues.push('Exterior');
      if (data.interior_ok === false) issues.push('Interior');
    }
    return { fuel: data.fuel_level || '', issues: issues.join('; '), remarks: data.notes || '' };
  }

  // Legacy schema: per-item exterior/interior checklists
  for (const group of ['exterior', 'interior']) {
    if (!data[group]) continue;
    for (const [item, val] of Object.entries(data[group])) {
      if (val === 'no') issues.push(item);
    }
  }
  return {
    fuel: data.fuel_level || '',
    issues: issues.join('; '),
    remarks: data.remarks || ''
  };
}

const CSV_HEADER = [
  'Shift Date', 'Shift', 'Duty Team', 'Staff Team', 'Car #', 'Reg #',
  'Issued To (Staff #)', 'Issued To (Name)', 'Issued At (Local Time)', 'Returned At (Local Time)',
  'Returned By (Staff #)', 'Returned By (Name)', 'Status',
  'Fuel At Pickup', 'Inspection Issues Noted', 'Inspection Remarks'
];

function loanToRow(l) {
  const insp = summarizeInspection(l.inspection_data);
  return [
    l.shift_date, l.shift, l.duty_team || '', l.team || '', l.car_number, l.reg_number,
    l.staff_number, l.staff_name, fmtLocal(l.issued_at), fmtLocal(l.returned_at),
    l.returned_by_staff_number || '', l.returned_by_name || '', l.status,
    insp.fuel, insp.issues, insp.remarks
  ];
}

function buildCsv(loans, summaryLines = []) {
  const lines = [];
  if (summaryLines.length) {
    lines.push(...summaryLines.map(l => csvEscape(l)));
    lines.push('');
  }
  lines.push(CSV_HEADER.map(csvEscape).join(','));
  loans.forEach(l => lines.push(loanToRow(l).map(csvEscape).join(',')));
  return lines.join('\n');
}

function getLoansForMonth(month, statusFilter = null) {
  let query = 'SELECT * FROM loans WHERE shift_date LIKE ?';
  const params = [`${month}%`];
  if (statusFilter) { query += ' AND status = ?'; params.push(statusFilter); }
  query += ' ORDER BY issued_at ASC';
  return db.prepare(query).all(...params);
}

function buildSummaryLines(month, loans) {
  const uniqueCars = new Set(loans.map(l => l.car_number)).size;
  const uniqueStaff = new Set(loans.map(l => l.staff_number)).size;
  const byTeam = {};
  loans.forEach(l => { const t = l.duty_team || 'Unknown'; byTeam[t] = (byTeam[t] || 0) + 1; });
  const teamSummary = Object.entries(byTeam).map(([t, c]) => `${t}:${c}`).join(' | ');

  return [
    `Vehicle Control Sheet - Monthly Summary for ${month}`,
    `Total loan records: ${loans.length}`,
    `Unique cars used: ${uniqueCars}`,
    `Unique staff: ${uniqueStaff}`,
    `Loans by duty team: ${teamSummary || 'n/a'}`
  ];
}

function archiveFilePath(month) {
  return path.join(archivesDir, `${month}.csv`);
}

// Get distinct months present in the loans table with counts, plus archive-file status
function listMonths() {
  const rows = db.prepare(`
    SELECT substr(shift_date, 1, 7) as month, COUNT(*) as total,
           SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) as returned_count,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
    FROM loans
    GROUP BY month
    ORDER BY month DESC
  `).all();

  const nowMonth = currentUAEMonth();
  return rows.map(r => ({
    month: r.month,
    total: r.total,
    returned_count: r.returned_count,
    active_count: r.active_count,
    is_current_month: r.month === nowMonth,
    archive_file_exists: fs.existsSync(archiveFilePath(r.month))
  }));
}

function listArchiveFiles() {
  if (!fs.existsSync(archivesDir)) return [];
  return fs.readdirSync(archivesDir)
    .filter(f => /^\d{4}-\d{2}\.csv$/.test(f))
    .map(f => {
      const stat = fs.statSync(path.join(archivesDir, f));
      return { filename: f, month: f.replace('.csv', ''), size_bytes: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.month.localeCompare(a.month));
}

// Creates (or overwrites) the archive CSV for a month, then deletes the archived rows
// (only 'returned' rows are ever deleted - active loans are left alone).
function archiveAndClearMonth(month) {
  if (month === currentUAEMonth()) {
    throw new Error('Cannot archive the current month - it is still in progress');
  }
  const returnedLoans = getLoansForMonth(month, 'returned');
  if (returnedLoans.length === 0) {
    return { archived: 0, file: null };
  }

  const summary = buildSummaryLines(month, returnedLoans);
  const csv = buildCsv(returnedLoans, summary);
  fs.writeFileSync(archiveFilePath(month), csv, 'utf8');

  const ids = returnedLoans.map(l => l.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM loans WHERE id IN (${placeholders})`).run(...ids);

  return { archived: returnedLoans.length, file: `${month}.csv` };
}

// Export-only (no deletion) for a given month - lets admins download a snapshot anytime
function exportMonthCsv(month) {
  const loans = getLoansForMonth(month);
  const summary = buildSummaryLines(month, loans);
  return buildCsv(loans, summary);
}

module.exports = {
  currentUAEMonth,
  listMonths,
  listArchiveFiles,
  archiveAndClearMonth,
  exportMonthCsv,
  archiveFilePath,
  buildCsv,
  CSV_HEADER,
  loanToRow,
  fmtLocal
};
