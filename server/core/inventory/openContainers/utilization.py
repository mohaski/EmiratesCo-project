"""
CEO-facing utilization reporting for the open-container stock model.

Split out from service.py, which handles the manager's two write actions
(open / close). This module only reads, and answers a different question: once
packs are being opened and closed, what do they actually deliver?

Three figures matter, and they are deliberately kept apart rather than merged
into one "stock" number, because each is known with different confidence:

  - nominal_quantity   what the pack's label claims (e.g. "1000pcs"). A
                       marketing figure. Never trusted as a quantity anywhere.
  - units_sold         what was actually billed out of the pack. Exact, because
                       every sub-pack sale records itself against the pack
                       (inventoryService._dispense_from_open_container).
  - actual_quantity    what the pack physically yielded, if a manager measured
                       it at close. Optional, and the only direct evidence.

The gap between the last two is the interesting one: material that left a pack
without a sale recording it. That is waste, breakage, internal use or loss --
things the old counted model silently absorbed into a drifting piece count and
made impossible to see.
"""
from typing import List, Optional, Dict

from sqlmodel import Session, select

from entities.products import Product
from entities.variants import Variant
from entities.orders import Order
from entities.orderItems import OrderItem
from entities.users import User
from entities.openContainers import OpenContainer
from . import model
from .service import _to_response, _observed_yield


def _container_lines(details: Optional[dict]) -> List[dict]:
    lines = (details or {}).get("lineItems")
    return lines if isinstance(lines, list) else []


def _units_from_line(line: dict, container_id: int) -> float:
    """How much of `line` came out of this specific pack, per the sources the
    checkout recorded on it. Returns 0 for a line that never touched it."""
    total = 0.0
    for source in (line.get("stock_sources") or []):
        if source.get("source") == "open_container" and source.get("container_id") == container_id:
            total += float(source.get("stock_used", 0) or 0)
    return total


def container_usage(container_id: int, db: Session) -> model.ContainerUsageResponse:
    """Every sale that drew from one pack.

    Order lines store their stock sources inside a JSON column, so this can't be
    a plain indexed query. It is narrowed two ways before anything is inspected:
    to this pack's own product, and to orders placed at or after it was opened --
    a pack cannot have supplied a sale that predates it being broken open.
    """
    container = db.get(OpenContainer, container_id)
    if not container:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Open container not found")

    stmt = (
        select(OrderItem, Order)
        .join(Order, Order.orderId == OrderItem.order_id)
        .where(OrderItem.product_id == container.product_id)
    )
    if container.opened_at:
        stmt = stmt.where(Order.created_at >= container.opened_at)

    user_names: Dict[str, Optional[str]] = {}
    lines: List[model.ContainerUsageLine] = []

    for item, order in db.exec(stmt).all():
        units = 0.0
        revenue = 0.0
        for line in _container_lines(item.details):
            taken = _units_from_line(line, container_id)
            if taken <= 0:
                continue
            units += taken
            # A line can in principle draw from more than one source; bill only
            # the share that came from THIS pack rather than the whole line.
            line_qty = float(line.get("qty", 0) or 0)
            line_total = float(line.get("total", 0) or 0)
            revenue += line_total * (taken / line_qty) if line_qty > 0 else line_total
        if units <= 0:
            continue

        served_key = str(order.servedby)
        if served_key not in user_names:
            user = db.get(User, order.servedby)
            user_names[served_key] = user.username if user else None

        lines.append(model.ContainerUsageLine(
            order_id=order.orderId,
            item_id=item.item_id,
            customer_name=order.customer_name,
            served_by=user_names[served_key],
            sold_at=order.created_at,
            units=round(units, 4),
            revenue=round(revenue, 2),
            item_status=item.status,
        ))

    lines.sort(key=lambda l: (l.sold_at is None, l.sold_at))
    return model.ContainerUsageResponse(
        container=_to_response(db, container),
        lines=lines,
        total_units=round(sum(l.units for l in lines), 4),
        total_revenue=round(sum(l.revenue for l in lines), 2),
    )


def _revenue_by_container(db: Session, product_ids: List[int]) -> Dict[int, float]:
    """One pass over the relevant order lines, bucketing revenue per pack --
    so a utilization table covering many packs doesn't re-scan orders once per
    row the way calling container_usage in a loop would."""
    if not product_ids:
        return {}
    totals: Dict[int, float] = {}
    items = db.exec(select(OrderItem).where(OrderItem.product_id.in_(product_ids))).all()
    for item in items:
        for line in _container_lines(item.details):
            line_qty = float(line.get("qty", 0) or 0)
            line_total = float(line.get("total", 0) or 0)
            for source in (line.get("stock_sources") or []):
                if source.get("source") != "open_container":
                    continue
                cid = source.get("container_id")
                if cid is None:
                    continue
                taken = float(source.get("stock_used", 0) or 0)
                share = line_total * (taken / line_qty) if line_qty > 0 else line_total
                totals[cid] = totals.get(cid, 0.0) + share
    return totals


def variant_utilization(db: Session, product_id: Optional[int] = None) -> List[model.VariantUtilizationRow]:
    """Per-variant rollup across every pack ever opened.

    Includes variants with no sealed stock left: a line that has been fully
    consumed is exactly the one whose history a CEO wants to look at.
    """
    stmt = select(OpenContainer)
    if product_id:
        stmt = stmt.where(OpenContainer.product_id == product_id)
    containers = db.exec(stmt).all()
    if not containers:
        return []

    revenue_by_container = _revenue_by_container(
        db, sorted({c.product_id for c in containers})
    )

    by_variant: Dict[int, List[OpenContainer]] = {}
    for c in containers:
        if c.variant_id is None:
            continue  # variantless products can't be attributed to a SKU row
        by_variant.setdefault(c.variant_id, []).append(c)

    rows: List[model.VariantUtilizationRow] = []
    for variant_id, group in by_variant.items():
        variant = db.get(Variant, variant_id)
        product = db.get(Product, group[0].product_id)
        if not variant or not product:
            continue  # variant deleted since; its packs have nothing to hang off

        finished = [c for c in group if c.status == "finished"]
        # A pack closed without dispensing anything says nothing about yield --
        # it was closed for some other reason (damaged, wrong item, mis-opened).
        yields = [_observed_yield(c) for c in finished if _observed_yield(c) > 0]
        measured = [c for c in finished if c.actual_quantity is not None and c.actual_quantity > 0]
        unaccounted = [
            float(c.actual_quantity) - float(c.units_sold or 0.0)
            for c in measured
        ]

        avg_yield = round(sum(yields) / len(yields), 2) if yields else None
        nominal = variant.unit_quantity
        rows.append(model.VariantUtilizationRow(
            product_id=product.productId,
            product_name=product.name,
            variant_id=variant_id,
            variant_name=variant.name or None,
            unit=product.unit,
            nominal_quantity=nominal,
            packs_opened=len(group),
            packs_finished=len(finished),
            packs_open_now=len([c for c in group if c.status == "open"]),
            sealed_remaining=int(variant.stock_quantity or 0),
            avg_yield=avg_yield,
            min_yield=min(yields) if yields else None,
            max_yield=max(yields) if yields else None,
            yield_vs_label_pct=(
                round(avg_yield / float(nominal) * 100, 1)
                if avg_yield is not None and nominal else None
            ),
            measured_count=len(measured),
            total_unaccounted=round(sum(unaccounted), 2) if unaccounted else None,
            total_units_sold=round(sum(float(c.units_sold or 0.0) for c in group), 2),
            total_revenue=round(sum(revenue_by_container.get(c.id, 0.0) for c in group), 2),
        ))

    rows.sort(key=lambda r: (r.product_name, r.variant_name or "", r.variant_id))
    return rows
