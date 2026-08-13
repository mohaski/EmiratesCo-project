# EmiratesCo System — Operations Manual

_Last verified against the live machine: 2026-08-04._

---

## 1. For shop workers — daily use

1. Turn on the laptop.
2. **Currently**: sign in with the `emirates` account password (auto-login isn't active yet — see §5 Known Gaps).
3. Once signed in, open the **EmiratesCo** app (installed as a PWA — a dedicated icon, not a browser tab). If it's not pinned yet, go to `http://127.0.0.1:8000` in Edge and install it (address bar → install icon).
4. Log into the app itself with your employee account (this is separate from the Windows login).

That's it — the backend is already running in the background at all times; nothing else needs to be started.

---

## 2. What's running, and why it doesn't need daily attention

| Component | What it is | Status check |
|---|---|---|
| **EmiratesCoAPI** | The FastAPI backend, installed as a Windows service via NSSM. Auto-starts on boot, auto-restarts if it crashes (`AppExit=Restart`). Bound to `127.0.0.1:8000` only (not reachable from the network). | `Get-Service EmiratesCoAPI` |
| **postgresql-x64-17** | The Postgres database — all orders, products, users, payments live here. | `Get-Service postgresql-x64-17` |
| **EmiratesCo DB Backup** | Scheduled Task, runs `server\backup_db.ps1` nightly at 23:30. Writes a `pg_dump` to `server\backups\`, keeps 14 days, prunes older ones automatically. | `Get-ScheduledTask "EmiratesCo DB Backup"` |

Quick health check from any browser or terminal on the machine:
```
http://127.0.0.1:8000/health
```
Should return `{"status":"healthy", ...}`.

### Managing the service manually (rare — e.g. after a code update)
```powershell
# as Administrator
nssm restart EmiratesCoAPI
nssm stop EmiratesCoAPI
nssm start EmiratesCoAPI
```

---

## 3. Accounts

| Account | Role | Notes |
|---|---|---|
| `mohas` | Owner / Administrator | Full admin rights. Use this for maintenance, updates, installing the service, anything system-level. |
| `emirates` | Shop worker (standard user, no admin rights) | Cannot see or delete the project folder — verified via NTFS permissions (only `SYSTEM`, `Administrators`, and `mohas` have access). Was recreated on 2026-08-04; you set your own password for it directly on the machine. |

The project lives at `C:\Users\mohas\Desktop\EmiratesCo project` — inside `mohas`'s own profile, which Windows already keeps private from other standard accounts by default.

---

## 4. Development workflow

Production and development are fully separated so testing code never risks the live shop app:

```
Production:  EmiratesCoAPI service → port 8000 → always running, don't touch directly
Development: server\dev.bat        → port 8001 → auto-reloads on save, run manually when working
             cd client && npm run dev → port 5173 → hot-reloads, talks to 8001
```

Open `http://localhost:5173` for dev work — never `127.0.0.1:8000`, that's what workers are using live.

**Shipping a change to production once tested in dev:**
```powershell
cd client && npm run build      # rebuilds client/dist
nssm restart EmiratesCoAPI      # as Administrator — picks up new frontend + backend code
```

**Known shared-DB risk**: `dev.bat` and the production service currently read the same `.env`, meaning dev work hits the **same live database** as the shop. A test order or payment made in dev is a real record. A separate `EmiratesCo_Database_dev` database has been discussed but not yet set up — worth doing before heavier feature testing.

---

## 5. Known gaps / open items

- **Auto-login for `emirates` is not currently active.** `AutoAdminLogon` was intentionally turned off when the account was recreated on 2026-08-04, pending you setting your own password and re-enabling it via `netplwiz` (Win+R → `netplwiz` → select `emirates` → uncheck "Users must enter a user name and password" → enter password). Until that's done, workers get a normal Windows password prompt at boot.
- **PWA install + Startup-folder auto-launch** under the `emirates` profile — needs to be done once, logged in as `emirates` (see §1, step 3, and the Startup folder step: `Win+R` → `shell:startup` → drop the installed app's shortcut there).
- **Screensaver** — was disabled for the *previous* `emirates` profile; since the account was recreated, this needs to be redone once under the new profile (Settings → Personalization → Lock screen → Screen saver → None). Password-on-wake is already disabled machine-wide, so this is the one remaining lock trigger.
- **Dev database isolation** — not yet set up (see §4).
- **UPS** on this machine — still unconfirmed whether one is in place. Matters because Postgres is the source of truth for all shop data.
- **Old leaked DB password** — the original hardcoded Postgres password is still visible in this repo's git history on GitHub (rotating it made the password itself dead, but the history entry remains unless rewritten, which wasn't done since it's a destructive operation on shared history).

---

## 6. Quick troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Cannot reach the server" in the app | Frontend built with a stale/wrong API URL, or service down | Check `/health`; confirm `client/.env.development.local` isn't leaking into a production build (see git history for the incident on 2026-08-04) |
| App unreachable after laptop reboot | Service not set to auto-start, or a manual dev server is squatting on port 8000 | `Get-Service EmiratesCoAPI` should show `Running`; never run `uvicorn` manually on port 8000 |
| `dev.bat` fails with "... was unexpected at this time." | A cmd.exe parenthesis-parsing bug (fixed 2026-08-04) | Should not recur — if it does, check for literal `(` `)` characters inside `echo` lines within an `if (...)` block |
| Windows asks `emirates` for a password unexpectedly | Either auto-login isn't configured yet (§5), or the machine woke from sleep/lock (password-on-wake is disabled machine-wide, so this shouldn't happen anymore) | See §5 to finish the auto-login setup |
