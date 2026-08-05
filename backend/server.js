require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const carsRouter = require('./routes/cars');
const staffRouter = require('./routes/staff');
const loansRouter = require('./routes/loans');
const adminRouter = require('./routes/admin');
const settingsRouter = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// CSP and COEP are left off: the frontend uses inline onclick="" handlers throughout and
// loads Google Fonts, which a default strict policy would silently break. The rest of
// helmet's headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, etc.)
// still apply. Revisit CSP if the frontend ever moves to addEventListener-based handlers.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());

// The admin password is a single shared secret checked on every /api/admin request
// (not just /login), so that's the actual brute-force surface. Only failed
// (4xx/5xx) responses count against the limit, so normal admin use never gets throttled.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts - please wait a few minutes and try again.' }
});

app.use('/api/cars', carsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/loans', loansRouter);
app.use('/api/admin', adminLimiter, adminRouter);
app.use('/api/settings', settingsRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// Unmatched API routes get a JSON 404 instead of falling through to Express's default HTML page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Automatically archive-and-clear any fully-past month that still has un-archived
// 'returned' records. Runs shortly after startup, then every 6 hours.
const archiveUtil = require('./archiveUtil');
function runAutoArchive() {
  try {
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

// Catch-all error handler. Express 4 automatically routes synchronous throws from route
// handlers here (all our DB calls are synchronous better-sqlite3 calls), so this is the
// single place that turns an unexpected failure into a clean JSON response instead of
// either a raw stack trace or a crashed process.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Last-resort safety nets. These shouldn't normally fire (the error handler above catches
// route-level failures), but they stop a stray async error from silently killing the process
// with no log line. Docker's `restart: unless-stopped` brings it back up after exit.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, shutting down:', err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`Vehicle Loan System running on port ${PORT}`);
});
