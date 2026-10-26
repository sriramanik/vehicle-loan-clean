let cars = [];
let settings = { inspection_mode: 'quick' };

let activeCarId = null;       // car the action sheet / modals are currently working with
let loanTargetCarId = null;
let returnTargetCarId = null;
let remarkTargetCarId = null;

let verifiedStaff = null;         // for loan flow
let verifiedReturnStaff = null;   // for return flow
let verifiedRemarkStaff = null;   // for remark flow
let verifiedDamageStaff = null;   // for damage report flow
let damageTargetCarId = null;
let damageResizedBlob = null;

const ALLOCATIONS = [
  'LSM / LMM',
  'B1 ENGINEER / TECHNICIAN',
  'B2 ENGINEER',
  'CAT A TECHNICIAN',
  'CABIN TEAM'
];

const FUEL_LEVELS = ['Full', '3/4', 'Half', '1/4', 'Empty'];
const MAX_REMARKS_PER_CAR = 5;

// Detailed-mode per-item checklists (kept in sync with admin.js)
const EXTERIOR_ITEMS = ['Headlights', 'Taillights', 'Beacon Lights', 'Brake Lights', 'Turn Signals', 'Windshield Condition', 'Tyres Condition', 'Tow Hitch Condition/Locking'];
const INTERIOR_ITEMS = ['Seat Belts', 'Dashboard Condition', 'Seats Condition', 'Cleanliness', 'AC Cooling'];

let quickAllOk = true;
// per-item states for detailed mode: true = ok/yes, false = issue/no
let exteriorItemStates = {};
let interiorItemStates = {};
let selectedFuel = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 2600);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'loanModalOverlay') resetLoanModal();
  if (id === 'returnModalOverlay') resetReturnModal();
  if (id === 'remarkModalOverlay') resetRemarkModal();
  if (id === 'damageModalOverlay') resetDamageModal();
}

// ---------------- Header: date + duty status ----------------

function updateDateLabel() {
  const now = new Date();
  document.getElementById('dateLabel').textContent = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'long' });
}

async function updateDutyPill() {
  try {
    const res = await fetch('/api/loans/duty/current');
    const duty = await res.json();
    const range = duty.isDay ? '06:00–18:00' : '18:00–06:00';
    document.getElementById('dutyLabel').innerHTML = duty.team
      ? `<strong>Team ${duty.team}</strong> on duty · ${duty.isDay ? 'Day' : 'Night'} shift · ${range}`
      : '--';
  } catch (e) { /* dashboard still works without this */ }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    settings = await res.json();
  } catch (e) { /* fall back to default quick mode */ }
}

async function loadStaffTeams() {
  try {
    const res = await fetch('/api/loans/teams');
    const teams = await res.json();
    const select = document.getElementById('loanTeam');
    select.innerHTML = '<option value="">Select your team...</option>' +
      teams.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  } catch (e) { /* loan form still works, submit will just report the missing team */ }
}

updateDateLabel();
updateDutyPill();
loadStaffTeams();
setInterval(updateDateLabel, 30000);
setInterval(updateDutyPill, 30000);

// ---------------- Car grid ----------------

async function loadCars() {
  const res = await fetch('/api/cars');
  cars = await res.json();
  renderCars();
}

function renderCars() {
  const grid = document.getElementById('carGrid');
  const empty = document.getElementById('emptyState');
  grid.innerHTML = '';

  const visibleCars = cars.filter(c => c.allocation && c.allocation.trim());

  if (visibleCars.length === 0) {
    empty.style.display = 'block';
    document.getElementById('countAvailable').textContent = 0;
    document.getElementById('countLoaned').textContent = 0;
    document.getElementById('countMaintenance').textContent = 0;
    return;
  }
  empty.style.display = 'none';

  let available = 0, loaned = 0, maintenance = 0;
  visibleCars.forEach(car => {
    if (car.status === 'available') available++;
    else if (car.status === 'loaned') loaned++;
    else maintenance++;
  });
  document.getElementById('countAvailable').textContent = available;
  document.getElementById('countLoaned').textContent = loaned;
  document.getElementById('countMaintenance').textContent = maintenance;

  const groups = {};
  ALLOCATIONS.forEach(a => { groups[a] = []; });
  groups['Unassigned'] = [];

  visibleCars.forEach(car => {
    const key = ALLOCATIONS.includes(car.allocation) ? car.allocation : 'Unassigned';
    groups[key].push(car);
  });

  const naturalSort = (a, b) => a.car_number.localeCompare(b.car_number, undefined, { numeric: true, sensitivity: 'base' });
  Object.values(groups).forEach(group => group.sort(naturalSort));

  const orderedKeys = [...ALLOCATIONS, 'Unassigned'];

  orderedKeys.forEach(key => {
    const carsInGroup = groups[key];
    if (carsInGroup.length === 0) return;

    const section = document.createElement('div');
    section.className = 'allocation-section';

    const header = document.createElement('div');
    header.className = 'allocation-header';
    header.innerHTML = `<span>${escapeHtml(key)}</span><span class="badge-count">${carsInGroup.length}</span>`;
    section.appendChild(header);

    const tileGrid = document.createElement('div');
    tileGrid.className = 'tile-grid';

    carsInGroup.forEach(car => tileGrid.appendChild(buildCarTile(car)));

    section.appendChild(tileGrid);
    grid.appendChild(section);
  });
}

function buildCarTile(car) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `car-tile ${car.status}${car.is_overdue ? ' overdue' : ''}`;
  tile.onclick = () => openCarSheet(car.id);

  const remarks = car.remarks || [];
  const dotHtml = remarks.length ? '<span class="remark-dot"></span>' : '';
  const overdueDotHtml = car.is_overdue ? '<span class="overdue-dot"></span>' : '';

  tile.innerHTML = `
    ${dotHtml}
    ${overdueDotHtml}
    <div class="tile-num">${escapeHtml(car.car_number)}</div>
    <div class="tile-reg">${escapeHtml(car.reg_number)}</div>
  `;
  return tile;
}

// ---------------- Car action sheet ----------------

const STATUS_LABELS = { available: 'Available', loaned: 'Loaned', maintenance: 'Unavailable' };

function openCarSheet(carId) {
  activeCarId = carId;
  const car = cars.find(c => c.id === carId);
  if (!car) return;

  document.getElementById('sheetCarNum').textContent = `Car ${car.car_number}`;
  const badge = document.getElementById('sheetStatusBadge');
  badge.textContent = STATUS_LABELS[car.status] || car.status;
  badge.className = `status-badge ${car.status}`;
  document.getElementById('sheetCarSub').textContent = `Reg # ${car.reg_number} · ${car.allocation || 'Unassigned'}`;

  const loanInfoDiv = document.getElementById('sheetLoanInfo');
  if (car.status === 'loaned' && car.loaned_to_staff_number) {
    const overdueTag = car.is_overdue ? '<span class="overdue-tag">Overdue</span>' : '';
    loanInfoDiv.innerHTML = `<div class="loan-info">With <strong>${escapeHtml(car.loaned_to_name)}</strong> (#${escapeHtml(car.loaned_to_staff_number)}) since ${fmtTime(car.loaned_at)}${overdueTag}</div>`;
  } else {
    loanInfoDiv.innerHTML = '';
  }

  const remarks = car.remarks || [];
  const remarksDiv = document.getElementById('sheetRemarks');
  if (remarks.length) {
    remarksDiv.innerHTML = remarks.map(r => `
      <div class="remark-banner">
        ${escapeHtml(r.remark_text)}
        <div class="meta">${r.staff_name ? escapeHtml(r.staff_name) + ', ' : ''}${fmtTime(r.created_at)}</div>
      </div>
    `).join('');
  } else {
    remarksDiv.innerHTML = '';
  }

  document.getElementById('sheetTakeBtn').style.display = car.status === 'available' ? 'block' : 'none';
  document.getElementById('sheetReturnBtn').style.display = car.status === 'loaned' ? 'block' : 'none';

  // load approved damage photos asynchronously
  const sheetDamages = document.getElementById('sheetDamages');
  sheetDamages.innerHTML = '';
  fetch(`/api/cars/${carId}/damages`).then(r => r.json()).then(damages => {
    if (damages.length) {
      sheetDamages.innerHTML = `
        <div style="font-size:12.5px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px;">Damage records (${damages.length})</div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;">
          ${damages.map(d => `
            <div style="flex:0 0 auto; text-align:center;">
              <img src="/api/cars/${carId}/damages/${d.id}/photo" style="height:80px; width:80px; object-fit:cover; border-radius:8px; border:1px solid var(--border); cursor:pointer;" onclick="window.open(this.src,'_blank')" title="Tap to view full size">
              ${d.description ? `<div style="font-size:11px; color:var(--text-dim); max-width:80px; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(d.description)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }
  }).catch(() => {});

  document.getElementById('carSheetOverlay').classList.add('open');
}

function sheetOpenLoan() {
  closeModal('carSheetOverlay');
  openLoanModal(activeCarId);
}
function sheetOpenReturn() {
  closeModal('carSheetOverlay');
  openReturnModal(activeCarId);
}
function sheetOpenRemark() {
  closeModal('carSheetOverlay');
  openRemarkModal(activeCarId);
}
function sheetOpenDamage() {
  closeModal('carSheetOverlay');
  openDamageModal(activeCarId);
}

// ---------------- Loan flow ----------------

function resetInspectionState() {
  quickAllOk = true;
  selectedFuel = null;
  exteriorItemStates = {};
  interiorItemStates = {};
  EXTERIOR_ITEMS.forEach(item => { exteriorItemStates[item] = true; });
  INTERIOR_ITEMS.forEach(item => { interiorItemStates[item] = true; });
}

function renderInspectionUI() {
  const quickBlock = document.getElementById('quickInspectionBlock');
  const detailedBlock = document.getElementById('detailedInspectionBlock');

  if (settings.inspection_mode === 'detailed') {
    quickBlock.style.display = 'none';
    detailedBlock.style.display = 'block';
    renderItemChecklists();
    renderFuelSelector();
  } else {
    quickBlock.style.display = 'block';
    detailedBlock.style.display = 'none';
    renderQuickSwitch();
  }
}

function renderQuickSwitch() {
  const sw = document.getElementById('quickAllOkSwitch');
  sw.classList.toggle('on', quickAllOk);
  document.getElementById('quickIssueField').style.display = quickAllOk ? 'none' : 'block';
}
function toggleQuickAllOk() {
  quickAllOk = !quickAllOk;
  renderQuickSwitch();
}

// Render per-item exterior/interior toggle rows
function renderItemChecklists() {
  const extBlock = document.getElementById('exteriorItemsBlock');
  const intBlock = document.getElementById('interiorItemsBlock');
  extBlock.innerHTML = EXTERIOR_ITEMS.map(item => buildItemRow(item, 'ext', exteriorItemStates[item])).join('');
  intBlock.innerHTML = INTERIOR_ITEMS.map(item => buildItemRow(item, 'int', interiorItemStates[item])).join('');
}

function buildItemRow(item, group, okState) {
  const safeId = `${group}_${item.replace(/[^a-z0-9]/gi, '_')}`;
  return `
    <div class="toggle-row-plain insp-item-row">
      <span class="insp-item-label">${escapeHtml(item)}</span>
      <button type="button" class="switch${okState ? ' on' : ''}" id="${safeId}" onclick="toggleInspItem('${group}','${item.replace(/'/g, "\\'")}','${safeId}')">
        <span class="knob"></span>
      </button>
    </div>`;
}

function toggleInspItem(group, item, btnId) {
  if (group === 'ext') {
    exteriorItemStates[item] = !exteriorItemStates[item];
    document.getElementById(btnId).classList.toggle('on', exteriorItemStates[item]);
  } else {
    interiorItemStates[item] = !interiorItemStates[item];
    document.getElementById(btnId).classList.toggle('on', interiorItemStates[item]);
  }
}

function renderFuelSelector() {
  const container = document.getElementById('fuelSelector');
  container.innerHTML = FUEL_LEVELS.map(level => `
    <div class="fuel-option ${selectedFuel === level ? 'active' : ''}" onclick="setFuelLevel('${level}')">${level}</div>
  `).join('');
}
function setFuelLevel(level) {
  selectedFuel = level;
  renderFuelSelector();
}

function openLoanModal(carId) {
  loanTargetCarId = carId;
  const car = cars.find(c => c.id === carId);
  document.getElementById('loanCarLabel').textContent = `Take Car ${car.car_number}`;
  document.getElementById('loanCarSub').textContent = `Reg # ${car.reg_number} · enter your details below`;

  resetInspectionState();
  renderInspectionUI();

  document.getElementById('loanModalOverlay').classList.add('open');
}

function resetLoanModal() {
  loanTargetCarId = null;
  verifiedStaff = null;
  document.getElementById('loanStaffNumber').value = '';
  document.getElementById('loanStaffConfirm').innerHTML = '';
  document.getElementById('newStaffNameField').style.display = 'none';
  document.getElementById('newStaffName').value = '';
  document.getElementById('loanTeam').value = '';
  document.getElementById('loanError').style.display = 'none';
  document.getElementById('quickIssueNote').value = '';
  document.getElementById('detailedNotes').value = '';
}

let staffCheckTimeout;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loanStaffNumber').addEventListener('input', (e) => {
    clearTimeout(staffCheckTimeout);
    const val = e.target.value.trim();
    verifiedStaff = null;
    document.getElementById('loanStaffConfirm').innerHTML = '';
    document.getElementById('newStaffNameField').style.display = 'none';
    if (!val) return;
    staffCheckTimeout = setTimeout(() => checkStaff(val), 400);
  });

  document.getElementById('returnStaffNumber').addEventListener('input', (e) => {
    clearTimeout(staffCheckTimeout);
    const val = e.target.value.trim();
    verifiedReturnStaff = null;
    document.getElementById('returnStaffConfirm').innerHTML = '';
    if (!val) return;
    staffCheckTimeout = setTimeout(() => checkReturnStaff(val), 400);
  });

  document.getElementById('remarkStaffNumber').addEventListener('input', (e) => {
    clearTimeout(staffCheckTimeout);
    const val = e.target.value.trim();
    verifiedRemarkStaff = null;
    document.getElementById('remarkStaffConfirm').innerHTML = '';
    if (!val) return;
    staffCheckTimeout = setTimeout(() => checkRemarkStaff(val), 400);
  });
});

async function checkStaff(staffNumber) {
  const res = await fetch(`/api/staff/verify/${encodeURIComponent(staffNumber)}`);
  const data = await res.json();
  const confirmDiv = document.getElementById('loanStaffConfirm');
  const newField = document.getElementById('newStaffNameField');

  if (data.found) {
    verifiedStaff = data.staff;
    newField.style.display = 'none';
    confirmDiv.innerHTML = `<div class="staff-confirm">&#10003; ${escapeHtml(data.staff.name)}</div>`;
  } else {
    verifiedStaff = null;
    confirmDiv.innerHTML = `<div class="staff-confirm new">Staff number not found. Enter name below to register it.</div>`;
    newField.style.display = 'block';
  }
}

async function submitLoan() {
  const errDiv = document.getElementById('loanError');
  errDiv.style.display = 'none';

  const carId = loanTargetCarId;
  const staffNumber = document.getElementById('loanStaffNumber').value.trim();
  const team = document.getElementById('loanTeam').value;

  if (!staffNumber) { errDiv.textContent = 'Enter your staff number.'; errDiv.style.display = 'block'; return; }
  if (!team) { errDiv.textContent = 'Select your team.'; errDiv.style.display = 'block'; return; }

  if (settings.inspection_mode === 'detailed' && !selectedFuel) {
    errDiv.textContent = 'Select the fuel level.';
    errDiv.style.display = 'block';
    return;
  }

  let staffName;
  if (verifiedStaff) {
    staffName = verifiedStaff.name;
  } else {
    staffName = document.getElementById('newStaffName').value.trim();
    if (!staffName) { errDiv.textContent = 'Staff number not found. Please enter your name to register it.'; errDiv.style.display = 'block'; return; }
    const addRes = await fetch('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_number: staffNumber, name: staffName })
    });
    if (!addRes.ok) {
      const err = await addRes.json();
      errDiv.textContent = err.error || 'Could not register staff number.';
      errDiv.style.display = 'block';
      return;
    }
  }

  let inspection;
  if (settings.inspection_mode === 'detailed') {
    // Build per-item exterior/interior maps (yes/no strings for legacy compatibility)
    const exterior = {};
    EXTERIOR_ITEMS.forEach(item => { exterior[item] = exteriorItemStates[item] ? 'yes' : 'no'; });
    const interior = {};
    INTERIOR_ITEMS.forEach(item => { interior[item] = interiorItemStates[item] ? 'yes' : 'no'; });
    inspection = {
      mode: 'detailed',
      exterior,
      interior,
      fuel_level: selectedFuel,
      notes: document.getElementById('detailedNotes').value.trim()
    };
  } else {
    inspection = {
      mode: 'quick',
      all_ok: quickAllOk,
      fuel_level: null,
      notes: quickAllOk ? '' : document.getElementById('quickIssueNote').value.trim()
    };
  }

  const btn = document.getElementById('loanSubmitBtn');
  btn.disabled = true; btn.textContent = 'Processing...';

  const res = await fetch('/api/loans/issue', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ car_id: carId, staff_number: staffNumber, staff_name: staffName, team, inspection })
  });

  btn.disabled = false; btn.textContent = 'Confirm & take car';

  if (res.ok) {
    closeModal('loanModalOverlay');
    showToast('Car loaned successfully', 'success');
    loadCars();
  } else {
    const err = await res.json();
    errDiv.textContent = err.error || 'Something went wrong.';
    errDiv.style.display = 'block';
  }
}

// ---------------- Return flow ----------------

function openReturnModal(carId) {
  returnTargetCarId = carId;
  const car = cars.find(c => c.id === carId);
  document.getElementById('returnCarLabel').textContent = `Return Car ${car.car_number}`;
  document.getElementById('returnCarSub').textContent = `Reg # ${car.reg_number}`;

  const infoDiv = document.getElementById('returnLoanInfo');
  if (car.loaned_to_staff_number) {
    infoDiv.style.display = 'block';
    infoDiv.textContent = `Currently with ${car.loaned_to_name} since ${fmtTime(car.loaned_at)}`;
  } else {
    infoDiv.style.display = 'none';
  }

  document.getElementById('returnStaffNumber').value = car.loaned_to_staff_number || '';
  if (car.loaned_to_staff_number) checkReturnStaff(car.loaned_to_staff_number);

  document.getElementById('returnModalOverlay').classList.add('open');
}

function resetReturnModal() {
  returnTargetCarId = null;
  verifiedReturnStaff = null;
  document.getElementById('returnStaffNumber').value = '';
  document.getElementById('returnStaffConfirm').innerHTML = '';
  document.getElementById('returnError').style.display = 'none';
}

async function checkReturnStaff(staffNumber) {
  const res = await fetch(`/api/staff/verify/${encodeURIComponent(staffNumber)}`);
  const data = await res.json();
  const confirmDiv = document.getElementById('returnStaffConfirm');
  if (data.found) {
    verifiedReturnStaff = data.staff;
    confirmDiv.innerHTML = `<div class="staff-confirm">&#10003; ${escapeHtml(data.staff.name)}</div>`;
  } else {
    verifiedReturnStaff = null;
    confirmDiv.innerHTML = `<div class="staff-confirm new">Staff number not found - you can still return the car.</div>`;
  }
}

async function submitReturn() {
  const errDiv = document.getElementById('returnError');
  errDiv.style.display = 'none';

  const staffNumber = document.getElementById('returnStaffNumber').value.trim();
  if (!staffNumber) { errDiv.textContent = 'Enter the returning staff number.'; errDiv.style.display = 'block'; return; }

  const btn = document.getElementById('returnSubmitBtn');
  btn.disabled = true; btn.textContent = 'Processing...';

  const res = await fetch('/api/loans/return', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      car_id: returnTargetCarId,
      returned_by_staff_number: staffNumber,
      returned_by_name: verifiedReturnStaff ? verifiedReturnStaff.name : undefined
    })
  });

  btn.disabled = false; btn.textContent = 'Confirm return';

  if (res.ok) {
    closeModal('returnModalOverlay');
    showToast('Car returned successfully', 'success');
    loadCars();
  } else {
    const err = await res.json();
    errDiv.textContent = err.error || 'Something went wrong.';
    errDiv.style.display = 'block';
  }
}

// ---------------- Remark flow ----------------

function openRemarkModal(carId) {
  remarkTargetCarId = carId;
  const car = cars.find(c => c.id === carId);
  document.getElementById('remarkCarLabel').textContent = `Remark · Car ${car.car_number}`;

  const currentBlock = document.getElementById('currentRemarkBlock');
  const addBlock = document.getElementById('addRemarkBlock');
  const remarks = car.remarks || [];

  if (remarks.length) {
    currentBlock.innerHTML = remarks.map(r => `
      <div class="remark-banner" style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div>
          ${escapeHtml(r.remark_text)}
          <div class="meta">${r.staff_name ? escapeHtml(r.staff_name) + ', ' : ''}${fmtTime(r.created_at)}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="clearRemark(${carId}, ${r.id})">Clear</button>
      </div>
    `).join('');
  } else {
    currentBlock.innerHTML = '';
  }

  if (remarks.length >= MAX_REMARKS_PER_CAR) {
    addBlock.style.display = 'none';
    currentBlock.innerHTML += `<div class="sub">Maximum of ${MAX_REMARKS_PER_CAR} remarks reached - clear one to add another.</div>`;
  } else {
    addBlock.style.display = 'block';
  }

  document.getElementById('remarkModalOverlay').classList.add('open');
}

function resetRemarkModal() {
  remarkTargetCarId = null;
  verifiedRemarkStaff = null;
  document.getElementById('remarkStaffNumber').value = '';
  document.getElementById('remarkText').value = '';
  document.getElementById('remarkStaffConfirm').innerHTML = '';
  document.getElementById('remarkError').style.display = 'none';
}

async function checkRemarkStaff(staffNumber) {
  const res = await fetch(`/api/staff/verify/${encodeURIComponent(staffNumber)}`);
  const data = await res.json();
  const confirmDiv = document.getElementById('remarkStaffConfirm');
  if (data.found) {
    verifiedRemarkStaff = data.staff;
    confirmDiv.innerHTML = `<div class="staff-confirm">&#10003; ${escapeHtml(data.staff.name)}</div>`;
  } else {
    verifiedRemarkStaff = null;
    confirmDiv.innerHTML = `<div class="staff-confirm new">Staff number not found - remark will still be saved.</div>`;
  }
}

async function submitRemark() {
  const errDiv = document.getElementById('remarkError');
  errDiv.style.display = 'none';

  const staffNumber = document.getElementById('remarkStaffNumber').value.trim();
  const remarkText = document.getElementById('remarkText').value.trim();

  if (!remarkText) { errDiv.textContent = 'Enter a remark.'; errDiv.style.display = 'block'; return; }

  const res = await fetch(`/api/cars/${remarkTargetCarId}/remarks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      staff_number: staffNumber || null,
      staff_name: verifiedRemarkStaff ? verifiedRemarkStaff.name : null,
      remark_text: remarkText
    })
  });

  if (res.ok) {
    closeModal('remarkModalOverlay');
    showToast('Remark saved', 'success');
    loadCars();
  } else {
    const err = await res.json();
    errDiv.textContent = err.error || 'Something went wrong.';
    errDiv.style.display = 'block';
  }
}

async function clearRemark(carId, remarkId) {
  const res = await fetch(`/api/cars/${carId}/remarks/${remarkId}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('Remark cleared', 'success');
    await loadCars();
    const stillHasCar = cars.find(c => c.id === carId);
    if (stillHasCar) openRemarkModal(carId);
  } else {
    showToast('Could not clear remark', 'error');
  }
}

// ---------------- Damage report flow ----------------

// Resize image client-side to max 1200px on longest side, JPEG at 0.75 quality
function resizeImageForUpload(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.getElementById('damageCanvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.75);
    };
    img.src = url;
  });
}

function previewDamagePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  resizeImageForUpload(file).then(blob => {
    damageResizedBlob = blob;
    const preview = document.getElementById('damagePhotoPreview');
    preview.src = URL.createObjectURL(blob);
    preview.style.display = 'block';
  });
}

function openDamageModal(carId) {
  damageTargetCarId = carId;
  const car = cars.find(c => c.id === carId);
  document.getElementById('damageCarLabel').textContent = `Damage · Car ${car.car_number}`;

  // load existing approved damages
  const block = document.getElementById('existingDamagesBlock');
  block.innerHTML = '<div class="sub" style="color:var(--text-dim);">Loading...</div>';
  fetch(`/api/cars/${carId}/damages`).then(r => r.json()).then(damages => {
    if (damages.length) {
      block.innerHTML = `
        <div style="font-size:12.5px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px;">Recorded damage (${damages.length})</div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:8px; border-bottom:1px solid var(--border); margin-bottom:10px;">
          ${damages.map(d => `
            <div style="flex:0 0 auto; text-align:center;">
              <img src="/api/cars/${carId}/damages/${d.id}/photo" style="height:90px; width:90px; object-fit:cover; border-radius:8px; border:1px solid var(--border); cursor:pointer;" onclick="window.open(this.src,'_blank')" title="Tap to view full size">
              ${d.description ? `<div style="font-size:11px; color:var(--text-dim); max-width:90px; margin-top:3px;">${escapeHtml(d.description)}</div>` : ''}
              <div style="font-size:11px; color:var(--text-dim);">${fmtTime(d.created_at)}</div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      block.innerHTML = '';
    }
  }).catch(() => { block.innerHTML = ''; });

  document.getElementById('damageModalOverlay').classList.add('open');
}

function resetDamageModal() {
  damageTargetCarId = null;
  verifiedDamageStaff = null;
  damageResizedBlob = null;
  document.getElementById('damageStaffNumber').value = '';
  document.getElementById('damageStaffConfirm').innerHTML = '';
  document.getElementById('damagePhotoInput').value = '';
  document.getElementById('damagePhotoPreview').style.display = 'none';
  document.getElementById('damagePhotoPreview').src = '';
  document.getElementById('damageDescription').value = '';
  document.getElementById('damageError').style.display = 'none';
  const btn = document.getElementById('damageSubmitBtn');
  btn.disabled = false; btn.textContent = 'Submit report';
}

async function checkDamageStaff(staffNumber) {
  const res = await fetch(`/api/staff/verify/${encodeURIComponent(staffNumber)}`);
  const data = await res.json();
  const confirmDiv = document.getElementById('damageStaffConfirm');
  if (data.found) {
    verifiedDamageStaff = data.staff;
    confirmDiv.innerHTML = `<div class="staff-confirm">&#10003; ${escapeHtml(data.staff.name)}</div>`;
  } else {
    verifiedDamageStaff = null;
    confirmDiv.innerHTML = `<div class="staff-confirm new">Staff number not found - report will still be submitted.</div>`;
  }
}

async function submitDamage() {
  const errDiv = document.getElementById('damageError');
  errDiv.style.display = 'none';

  if (!damageResizedBlob) {
    errDiv.textContent = 'Please select a photo.';
    errDiv.style.display = 'block';
    return;
  }

  const staffNumber = document.getElementById('damageStaffNumber').value.trim();
  const description = document.getElementById('damageDescription').value.trim();

  const formData = new FormData();
  formData.append('photo', damageResizedBlob, 'damage.jpg');
  if (staffNumber) formData.append('staff_number', staffNumber);
  if (verifiedDamageStaff) formData.append('staff_name', verifiedDamageStaff.name);
  if (description) formData.append('description', description);

  const btn = document.getElementById('damageSubmitBtn');
  btn.disabled = true; btn.textContent = 'Uploading...';

  const res = await fetch(`/api/cars/${damageTargetCarId}/damages`, { method: 'POST', body: formData });

  btn.disabled = false; btn.textContent = 'Submit report';

  if (res.ok) {
    closeModal('damageModalOverlay');
    showToast('Damage report submitted — pending admin review', 'success');
  } else {
    const err = await res.json();
    errDiv.textContent = err.error || 'Upload failed.';
    errDiv.style.display = 'block';
  }
}

// Wire up damage staff lookup
document.addEventListener('DOMContentLoaded', () => {
  const damageStaffInput = document.getElementById('damageStaffNumber');
  if (damageStaffInput) {
    let t;
    damageStaffInput.addEventListener('input', (e) => {
      clearTimeout(t);
      const val = e.target.value.trim();
      verifiedDamageStaff = null;
      document.getElementById('damageStaffConfirm').innerHTML = '';
      if (!val) return;
      t = setTimeout(() => checkDamageStaff(val), 400);
    });
  }
});

// ---------------- Help ----------------

function openHelpModal() {
  document.getElementById('helpModalOverlay').classList.add('open');
}

// ---------------- Init ----------------

(async function init() {
  await loadSettings();
  await loadCars();
  setInterval(loadCars, 20000);
})();
