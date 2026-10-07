"""Provisional offcuts: worksheets stay right when MANY sales share one bar.

Every scenario runs with the switch on, on one 21ft bar, with 3 to 8 sale windows and checkouts
cutting from it in mixed orders, each window then confirmed or released in a mixed order. Then:

  FLOOR   a simulated cutter takes the confirmed sales in the order they were confirmed (the
          cutting queue) and does exactly what each worksheet says: "New bar" takes a bar from
          stock; any other source must be a piece that is really on the rack (a leftover of an
          earlier cut, or an offcut that was there); every CUT/KEEP must add up.
          At the end: bars taken == stock drop, and the rack == the system's offcut pool.
  STABLE  a worksheet looks the same at the end as when its sale was confirmed (one printed
          at the till never goes stale)
  MINIMAL a new bar is opened only when no piece in the pool - ordinary or provisional, any
          window's - is long enough for the cut, however many windows share the bar
  CLEAN   the integrity check (provisional invariants included) after every step
  FAST    working a worksheet out stays cheap on a heavily shared bar (queries and time)

  A1-A9  hand-picked orders (confirm in order / reversed / mixed with releases / checkouts in
         between / sales with several cuts on the bar / everything released)
  R      100 seeded random scenarios, 3-8 windows each (some need a second bar)
  P      8 windows + 8 checkouts on one bar: per-worksheet query count and time

Runs on emiratesco_edit_test (DATABASE_URL). Run from server/.
"""
import logging
import os
import random
import sys
import time
import uuid

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from sqlalchemy import event
from sqlmodel import Session, select, text

import entities  # noqa: F401
from db.database import engine
from entities.offcuts import Offcut
from entities.orders import Order
from entities.products import Category

with Session(engine) as _db:
    assert _db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test", "test DB only"

import test_sale_windows as T  # noqa: E402
from test_sale_windows import open_w, set_cart, confirm, release, stock, cut, FakeUser, FULL_BAR  # noqa: E402
from core.audit import integrity  # noqa: E402
from core.ordering import model, orderService  # noqa: E402

failures = []
SCEN = {"n": 0}


def check(label, ok, got=None):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f" — got {got!r}"))
    if not ok:
        failures.append(label)


def set_flag(db, value):
    db.exec(text("INSERT INTO system_settings (key, value) VALUES ('provisional_offcuts_enabled', :v) "
                 "ON CONFLICT (key) DO UPDATE SET value = :v").bindparams(v=value))
    db.commit()


def rebaseline(db):
    db.exec(text("DELETE FROM stock_baseline"))
    last = db.exec(text("SELECT coalesce(max(id), 0) FROM stock_journal")).one()[0]
    for table, col in (("variants", '"variantId"'), ("products", '"productId"')):
        db.exec(text(f"INSERT INTO stock_baseline (table_name, row_pk, quantity, taken_at, after_journal_id) "
                     f"SELECT '{table}', {col}::text, coalesce(stock_quantity, 0), now() at time zone 'utc', :last "
                     f"FROM {table}").bindparams(last=last))
    db.commit()
    return last


def checkout(db, user, items):
    return orderService.create_order(model.OrderCreate(
        servedBy=uuid.UUID(FakeUser(user).userId), status="confirmed", items=items, amountPaid=0), db, FakeUser(user))


def worksheet(db, order_id) -> list:
    """What the cutter is told for each bar cut of an order, as the worksheet shows it:
    (needs: None = a new bar, else the length of the piece to take), cut, keep."""
    db.expire_all()
    o = orderService.get_order_by_orderId(order_id, db)
    out = []
    for it in sorted(o.items, key=lambda i: i.itemId):
        for line in (it.details or {}).get("lineItems") or []:
            for s in line.get("offcut_sources") or []:
                if s.get("superseded") or "cuts" in s:
                    continue
                p = s.get("physical")
                if p:
                    needs = None if p["kind"] == "new_bar" else round(p["length"], 3)
                    keep = round(p["keep"], 3)
                else:
                    needs = None if s["source"] == "full_bar" else round(float(s["offcut_length"]), 3)
                    keep = round(float(s.get("remainder_created") or 0), 3)
                out.append((needs, round(float(s["length_used"]), 3), keep))
    return out


def pool(db, product) -> list:
    db.expire_all()
    return sorted(round(r.length, 3) for r in db.exec(select(Offcut).where(
        Offcut.product_id == product.productId, Offcut.quantity > 0)).all() for _ in range(r.quantity))


class Bar:
    """One scenario: a 21ft bar product, the sales on it, and what each worksheet said when its
    sale was confirmed."""

    def __init__(self, db, cat, name, users):
        self.db, self.users = db, users
        SCEN["n"] += 1
        self.bar, self.bv = T.seed_product(db, cat, f"{name} #{SCEN['n']}", kind="bar", stock=5)
        self.start = 5
        self.since = rebaseline(db)
        self.windows = {}        # label -> window response
        self.sold = []           # order ids of confirmed sales
        self.printed = {}        # order id -> worksheet when it was confirmed
        self.cuts = 0.0          # total length the confirmed sales cut
        self.wasteful = []       # cuts that opened a bar while a piece that fits was there

    def _bars_needed(self, length, qty):
        """How many new bars `qty` cuts of `length` need from the pool as it is now, choosing the
        way the engine must (decision D1): the shortest ORDINARY piece that fits, else the
        shortest provisional one, else a new bar. A leftover below min_usable (1ft) is scrap."""
        self.db.expire_all()
        pieces = [(bool(r.provisional_for), r.length) for r in self.db.exec(select(Offcut).where(
            Offcut.product_id == self.bar.productId, Offcut.quantity > 0, Offcut.status == "available")).all()
            for _ in range(r.quantity)]
        bars = 0
        for _ in range(qty):
            fits = sorted(p for p in pieces if p[1] >= length - 0.001)
            if fits:
                pieces.remove(fits[0])
                provisional, left = fits[0][0], round(fits[0][1] - length, 4)
            else:
                bars += 1
                provisional, left = True, round(FULL_BAR - length, 4)
            if left >= 1.0:
                pieces.append((provisional, left))
        return bars

    def _cutting(self, label, length, qty, do):
        need, before = self._bars_needed(length, qty), stock(self.db, self.bv)
        out = do()
        used = before - stock(self.db, self.bv)
        if used > need:
            self.wasteful.append(f"{label} ({qty} x {length}ft) opened {used} bar(s) where the pool needed {need}")
        return out

    def _clean(self, step):
        res = integrity.check(self.db, since_journal_id=self.since)
        if res["errors"]:
            return f"integrity after {step}: {res['errors'][:3]}"
        return None

    def window(self, label, length, qty=1, user=None):
        # The cashier with the fewest open windows here (each may hold at most 3).
        u = user or min(self.users, key=lambda x: sum(1 for (wu, _, _) in self.windows.values() if wu is x))
        w = self._cutting(f"window {label}", length, qty,
                          lambda: set_cart(self.db, u, open_w(self.db, u), [cut(self.bar, self.bv, length, qty=qty)]))
        self.windows[label] = (u, w, length * qty)
        return self._clean(f"window {label} cut {qty} x {length}")

    def checkout(self, length, qty=1, user=None):
        u = user or self.users[0]
        o = self._cutting("checkout", length, qty, lambda: checkout(self.db, u, [cut(self.bar, self.bv, length, qty=qty)]))
        self.sold.append(o.orderId)
        self.cuts += length * qty
        self.printed[o.orderId] = worksheet(self.db, o.orderId)
        return self._clean(f"checkout {length}")

    def close(self, label, how):
        u, w, length = self.windows.pop(label)
        if how == "confirm":
            res = confirm(self.db, u, w)
            self.sold.append(res.orderId)
            self.cuts += length
            self.printed[res.orderId] = worksheet(self.db, res.orderId)
        else:
            release(self.db, u, w)
        return self._clean(f"{how} {label}")

    def verify(self) -> list:
        """FLOOR + STABLE + MINIMAL; returns problems (empty = all good)."""
        db, problems = self.db, []
        order_of = {o.orderId: o for o in db.exec(select(Order).where(Order.orderId.in_(self.sold))).all()}
        rack, bars = [], 0
        for oid in sorted(self.sold, key=lambda i: (order_of[i].created_at, i)):
            sheet = worksheet(db, oid)
            if sheet != self.printed[oid]:
                problems.append(f"order {oid}: worksheet changed since it was confirmed: {self.printed[oid]} -> {sheet}")
            for needs, used, keep in sheet:
                if needs is None:
                    bars += 1
                    piece = FULL_BAR
                else:
                    match = next((i for i, l in enumerate(rack) if abs(l - needs) < 0.01), None)
                    if match is None:
                        problems.append(f"order {oid}: told to take a {needs}ft piece, the rack has {sorted(rack)}")
                        continue
                    piece = rack.pop(match)
                if abs(piece - used - keep) > 0.01:
                    problems.append(f"order {oid}: {piece} - cut {used} != keep {keep}")
                if keep > 0.01:
                    rack.append(round(keep, 3))
        drop = self.start - stock(db, self.bv)
        if bars != drop:
            problems.append(f"bars taken on the floor {bars} != stock drop {drop}")
        if sorted(rack) != pool(db, self.bar):
            problems.append(f"rack {sorted(rack)} != system pool {pool(db, self.bar)}")
        problems += self.wasteful
        return problems


def run_steps(b: Bar, steps) -> list:
    for step in steps:
        kind = step[0]
        err = (b.window(step[1], step[2], *step[3:]) if kind == "w" else b.checkout(step[1], *step[2:]) if kind == "c"
               else b.close(step[1], kind))
        if err:
            return [err]
    return b.verify()


def named(db, cat, users):
    print("A   Hand-picked: many sales on one bar")
    cases = {
        "A1 3 windows, confirmed in the order they opened": [
            ("w", "W1", 3.0), ("w", "W2", 3.0), ("w", "W3", 3.0),
            ("confirm", "W1"), ("confirm", "W2"), ("confirm", "W3")],
        "A2 3 windows, confirmed in REVERSE order": [
            ("w", "W1", 3.0), ("w", "W2", 3.0), ("w", "W3", 3.0),
            ("confirm", "W3"), ("confirm", "W2"), ("confirm", "W1")],
        "A3 4 windows, two released, the others confirmed last-first": [
            ("w", "W1", 2.0), ("w", "W2", 4.0), ("w", "W3", 3.0), ("w", "W4", 5.0),
            ("release", "W2"), ("confirm", "W3"), ("release", "W4"), ("confirm", "W1")],
        "A4 3 windows with checkouts cutting in between, mixed closes": [
            ("w", "W1", 3.0), ("c", 2.0), ("w", "W2", 4.0), ("c", 1.5), ("w", "W3", 2.5),
            ("release", "W2"), ("confirm", "W1"), ("c", 2.0), ("release", "W3")],
        "A5 5 windows and a checkout, the opener released first, the rest confirmed": [
            ("w", "W1", 3.0), ("w", "W2", 2.0), ("c", 3.0), ("w", "W3", 2.0), ("w", "W4", 1.5), ("w", "W5", 2.5),
            ("release", "W1"), ("confirm", "W4"), ("confirm", "W2"), ("confirm", "W5"), ("confirm", "W3")],
        "A7 a checkout making 3 cuts and a window making 2, on a bar a window opened": [
            ("w", "W1", 3.0), ("c", 2.0, 3), ("w", "W2", 1.5, 2), ("confirm", "W2"), ("release", "W1")],
        "A8 the opener confirmed after a 3-cut checkout and a 2-cut window": [
            ("w", "W1", 3.0), ("c", 2.0, 3), ("w", "W2", 1.5, 2), ("release", "W2"), ("confirm", "W1")],
        "A9 a released piece goes back ONTO the bar's other leftover, not beside it": [
            # Two windows' uncut lengths each become the bar's leftover while the other is being
            # cut from; releasing the cutter puts its piece back - one 3ft on the rack, not two 1.5s.
            ("w", "W1", 1.5), ("w", "W2", 1.5), ("w", "W3", 3.5), ("w", "W4", 2.0), ("w", "W5", 3.5),
            ("w", "W6", 2.5), ("c", 3.0), ("c", 3.5), ("release", "W6"), ("c", 2.5), ("w", "W7", 2.5),
            ("release", "W1"), ("w", "W8", 1.5), ("confirm", "W4"), ("release", "W7"), ("release", "W2"),
            ("release", "W8"), ("confirm", "W5"), ("confirm", "W3")],
        "A6 everything released: the bar goes back to stock whole": [
            ("w", "W1", 3.0), ("w", "W2", 3.0), ("w", "W3", 3.0),
            ("release", "W2"), ("release", "W1"), ("release", "W3")],
    }
    for label, steps in cases.items():
        b = Bar(db, cat, label[:2], users)
        problems = run_steps(b, steps)
        check(label, problems == [], problems[:3])
        T.close_all(db)


def randomized(db, cat, users, scenarios=100):
    print(f"R   {scenarios} random scenarios: 3-8 windows and 0-3 checkouts per bar, random closing order")
    rng = random.Random(20261008)
    bad = 0
    sizes = {}
    for n in range(scenarios):
        windows = rng.randint(3, 8)
        checkouts = rng.randint(0, 3)
        lengths = [rng.choice([1.5, 2.0, 2.5, 3.0, 3.5]) for _ in range(windows + checkouts)]
        steps, open_labels, opened = [], [], 0
        events = ["w"] * windows + ["c"] * checkouts
        rng.shuffle(events)
        events = ["w"] + events[1:] if "w" in events and events[0] != "w" else events  # a window opens the bar first
        closers = []
        for i, e in enumerate(events):
            if e == "w":
                opened += 1
                label = f"W{opened}"
                steps.append(("w", label, lengths[i], rng.choice([1, 1, 1, 2])))
                open_labels.append(label)
            else:
                steps.append(("c", lengths[i], rng.choice([1, 1, 2])))   # sometimes 2 cuts in one sale
            # sometimes close a window right away, between later sales
            if open_labels and rng.random() < 0.25:
                lab = open_labels.pop(rng.randrange(len(open_labels)))
                steps.append((rng.choice(["confirm", "release"]), lab))
        rng.shuffle(open_labels)
        for lab in open_labels:
            steps.append((rng.choice(["confirm", "confirm", "release"]), lab))
        b = Bar(db, cat, "R", users)
        problems = run_steps(b, steps)
        sizes[windows] = sizes.get(windows, 0) + 1
        if problems:
            bad += 1
            check(f"scenario {n}: {steps}", False, problems[:3])
        T.close_all(db)
    check(f"{scenarios} random scenarios ({', '.join(f'{k} windows: {v}' for k, v in sorted(sizes.items()))}): "
          "every worksheet followable, stable, no needless bar, pool matches", bad == 0, f"{bad} failed")


def performance(db, cat, users):
    print("P   8 windows + 8 checkouts on one bar: what a worksheet costs")
    b = Bar(db, cat, "P", users)
    steps = []
    for i in range(8):
        steps += [("w", f"W{i + 1}", 1.2), ("c", 1.0)]
    for i in (5, 2, 7, 0, 3, 6, 1, 4):            # confirm/release in a scrambled order
        steps.append(("confirm" if i % 3 else "release", f"W{i + 1}"))
    problems = run_steps(b, steps)
    check("16 sales on one bar: every worksheet followable, stable, no needless bar, pool matches", problems == [], problems[:3])

    counter = {"n": 0}

    def count(*_a, **_k):
        counter["n"] += 1
    event.listen(engine, "before_cursor_execute", count)
    worst_q, worst_t = 0, 0.0
    try:
        for oid in b.sold:
            with Session(engine) as fresh:        # a fresh request: nothing cached
                counter["n"] = 0
                t0 = time.perf_counter()
                orderService.get_order_by_orderId(oid, fresh)
                worst_t = max(worst_t, time.perf_counter() - t0)
                worst_q = max(worst_q, counter["n"])
    finally:
        event.remove(engine, "before_cursor_execute", count)
    print(f"    worst worksheet: {worst_q} queries, {worst_t * 1000:.0f} ms ({len(b.sold)} sales on the bar)")
    check("a worksheet on a 16-sale bar takes at most 80 queries", worst_q <= 80, worst_q)
    check("...and under 0.5 s", worst_t < 0.5, round(worst_t, 3))


def main():
    with Session(engine) as db:
        T.reset(db)
        cat = Category(name="Provisional Worksheets", type="ke-profile", sub_categories=[])
        db.add(cat)
        users = [T.seed_user(db, f"pw-{n}") for n in ("alice", "bob", "carol", "dan")]
        db.commit()
        set_flag(db, "true")
        try:
            named(db, cat, users)
            randomized(db, cat, users)
            performance(db, cat, users)
        finally:
            T.close_all(db)
            set_flag(db, "false")

    print("\n" + "=" * 68)
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"   - {f[:300]}")
        raise SystemExit(1)
    print("All provisional-worksheet checks passed.")


if __name__ == "__main__":
    main()
