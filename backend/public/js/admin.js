let adminPassword = sessionStorage.getItem('adminPassword') || '';

const ALLOCATIONS = [
  'LSM / LMM',
  'B1 ENGINEER / TECHNICIAN',
  'B2 ENGINEER',
  'CAT A TECHNICIAN',
  'CABIN TEAM'
];

const DOC_TYPES = ['Insurance', 'Mulkiya / Registration', 'Airport Vehicle Permit', 'Other'];
const EXTERIOR_ITEMS = ['Headlights', 'Taillights', 'Beacon Lights', 'Brake Lights', 'Turn Signals', 'Windshield Condition', 'Tyres Condition', 'Tow Hitch Condition/Locking'];
const INTERIOR_ITEMS = ['Seat Belts', 'Dashboard Condition', 'Seats Condition', 'Cleanliness', 'AC Cooling'];

let editingCarId = null;
let editingStaffNumber = null;
let currentSettings = { inspection_mode: 'quick' };

function closeAdminModal(id) {
  document.getElementById(id).classList.remove('open');
}

function populateAllocationSelects() {
  const opts = ALLOCATIONS.map(a => `<option value="${a}">${a}</option>`).join('');
  document.getElementById('newAllocation').innerHTML = opts;
  document.getElementById('editAllocation').innerHTML = opts;
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function adminFetch(url, options = {}) {
  options.headers = options.headers || {};
  options.headers['x-admin-password'] = adminPassword;
  const res = await fetch(url, options);
  if (res.status === 401) {
    sessionStorage.removeItem('adminPassword');
    showLogin();
    throw new Error('Unauthorized');
  }
  return res;
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminApp').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
  populateAllocationSelects();
  loadOverview();
  loadCars();
  loadStaff();
  loadRecords();
  loadMonthsList();
  loadArchiveFilesList();
  loadSettingsIntoUI();
}

async function login() {
  const pw = document.getElementById('passwordInput').value;
  const errDiv = document.getElementById('loginError');
  errDiv.style.display = 'none';

  const res = await fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  });

  if (res.ok) {
    adminPassword = pw;
    sessionStorage.setItem('adminPassword', pw);
    showApp();
  } else {
    errDiv.textContent = 'Incorrect password.';
    errDiv.style.display = 'block';
  }
}

function logout() {
  sessionStorage.removeItem('adminPassword');
  adminPassword = '';
  showLogin();
}

if (adminPassword) {
  adminFetch('/api/admin/cars').then(res => { if (res.ok) showApp(); else showLogin(); }).catch(() => showLogin());
} else {
  showLogin();
}

// Tabs
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'overview') loadOverview();
    });
  });
});

// ---------------- OVERVIEW ----------------
async function loadOverview() {
  try {
    const [carsRes, publicCarsRes] = await Promise.all([
      adminFetch('/api/admin/cars'),
      fetch('/api/cars')
    ]);
    const cars = await carsRes.json();
    const publicCars = await publicCarsRes.json();

    let available = 0, loaned = 0, maintenance = 0;
    cars.forEach(c => {
      if (c.status === 'available') available++;
      else if (c.status === 'loaned') loaned++;
      else maintenance++;
    });

    document.getElementById('kpiTotal').textContent = cars.length;
    document.getElementById('kpiAvailable').textContent = available;
    document.getElementById('kpiLoaned').textContent = loaned;
    document.getElementById('kpiMaintenance').textContent = maintenance;

    const remarksTotal = publicCars.reduce((sum, c) => sum + ((c.remarks || []).length), 0);
    document.getElementById('kpiRemarks').textContent = remarksTotal;

    // Team utilization = grouped by allocation (matches the dashboard's team sections)
    const groups = {};
    ALLOCATIONS.forEach(a => { groups[a] = { loaned: 0, total: 0 }; });
    cars.forEach(c => {
      const key = ALLOCATIONS.includes(c.allocation) ? c.allocation : null;
      if (!key) return; // unassigned cars don't count toward any team's utilization
      groups[key].total++;
      if (c.status === 'loaned') groups[key].loaned++;
    });

    const container = document.getElementById('teamUtilization');
    container.innerHTML = ALLOCATIONS.filter(a => groups[a].total > 0).map(a => {
      const { loaned: l, total } = groups[a];
      const pct = total ? Math.round((l / total) * 100) : 0;
      return `
        <div class="util-row">
          <div class="util-head"><span>${escapeHtml(a)}</span><span>${l}/${total} out</span></div>
          <div class="util-track"><div class="util-fill" style="width:${pct}%;"></div></div>
        </div>
      `;
    }).join('') || `<div class="sub" style="color:var(--text-dim);">No cars assigned to a team yet.</div>`;
  } catch (e) { /* not logged in yet, ignore */ }
}

// ---------------- SETTINGS ----------------
async function loadSettingsIntoUI() {
  const res = await adminFetch('/api/admin/settings');
  currentSettings = await res.json();
  renderSettingsToggle();
}

function renderSettingsToggle() {
  const mode = currentSettings.inspection_mode || 'quick';
  document.getElementById('modeQuickBtn').classList.toggle('active', mode === 'quick');
  document.getElementById('modeDetailedBtn').classList.toggle('active', mode === 'detailed');
}

async function setInspectionMode(mode) {
  const res = await adminFetch('/api/admin/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspection_mode: mode })
  });
  if (res.ok) {
    currentSettings.inspection_mode = mode;
    renderSettingsToggle();
    showToast(`Inspection mode set to ${mode === 'quick' ? 'Quick' : 'Detailed'}`);
  } else {
    showToast('Could not update setting', 'error');
  }
}

// ---------------- CARS ----------------
function openAddCarForm() {
  document.getElementById('addCarForm').style.display = 'flex';
}

async function submitAddCar() {
  const car_number = document.getElementById('newCarNumber').value.trim();
  const reg_number = document.getElementById('newRegNumber').value.trim();
  const allocation = document.getElementById('newAllocation').value.trim();
  if (!car_number || !reg_number) return showToast('Car # and Reg # are required', 'error');

  const res = await adminFetch('/api/admin/cars', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ car_number, reg_number, allocation })
  });

  if (res.ok) {
    const data = await res.json();
    showToast('Car added - add documents below if needed');
    document.getElementById('newCarNumber').value = '';
    document.getElementById('newRegNumber').value = '';
    document.getElementById('newAllocation').value = '';
    document.getElementById('addCarForm').style.display = 'none';
    await loadCars();
    openEditCarModal(data.id);
  } else {
    const err = await res.json();
    showToast(err.error || 'Failed to add car', 'error');
  }
}

async function importCarsCsv(event) {
  const file = event.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  const res = await adminFetch('/api/admin/cars/import', { method: 'POST', body: formData });
  if (res.ok) {
    const data = await res.json();
    showToast(`Imported ${data.imported} car(s) (${data.skipped} skipped)`);
    loadCars();
  } else {
    const err = await res.json();
    showToast(err.error || 'Import failed', 'error');
  }
  event.target.value = '';
}

let allCarsCache = [];
let docsCountCache = {};

async function loadCars() {
  const res = await adminFetch('/api/admin/cars');
  const cars = await res.json();
  cars.sort((a, b) => a.car_number.localeCompare(b.car_number, undefined, { numeric: true, sensitivity: 'base' }));
  allCarsCache = cars;

  const carsRes = await fetch('/api/cars');
  const carsWithLoans = await carsRes.json();
  const loanMap = {};
  carsWithLoans.forEach(c => { loanMap[c.id] = c; });

  await Promise.all(cars.map(async car => {
    try {
      const dres = await adminFetch(`/api/admin/cars/${car.id}/documents`);
      const data = await dres.json();
      docsCountCache[car.id] = data.documents.length;
    } catch (e) {
      docsCountCache[car.id] = docsCountCache[car.id] ?? 0;
    }
  }));

  const tbody = document.getElementById('carsTableBody');
  tbody.innerHTML = cars.map(car => {
    const withLoan = loanMap[car.id] || {};
    const loanedTo = car.status === 'loaned' && withLoan.loaned_to_staff_number
      ? `${escapeHtml(withLoan.loaned_to_staff_number)} · ${escapeHtml(withLoan.loaned_to_name)}` : '—';

    let statusCell;
    if (car.status === 'loaned') {
      statusCell = `
        <span class="status-badge loaned">Loaned Out</span>
        <button class="btn btn-outline btn-sm" style="margin-left:6px;" onclick="returnCarAdmin(${car.id})">Return</button>
      `;
    } else {
      statusCell = `
        <select class="filter-input" onchange="updateCarStatus(${car.id}, this.value)">
          <option value="available" ${car.status === 'available' ? 'selected' : ''}>Available</option>
          <option value="maintenance" ${car.status === 'maintenance' ? 'selected' : ''}>Out of Service</option>
        </select>
      `;
    }

    const docCount = docsCountCache[car.id] ?? 0;

    return `
      <tr>
        <td>${escapeHtml(car.car_number)}</td>
        <td>${escapeHtml(car.reg_number)}</td>
        <td>${escapeHtml(car.allocation || '')}</td>
        <td style="white-space:nowrap;">${statusCell}</td>
        <td>${loanedTo}</td>
        <td><button class="btn btn-outline btn-sm" onclick="openEditCarModal(${car.id})">${docCount}/4 &middot; view</button></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="openEditCarModal(${car.id})">Edit</button>
          <button class="btn btn-outline btn-sm" onclick="deleteCar(${car.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" style="text-align:center; color:var(--text-dim);">No cars yet</td></tr>`;
}

function openEditCarModal(carId) {
  const car = allCarsCache.find(c => c.id === carId);
  if (!car) return;
  editingCarId = car.id;
  document.getElementById('editCarNumber').value = car.car_number;
  document.getElementById('editRegNumber').value = car.reg_number;
  document.getElementById('editAllocation').value = car.allocation || ALLOCATIONS[0];
  document.getElementById('editCarError').style.display = 'none';
  document.getElementById('editCarModalOverlay').classList.add('open');
  loadCarDocuments(carId);
}

async function submitEditCar() {
  const errDiv = document.getElementById('editCarError');
  errDiv.style.display = 'none';
  const car_number = document.getElementById('editCarNumber').value.trim();
  const reg_number = document.getElementById('editRegNumber').value.trim();
  const allocation = document.getElementById('editAllocation').value;
  if (!car_number || !reg_number) { errDiv.textContent = 'Car # and Reg # are required'; errDiv.style.display = 'block'; return; }

  const res = await adminFetch(`/api/admin/cars/${editingCarId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ car_number, reg_number, allocation })
  });
  if (res.ok) {
    showToast('Car updated');
    closeAdminModal('editCarModalOverlay');
    loadCars();
    loadOverview();
  } else {
    const err = await res.json();
    errDiv.textContent = err.error || 'Update failed';
    errDiv.style.display = 'block';
  }
}

async function updateCarStatus(id, status) {
  const res = await adminFetch(`/api/admin/cars/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (res.ok) {
    showToast('Status updated');
  } else {
    const err = await res.json();
    showToast(err.error || 'Update failed', 'error');
  }
  loadCars();
  loadOverview();
}

async function returnCarAdmin(id) {
  if (!confirm('Mark this car as returned? Use this if a staff member forgot to return it through the app.')) return;
  const res = await adminFetch(`/api/admin/cars/${id}/return`, { method: 'POST' });
  if (res.ok) {
    showToast('Car marked as returned');
    loadCars();
    loadRecords();
    loadOverview();
  } else {
    const err = await res.json();
    showToast(err.error || 'Failed to return car', 'error');
  }
}

async function deleteCar(id) {
  if (!confirm('Delete this car? This cannot be undone.')) return;
  const res = await adminFetch(`/api/admin/cars/${id}`, { method: 'DELETE' });
  if (res.ok) { showToast('Car deleted'); loadCars(); loadOverview(); }
  else { const err = await res.json(); showToast(err.error || 'Delete failed', 'error'); }
}

// ---------------- CAR DOCUMENTS ----------------
async function loadCarDocuments(carId) {
  const container = document.getElementById('carDocumentsList');
  container.innerHTML = '<div class="sub">Loading...</div>';
  const res = await adminFetch(`/api/admin/cars/${carId}/documents`);
  const data = await res.json();
  const byType = {};
  data.documents.forEach(d => { byType[d.doc_type] = d; });
  docsCountCache[carId] = data.documents.length;

  container.innerHTML = DOC_TYPES.map(type => {
    const doc = byType[type];
    const inputId = `docfile_${type.replace(/[^a-z0-9]/gi, '_')}`;
    return `
      <div class="doc-row">
        <div class="doc-type-label">${type}</div>
        ${doc
          ? `<div class="doc-status">${escapeHtml(doc.original_name)}</div>
             <div class="doc-actions">
               <button class="btn btn-outline btn-sm" onclick="downloadCarDocument(${carId}, '${type}')">View</button>
               <button class="btn btn-outline btn-sm" onclick="deleteCarDocument(${carId}, '${type}')">Remove</button>
             </div>`
          : `<input type="file" id="${inputId}">
             <button class="btn btn-primary btn-sm" onclick="uploadCarDocument(${carId}, '${type}', '${inputId}')">Upload</button>`
        }
      </div>
    `;
  }).join('');
}

async function uploadCarDocument(carId, docType, inputId) {
  const fileInput = document.getElementById(inputId);
  const file = fileInput.files[0];
  if (!file) return showToast('Choose a file first', 'error');

  const formData = new FormData();
  formData.append('doc_type', docType);
  formData.append('file', file);

  const res = await adminFetch(`/api/admin/cars/${carId}/documents`, { method: 'POST', body: formData });
  if (res.ok) {
    showToast('Document uploaded');
    loadCarDocuments(carId);
    loadCars();
  } else {
    const err = await res.json();
    showToast(err.error || 'Upload failed', 'error');
  }
}

async function downloadCarDocument(carId, docType) {
  const res = await adminFetch(`/api/admin/cars/${carId}/documents/${encodeURIComponent(docType)}/file`);
  if (!res.ok) return showToast('Could not open document', 'error');
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.target = '_blank';
  link.download = '';
  link.click();
}

async function deleteCarDocument(carId, docType) {
  if (!confirm(`Remove the ${docType} document?`)) return;
  const res = await adminFetch(`/api/admin/cars/${carId}/documents/${encodeURIComponent(docType)}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('Document removed');
    loadCarDocuments(carId);
    loadCars();
  }
}

// ---------------- STAFF ----------------
let allStaffCache = [];

async function loadStaff() {
  const res = await adminFetch('/api/admin/staff');
  const staff = await res.json();
  allStaffCache = staff;
  const tbody = document.getElementById('staffTableBody');
  tbody.innerHTML = staff.map(s => `
    <tr>
      <td>${escapeHtml(s.staff_number)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="openEditStaffModal('${escapeHtml(s.staff_number)}')">Edit</button>
        <button class="btn btn-outline btn-sm" onclick="deleteStaff('${escapeHtml(s.staff_number)}')">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="3" style="text-align:center; color:var(--text-dim);">No staff yet</td></tr>`;
}

function openEditStaffModal(staffNumber) {
  const staff = allStaffCache.find(s => s.staff_number === staffNumber);
  if (!staff) return;
  editingStaffNumber = staffNumber;
  document.getElementById('editStaffSub').textContent = `Staff #${staffNumber}`;
  document.getElementById('editStaffName').value = staff.name;
  document.getElementById('editStaffError').style.display = 'none';
  document.getElementById('editStaffModalOverlay').classList.add('open');
}

async function submitEditStaff() {
  const errDiv = document.getElementById('editStaffError');
  errDiv.style.display = 'none';
  const name = document.getElementById('editStaffName').value.trim();
  if (!name) { errDiv.textContent = 'Name is required'; errDiv.style.display = 'block'; return; }

  const res = await adminFetch(`/api/admin/staff/${encodeURIComponent(editingStaffNumber)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (res.ok) {
    showToast('Staff updated');
    closeAdminModal('editStaffModalOverlay');
    loadStaff();
  } else {
    const err = await res.json();
    errDiv.textContent = err.error || 'Update failed';
    errDiv.style.display = 'block';
  }
}

async function submitAddStaff() {
  const staff_number = document.getElementById('newStaffNumber').value.trim();
  const name = document.getElementById('newStaffNameInput').value.trim();
  if (!staff_number || !name) return showToast('Staff number and name required', 'error');

  const res = await adminFetch('/api/admin/staff', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staff_number, name })
  });
  if (res.ok) {
    showToast('Staff added');
    document.getElementById('newStaffNumber').value = '';
    document.getElementById('newStaffNameInput').value = '';
    loadStaff();
  } else {
    const err = await res.json();
    showToast(err.error || 'Failed to add staff', 'error');
  }
}

async function deleteStaff(staffNumber) {
  if (!confirm('Delete this staff member?')) return;
  const res = await adminFetch(`/api/admin/staff/${encodeURIComponent(staffNumber)}`, { method: 'DELETE' });
  if (res.ok) { showToast('Staff deleted'); loadStaff(); }
}

async function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  const res = await adminFetch('/api/admin/staff/import', { method: 'POST', body: formData });
  if (res.ok) {
    const data = await res.json();
    showToast(`Imported ${data.imported} staff (${data.skipped} skipped)`);
    loadStaff();
  } else {
    const err = await res.json();
    showToast(err.error || 'Import failed', 'error');
  }
  event.target.value = '';
}

// ---------------- RECORDS ----------------
let allRecordsCache = [];

async function loadRecords() {
  const date = document.getElementById('filterDate').value;
  const team = document.getElementById('filterTeam').value;
  const staff = document.getElementById('filterStaff').value.trim();
  const car = document.getElementById('filterCar').value.trim();

  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (team) params.set('team', team);
  if (staff) params.set('staff_number', staff);
  if (car) params.set('car_number', car);

  const res = await adminFetch(`/api/admin/loans?${params.toString()}`);
  const loans = await res.json();
  allRecordsCache = loans;

  const tbody = document.getElementById('recordsTableBody');
  tbody.innerHTML = loans.map(l => `
    <tr>
      <td>${l.shift_date}</td>
      <td>${l.shift}</td>
      <td>${l.duty_team ? 'Team ' + escapeHtml(l.duty_team) : '—'}</td>
      <td>#${escapeHtml(l.car_number)} · ${escapeHtml(l.reg_number)}</td>
      <td>${escapeHtml(l.staff_number)} · ${escapeHtml(l.staff_name)}</td>
      <td>${fmtTime(l.issued_at)}</td>
      <td>${fmtTime(l.returned_at)}</td>
      <td>${l.returned_by_staff_number ? escapeHtml(l.returned_by_staff_number) + ' · ' + escapeHtml(l.returned_by_name) : '—'}</td>
      <td><span class="status-badge ${l.status === 'active' ? 'loaned' : 'available'}">${l.status === 'active' ? 'Loaned Out' : 'Returned'}</span></td>
      <td>${l.inspection_data ? `<button class="btn btn-outline btn-sm" onclick="viewInspection(${l.id})">View</button>` : '—'}</td>
    </tr>
  `).join('') || `<tr><td colspan="10" style="text-align:center; color:var(--text-dim);">No records found</td></tr>`;
}

function viewInspection(loanId) {
  const loan = allRecordsCache.find(l => l.id === loanId);
  if (!loan || !loan.inspection_data) return;
  let data;
  try { data = JSON.parse(loan.inspection_data); } catch (e) { return showToast('Could not read inspection data', 'error'); }

  document.getElementById('inspectionSub').textContent = `Car #${loan.car_number} · ${loan.reg_number} — ${loan.staff_number} · ${loan.staff_name} — ${fmtTime(loan.issued_at)}`;

  let html;
  if (data.mode === 'quick' || data.mode === 'detailed') {
    // New schema (Fleet Control)
    if (data.mode === 'quick') {
      html = `
        <div class="checklist-section">
          <div class="checklist-title">Quick check</div>
          <div class="checklist-item"><span>Vehicle checked, all good</span><span class="status-badge ${data.all_ok ? 'available' : 'loaned'}">${data.all_ok ? 'YES' : 'NO'}</span></div>
        </div>
        ${data.notes ? `<div class="checklist-section"><div class="checklist-title">What was wrong</div><div style="font-size:13.5px; color:var(--text-dim);">${escapeHtml(data.notes)}</div></div>` : ''}
      `;
    } else {
      html = `
        <div class="checklist-section">
          <div class="checklist-title">Detailed check</div>
          <div class="checklist-item"><span>Exterior OK</span><span class="status-badge ${data.exterior_ok ? 'available' : 'loaned'}">${data.exterior_ok ? 'YES' : 'NO'}</span></div>
          <div class="checklist-item"><span>Interior OK</span><span class="status-badge ${data.interior_ok ? 'available' : 'loaned'}">${data.interior_ok ? 'YES' : 'NO'}</span></div>
        </div>
        <div class="checklist-section">
          <div class="checklist-title">Fuel level at pickup</div>
          <div style="font-size:14px;">${data.fuel_level || 'n/a'}</div>
        </div>
        ${data.notes ? `<div class="checklist-section"><div class="checklist-title">Damage / notes</div><div style="font-size:13.5px; color:var(--text-dim);">${escapeHtml(data.notes)}</div></div>` : ''}
      `;
    }
  } else {
    // Legacy per-item checklist schema
    const renderGroup = (title, items, values) => `
      <div class="checklist-section">
        <div class="checklist-title">${title}</div>
        ${items.map(item => {
          const v = (values && values[item]) || 'n/a';
          return `<div class="checklist-item"><span>${item}</span><span class="status-badge ${v === 'no' ? 'loaned' : 'available'}">${v.toUpperCase()}</span></div>`;
        }).join('')}
      </div>
    `;
    html = `
      ${renderGroup('Exterior', EXTERIOR_ITEMS, data.exterior)}
      ${renderGroup('Interior', INTERIOR_ITEMS, data.interior)}
      <div class="checklist-section">
        <div class="checklist-title">Fuel quantity at pickup</div>
        <div style="font-size:14px;">${data.fuel_level || 'n/a'}</div>
      </div>
      ${data.remarks ? `<div class="checklist-section"><div class="checklist-title">Damage / notes</div><div style="font-size:13.5px; color:var(--text-dim);">${escapeHtml(data.remarks)}</div></div>` : ''}
    `;
  }

  document.getElementById('inspectionContent').innerHTML = html;
  document.getElementById('inspectionModalOverlay').classList.add('open');
}

function exportCsv() {
  const date = document.getElementById('filterDate').value;
  const team = document.getElementById('filterTeam').value;
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (team) params.set('team', team);
  const url = `/api/admin/loans/export?${params.toString()}`;

  adminFetch(url).then(async res => {
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'vehicle_loans_export.csv';
    link.click();
  });
}

// ---------------- MONTHLY ARCHIVES ----------------
async function loadMonthsList() {
  const res = await adminFetch('/api/admin/archives/months');
  const months = await res.json();
  const container = document.getElementById('monthsList');

  if (months.length === 0) {
    container.innerHTML = `<div class="sub">No records yet.</div>`;
    return;
  }

  container.innerHTML = months.map(m => `
    <div class="archive-row">
      <div>
        <strong>${m.month}</strong>
        <span class="archive-meta">&nbsp;·&nbsp;${m.total} record(s)${m.active_count ? `, ${m.active_count} still active` : ''}${m.is_current_month ? ' · current month' : ''}${m.archive_file_exists ? ' · already archived' : ''}</span>
      </div>
      <div class="archive-actions">
        <button class="btn btn-outline btn-sm" onclick="exportMonthSnapshot('${m.month}')">Download CSV</button>
        ${!m.is_current_month && m.returned_count > 0
          ? `<button class="btn btn-primary btn-sm" onclick="archiveMonth('${m.month}')">Archive & clear</button>`
          : ''}
      </div>
    </div>
  `).join('');
}

function exportMonthSnapshot(month) {
  adminFetch(`/api/admin/archives/export/${month}`).then(async res => {
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vehicle_loans_${month}.csv`;
    link.click();
  });
}

async function archiveMonth(month) {
  if (!confirm(`Archive ${month} to a CSV file and remove those completed records from the live system? This can't be undone (the CSV will still be downloadable afterwards).`)) return;
  const res = await adminFetch(`/api/admin/archives/${month}/create`, { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    showToast(data.archived > 0 ? `Archived ${data.archived} record(s) for ${month}` : `No completed records to archive for ${month}`);
    loadMonthsList();
    loadArchiveFilesList();
    loadRecords();
  } else {
    const err = await res.json();
    showToast(err.error || 'Archive failed', 'error');
  }
}

async function loadArchiveFilesList() {
  const res = await adminFetch('/api/admin/archives/files');
  const files = await res.json();
  const container = document.getElementById('archiveFilesList');

  if (files.length === 0) {
    container.innerHTML = `<div class="sub">No archived files yet.</div>`;
    return;
  }

  container.innerHTML = files.map(f => `
    <div class="archive-row">
      <div>
        <strong>${f.filename}</strong>
        <span class="archive-meta">&nbsp;·&nbsp;${(f.size_bytes / 1024).toFixed(1)} KB</span>
      </div>
      <div class="archive-actions">
        <button class="btn btn-outline btn-sm" onclick="downloadArchiveFile('${f.filename}')">Download</button>
      </div>
    </div>
  `).join('');
}

function downloadArchiveFile(filename) {
  adminFetch(`/api/admin/archives/files/${filename}`).then(async res => {
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  });
}
