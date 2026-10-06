# Provisional Offcuts: Implementation Plan

Make a sale window's bar remainders visible to every till, marked **provisional**, instead of
hiding them, so two sales never open two bars when one is enough.

Status: **Phase 0 done** on branch `provisional-offcuts-phase0` (R1, R2; suite
`server/test_provisional_offcuts.py`). Phases 1 to 6 not started. Decisions D1 to D4 accepted as
recommended (2026-10-06). Written 2026-10-06 from the production dump of the same day and the code
at `9416d04`.

---

## 0. Why

**Incident, 2026-10-06, Sliding Mullion White (21ft bars):**

| Time | What happened |
|---|---|
| 10:04 | Emirates' window (#342) cuts 3ft from a **new bar**. Its 18ft remainder is private to that window (`offcuts.held_by_order_id = 348`) until 10:14. |
| 10:11 | The correction of #341 needs a 3ft. It can't see the held 18ft, so it opens a **second bar**. |
| 10:14 | Emirates confirms. Its 18ft goes public, but the second bar is already used. |

One bar was enough for both cuts. The hold (`core/inventory/holdScope.py`) exists for a good reason:
a window's remainder is only on paper (the bar is still whole on the rack, nothing is cut before
payment). If another sale took part of it and the window was then released, the bar could not go
back to stock whole. This plan keeps that guarantee by different means.

---

## 1. The design

### 1.1 Rules

1. **Visible, but marked.** A remainder of a window's cut on a profile bar (1D) is visible to every
   till and every manager tool, marked *provisional - Window 2 (Ismail)*. Glass (2D) keeps today's
   private hold (§1.4).
2. **Confirm removes the mark.** When the window is paid, its cuts go ahead, so its mark is removed
   from every row. A row with no marks left is an ordinary offcut.
3. **Release hands the bar over.** When a window is released or expires, its cuts are reversed as
   *not cut* (true by definition: nothing in a window is cut before payment).
   - Nobody borrowed from its remainder: the bar goes back to stock whole, exactly as today.
   - Someone borrowed: the window's uncut length is joined back onto what is left of the bar, and the
     bar stays out of stock, now carried by the borrower. Nothing physical changes; the bar was
     whole all along.
4. **Choosing a source:** best fit among ordinary offcuts first, then provisional offcuts, then a new
   bar. Bars are only shared when sharing saves one (decision D1).
5. **Marks are derived, not propagated.** A row's marks are the open windows whose uncut cut is in
   that piece's ancestry (its `parent_piece_id` chain in the piece ledger). One function computes
   this; the stored column is a cache of it, refreshed on every write. This is what keeps marks
   correct through edits, cancels, corrections and undo (see the bug register, R3 and R5).

### 1.2 Worked example (the incident under the new rules)

| Step | Pool (White) | Stock |
|---|---|---|
| Emirates window cuts 3ft from a new bar | 18ft *provisional - Emirates* | 8 |
| #341 correction takes 3ft from the provisional 18ft | 15ft *provisional - Emirates* | 8 |
| **a)** Emirates confirms | 15ft (mark removed) | 8 |
| **b)** Emirates is released instead | 18ft (3ft never cut + 15ft), carried by #341 | 8 |

Either way one bar is used. In (b) it is exactly what is on the rack: #341's 3ft comes out of a
21ft bar and leaves 18ft.

### 1.3 Data model

- `offcuts.provisional_for INTEGER[] NOT NULL DEFAULT '{}'`, with a GIN index. These are the order
  ids of the open windows this material depends on. It can hold more than one: window B borrows from
  window A's remainder, and B's own remainder depends on both.
- `offcuts.held_by_order_id` stays, with a narrower meaning: private, used for 2D only.
- An empty `provisional_for` means an ordinary offcut. Rows merge (pooled quantity) only when their
  mark sets are identical.

### 1.4 Glass stays private for now

A sheet's leftovers are rectangles at fixed positions. Handing a sheet over means recomputing the
leftover rectangles around another order's cut, which is not a simple length join. Every 2D call
site keeps today's strict visibility. Revisit once the 1D version has run cleanly.

---

## 2. Bugs this change would expose (investigation results)

Each was checked against the code at `9416d04`. **R1 and R2 were reproduced on the 2026-10-06 data**
(Sliding Mullion White, run inside a transaction and rolled back). Script:
`repro_rejoin.py` in the session scratchpad.

| # | Area | Risk | Evidence | Fix (phase) |
|---|---|---|---|---|
| **R1** | Reversal: rejoin (`inventoryService._rejoin_uncut_1d`) | Bar opener reversed as *not cut*, **then** the borrower reversed as *not cut*: the two rejoins rebuild a full-length piece, which lands in the **offcut pool as a 21ft offcut** while stock stays one bar short. | Reproduced: stock 7 → **6**, pool gains a **21.0** offcut. The reverse order is correct (stock back to 7). **This bug exists today** for ordinary edits and cancels; provisional sharing would make it routine (every release after a borrow). | When a rejoin reaches the bar's full length and the root is a stock bar, return the bar to stock (+1) and retire the pieces instead of creating an offcut. (Phase 0) |
| **R2** | Window release and cart rebuild (`windowService._restore_all`) | `_restore_all` passes no physical-state answers, so with a borrower present the window's cut is credited as a **separate piece** instead of rejoined. | Reproduced: pool ends 19ft + 2ft for a bar that is physically whole, stock 7 → **6**. Unreachable today (nobody can borrow a held remainder); the main path under this design. | Window restores always pass *not cut* for every cut line (`ReversalDecisions` built for all lines). (Phase 0) |
| R3 | Restore of a borrowed piece (`_return_pooled_unit_for_piece`, line ~1390) | Marks for a re-created row come from the **caller's scope** (`hold_for_new_row`). A manager edit or cancel of the borrower (scope None) would put the provisional 18ft back as an ordinary offcut. | Code reading. | Use the lineage function (rule 5), never the scope. (Phase 2) |
| R4 | Un-create lookups by size (`_remove_offcut` ~1304, `_drop_pooled_unit_for_piece` fallback ~1350) | Once marked rows are visible, a size lookup could retire **another window's** same-length provisional piece. | Code reading: these use `visible_to_scope()` + `own_rows_first()`. | Keep these lookups strict: exact piece id first, and the size fallback excludes rows marked by other windows. (Phase 3) |
| R5 | Merging remainders (`_upsert_offcut` `same_scope()` ~1814) | A borrower's remainder merges into an ordinary row of the same length and loses its mark (or the reverse). | Code reading. | Merge only on an identical mark set. (Phase 2) |
| R6 | Rejoin onto a window's leaf (`holdScope.held_elsewhere` in `_rejoin_uncut_1d`) | Today it refuses to rejoin onto another window's held leaf and credits a separate piece. Under the new design that leaf is often a borrower window's provisional remainder, so R2's split would come back. | Code reading. | Allow the rejoin for 1D; the joined piece's marks come from the lineage function. (Phase 3) |
| R7 | Cutting worksheet (`client/src/utils/cuttingInstructionFormat.js:45`) | The borrower's sheet says "Source: Offcut #21598 (18ft)", but while the holder is unpaid there is no 18ft on the rack, only a whole 21ft bar. | Code reading. The existing `pending_source_notice` already covers the same situation for confirmed-but-uncut orders. | Extend the notice with `in_window` and the bar length. The worksheet says "take a 21ft bar (shared with Window 2 - its 3ft is not cut yet)". Work this out when the sheet is shown, from the ledger, not at sale time. (Phase 4) |
| R8 | Offcut Management (`products/service.py` ~864, ~916, ~1037) | Provisional rows are currently hidden from this list. Shown, a CEO could edit or delete a piece that exists only on paper. | Code reading. | Show them read-only with the badge; keep the 409 on edit and delete. (Phase 4) |
| R9 | Stock counts | A count while a window is open finds a whole bar where the system shows "18ft". | Same gap as today's held stock (windows plan D4). | Badge provisional rows in counts and in `held_stock`; never reconcile against them. (Phase 4) |
| R10 | Audit and integrity | After a handover, an abandoned window's order shows net −1 bar and the borrower +1. A per-order stock reconciliation flags it. | Follows from rule 3. | Record handovers in the op summary (`bar_handed_over: {from_order, to_order, piece}`). Teach `core/audit/integrity.py` the new invariants (§3, Phase 6). Update window tests that expect a release to give back exactly what it took. |
| R11 | Undo (`core/audit/undo.py`) | Undo replays row images. Marks change when other windows open and close, so undo of a sale that touched a provisional row is refused more often. | Code reading (the "changed again afterwards" refusals). | Accept, same as windows plan D6. Make sure the refusal message names the window. |
| R12 | Holder edits its cart after a borrow (`_rebuild_items` teardown) | Every save of the holder's cart rejoins and re-cuts, so piece ids churn; the borrower's records point at pieces that are later replaced. | Code reading. The ledger already follows `superseded_by_piece_id`. | Test it explicitly (T9). Keep the "appended only" fast path. |
| R13 | Locking and deadlocks | A pool can span variants (`pool_key`), so a borrower may lock a different variant than the holder's release, then both lock offcut rows in a different order. | `lock_stock_rows` sorts variant and product locks, but offcut rows are locked later, in query order. | Lock offcut rows in ascending id within one operation. Every path that can borrow (checkout, edit, correction, window) must retry on deadlock, as windows already do (`_with_retry`). (Phase 3) |
| R14 | Idle expiry (`main.py` sweeper) | The handover runs in a background thread with no user; the borrower's till is not told its source changed. | Code reading. | Same release path; broadcast after commit (Phase 5). |
| R15 | Shared helper widened by mistake | `visible_to_scope()` is used by both the 1D and 2D engines; widening it would leak 2D holds. | 13 call sites (listed in §3, Phase 3). | Add a new `visible_1d()` and switch only the 1D consumption sites. |
| R16 | Feature switch | Turning provisional sharing off while marks exist would leave rows no rule handles. | n/a | The switch can only change while no window is open (release all first), like the windows switch. |

---

## 3. Implementation phases

### Phase 0: prerequisite fixes (ship first, useful on their own)
- **R1:** in `_rejoin_uncut_1d`, if the joined length is at least the bar's full length
  (`_get_full_length`), and the chain root is a `stock_unit` piece, then:
  - `_restore_simple_stock(+1)`;
  - retire the leaf and the source piece (`whole bar returned to stock`);
  - create no offcut.
- **R2:** `_restore_all` builds a not-cut `ReversalDecisions` for every cut line of every item and
  passes it to `restore_stock_for_order_item`.
- Tests: T1, T2 (§4) with private holds still on, plus the existing edit and cancel suites.

### Phase 1: data model
- `server/migrate_add_provisional_offcuts.py`: add the column and GIN index; idempotent, like the
  other migrations.
- `entities/offcuts.py`: the field, plus a docstring stating rules 1 to 5.
- Feature setting `provisional_offcuts_enabled` (`system_settings`), default off. The switch requires
  zero open windows (R16).

### Phase 2: marks lifecycle (`core/inventory/holdScope.py`, renamed in docs to "provisional")
- `marks_for_piece(db, piece) -> set[int]`: walk `parent_piece_id` up to the root and collect
  `consumed_by_order_id` where that order is an open window (`status == 'held'`). Depth is small (a
  bar is rarely cut more than about 5 times).
- `refresh_marks(db, row)`: set `provisional_for` from the row's available pieces. Call it wherever
  a 1D row is created, merged or re-created:
  - `_upsert_offcut`
  - `_return_pooled_unit_for_piece` (R3)
  - rejoin
  - restore credit
- Merge rule: same `provisional_for` (R5).
- **Confirm** (`windowService._confirm`, replacing `publish_held_offcuts` for 1D):
  `UPDATE offcuts SET provisional_for = array_remove(provisional_for, :order)`.
- **Release** (`_close`): Phase 0's not-cut restore, then the same `array_remove`. Add the
  `bar_handed_over` summary when a rejoin happened (R10).

### Phase 3: visibility and source choice
- New `holdScope.visible_1d()`: `held_by_order_id IS NULL OR held_by_order_id = current window`.
  Marks never hide anything.
- Switch only the 1D **consumption** sites (R15):
  - `inventoryService` best fit (~920);
  - own-or-new bar (~944);
  - same-size tie rows (~967);
  - manual pick `assert_usable` (~1672);
  - `cutCorrection.profile_candidates` (~450): the incident came from a correction.
- Keep strict: `_remove_offcut`, the `_drop_pooled_unit_for_piece` fallback (R4), and every
  `glassOffcutService` site.
- Ranking (D1): best fit order becomes `(cardinality(provisional_for) > 0, length)`, i.e. ordinary
  offcuts first, then provisional, then a new bar.
- Rejoin: drop the `held_elsewhere` refusal for 1D (R6).
- Locks: offcut rows `FOR UPDATE` in ascending id; deadlock retry on checkout, edit and correction
  (R13).

### Phase 4: listings and screens
- Offcut picker (`products/service.py` ~685): include provisional rows with `provisional: [{order,
  window label, cashier}]`. `OffcutSelectorModal.jsx` shows a badge; the client's
  window-own-remainder logic is unchanged.
- Correction modals (`CorrectProfileOffcutModal.jsx`): the same badge.
- Offcut Management: list provisional rows read-only (R8).
- `held_stock` (manager view): add "borrowed from Window N" lines (R9).
- Worksheet (R7):
  - `_pending_source_notice` returns `in_window` and `bar_length`;
  - `cuttingInstructionFormat.js` renders "Take a {bar} bar (shared with Window N, not cut yet)";
  - the cutting queue asks the server for the current physical source when showing a line.

### Phase 5: live messaging (information only, never correctness)
- `ws/manager.broadcast(event, data=None)`: optional payload (today it sends `{type}` only).
- New event `offcuts_updated {variantIds}` on window cart save, confirm, release, expiry (sweeper in
  `main.py`), and any borrow of a provisional row. Pickers and stock screens refetch.
- `bar_handed_over {fromWindow, toOrder, variantId}`: the borrower's till shows "Window 2 was
  released - your 3ft now comes from the bar it opened. Nothing changes for the customer."
  Tills filter by their own windows or orders.
- Every rule in Phases 2 and 3 runs in the same transaction as the sale. A till that misses a
  message is only showing stale screens; stock stays correct.

### Phase 6: audit and integrity (`core/audit/integrity.py`)
New invariants:
- every id in `provisional_for` is an **open** window;
- `provisional_for` equals `marks_for_piece` for each available piece (the cache equals the
  derived value);
- no 1D row has `held_by_order_id` set while the feature is on;
- no 1D offcut is at least its bar's full length with a stock-bar root (catches R1 coming back).

---

## 4. Tests

New suite `test_provisional_offcuts.py` (isolated DB, same harness as `test_sale_windows_*`).
`integrity.check` and a per-order stock reconciliation run after every step.

| # | Scenario | Expect |
|---|---|---|
| T1 | R1 repro: opener reversed *not cut*, then borrower *not cut* (no windows) | Stock back to the start, no full-length offcut |
| T2 | R2 repro: window releases after a borrow | One 18ft joined piece, stock −1 carried by the borrower |
| T3 | The incident: window cuts 3ft, a correction borrows 3ft, window confirms | 1 bar, 15ft ordinary offcut |
| T4 | Same, window released instead | 1 bar, 18ft, `bar_handed_over` recorded |
| T5 | Window → window borrow, confirmed in either order | 1 bar, correct marks at every step |
| T6 | Both windows released, in both orders | Bar back in stock whole, no offcuts left |
| T7 | Borrower (confirmed) edited or cancelled while the holder is open | Piece goes back provisional (R3) |
| T8 | Borrower cut physically, then the holder released | Rejoin matches the rack: 18ft |
| T9 | Holder changes cart (3ft → 5ft, then removes it) after a borrow | Fits in the rest of the bar or takes a new source; no lost or duplicated length |
| T10 | Same-length provisional and ordinary rows side by side | Never merged; un-create retires the right one (R4, R5) |
| T11 | Ranking | Ordinary offcut preferred over provisional over a new bar |
| T12 | Idle expiry with a borrower | Same as T4; broadcast sent |
| T13 | Glass | Unchanged: still private (R15) |
| T14 | Concurrency: release and borrow at the same moment on one pool | One wins, the other retries, no deadlock surfaces |
| T15 | Undo of a sale that borrowed | Refused with a clear reason, or exact |
| T16 | Switch off/on with windows open | Refused (R16) |

Also re-run every existing backend suite (`tests/run_backend_tests.sh`) and the window browser suite.
Update the window tests that assert "release restores exactly what it took" to allow a recorded
handover.

---

## 5. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Ranking: a tighter provisional fit vs. a looser ordinary one | Ordinary first. Less tangling, and a small waste difference is cheaper than a confusing handover. |
| D2 | Can a window borrow from another window's provisional piece? | Yes, it is the main saving (two tills selling the same profile). |
| D3 | Does the cashier see who holds a provisional piece? | Yes: window label and cashier. |
| D4 | Can a cashier hand-pick a provisional piece? | Yes, with the badge. |

---

## 6. Rollout

1. Phase 0 alone: deploy, run `check_integrity.py` daily for a few days.
2. Phases 1 to 6 behind `provisional_offcuts_enabled` (off). Deploy, then switch on at a quiet time
   with no windows open.
3. Watch for a week: integrity check daily; review every `bar_handed_over` in op summaries against
   the cutting floor.
4. Rollback: release all windows, switch off. Rows lose their meaning only while a window is open,
   so nothing needs migrating back.

## 7. Today's case (independent of this plan)

Emirates' 3ft (#342, item 1015) is not cut yet. A cut correction on #342 onto the 16ft offcut
(#21643) returns the second bar (White 7 → 8). Do it before either bar is cut.
