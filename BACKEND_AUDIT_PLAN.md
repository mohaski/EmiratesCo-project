# Backend Audit — Bugs, Bottlenecks and a Safe Fix Plan

Audited 2026-10-06 against `master` (d6b2987). The server is about 23,600 lines across 25 modules.

**What was checked:**
- every route's authentication and role checks;
- exception handling;
- locking on every money and stock write;
- list-query cost, measured on the live data;
- index coverage, live data consistency, timestamps, logging and config;
- failover, WebSockets, deletions, quotations, open packs.

Every live-database check was read-only.

**Live data is clean today.** Product totals match their variants. There is no negative stock and no empty offcut row. No order's balance or payment total disagrees with its payments. So the race conditions below are latent: they haven't corrupted anything yet, and the fixes are preventive.

---

## A. Fix first — correctness and security

### A1. `GET /orders/{order_id}/items` needs no login
- **Effect:** anyone who can reach the server can read the items of any order, including prices, customers' cuts and measurements. It is the only data route without authentication; the others are `/users/token`, `/health`, `/api/status` and the page fallback.
- **Fix:** add `current_user = Depends(get_current_user)` and the same role list as `GET /orders/{id}`.
- **Risk of the fix:** the client always sends its token. Check that the cutting worksheet and order summary call this route through the authenticated `api` instance; they do.
- **Test:** add the route to `security_api.cjs`: 401 without a token, 200 with one. Run all browser suites.

### A2. Debt payments race (`PaymentService.record_payment`)
- **Effect:** the order is read without a row lock. Two tills collecting the same debt at once both pass "amount ≤ balance". Both then write `amountPayed = old + amount`, so one update is lost while both Payment rows remain. The books then disagree with the cash taken, and the customer can end up appearing to owe money already paid. A debt payment that lands during an order edit or cancel has the same problem: those lock the order, but this path doesn't.
- **Fix:** `select(Order).where(...).with_for_update()`.
- **Risk:** none to the logic. Concurrent payments on one order queue for milliseconds.
- **Test:**
  - four threads each pay the full balance at once → exactly one succeeds, the others get "exceeds the outstanding balance", and payment rows sum to `amountPayed`;
  - a payment racing a cancel → either the payment lands before the cancel's refund is worked out, or it is refused because the order is already cancelled.

### A3. Cancel reads the order unlocked (`apply_cancel`)
- **Effect:** the refund is worked out from `amountPayed` read without a lock. A debt payment committed at the same moment is missed: the customer paid, but the refund leaves it out. The client's "expected refund" check narrows the window but doesn't close it.
- **Fix:** load the order with `with_for_update()` in `apply_cancel`, in place of `get_visible_order_or_404`'s plain `db.get`, keeping the held/abandoned check.
- **Risk:** low. Cancels already lock stock rows afterwards. Order first, then stock is the same order the edit path uses, so no deadlock.
- **Test:** the A2 race test, plus the existing cancel suites (`test_cancel_refund_sync`, browser group 2).

### A4. A quotation can be converted twice
- **Effect:** `create_order` and `convert_invoice_to_order` check `invoice.status != "converted"` on an unlocked read. Two tills converting the same quotation at once create two orders and deduct the stock twice. The sale-window confirm already locks; these two paths don't.
- **Fix:** `select(Invoice).where(...).with_for_update()` in both.
- **Risk:** none. Only simultaneous converts of the same quotation wait.
- **Test:** two threads convert one quotation → one order, one refusal ("already converted"), stock deducted once.

### A5. `POST /invoices/{id}/convert` makes confirmed sales without taking stock
- **Effect:** this route creates a confirmed order, but:
  - it **never deducts stock** (its comment says "Do NOT deduct here");
  - it prices the sale from the browser-supplied quotation totals, not the server's prices;
  - it records no stock operation;
  - it doesn't lock the quotation.

  Every sale through it would leave its goods on the books. **Nothing uses it:** no screen calls it, the client helper is unused, and live has 0 orders created by it. But any signed-in user could still call it directly.
- **Fix:** answer `410 Gone` with "Convert from Order History (checkout)". Remove the unused client helper `convertInvoiceToOrder`. The real conversion path (checkout, or a sale window) is untouched.
- **Risk:** none for the app.
- **Test:** the route answers 410. Group 7 and windows suites (quotation conversion) still pass.

### A6. Searching orders by a long number fails with a 500 (introduced in Phase E)
- **Effect:**
  - a search that is all digits is compared with `order_no`, a 32-bit integer column. Searching by a 12-digit phone number (2547…) overflows it, and the search fails;
  - `GET /orders/by-number/{n}` with a huge number fails the same way.
- **Fix:**
  - search: only add the number comparison when `int(term) ≤ 2147483647`;
  - lookup: validate the path value (`Path(..., ge=1, le=2147483647)`).
- **Risk:** none.
- **Test:** search "254722222222" → 200 with name matches only; `by-number/99999999999` → 422.

### A7. Product stock edits take no row lock
- **Effect:** `update_variant` (restock stock changes), `update_simple_product_stock` and `add_variant` do read-modify-write on stock with no lock. With sale windows saving stock on every cart change, a restock and a sale at the same moment can lose one of the two updates. This is the same class of bug fixed in Stock Control during the windows work; these product-service paths were missed.
- **Fix:** call `inventoryService.lock_stock_rows(...)` before the write, the global lock order every sale path uses.
- **Risk:** low. The same pattern is already proven in stock sessions (test D in `test_sale_windows_stock.py`).
- **Test:** restock racing a window save, as test D, through `update_variant`.

---

## B. Performance and operations

### B1. SQL logging is on in production (`DEBUG=true`)
- **Effect:** `server/.env` has `DEBUG=true`, and `DEBUG` also turns on SQLAlchemy `echo`, so **every SQL statement is logged**. The order list alone is 118 statements. Logging is also configured twice (`main.py` and `loggiing.py`), so lines appear twice. The cost is CPU, slower requests and log files that grow without limit. Under NSSM, the service's output file grows until the disk fills.
- **Fix:**
  - set `DEBUG=false` in the live `.env`;
  - in code, drive `echo` from its own `SQL_ECHO` variable, off by default;
  - keep one logging configuration.
- **Risk:** none for behaviour; logs just get smaller. Nothing else reads `DEBUG`.
- **Test:** start the server and confirm requests still log one line each, and SQL is not logged.

### B2. Order lists run one extra query per row
- **Effect:** measured on live, `GET /orders/` runs **118 queries for 100 orders** and `with-balance` runs 80 for 73. Each row lazily loads `order.customer` and `order.payments` (for the "latest payment method"). The cutting queue loads each order's items, then each item's product. Fine at today's size; it grows with every order, and every till refreshes these lists after each sale.
- **Fix:** add `selectinload(Order.customer), selectinload(Order.payments)` to the list queries (`get_all_orders`, `get_orders_with_balance`, and by customer, served-by, day and VAT). Add `selectinload(Order.orderItems).selectinload(OrderItem.product)` to `get_pending_cutting_orders`.
- **Risk:** read-only; the responses stay identical. One thing to watch: loading payments for 100 orders is one query returning all their payments, which is fine.
- **Test:** a query-count test (≤ 5 queries for 100 orders), and the response compared field by field with the current output. All browser suites.

### B3. Missing indexes on the most-used lookups
- **Effect:** none of these columns has an index, so each of these lookups scans the whole table:
  - `orderitems.order_id`: every order's items;
  - `payments."orderId"`: payments per order, collect-payments, latest method;
  - `credits."orderId"`;
  - `variants.product_id`: every product list loads variants by product;
  - `offcuts.product_id`: every offcut search;
  - `orders.created_at`, `servedby`, `customerid`, `status`: reports, day lists, debts. `created_at` and `servedby` are even declared in the models but missing in the database, because `create_all` never adds indexes to existing tables.
  - `stock_journal (table_name, row_pk, id)`: undo's "was this changed later?" checks.

  Cheap at ~700 rows; worse with every sale.
- **Fix:** a hand-written `migrate_indexes.py` using `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, which builds without locking the tables and can run with the app up. Also declare the indexes in the entities, so a fresh database gets them.
- **Risk:** none to the logic. `CONCURRENTLY` can't run inside a transaction, so use autocommit, as `migrate_sale_windows.py` does. Re-runnable.
- **Test:** run it on the test DB twice. Run every suite.

### B4. Date filters can't use indexes
- **Effect:** the financial summary, day lists and audit history filter with `func.date(column) >= x`. Wrapping the column in a function stops any index being used, so every summary scans all payments and orders.
- **Fix:** compare the raw column with a half-open range: `column >= start AND column < end + 1 day`. Same meaning, because timestamps are stored as naive Nairobi time.
- **Risk:** the boundaries must stay inclusive of the whole last day.
- **Test:** summary figures for day, month and year identical before and after on the test DB, plus `test_group2_money`.

### B5. WebSocket broadcasts
- **Effect:**
  - broadcasts go to each connected till in turn, so one stalled connection delays every other till's update;
  - `disconnect()` raises `ValueError` when the broadcast has already pruned that socket;
  - a connection that dies with anything other than a clean disconnect stays listed until the next broadcast.
- **Fix:** send to all at once with a per-send timeout (`asyncio.wait_for`, 2 s), use `discard`-style removal, and catch every exception in the endpoint.
- **Risk:** low. Events stay "type only".
- **Test:** the windows suite (T26 reconnect) and the "tab B sees tab A" test.

### B6. Unbounded list sizes
- **Effect:** `limit` parameters are plain integers with no maximum (orders, invoices, tools, stock sessions, open containers, products), so a caller can request the entire table.
- **Fix:** `Query(..., le=1000)`. Check the client never asks for more first; the largest it asks for is invoices at 500 and outstanding orders at 1000.
- **Risk:** low.

### B7. Journal copying on every order-item load (measure, don't change yet)
- The audit journal deep-copies every order item's details whenever one is loaded, including read-only screens. Undo depends on those copies being exact, so it isn't worth risking for an unmeasured gain.
- **Action:** measure with B2's query test. Only revisit if it shows up.

---

## C. Minor issues

| # | Issue | Effect | Fix | Risk |
|---|---|---|---|---|
| C1 | Open-pack "hours open" uses UTC now minus Nairobi opening time | An open pack shows 3 h less than it really has been open | Use `nairobi_now()` | None |
| C2 | Deleting a user who has served orders | Foreign key → 500 "Internal server error" | Catch `IntegrityError` → 409 "This user has history — deactivate them instead" | None |
| C3 | `create_category` turns its own 4xx into 500 | Wrong error shown | Add `except HTTPException: raise` | None |
| C4 | `print("DEBUG: Error creating user")` in authService; `remove_product` returns `str(e)` on 500 | Noise; internal detail leaked | Logger; generic message | None |
| C5 | Quotations store the browser's totals | The quotation document can show stale prices. Converted sales are repriced by the server, so money is safe. | **Done:** the server prices every line and the totals on save/update, exactly as checkout does (browser totals ignored); the cashier gets a warning when the saved total differs from the screen | Low |
| C6 | Manual credit endpoints (`POST/PUT /financials/credits`) change credit without touching the order | Could make a credit disagree with its order. CEO/admin only, unused by any screen. | **Done:** both routes, their service functions and the unused client methods removed | None |
| C7 | WebSocket needs no login | Only event names leak; a nuisance-connection risk | **Skipped (decision):** left open; revisit if the till network is shared | Medium |

---

## Verified fine (no action)
- **Failover:** peer routes refuse when no shared secret is set.
- **Messages:** read status is limited to the recipient.
- **Passwords and sign-in:** Argon2 hashing; the sign-in throttle prunes old entries.
- **Open packs:** the sold count is locked during a sale.
- **Product list and outstanding credits:** already efficient (2 queries; 1 join).
- **Error handling:** broad error handlers are otherwise correct.
- **Every other order read** filters out sale windows (route-sweep test).

---

## Order of work (each step ends with the full test run green)

| Step | Items | Why this order |
|---|---|---|
| 1 | B1: `DEBUG=false` in the live `.env` | Config only, no code, immediate relief. Do it now. |
| 2 | A1, A5, A6 | Small, isolated, security/refusal changes |
| 3 | A2, A3, A4, A7 | Locking. Add the race tests first (they fail before, pass after), then the locks |
| 4 | B3 | Index migration on the test DB, then on live (concurrent, can run with the app up) |
| 5 | B2, B4 | Query shape. Compare responses before/after field by field |
| 6 | B5, B6, C1–C4 | Small hardening |
| 7 | C5, C6, C7 | Decided: C5 done, C6 removed, C7 skipped |

**Rules that keep this safe:**
- **No behaviour change** in steps 2–6 beyond the bug itself; every response stays identical except the fixed error.
- **A test that fails first** for every bug in sections A and B, kept in `server/test_backend_audit.py` (races, query counts, overflow) and `tests/e2e/security_api.cjs` (auth).
- **Test database only** for every test; live is touched only by `.env` (step 1) and the index migration (step 4), after a backup.
- **Full suite after each step:** `tests/run_all.sh` (server suites, service tests, 11 browser suites) plus lint and build.
