# Sale Windows — Integration Plan

Bringing `origin/sale-windows` (25cc9ab, written on top of 421fcb7) into the current
`master` (fbea71f) without introducing new bugs.

---

## 0. Where things stand

| | |
|---|---|
| Branch base | `421fcb7` — before undo (373abf3), offcut-correction enhancement (3181eac) and the frontend fixes (fbea71f) |
| Size | 59 files, +3,806 / −221 |
| Trial merge into master | **16 files conflict** (orderService.py ×9, SalesDashboard ×8, CartContext ×6, CheckoutPage ×4, OrdersPage ×3, CutPreviewModal ×3, products service/controller/model, inventoryService ×2, OffcutSelectorModal ×2, ResolveCutsModal, api.js, toast.js, orderItemMapping.js, entities/\_\_init\_\_) and ~45 more merge as text but must be re-checked for meaning |
| Branch's own tests (isolated DB) | `test_sale_windows.py` 66/66, `test_sale_windows_matrix.py` 191/191 |

**How it works:** an open window is a real `Order` row with status `held`. Its stock is
really deducted when items enter the cart. Remainders it produces are private to it
(`offcuts.held_by_order_id`). It ends as `confirmed` (paid), or `abandoned` when released
or expired (its stock goes back).

**What follows from that:** every piece of code that reads orders or offcuts must know
about windows, and master has grown a lot of such code since the branch was written.

**Approach: port, don't merge.** Start a new branch from `master`:

1. Copy the branch's new files as they are.
2. Re-apply its edits by hand onto master's current versions of the conflicting files.
3. Apply the fixes in §3.
4. Gate everything behind a feature flag (§5).

---

## 1. Business decisions needed before coding

| # | Question | Branch does | Recommendation |
|---|---|---|---|
| D1 | Idle expiry | 15 min, no extension, even on the checkout screen | Keep 15 min for an idle cart. **The checkout screen keeps the window alive** (a heartbeat while it is open and visible), with a hard cap of 30 min. Otherwise a customer paying by M-Pesa for more than 15 minutes has paid, while the window and its stock are already gone. |
| D2 | Windows per cashier | 3 | Keep 3 |
| D3 | Sign Out with open windows | Windows keep holding stock up to 15 min | Ask "Release your N open sales?" — yes releases them now |
| D4 | Managers can't see held stock | Stock just looks lower | Show "held in open sales: X" on Inventory / Stock Control so nobody "corrects" stock that is merely held |
| D5 | Receipt number ≠ internal id | New gap-free `order_no`; existing orders keep their number | Accept |
| D6 | Undo of an edit whose returned piece was later used by a window | Not considered | Refuse the undo with a clear reason (safe), even after that window is released |
| D7 | Window cart re-priced on every save | Price at last save is what confirm charges | Accept; checkout shows the server's window total |

---

**Decided (2026-10-04):**
- **D1:** 15 min idle, no extension. Typing on Checkout counts as activity and resets the clock, like switching windows; nothing keeps a window alive without activity.
- **D2:** 3 windows.
- **D3:** Sign Out releases the cashier's windows.
- **D4:** Managers see held stock.
- **D5–D7:** as recommended.

**Progress (branch `sale-windows-v2`):**
- Phases B–E (server): implemented. Every backend suite passes, plus the new
  `test_sale_windows_{visibility,holds,money,stock}.py` and the ported branch suites.
- Phases F–G (client): implemented. Lint stays at the baseline of 22 and the build passes.
- Browser regression (windows off) and `suite_windows.cjs` (windows on): see the latest run.

**Found and fixed while integrating, beyond §2:**
- **Concurrent checkouts deadlocked** (also on master): 2 of 4 simultaneous checkouts of one
  product failed with a 500. Every sale path now locks stock rows up front in one global
  order (`inventoryService.lock_stock_rows`).
- **Cancel/edit "rejoin" could merge an uncut piece into an open window's private
  remainder.** That left a ledger piece consumed by an abandoned window. Now refused
  (`holdScope.held_elsewhere`).
- **Opening a window wrote an order outside any operation** (TRACE). Now recorded.
- **`_describe_blocker` could raise `NameError`** (branch code) when a piece had no order.
- **Stock sessions read stock without a lock.** They now lock in the global order.

## 2. Bugs the branch would introduce (verified)

### Money — highest cost
1. **`windowService._confirm` copies the old checkout money rules.** It is missing:
   - the negative-amount refusal;
   - the overpay refusal (more than total + 1);
   - capping `amountPayed` at the total;
   - `ceil_amount` on the payment row;
   - `normalize_payment_details` (split parts are never validated);
   - the Paid threshold — it uses `balance == 0` where checkout uses `<= 0.10`.
2. **`_set_cart` accepts a negative discount** (net goes up). Checkout refuses it.
3. **Converting a quotation opens a window without the quotation's discount**
   (`openWindowWith` in SalesDashboard). This undoes the group-2 discount carry-over:
   the customer is charged more than quoted.

### Held orders leaking into code written after the branch
4. These read orders with no held/abandoned filter:
   - `undo.undo_operation`, `undo.preview`, `operationsService.correction_plan`;
   - `orderService._correction_target`, `apply_order_edit`, `apply_cancel`,
     `projected_offcuts`, `get_reversal_plan`, `update_order_status`,
     `mark_cutting_complete_for_orders_batch`, `get_orders_with_balance`;
   - `get_all_orders` (including the new `search=` parameter).
5. `orderItemService.update_orderItem_status_to_returned` looks an item up by id alone,
   so it can mark a held window's item returned.
6. `creditService.create_credit` and `update_credit` take an `order_id` with no check.

### Held offcuts leaking
7. `cutCorrection.profile_candidates` (master's offcut correction) lists offcuts with no
   window scope. A manager's correction can take another window's private remainder,
   and that window can then never give its bar back whole.
8. `inventoryService._cut_from`, the `tie_rows` query (master), has no scope and locks
   other windows' rows. `glass_piece_options` must be checked the same way.

### Audit / undo (master's journal is newer than the branch)
9. **Window operations run outside any `operation()`.** Master's integrity check requires
   every offcut-ledger event to carry its operation (the TRACE invariant), so every window
   cart change, release and expiry would fail it. The undo tool would also show stock moves
   as "made outside any recorded operation".
10. `undo._op_label` and `analyse` messages print `Order #{orderId}`. Once windows use up
    ids, that is not the number on the receipt.

### Background sweeper
11. The sweeper runs every 30 s, **including during a failover receive**, when
    `pg_restore --clean` is dropping and recreating tables. It can fail, or write stock
    changes into a half-restored database. It must skip while
    `failover.service._operation_lock` is held.

### Client
12. **Calculators don't credit a window line's own held stock.** `heldByEditedItem` only
    counts edits of saved orders (`_sourceItemId`). With stock at 10 and a line holding 8,
    reopening the line says "Only 2 available" and refuses valid quantities.
13. **The instant stock check over-promises for a new line.** The window's order id is sent
    as `edit_order_id`, so the check gives back all of that window's material. The server
    save then refuses: a confusing "OK, then no".
14. **`addToCart(...).catch(() => {})` closes the product modal before the save is
    answered.** A refused save loses the glass sizes or cuts the cashier typed.
15. **Edit mode clashes.** The branch decides edit mode from an `editingOrderId` that isn't
    saved and is set from navigation. Master saves the edit session
    (`emirates_pos_edit_session`). Window mode must be
    `sessionType === 'sales' && !editSession`, or a reload in the middle of an edit turns
    it into a new sale.
16. **First load after deploy hides any cart a till has in `emirates_pos_cart`.** Window mode
    ignores the local cart, so it disappears silently.
17. `WebSocketContext.ALL_EVENTS` is missing `windows_updated`, so a reconnecting till
    doesn't refresh its windows until the 60 s poll.
18. **Internal ids are shown to people as order numbers.** Once ids and numbers drift, these
    become wrong: `OrderCard`, `PaymentModal`, `CuttingQueueSection`, `CuttingInstructions`,
    `ResolveCutsModal`, `DuesPage`, `OpenStockHistory`, `ActivityLogPage`, `CeoDashboard`
    activity, the SalesDashboard edit banner, `OrderContext` notes, `activityMeta`
    summaries, and `ReceiptPage` (`number: orderId`). The branch fixed some of these, but
    master changed many of the same files.
19. **Search by order number uses the internal id:** OrdersPage (including group 7's ID
    lookup) and CollectPaymentsPage. Typing a receipt number finds a different order.

### Load and data growth
20. **Every cart change tears down and rebuilds the whole cart.** That includes simply adding
    an item. A 20-line cart re-runs the cut engines about 200 times while it is built.
    Every run writes journal and ledger rows, and every save broadcasts `products_updated`,
    so every till refetches all products.
21. **Stock sessions update stock without a row lock** (`stockSessions/service.py`, the
    `db.get` + `=`). Windows write stock on every cart change, so a restock running
    alongside a window save can lose one of the two updates.

---

## 3. Implementation plan

Each phase ends with its tests green **and** every existing suite green.

### Phase A — Safety net first (tests that must fail before the work)
- A1. **Route sweep test** (T1 below), written now. It enumerates FastAPI routes, so it also
  covers endpoints added in future.
- A2. **`order_no ≠ orderId` fixture.** Seed the test DB with the counter offset by
  +1000, so any internal id that leaks onto a screen is obvious.
- A3. **Integrity hook** in every new test: run `core/audit/integrity.check()` after each
  step.

### Phase B — Server foundation
- B1. Copy the new files as they are: `entities/saleWindows.py`, `visibility.py`,
  `orderNumbers.py`, `migrate_sale_windows.py`. Apply the edits to `entities/orders.py`,
  `entities/offcuts.py`, `entities/__init__.py` and `ordering/model.py` (`orderNo` fields).
- B2. Apply `visible_orders()` / `get_visible_order_or_404()` to **every** function in this
  list, made from current master:
  - **orderService:**
    - `get_order_by_orderId`, the two `get_orders_for_period_vat*`;
    - `get_orders_by_customerId`, `get_orders_by_servedby`, `get_orders_for_certain_day`;
    - `get_child_orders`, `get_all_orders` (with search), `getAll_orders_VatIncluded`;
    - `apply_order_edit`, `_correction_target`;
    - `mark_cutting_complete_batch`, `mark_cutting_complete_for_orders_batch`,
      `mark_cutting_complete_for_order`, `get_pending_cutting_orders`;
    - `get_orders_with_balance`, `get_reversal_plan`, `update_order_status` (also refuse
      setting `held` / `abandoned`), `apply_cancel`, `projected_offcuts`.
  - **Other services:**
    - `operationsService.correction_plan`;
    - `undo.undo_operation` and `undo.preview` (refuse a held target);
    - `PaymentService.get_financial_summary`, `PaymentService.record_payment`;
    - `creditService.create_credit` / `update_credit`;
    - `orderItemService.get_orderItems_by_orderId`,
      `orderItemService.update_orderItem_status_to_returned`;
    - `openContainers.utilization.container_usage` / `_revenue_by_container`.
  - **Display only:** `inventoryService._pending_source_notice`,
    `reversalPlan._piece_summary`, `offcutResolver._describe_blocker` / `later_cut_info`,
    `glassOffcutService._apply_candidate`. Add `order_no`, and when the holder is a window
    say "an open sale" instead of an order number.
- B3. `create_order` refuses `held`/`abandoned` and calls `assign_order_no` last.
  `invoices/service.py` conversion does the same.
- B4. `offcutLedger._consumption_is_live` treats `abandoned` like `cancelled`.

### Phase C — Holds (private remainders)
- C1. Copy `holdScope.py`. Re-apply its use in `inventoryService` and `glassOffcutService`
  onto master's versions: `_fulfill_one_cut_via_best_fit`, `_remove_offcut`,
  `_drop_pooled_unit_for_piece`, `_return_pooled_unit_for_piece`,
  `_consume_offcut_sources`, `_upsert_offcut`, `_generate_candidates`,
  `_upsert_glass_offcut`, `_find_glass_offcut`, `_apply_candidate`.
- C2. **New scoping** for master code: `cutCorrection.profile_candidates`,
  `cutCorrection.glass_piece_options`, the `inventoryService._cut_from` `tie_rows` query,
  and `_fulfill_from_own_or_new_bar`.
- C3. Products service: the picker listing takes `hold_order_id` (checked by
  `require_own_held_order`). Offcut Management's list, edit and delete refuse held rows.
  Merge these with group 7's category-delete routes.
- C4. `_restore_packaged_stock_pooled`: keep the branch's "leftover not intact → return
  loose pieces only" fix.
- C5. Stock sessions: lock variant and product rows `with_for_update()` before
  read-modify-write (bug 21).

### Phase D — Window service, ported and fixed
- D1. Copy `windowService.py`, `windowModel.py` and `windowController.py`, and register
  them in `main.py` alongside group 7's page-load middleware.
- D2. **One money path.** Extract checkout's money block (bounds, cap, ceil, Paid
  threshold, Credit row, Payment row with `normalize_payment_details`) from `create_order`
  into `orderService._settle_new_sale(db, order, final_total, amount_paid, method, details,
  user)`. Call it from **both** `create_order` and `_confirm`; the rules then can't drift
  apart again.
- D3. `_set_cart` refuses a negative discount. The window keeps the quotation's discount
  when created from one.
- D4. **Operations:** add kinds `window_cart`, `window_release`, `window_expire` to
  `entities/opJournal.py`.
  - Wrap `_set_cart`, `_close` and `_confirm` in `operation(...)`, with `order_id` = the
    window's order. The sweeper uses `actor=None`.
  - `_confirm` runs as `OP_SALE`, so an order made in a window looks exactly like a
    checkout to undo.
  - Leave the window kinds out of `UNDOABLE_KINDS`. Add labels in `undo._op_label`
    ("a sale in progress (window)").
- D5. **Incremental append.** When `_match_items` finds every existing item reused and only
  new items appended, deduct just the new items: no teardown. Removals and changes keep the
  full rebuild. This gives the same result as checkout, which also deducts in cart order,
  and removes most of the load in bug 20.
- D6. **Dry-run cart check:** `POST /windows/{id}/cart/check` runs `_rebuild_items` in a
  SAVEPOINT and rolls back. In window mode the calculators use it instead of `edit_order_id`
  (fixes bug 13).
- D7. **Sweeper:** skip while `failover.service._operation_lock.locked()`. Keep one worker
  (NSSM `--workers 1`). Expire with `skip_locked` as now.
- D8. **Heartbeat** (decision D1): `POST /windows/{id}/touch`, called by Checkout every
  60 s while it is visible. Refuse past the 30 min cap.
- D9. **Release on sign out** (decision D3): `DELETE /windows/mine`.
- D10. **Feature flag:** a `SALE_WINDOWS_ENABLED` system setting. When off, the window
  endpoints answer 404 and the client uses the local cart as today.

### Phase E — Order numbers everywhere
- E1. Server messages: undo (`_op_label`, `analyse`), `_assert_cart_is_this_orders`, the
  edit version conflict, reversal plan "later cut" messages, resolver blockers, the invoice
  conversion log, and the status/cancel responses. Use `order_no`.
- E2. API: `GET /orders/by-number/{no}`. `get_all_orders(search=)` also matches `order_no`.
- E3. Client: every place listed in bug 18, plus receipt print, reprint and QZ, which use
  `orderNo` for the receipt number. Searches match `orderNo` (bug 19).

### Phase F — Client state
- F1. Copy `WindowContext.jsx`, `WindowTabs.jsx` and `utils/saleWindows.js`. Add the
  provider in `App.jsx` (between Product and Cart providers).
- F2. **CartContext merge rules:**
  - window mode = `sessionType === 'sales' && !editSession`;
  - local mode keeps all group-7 behaviour (storage sync, owner key, saved edit session,
    tax in context);
  - window mode reads customer, VAT and links from the window.
- F3. **Legacy cart on first load** (bug 16): if `emirates_pos_cart` has items, there is no
  edit session and windows are enabled, move them into a new window (stock checked) and
  tell the cashier. If that fails, keep them local and say why.
- F4. `AuthContext` logout: confirm and release windows (D9). Also clear
  `emirates_pos_active_window_*`, `emirates_pos_window_customers_*` and
  `emirates_pos_confirm_key_*`.
- F5. Add `windows_updated` to `ALL_EVENTS`. Debounce `refreshProducts` (about 300 ms) so
  a burst of saves is one refetch.

### Phase G — Client screens
- G1. **SalesDashboard:**
  - the product modal **awaits** the save and stays open with the error on refusal (bug 14);
  - quotation conversion passes `discount` (bug 3);
  - keep group 7's "opening Sales doesn't clear the customer";
  - window tabs are hidden while editing a saved order.
- G2. **Calculators:**
  - Window lines carry `_heldItemId`. A new `heldByCartLine()` credits that line's own held
    units (bug 12). Don't reuse `_sourceItemId`: the edit matching uses it.
  - In window mode, pass `holdOrderId` to the offcut picker and glass preview.
  - In window mode, use the cart check from D6.
  - Resolve the conflicts in CutPreviewModal and OffcutSelectorModal onto the group fixes.
- G3. **CheckoutPage:**
  - window sale: save discount and VAT, then confirm with an idempotency key;
  - totals shown are the **server's** `windowTotals`;
  - handle 410 / 409;
  - heartbeat (D8);
  - keep the group-2 payment bounds, split validation and discount rules on the client too.
- G4. **ReceiptPage / OrderSummary / OrdersPage:** show `orderNo` and search by it.

### Phase H — Full verification (§4), then staged deploy (§5)

---

## 4. Tests — the ones missing today that could let a costly bug through

The existing suites stay mandatory:
- browser: suite, g2–g7, edit_session_suite, security_api;
- backend: `run_backend_tests.sh`;
- service: group2_money, payment_status_derivation, group5, group7;
- the branch's `test_sale_windows*.py`.

The tests below are **new**. Each one targets a gap those suites cannot see.

### Money (a wrong figure here is real cash or real debt)
| ID | Test | Catches |
|---|---|---|
| T2 | **Checkout vs window parity matrix.** For the same cart, compare `create_order` with window confirm across:<br>• VAT on/off<br>• discount 0, partial, ≥ subtotal, negative<br>• paid 0, partial, exact, total+0.5, total+5, negative<br>• method cash, mpesa, valid split, split that doesn't add up<br>Assert that the order, payment and credit rows are field-for-field equal, or that both refuse the same way. | Bugs 1–2, and any future drift between the two paths |
| T3 | Quotation with a discount → convert → window → confirm. The total equals the quotation total. | Bug 3 |
| T4 | **Displayed total = charged total.** Browser test: for the VAT and discount combinations, the checkout total on screen equals the server window total equals the confirmed `order.total`. | Rounding (`ceil_amount`) mismatches |
| T5 | Two confirms with the same key at the same moment (two threads) → exactly 1 payment. A different key → 410. A confirm after expiry → 410, no payment row, stock as released. | Double charge |
| T6 | Checkout open for 20 min (heartbeat on) → confirm succeeds. Heartbeat off → clear message, no receipt printed, no payment row. | The M-Pesa paid-but-window-gone case |

### Visibility and stock integrity
| ID | Test | Catches |
|---|---|---|
| T1 | **Route sweep.** Create a held order and an abandoned order (with items and held offcuts). Enumerate `app.routes`:<br>• every route with `{order_id}` / `{orderId}` → 404 for both;<br>• every list, report and queue route → neither id appears;<br>• every `{item_id}` route using their items → refused;<br>• the financial summary counts and totals are unchanged by them. | Bugs 4–6 now, **and any endpoint added later** |
| T7 | **Stock conservation property test.** Run random sequences of window actions (open, add, edit line, remove, change customer, release, expire, confirm) across 3 windows and 2 users. Mix in checkout, edit, cancel, correction, cutting report and restock. After every step assert:<br>• integrity check clean (POOL↔LEDGER, STOCK↔JOURNAL, **TRACE**);<br>• for each product, stock + held = start − confirmed sales;<br>• a released window gives back exactly what it took, bars recombined;<br>• no phantom pieces. | Bug 9, and engine/hold edge cases nobody thought of |
| T8 | **Held-remainder privacy across every offcut reader:**<br>• picker listing, glass preview, best-fit;<br>• `profile_candidates`, `glass_piece_options`;<br>• Offcut Management list, edit, delete;<br>• stock-session offcut lines, open-container paths.<br>Another window's held row is never offered or used, and edit/delete is refused. | Bugs 7–8 |
| T9 | A window rebuild never sets `cutting_completed` (the precut path). A confirmed window's items appear in the cutting queue **exactly once**, and never before confirm. | Silently skipped cutting, or cutting before payment |
| T10 | **Same result as checkout.** A cart built in a window (append path and remove/edit path) and confirmed leaves the same stock, offcuts and `offcut_sources` as `create_order` of that cart from the same starting state. | The incremental-append change (D5) |
| T11 | **Concurrency:**<br>• two users race for the last unit or last offcut → exactly one wins, stock never negative;<br>• forced deadlock → retried;<br>• restock and window save at once → no lost update. | Bug 21; overselling |
| T12 | Sweeper vs save at the 15-min boundary → either the save wins (clock reset) or expiry wins (410). Never half of each. | Partial release |
| T13 | Sweeper during a failover receive → skipped, no errors. After the restore, windows that came in the dump expire correctly and stock reconciles. | Bug 11 |
| T14 | **Undo interplay:**<br>• edit returns a piece → a window uses it → undo refused with a clear reason;<br>• that window is released → undo still safe and integrity clean;<br>• undo of an edit on a window-confirmed order works. | Undo corrupting stock |
| T15 | Window-confirmed order, then edit qty, offcut correction, cutting report, cancel within the week. Each fully reverses (bars recombine), and integrity is clean after each. | Window orders behaving differently from checkout orders later |
| T16 | Open container: window A opens a box, window B sells loose pieces from it, A is released → no invented pieces. Container usage and revenue count only confirmed sales. | Inflated stock and revenue |
| T17 | Order numbers: 20 concurrent confirms and checkouts plus forced rollbacks → `order_no` unique and gap-free. | Receipt number gaps or duplicates |
| T18 | **Migration on a copy of live:** enum values added, backfill `order_no = orderId`, counter = max. Re-run is idempotent. Orders taken by the old backend between migration and restart get numbered from the counter. | A bad deploy |

### Client (browser)
| ID | Test | Catches |
|---|---|---|
| T19 | Stock 10, line holds 8 → reopening the line shows 10 available and accepts 9 or 10. A second new line sees 2. Covers Standard, Dynamic, Accessory (including packs and open containers), Profile and Glass calculators. | Bug 12 |
| T20 | Another till takes the stock between the instant check and the save → the modal stays open with every input intact and a clear reason. | Bugs 13–14 |
| T21 | Window expires while the modal is open, and while on Checkout → no new customer-less window is created silently, the customer overlay appears, and the message is clear. | Sales with no customer |
| T22 | Windows open → start editing order X → the cart shows the edit and the tabs are hidden → reload in the middle of the edit (still an edit, no window created) → save → back to the same active window, unchanged. | Bug 15 |
| T23 | A till with items in `emirates_pos_cart` loads the new client → items moved into a window, or kept with a reason. Never silently lost. | Bug 16 |
| T24 | Same cashier in two tabs → 409 handled, both tabs converge. Group 7's storage sync doesn't fight the windows. | Tab ping-pong |
| T25 | Cashier A signs out (release prompt), then cashier B signs in on the same till → B never sees A's windows, and A's stock follows decision D3. | Stock held by nobody |
| T26 | Drop the network → windows change elsewhere → reconnect → the till shows the change within seconds (`windows_updated` replay). | Bug 17 |
| T27 | While a cashier types glass sizes, another till saves 10 times → inputs survive, no flicker, one product refetch per burst. | Bug 20 on screen |
| T28 | **Order-number leak check,** with the A2 fixture (`order_no = orderId + 1000`). Every screen and print that names an order shows `order_no`:<br>• receipt print, reprint, QZ;<br>• order card, payment modal;<br>• dues, collect payments;<br>• cutting queue and worksheet notices;<br>• activity log, CEO dashboard;<br>• undo and conflict messages, open-stock history.<br>Searching a receipt number opens **that** order, not the one whose internal id matches. | Bugs 18–19 |

### Load check (run once before go-live)
- **T29.** Three tills each build a 20-line cart, mixing profile, glass and accessories.
  Measure:
  - save latency;
  - journal and ledger rows added per sale;
  - product refetches per minute.

  Must hold: p95 save under 1 s, and journal growth acceptable for a year of trade.
  Re-run the integrity check over the year-sized journal.

---

## 5. Deployment and rollback

**Order of deploy:**
1. Back up live.
2. Rehearse on a copy of live (T18).
3. Stop the backend.
4. Run `migrate_sale_windows.py`.
5. Start the new backend with `SALE_WINDOWS_ENABLED = off`.
6. Deploy the client.
7. Turn the flag on for one till, then for all.

**Compatibility:**
- Old clients still work, because the new backend keeps `create_order`. That matters with
  the PWA `prompt` mode, where a till may run the old client until someone accepts the
  update.
- A new client against an old backend does not work, so the server always goes first.

**Rollback = turn the flag off, never revert the code.**
- Once windows have been used, the database holds `held` and `abandoned` orders.
- The old code knows neither status. It would list abandoned windows as orders, and may
  fail to load the rows at all.
- Turning the flag off:
  1. releases every open window (script: `windowService.release_all_open()`);
  2. hides window endpoints;
  3. puts the client back on the local cart.

  The visibility filters stay in place.

---

## 6. Done means
- [ ] All existing suites green, plus the branch's suites, plus T1–T29.
- [ ] Integrity check clean on the test DB after the full run, and on the live copy after the rehearsal.
- [ ] Lint not worse than today (22). Build succeeds.
- [ ] Decisions D1–D7 recorded.
- [ ] Rollback (flag off with open windows) rehearsed on the live copy.
