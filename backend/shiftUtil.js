// All shift/roster logic is anchored to UAE local time (UTC+4, no daylight saving),
// regardless of what timezone the server itself runs in.

function pad(n) { return String(n).padStart(2, '0'); }

// Returns the UAE wall-clock date/time components for a given moment.
// Trick: shift the UTC epoch by +4h, then read it back with the UTC getters —
// this sidesteps the server's own local timezone entirely.
function getUAEParts(date = new Date()) {
  const uae = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  return {
    year: uae.getUTCFullYear(),
    month: uae.getUTCMonth(), // 0-indexed
    day: uae.getUTCDate(),
    hour: uae.getUTCHours(),
    minute: uae.getUTCMinutes(),
    uaeDate: uae
  };
}

// Day shift: 06:00-17:59 UAE time. Night shift: 18:00-05:59 UAE time (next day).
// shift_date is the calendar date (UAE) the shift STARTED on.
function getShiftInfo(date = new Date()) {
  const p = getUAEParts(date);
  const isDay = p.hour >= 6 && p.hour < 18;

  let y = p.year, m = p.month, d = p.day;
  if (!isDay && p.hour < 6) {
    // between midnight and 6am UAE time -> belongs to the night shift that started the previous day
    const prev = new Date(p.uaeDate);
    prev.setUTCDate(prev.getUTCDate() - 1);
    y = prev.getUTCFullYear(); m = prev.getUTCMonth(); d = prev.getUTCDate();
  }

  return {
    shift: isDay ? 'Day (06:00-18:00)' : 'Night (18:00-06:00)',
    isDay,
    shift_date: `${y}-${pad(m + 1)}-${pad(d)}`
  };
}

// ---------------- 4-team rotation roster ----------------
// Pattern per team: 4 days OFF, 2 days DAY shift, 2 days NIGHT shift, repeating every 8 days.
// Teams are offset from each other so exactly one team is on Day and one on Night at any time.
//
// Anchor date 2026-07-24 = cycle day index 0. Confirmed against the known schedule:
//   Team A: OFF OFF OFF OFF DAY DAY NIGHT NIGHT  (24-27 off, 28-29 day, 30-31 night)
//   Team B: NIGHT NIGHT OFF OFF OFF OFF DAY DAY  (24-25 night, 26-29 off, 30-31 day)
//   Team C: OFF OFF DAY DAY NIGHT NIGHT OFF OFF  (24-25 off, 26-27 day, 28-29 night)
//   Team D: DAY DAY NIGHT NIGHT OFF OFF OFF OFF  (24-25 day, 26-27 night, 28-31 off)

const REF_DATE = '2026-07-24';
const TEMPLATE = ['OFF', 'OFF', 'OFF', 'OFF', 'DAY', 'DAY', 'NIGHT', 'NIGHT'];
const TEAM_PHASE = { A: 0, B: 6, C: 2, D: 4 };

function mod(n, m) { return ((n % m) + m) % m; }

function daysBetween(dateStr, refStr) {
  const [y1, m1, d1] = dateStr.split('-').map(Number);
  const [y2, m2, d2] = refStr.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t1 - t2) / 86400000);
}

// State (OFF/DAY/NIGHT) for a given team on a given shift_date (the calendar date a shift started)
function teamStateOnDate(team, shiftDateStr) {
  const dayIndex = daysBetween(shiftDateStr, REF_DATE);
  const idx = mod(dayIndex + TEAM_PHASE[team], 8);
  return TEMPLATE[idx];
}

// Returns the team currently on duty for the active shift (Day or Night) at the given moment
function getCurrentDuty(date = new Date()) {
  const { shift, shift_date, isDay } = getShiftInfo(date);
  const wanted = isDay ? 'DAY' : 'NIGHT';
  let team = null;
  for (const t of Object.keys(TEAM_PHASE)) {
    if (teamStateOnDate(t, shift_date) === wanted) { team = t; break; }
  }
  return { team, shift, shift_date, isDay };
}

// Full roster status (all 4 teams) for a given shift_date - useful for admin/debugging
function getRosterForDate(shiftDateStr) {
  const roster = {};
  for (const t of Object.keys(TEAM_PHASE)) roster[t] = teamStateOnDate(t, shiftDateStr);
  return roster;
}

module.exports = { getShiftInfo, getCurrentDuty, getRosterForDate, getUAEParts };
