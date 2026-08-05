// Fixed list of staff teams staff pick from when taking a car (loans.team column).
// Distinct from car.allocation (which department a car belongs to) and duty_team
// (the auto-computed A/B/C/D shift rotation) - this is "which team is the person
// borrowing the car on".
const STAFF_TEAMS = ['LSM', 'Engineer B1', 'Engineer B2', 'Cat A', 'Cabin'];

module.exports = { STAFF_TEAMS };
