from sqlmodel import SQLModel, Field
from sqlalchemy import func
from typing import Optional
from datetime import datetime
from uuid import UUID


class OpenContainer(SQLModel, table=True):
    """A single sealed pack (a roll of rubber, a box of screws) that a manager
    has physically broken open to dispense from.

    Exists because the "counted" packaged model (Variant.unit_quantity +
    inventoryService._deduct_packaged_stock_pooled) assumes a pack holds an
    EXACT, known number of pieces. For a lot of real accessory stock that's
    false — rubber rolls run long or short, a "box" of screws is sold by
    weight — so any piece-level count below the pack is fiction, and enforcing
    it either blocks real sales ("short by N pieces" while material is on the
    floor) or permits phantom ones after the roll is physically empty.

    Under Product.unit_stock_mode == 'open_container' the system therefore
    tracks only what it can actually count — SEALED packs, in
    Variant.stock_quantity — and stops tracking quantity below that level.
    Opening one moves it out of sealed stock into a row here; unit/metre/piece
    sales are then recorded against this row WITHOUT decrementing any
    quantity, and the manager closes it when the physical pack runs out.

    units_sold is therefore telemetry, not stock: it never gates a sale. Its
    value is historical — the yield of finished containers is the only honest
    estimate of what a pack of this variant actually holds (see
    openContainers/service.py's yield_history).
    """
    __tablename__ = "open_containers"

    id: Optional[int] = Field(default=None, primary_key=True)

    product_id: int = Field(foreign_key="products.productId", index=True)
    # Which SKU's sealed pack was broken open. Unlike Offcut.variant_id this is
    # NOT merely provenance — closing/cancelling returns the pack to exactly
    # this variant's stock_quantity.
    variant_id: Optional[int] = Field(default=None, foreign_key="variants.variantId", index=True)
    # Groups containers with the variants that may dispense from them, using the
    # same rule as every offcut pool — see core/inventory/poolKey.py. A sale on a
    # sibling variant that differs only by pack size draws from the same open pack.
    pool_key: str = Field(default="", nullable=False, index=True)

    # 'open'     — physically broken open, dispensing
    # 'finished' — physically empty, closed by a manager
    status: str = Field(default="open", index=True)

    opened_by: Optional[UUID] = Field(default=None, foreign_key="users.userId", index=True)
    opened_at: datetime = Field(sa_column_kwargs={"server_default": func.now()}, index=True)
    closed_by: Optional[UUID] = Field(default=None, foreign_key="users.userId")
    closed_at: Optional[datetime] = Field(default=None)

    # Variant.unit_quantity snapshotted at open time (e.g. 100 for a "100m roll").
    # DISPLAY ONLY — the whole point of this model is that the real figure varies,
    # so no code path may ever treat this as an available quantity.
    nominal_quantity: Optional[float] = Field(default=None)
    # Running tally of units dispensed from this pack. Advisory — see class docstring.
    units_sold: float = Field(default=0.0)
    # What the pack actually yielded, if the manager measured it at close time.
    actual_quantity: Optional[float] = Field(default=None)

    notes: Optional[str] = Field(default=None)
