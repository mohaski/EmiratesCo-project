# EmiratesCo

A point-of-sale, inventory, and business management system for an aluminium & glass
merchant — built as a single on-prem application that runs on one machine in the shop
(no cloud dependency required) but can also be deployed as a standard web service.

## What it does

EmiratesCo covers the day-to-day operations of a glass/aluminium retail and fabrication
business:

- **Point of sale** — a cart-based checkout flow with dedicated calculators per product
  type: cut-to-size glass (length × width, priced per sqft), aluminium profiles/bars
  (full length, half length, or custom cuts), and simple accessories/hardware.
- **Inventory management** — products with variants (color, thickness, size, etc.),
  stock levels, low-stock alerts, restock history, and category management.
- **Glass offcut optimization** — see below; this is the most involved subsystem in
  the codebase.
- **Orders** — cart → order → receipt, with support for editing/cancelling orders
  (which correctly reverses stock and offcut state), split payments, and credit/
  installment tracking.
- **Invoicing** — generate and review customer invoices, convert invoices to orders.
- **Financials** — payments, credits, and financial reporting.
- **Messaging** — internal messaging between staff, delivered over a WebSocket
  connection for live updates.
- **User management** — role-based accounts (admin, ceo, manager, cashier).
- **Dashboards** — sales dashboard and general admin dashboard.

## The glass offcut decision engine

When a cut piece of glass is sold, it can come from a fresh sheet or from a leftover
offcut of a previous cut — and cutting it one way vs. another determines whether the
leftover material is a usable, sellable offcut or unsellable scrap. `server/core/inventory/glassOffcutService.py`
is a deterministic, real-time 2D cutting-stock engine that makes this decision inline
during checkout (no LLM/network call — this affects real inventory and needs to be
fast, safe, and reproducible):

- **Recursive guillotine packing** — packs pieces into a source (sheet or offcut) via
  physically-valid edge-to-edge cuts, recursing into leftover space so multiple pieces
  (even different shapes/sizes across different order lines) can share one sheet
  instead of each opening a new one.
- **Multi-strategy search** — tries several packing heuristics per order (different
  piece orderings, different split preferences) and keeps whichever full result uses
  the fewest sheets, then the least true scrap, then the most *sellable* remainders,
  then the least fragmentation — the same "try several heuristics, keep the best"
  principle dedicated nesting tools use, implemented as isolated trials inside
  Postgres savepoints so a losing trial never touches real stock.
- **Sellability-aware** — remainders are scored against the product's own sales
  history, so the engine prefers leaving behind offcut sizes that have actually sold
  before, and flags them for staff (`★ popular size`) on both the pre-checkout preview
  and the printed cutting instructions.
- **Cut preview** — a dry-run endpoint (`/products/{id}/glass-cut-preview`) lets a
  cashier preview the optimizer's layout, including which strategies were compared and
  why one won, before committing to a sale.

## Tech stack

**Backend** (`server/`) — Python, [FastAPI](https://fastapi.tiangolo.com/), SQLModel/SQLAlchemy
on PostgreSQL, JWT auth (passlib/argon2), WebSockets for live messaging.

**Frontend** (`client/`) — React 19 + Vite, Tailwind CSS, React Router, Axios, installable
as a PWA. In production the built frontend is served same-origin by the FastAPI process
(`client/dist` is mounted directly), so no separate web server or CORS setup is needed
on a single-shop install.

## Project structure

```
EmiratesCo project/
├── client/                    React frontend (Vite)
│   └── src/
│       ├── pages/             Route-level pages (POS, Inventory, Orders, Dashboard, ...)
│       ├── components/        Feature components (sales calculators, inventory modals, ...)
│       ├── context/           React context providers (products, auth, cart, ...)
│       └── services/api.js    Axios client for the backend API
├── server/                    FastAPI backend
│   ├── main.py                App entrypoint, middleware, router registration
│   ├── entities/              SQLModel table definitions (products, orders, users, ...)
│   ├── core/                  Feature modules, each with controller/service/model
│   │   ├── inventory/         Products, variants, attributes, offcuts, the optimization engine
│   │   ├── ordering/          Cart → order processing, stock deduction/restoration
│   │   ├── invoices/          Invoice generation and review
│   │   ├── financials/        Payments, credits
│   │   ├── userManagement/    Auth, roles, accounts
│   │   ├── messaging/         Internal messaging
│   │   └── settings/          App-wide settings
│   ├── db/                    Database engine/session setup
│   ├── ws/                    WebSocket connection manager
│   └── migrate_*.py           One-off, additive schema migration scripts (run manually)
└── emirateCo project diagrams/   ERD, flowcharts, use-case diagrams (draw.io)
```

Each `core/<module>/` follows the same three-file pattern: `controller.py` (FastAPI
routes), `service.py` (business logic), `model.py` (Pydantic request/response schemas).

## Getting started

### Prerequisites
- Python 3.13, PostgreSQL, Node.js (for the client)

### Backend
```bash
cd server
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
cp .env.example .env                                  # then edit DB credentials, secrets
python create_tables.py                                # create tables (or let uvicorn do it on startup)
uvicorn main:app --reload
```
See `server/ENVIRONMENT_SETUP.md` and `server/DATABASE_SETUP.md` for the full list of
environment variables and database setup options.

### Frontend
```bash
cd client
npm install
npm run dev          # local development against the API
npm run build         # production build -> client/dist, served by the FastAPI backend
```

### Tests
Backend tests are standalone scripts (not pytest) that run against a real database
using dedicated fixture products, e.g.:
```bash
cd server
python test_glass_offcut_logic.py
python test_offcut_logic.py
```

## Deployment

Designed to also run as a persistent Windows service on the shop's own machine (see
`install_service.bat`, `create_task.ps1`) using NSSM, with the built frontend served
directly by the same FastAPI process — a single process, single machine, no internet
dependency required for day-to-day operation. `backup_db.ps1` provides a simple
database backup routine for this setup.
