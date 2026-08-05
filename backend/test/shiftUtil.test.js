const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getShiftInfo, getCurrentDuty, getRosterForDate, isLoanOverdue } = require('../shiftUtil');

// All times below are given as UTC ISO strings chosen so that (UTC + 4h) lands on the UAE
// wall-clock moment described in the comment - that +4h shift is exactly what getUAEParts()
// applies internally, so this keeps the tests independent of the machine's own timezone.

describe('getShiftInfo', () => {
  test('mid-morning UAE time is Day, shift_date = same day', () => {
    // UAE 2026-07-28 10:00
    const info = getShiftInfo(new Date('2026-07-28T06:00:00Z'));
    assert.equal(info.isDay, true);
    assert.equal(info.shift_date, '2026-07-28');
    assert.match(info.shift, /^Day/);
  });

  test('mid-evening UAE time is Night, shift_date = same day', () => {
    // UAE 2026-07-28 20:00
    const info = getShiftInfo(new Date('2026-07-28T16:00:00Z'));
    assert.equal(info.isDay, false);
    assert.equal(info.shift_date, '2026-07-28');
    assert.match(info.shift, /^Night/);
  });

  test('just after midnight UAE time still belongs to the previous calendar day\'s night shift', () => {
    // UAE 2026-07-29 02:00 -> belongs to the night shift that started 2026-07-28
    const info = getShiftInfo(new Date('2026-07-28T22:00:00Z'));
    assert.equal(info.isDay, false);
    assert.equal(info.shift_date, '2026-07-28');
  });

  test('06:00 UAE is the first minute of Day (lower boundary, inclusive)', () => {
    const info = getShiftInfo(new Date('2026-07-28T02:00:00Z')); // UAE 06:00
    assert.equal(info.isDay, true);
    assert.equal(info.shift_date, '2026-07-28');
  });

  test('05:59 UAE is still the previous night shift (lower boundary, exclusive)', () => {
    const info = getShiftInfo(new Date('2026-07-28T01:59:00Z')); // UAE 05:59
    assert.equal(info.isDay, false);
    assert.equal(info.shift_date, '2026-07-27');
  });

  test('18:00 UAE is the first minute of Night (upper boundary)', () => {
    const info = getShiftInfo(new Date('2026-07-28T14:00:00Z')); // UAE 18:00
    assert.equal(info.isDay, false);
    assert.equal(info.shift_date, '2026-07-28');
  });

  test('17:59 UAE is still Day (upper boundary, exclusive)', () => {
    const info = getShiftInfo(new Date('2026-07-28T13:59:00Z')); // UAE 17:59
    assert.equal(info.isDay, true);
    assert.equal(info.shift_date, '2026-07-28');
  });

  test('a night shift crossing a month boundary keeps the correct shift_date', () => {
    // UAE 2026-08-01 03:00 -> belongs to the night shift that started 2026-07-31
    const info = getShiftInfo(new Date('2026-07-31T23:00:00Z'));
    assert.equal(info.isDay, false);
    assert.equal(info.shift_date, '2026-07-31');
  });
});

describe('getCurrentDuty (4-team rotation)', () => {
  // Per the anchor table documented in shiftUtil.js: on 2026-07-28, Team A is on Day duty
  // and Team C is on Night duty (B and D are both off).
  test('matches the documented anchor schedule for 2026-07-28', () => {
    const day = getCurrentDuty(new Date('2026-07-28T06:00:00Z')); // UAE 10:00
    assert.equal(day.team, 'A');

    const night = getCurrentDuty(new Date('2026-07-28T16:00:00Z')); // UAE 20:00
    assert.equal(night.team, 'C');
  });

  test('matches the documented anchor schedule for 2026-07-30 (Team B day, Team A night)', () => {
    const day = getCurrentDuty(new Date('2026-07-30T06:00:00Z')); // UAE 10:00
    assert.equal(day.team, 'B');

    const night = getCurrentDuty(new Date('2026-07-30T16:00:00Z')); // UAE 20:00
    assert.equal(night.team, 'A');
  });

  test('exactly one team is on Day and exactly one is on Night for any date (invariant)', () => {
    // Walk 40 consecutive days (covers 5 full 8-day cycles) and check the roster never
    // doubles up or drops a shift.
    const start = new Date('2026-07-01T00:00:00Z');
    for (let i = 0; i < 40; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const shiftDate = `2026-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const roster = getRosterForDate(shiftDate);
      const counts = Object.values(roster).reduce((acc, state) => {
        acc[state] = (acc[state] || 0) + 1;
        return acc;
      }, {});
      assert.equal(counts.DAY, 1, `expected exactly one team on DAY for ${shiftDate}, got ${JSON.stringify(roster)}`);
      assert.equal(counts.NIGHT, 1, `expected exactly one team on NIGHT for ${shiftDate}, got ${JSON.stringify(roster)}`);
      assert.equal(counts.OFF, 2, `expected exactly two teams OFF for ${shiftDate}, got ${JSON.stringify(roster)}`);
    }
  });

  test('the rotation repeats every 8 days', () => {
    const rosterA = getRosterForDate('2026-07-24');
    const rosterB = getRosterForDate('2026-08-01'); // 8 days later
    assert.deepEqual(rosterA, rosterB);
  });
});

describe('isLoanOverdue', () => {
  const dayLoan = { status: 'active', shift: 'Day (06:00-18:00)', shift_date: '2026-07-28' };
  const nightLoan = { status: 'active', shift: 'Night (18:00-06:00)', shift_date: '2026-07-28' };

  test('a Day loan is not overdue before 18:00 UAE', () => {
    assert.equal(isLoanOverdue(dayLoan, new Date('2026-07-28T13:59:00Z')), false); // UAE 17:59
  });

  test('a Day loan becomes overdue right at 18:00 UAE', () => {
    assert.equal(isLoanOverdue(dayLoan, new Date('2026-07-28T14:00:01Z')), true); // UAE 18:00:01
  });

  test('a Night loan is not overdue before 06:00 UAE the next day', () => {
    assert.equal(isLoanOverdue(nightLoan, new Date('2026-07-29T01:59:00Z')), false); // UAE 05:59 next day
  });

  test('a Night loan becomes overdue right after 06:00 UAE the next day', () => {
    assert.equal(isLoanOverdue(nightLoan, new Date('2026-07-29T02:00:01Z')), true); // UAE 06:00:01 next day
  });

  test('a returned loan is never overdue', () => {
    assert.equal(isLoanOverdue({ ...dayLoan, status: 'returned' }, new Date('2026-08-01T00:00:00Z')), false);
  });
});
