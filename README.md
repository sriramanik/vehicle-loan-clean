# Vehicle Control Sheet — Loan/Return Tracker

A mobile-friendly web app to replace the paper "Vehicle Control Sheet". Staff loan and return
company cars from their phones, and admins manage the fleet, staff list, and shift records.

## What it does

- **Dashboard** — shows every car with a live status: Available (green), Loaned (red, with
  who has it and since when), or Maintenance (grey).
- **Loan a car** — tap a car, enter your staff number. If it's recognized, your name fills in
  automatically. If not, you're prompted to register it on the spot (number + name).
- **Return a car** — tap "Return", confirm the staff number returning it.
- **Shift tracking** — every loan is automatically tagged as Day (06:00–18:00) or Night
  (18:00–06:00), with the correct calendar date even when a night shift crosses midnight.
- **Admin panel** (password-protected):
  - Add/remove cars, mark a car Available / Maintenance (blocked while a car is actively loaned).
  - Add staff manually or bulk-import via CSV (column A = staff number, column B = name).
  - View & filter the full loan history by date, shift, staff number, or car — and export to CSV.
  - "Force return" to correct a record if someone forgot to check a car back in through the app.

## Fleet Control redesign

The interface was redesigned (light theme, indigo accent, Manrope font, tap-to-open "car action
sheet" flow, rounded status-tinted tiles). A few things worth knowing:

- **Tap-to-open flow**: cars are now shown as colored square tiles grouped by team. Tapping a
  tile opens an action sheet with "Take this car", "Return this car" (if loaned), and
  "Add / view remark" - the individual buttons that used to sit directly on each card are gone,
  consolidated into this sheet.
- **Quick vs Detailed inspection**: the loan flow now has two configurable modes, set from
  Admin → Overview → "Loan inspection mode":
  - **Quick** (default) - a single "Vehicle checked, all good" toggle; flip it off to reveal one
    free-text "what's wrong?" field. Fast path for the common case.
  - **Detailed** - Exterior OK / Interior OK toggles, a 5-way fuel level selector, and an optional
    damage/notes field.
  Older inspection records (from before this redesign, with the original per-item 8-exterior /
  5-interior checklist) still open and display correctly in Admin → Records → View - the
  inspection viewer and CSV/archive exports understand both formats.
- **Admin → Overview** is new: fleet-wide KPIs (total/available/loaned/off-duty/open remarks) and
  a "team utilization" bar per allocation group, alongside the inspection mode setting above.

## What's new since the first version

- **Admin can return a car directly** — Admin → Cars shows a "Return" button next to any car
  that's loaned out, for when staff forget to return it through the app. Manual status changes
  (Available / Out of Service) are only allowed once a car isn't loaned.
- **Vehicle inspection checklist** — built into the loan flow. Staff confirm exterior/interior
  condition (defaults to "Yes", flip to "No" if something's wrong), fuel level, and optional
  damage notes. Stored as structured data with the loan record — viewable anytime from
  Admin → Records → **View** under the Inspection column.
- **Car remarks** — anyone on the dashboard can flag an issue on a car (dirty, AC not cooling,
  etc.) via the "+ Add a remark" link on its card. It shows as a banner on the card for everyone
  until someone clears it — no login required either way.
- **Car documents** — Admin → Cars → Edit lets you upload up to 4 documents per car (Insurance,
  Mulkiya/Registration, Airport Vehicle Permit, Other). Files live on disk under
  `data/car-documents/`, viewable/downloadable/replaceable from the same screen.
- **Monthly archives** — Admin → Records has an archive section. Past months can be exported as
  a CSV snapshot anytime (non-destructive), or "Archived & cleared" — which saves a CSV to disk
  and removes those completed records from the live database to keep things fast. This also runs
  **automatically** in the background every few hours for any month that's fully in the past.
  Archived files are listed and downloadable from the same screen.
- All timestamps display in local (UAE) time without a confusing timezone label.
- **Bulk car import via CSV** — Admin → Cars → Import CSV, with car # / reg # / optional
  allocation columns. Cars imported without an allocation stay hidden from the dashboard (but
  fully visible and editable in admin) until an allocation is set.
- **Up to 5 remarks per car** — remarks no longer overwrite each other; each has its own clear
  button, and a car can carry up to 5 open remarks before you need to clear one to add another.
- **Help tab** — Admin → Help has a plain-language summary of how the dashboard and admin panel
  work, for onboarding new staff or admins quickly.
- Car cards now show **"Reg #:"** before the plate number for clarity.

## Project structure

```
vehicle-loan-system/
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── backend/
    ├── server.js          # Express app entry point
    ├── db.js              # SQLite schema & connection
    ├── shiftUtil.js        # Day/Night shift calculation
    ├── adminAuth.js
    ├── routes/
    │   ├── cars.js         # public: list cars
    │   ├── staff.js        # public: verify/add staff number
    │   ├── loans.js        # public: issue/return/history
    │   └── admin.js        # protected: manage cars/staff/records
    └── public/              # frontend (dashboard + admin panel)
```

## Deploying on your VPS (Docker)

1. Copy this whole folder to your VPS.
2. Copy the env file and set a real admin password:
   ```bash
   cp .env.example .env
   nano .env   # set ADMIN_PASSWORD to something strong
   ```
3. Build and start:
   ```bash
   docker compose up -d --build
   ```
4. The app will be running on `http://<your-vps-ip>:3000`.
5. Data (the SQLite database) persists in a Docker volume (`vehicle_loan_data`), so it survives
   restarts and rebuilds.

## Deploying via Portainer

There are two ways to get this into Portainer. Option A is the quickest if you just want it
running today. Option B is better long-term because Portainer can rebuild it automatically
whenever you push updates.

### Option A — build the image once by hand, then run it from Portainer

1. Copy the project folder to your VPS (e.g. via `scp` or `sftp`) — anywhere, e.g. `/opt/vehicle-loan-system`.
2. SSH in and build the image once:
   ```bash
   cd /opt/vehicle-loan-system
   docker build -t vehicle-loan-app:latest .
   ```
3. In Portainer: **Stacks → Add stack → Web editor**, name it `vehicle-loan-app`, and paste:
   ```yaml
   services:
     vehicle-loan-app:
       image: vehicle-loan-app:latest
       container_name: vehicle-loan-app
       restart: unless-stopped
       ports:
         - "3000:3000"
       environment:
         - ADMIN_PASSWORD=your_real_password_here
         - PORT=3000
       volumes:
         - vehicle_loan_data:/app/data

   volumes:
     vehicle_loan_data:
   ```
4. Set a real `ADMIN_PASSWORD` value, then **Deploy the stack**.
5. To ship an update later: pull your changed files onto the VPS, re-run the `docker build` command, then in Portainer hit **Pull and redeploy** (or just restart the stack — it'll use the new local image tag).

### Option B — let Portainer build it from a Git repository

1. Push this project folder to a Git repo (GitHub, GitLab, or a self-hosted one Portainer can reach).
2. In Portainer: **Stacks → Add stack → Repository**.
3. Fill in the repo URL, branch, and set **Compose path** to `docker-compose.yml` (it's at the repo root).
4. Under **Environment variables**, add `ADMIN_PASSWORD` with a real value (this is what fills in the `${ADMIN_PASSWORD}` placeholder in the compose file — no `.env` file needed).
5. Deploy. Portainer will clone the repo, build the image from the included `Dockerfile`, and start it.
6. To update later: push changes to the repo, then use Portainer's **Pull and redeploy** button on the stack.

Either way, the SQLite database lives in the `vehicle_loan_data` named volume, so redeploying or rebuilding the image never wipes your car/staff/loan data — only deleting the volume itself would.

### Recommended: put it behind HTTPS

The app itself has no built-in HTTPS or login page for the main dashboard (by design — it's meant
to be quick for staff on shift). For real use, put it behind a reverse proxy so traffic is
encrypted and the app isn't directly exposed on a raw port:

- **Nginx + Certbot** — point a subdomain (e.g. `vehicles.yourcompany.com`) at the VPS, reverse
  proxy to `localhost:3000`, and get a free TLS cert with Let's Encrypt.
- Alternatively, **Caddy** does this in about 3 lines of config with automatic HTTPS.

Once that's set up, change the `ports` mapping in `docker-compose.yml` to bind only to
`127.0.0.1:3000:3000` so the app isn't reachable directly from the internet, only through the proxy.

## Admin access

- The admin panel (`/admin.html`) is protected by a single shared password, set via
  `ADMIN_PASSWORD` in `.env`.
- There's no separate login for the main dashboard — anyone on your network/site can loan or
  return a car, which matches how the paper sheet worked (open to whoever's on shift).
- Change `ADMIN_PASSWORD` before going live — the example value is not secure.

## Staff CSV import format

No header row required. Two columns:

| Column A (staff number) | Column B (name) |
|---|---|
| 12345 | Ahmed Ali |
| 12346 | Sara Khan |

If a header row is included, the importer will skip a first row that looks like one
(e.g. contains "staff number").

## Team rotation roster (auto-assigned duty team)

The app tracks a 4-team rotation (Team A/B/C/D), each on an 8-day cycle: 4 days off, 2 day
shifts, 2 night shifts. It's anchored to the schedule starting **24 July 2026** and repeats
indefinitely in both directions — no manual entry needed. Every loan automatically records
which team was on duty at the moment it was issued, and the dashboard header shows the current
team + shift live. If the actual roster pattern ever changes, the anchor date, template, and
per-team phase offsets are defined at the top of `backend/shiftUtil.js`.

All shift boundaries (06:00/18:00) and the roster are calculated in **UAE local time (GST,
UTC+4)** regardless of what timezone the server itself is running in — so this works correctly
even if your VPS or cPanel host's system clock is set to UTC or another timezone.

## Can this run on cPanel hosting (no Docker)?

Yes, with one condition: your cPanel host needs to offer **"Setup Node.js App"** (a CloudLinux/
Passenger feature that most modern shared and reseller cPanel hosts include). If you see that
option in cPanel, here's the outline:

1. In cPanel → **Setup Node.js App** → create an application, choose a Node.js version (18+),
   set the **Application root** (e.g. `vehicle-app`) and **Application URL**.
2. Upload the contents of the `backend/` folder into that application root (via File Manager or
   FTP) — you don't need `node_modules`, Dockerfile, or docker-compose.yml for this route.
3. In the Node.js App interface, click **Run NPM Install** to install dependencies.
4. Add an environment variable `ADMIN_PASSWORD` with a real password through the same interface.
   (Don't set `PORT` — Passenger assigns and manages that for you automatically, and the app
   already reads `process.env.PORT`.)
5. Set the **Application startup file** to `server.js` and start/restart the app.
6. cPanel/Passenger reverse-proxies your domain or subdomain to the app, HTTPS included if you
   have a certificate on that domain (AutoSSL usually handles this automatically).

One thing to watch for: `better-sqlite3` is a native module — it either downloads a prebuilt
binary for your server's exact Node version/OS, or compiles from source if no prebuilt matches.
Most cPanel Node.js environments handle this fine, but some locked-down shared hosts block
compilation. If `Run NPM Install` fails on `better-sqlite3` specifically, that's the tell — in
that case, either ask your host to enable build tools, or move to a small VPS (Docker or plain
Node + PM2), which is the more reliable option long-term.

If your cPanel host does **not** offer "Setup Node.js App" at all, cPanel is really built for
PHP hosting and isn't a good fit for this app (which needs a persistent Node server, not just
static files) — in that case a lightweight VPS is the better path.



```bash
cd backend
npm install
cp ../.env.example .env    # or create backend/.env directly
node server.js
```
Visit `http://localhost:3000`.

## Notes / things you may want to extend later

- Currently there's one shared admin password. If you want individual admin logins with
  audit trails (who changed what), that's a natural next step.
- The "Team" field on a loan is a free-text box — if your teams are a fixed list
  (e.g. LSM, Engineer B1, Engineer B2, Cat A, Cabin), it could be turned into a dropdown to
  keep records consistent.
- No SMS/email notifications currently — could be added if you want reminders for cars
  loaned for longer than expected.
