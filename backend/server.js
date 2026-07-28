require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const carsRouter = require('./routes/cars');
const staffRouter = require('./routes/staff');
const loansRouter = require('./routes/loans');
const adminRouter = require('./routes/admin');
const settingsRouter = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/cars', carsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/loans', loansRouter);
app.use('/api/admin', adminRouter);
app.use('/api/settings', settingsRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// Automatically archive-and-clear any fully-past month that still has un-archived
// 'returned' records. Runs shortly after startup, then every 6 hours.
function runAutoArchive() {
  try {
    const archiveUtil = require('./archiveUtil');
    const months = archiveUtil.listMonths();
    const currentMonth = archiveUtil.currentUAEMonth();
    months
      .filter(m => m.month !== currentMonth && !m.archive_file_exists && m.returned_count > 0)
      .forEach(m => {
        try {
          const result = archiveUtil.archiveAndClearMonth(m.month);
          console.log(`Auto-archived ${result.archived} record(s) for ${m.month} -> ${result.file}`);
        } catch (err) {
          console.error(`Auto-archive failed for ${m.month}:`, err.message);
        }
      });
  } catch (err) {
    console.error('Auto-archive check failed:', err.message);
  }
}
setTimeout(runAutoArchive, 15000); // give the app a moment to fully start
setInterval(runAutoArchive, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Vehicle Loan System running on port ${PORT}`);
});
