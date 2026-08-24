# EmiratesCo — Device Migration Manual

**Goal:** move the live, in-use system (code + real database + running service) from the
current machine to a new Windows device, with minimal shop downtime and zero data loss.

This is different from `OPERATIONS_MANUAL.md §5` / `setup_new_machine.ps1`, which bootstrap
an **empty** database. Here we're moving live orders, customers, payments — the restore step
matters and must not be skipped.

---

## 0. Before you start — decide the cutover window

Pick a slow moment (after closing, or early morning) for the final data-copy + cutover steps
(§4). Everything in §1–§3 can be prepped on the new machine in advance, in parallel with the
old machine still running the shop, with zero downtime until §4.

---

## 1. On the OLD machine — capture everything

### 1.1 Commit and push in-progress code changes
`git status` currently shows uncommitted work:
- Modified: `ManageVariantsModal.jsx`, the 4 sales calculators, `ProductContext.jsx`,
  `AdminProductsPage.jsx`, `server/core/inventory/products/model.py`, `server/entities/products.py`
- Untracked: `server/migrate_add_product_default_attributes.py`

If you `git clone` fresh on the new machine, **none of this comes with you** — it only exists
in this working tree. Before migrating, either:

- **Commit + push** (recommended — keeps history clean):
  ```powershell
  git add -A
  git commit -m "wip: product default_attributes"
  git push
  ```
- Or, if not ready to commit, plan to copy the whole folder instead of `git clone` (§3.2, option B).

### 1.2 Take a final database backup
Don't rely on last night's scheduled dump — take one right before the move:
```powershell
cd "C:\Users\mohas\Desktop\EmiratesCo project\server"
$env:PGPASSWORD = "<DB_PASSWORD from .env>"
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -h localhost -p 5432 -U postgres -F c -f ".\backups\EmiratesCo_MIGRATION_$(Get-Date -Format yyyy-MM-dd_HH-mm-ss).dump" EmiratesCo_Database
Remove-Item Env:\PGPASSWORD
```
This produces a `.dump` file in `server\backups\` — the same format the nightly task already
makes (`pg_restore` compatible). You do **not** need to touch S3 for this — the file on disk
is enough to carry over directly.

### 1.3 Note what needs to travel with you
| Item | Where | Notes |
|---|---|---|
| `.env` | `server\.env` | **Not in git.** Contains live secrets — DB password, `SECRET_KEY`, `JWT_SECRET_KEY`, SMTP password. Copy the file itself, don't retype it. |
| DB backup | the `.dump` file from §1.2 | |
| AWS credentials (if keeping S3 off-site backups) | `C:\Users\mohas\.aws\credentials` and `\config` | Referenced by `backup_db.ps1`. Only needed if you want off-site backups running from the new machine too. |
| Code | git repo | via push (§1.1) or full folder copy |

Nothing else is user-data — there's no separate uploads/media folder; the app has no file-upload
feature, and `client\dist` is just a build artifact that gets regenerated on the new machine.

### 1.4 Gather the actual NSSM service config (sanity check)
Run this on the old machine and confirm it matches what `install_service.bat` will install
on the new one:
```powershell
& "C:\nssm\win64\nssm.exe" get EmiratesCoAPI AppParameters
```
Should read `-m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1` — `install_service.bat`
was updated to match this (it previously hardcoded `127.0.0.1`, which would have broken
Tailscale remote access on a fresh install).

---

## 2. New machine — install prerequisites

Install these first (none of this is scripted by `setup_new_machine.ps1`):

1. **Python 3.11+** — https://www.python.org/downloads/ (check "Add to PATH")
2. **Node.js 20+** — https://nodejs.org/
3. **PostgreSQL 17** — https://www.postgresql.org/download/windows/
   - Use the **same major version (17)** as the old machine so the `pg_dump`/`pg_restore`
     formats line up cleanly.
   - Set a Postgres superuser password when prompted — this doesn't have to match the old
     one, but simplest if it does (avoids editing `.env`).
4. **NSSM** — https://nssm.cc/download → unzip `win64\nssm.exe` to `C:\nssm\win64\nssm.exe`
5. **Tailscale** — https://tailscale.com/download/windows, sign in with the same account
   (`mohaski24@gmail.com`) used on the old machine
6. **Git** — https://git-scm.com/download/win

---

## 3. New machine — set up the app

### 3.1 Restore the database first
```powershell
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres EmiratesCo_Database
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -U postgres -d EmiratesCo_Database --no-owner --no-privileges "<path to the .dump file from §1.2>"
```
Verify row counts look sane afterward, e.g.:
```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d EmiratesCo_Database -c "SELECT count(*) FROM orders;"
```

### 3.2 Get the code
**Option A (clean, if §1.1 was done):**
```powershell
git clone https://github.com/mohaski/EmiratesCo-project.git "C:\Users\mohas\Desktop\EmiratesCo project"
```
**Option B (if you skipped §1.1 and need the exact working tree, uncommitted changes included):**
Copy the whole folder from old → new machine (external drive, or `robocopy` over the LAN/a
network share), **excluding** `node_modules`, `.venv`, `client\dist`, `client\dev-dist`,
`server\__pycache__`, `server\logs` — those get regenerated and are large:
```powershell
robocopy "\\OLDMACHINE\EmiratesCo project" "C:\Users\mohas\Desktop\EmiratesCo project" /E /XD node_modules .venv dist dev-dist __pycache__ logs
```

### 3.3 Drop in `.env` and Python deps
Copy the actual `.env` file from the old machine into `server\.env` (don't regenerate secrets —
regenerating `JWT_SECRET_KEY` logs out every currently-signed-in device). If the new Postgres
password differs from the old one, edit `DATABASE_URL` and `DB_PASSWORD` in `.env` to match.

```powershell
cd "C:\Users\mohas\Desktop\EmiratesCo project"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
```

Skip `create_tables.py` / `setup_new_machine.ps1`'s DB-creation step — the DB is already
populated from the restore in §3.1, and `create_db_and_tables()` also runs automatically on
every app startup and is safe to run against an existing schema (only creates missing tables).

### 3.4 Build the frontend and install the service
```powershell
cd "C:\Users\mohas\Desktop\EmiratesCo project\client"
npm install
npm run build
```
Then install the service (as Administrator):
```powershell
cd "C:\Users\mohas\Desktop\EmiratesCo project\server"
.\install_service.bat
```
This now installs with `--host 0.0.0.0`, matching the live machine (needed for Tailscale
remote access — see §1.4). If this new device will *only* ever be accessed locally with no
Tailscale/remote need, you can narrow it afterward with
`nssm set EmiratesCoAPI AppParameters "-m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1"`.

### 3.5 Tailscale + firewall (only if you want remote access like the old machine)
1. Confirm the new machine shows up in `tailscale status` under the same tailnet.
2. Re-create the inbound firewall rule (mirrors `EmiratesCo API - Tailscale` on the old box):
   ```powershell
   New-NetFirewallRule -DisplayName "EmiratesCo API - Tailscale" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -RemoteAddress 100.64.0.0/10
   ```
3. Run `tailscale serve https / http://localhost:8000` (or whatever the old machine's exact
   `tailscale serve` config was) so HTTPS/PWA-install still works at the tailnet hostname.
4. Update `CORS_ORIGINS` in `.env` if the new machine gets a **different** Tailscale hostname
   than `moha.tail821c76.ts.net` — otherwise the browser will block same-origin-looking but
   actually-mismatched requests. Restart the service after any `.env` edit.

### 3.6 Off-site backups (optional but recommended — keep continuity)
```powershell
mkdir C:\Users\mohas\.aws -Force
# copy credentials + config files from the old machine into C:\Users\mohas\.aws\
```
Then re-create the scheduled task:
```powershell
schtasks /Create /TN "EmiratesCo DB Backup" /SC DAILY /ST 23:30 /TR "powershell.exe -ExecutionPolicy Bypass -File `"C:\Users\mohas\Desktop\EmiratesCo project\server\backup_db.ps1`""
```
Also add an **ONSTART** trigger to match the old machine's setup (it backs up on boot too,
since the shop PC is off overnight) — either add a second trigger via Task Scheduler GUI, or
`schtasks /Create ... /SC ONSTART` as a second task.

### 3.7 Verify before cutover
```powershell
Get-Service EmiratesCoAPI, postgresql-x64-17     # both Running
curl http://127.0.0.1:8000/health                 # {"status":"healthy",...}
```
Open the app in a browser, log in with a real account, and confirm real orders/customers show
up (proves the restore in §3.1 worked, not just an empty schema).

---

## 4. Cutover

1. On the **old** machine, during the chosen window (§0): stop the service so no new writes
   happen after your backup was taken.
   ```powershell
   nssm stop EmiratesCoAPI
   ```
2. If any orders/payments were entered between your §1.2 backup and this stop, take one more
   `pg_dump` now and restore *that* on the new machine instead (repeat §1.2 → §3.1) — otherwise
   you'll lose that window's data.
3. On the **new** machine: start the service (if not already running) and do a final check
   per §3.7.
4. Point the shop's usual access path at the new machine:
   - **Local PWA on the shop PC itself** (if the new machine *is* the shop PC): re-install the
     PWA from the new machine's `http://127.0.0.1:8000`, re-pin it, redo the Startup-folder
     auto-launch shortcut (`Win+R` → `shell:startup`) — these are all machine-specific and
     don't carry over automatically. See `OPERATIONS_MANUAL.md §1` and `§6`.
   - **Remote/Tailscale access**: nothing to change on client devices if the tailnet hostname
     stayed the same (`moha.tail821c76.ts.net`) — Tailscale resolves it to whichever machine
     currently holds that node. If the new machine registers as a *different* Tailscale node,
     update bookmarks/PWA installs on phones etc. to the new hostname.
5. Recreate the `emirates` shop-worker Windows account and its NTFS lockdown on the new
   machine (`OPERATIONS_MANUAL.md §3`), and redo auto-login (`§6`) if you want that behavior
   preserved — these are per-machine Windows settings, not part of the app.
6. Leave the old machine's service **stopped but not uninstalled** for a few days (§5) rather
   than wiping it immediately, in case you need to fail back.

---

## 5. Post-migration checklist

- [ ] New machine: `EmiratesCoAPI` and `postgresql-x64-17` both set to **Automatic** start
- [ ] Reboot-test the new machine once — confirm the service comes back up on its own
- [ ] Nightly backup task exists and fires (`Get-ScheduledTask "EmiratesCo DB Backup"`)
- [ ] Old machine's service stopped (not left running — two machines writing to two DBs is
      the failure mode to avoid)
- [ ] Old machine's `.env` and any local `.dump` backup files wiped or the disk secured once
      you're confident the new machine is stable (they contain live secrets)
- [ ] Rotate `SECRET_KEY`/`JWT_SECRET_KEY` eventually if the old machine's disk isn't being
      securely wiped/destroyed (optional — logs out all sessions when you do it, so pick a
      quiet moment)
- [ ] After a week of stable operation on the new machine, decommission the old one for real

---

## 6. Rollback plan

If the new machine has a problem after cutover: `nssm start EmiratesCoAPI` on the **old**
machine again (it still has the pre-migration data). Any orders entered on the new machine in
the meantime will need to be manually re-entered on the old one — there's no live replication
between them, so pick the shortest reasonable trial window before fully committing to the new
box.

---

## Reference — files this manual builds on
- `server/OPERATIONS_MANUAL.md` — day-to-day ops, accounts, known gaps
- `server/setup_new_machine.ps1` — automates §2–3 for a **fresh/empty** install (not a data
  migration — doesn't restore a backup)
- `server/install_service.bat` — installs the NSSM service; fixed to bind `--host 0.0.0.0`
  (was `127.0.0.1`, which didn't match the live machine)
- `server/backup_db.ps1` — the nightly backup script whose `.dump` format this manual reuses
- `server/DATABASE_SETUP.md` — generic/stale, describes SQLite/MySQL options not actually
  used in this project; safe to ignore in favor of this manual for Postgres specifics
