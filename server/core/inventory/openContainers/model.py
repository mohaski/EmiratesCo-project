from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime


class OpenContainerCreate(BaseModel):
    """Break open one sealed pack of this variant. Quantity is always exactly
    one pack — opening is a physical act, done one roll/box at a time, and the
    whole model rests on that being an honest, countable event."""
    variant_id: Optional[int] = None
    notes: Optional[str] = None


class OpenContainerClose(BaseModel):
    """Mark the open pack physically empty. actual_quantity is what it really
    yielded, if the manager measured or counted it — optional, and never used
    as stock. It's the evidence that turns the nominal pack size into a real
    average over time (see service.yield_history)."""
    actual_quantity: Optional[float] = None
    notes: Optional[str] = None


class OpenContainerResponse(BaseModel):
    id: int
    product_id: int
    product_name: str
    variant_id: Optional[int] = None
    variant_name: Optional[str] = None
    attributes: Dict[str, Any] = {}
    pool_key: str
    unit: Optional[str] = None

    status: str
    opened_by_name: Optional[str] = None
    opened_at: Optional[datetime] = None
    closed_by_name: Optional[str] = None
    closed_at: Optional[datetime] = None

    nominal_quantity: Optional[float] = None
    units_sold: float = 0.0
    actual_quantity: Optional[float] = None
    notes: Optional[str] = None

    # ── Utilization, computed per row (see service._utilization) ──────────────
    # How long the pack has been (or was) in use. Shows how fast stock of this
    # kind actually turns over.
    duration_hours: Optional[float] = None
    # observed yield minus the labelled pack size. Negative = the pack held less
    # than the label claimed, which is exactly the problem that made counting
    # pieces unworkable in the first place.
    variance_vs_label: Optional[float] = None
    # Measured yield minus what was actually billed. Only meaningful once a
    # manager has entered a measured actual_quantity at close. Positive = units
    # physically left the pack that no sale ever recorded -- waste, breakage,
    # internal use or loss. This is the number worth watching.
    unaccounted_units: Optional[float] = None

    class Config:
        from_attributes = True


class OpenableVariantResponse(BaseModel):
    """One variant of an open-container product that has at least one sealed
    pack left to break open. `has_open` says whether this variant's pool is
    already dispensing — opening a second pack then is allowed but rarely
    intended, so the UI warns rather than blocks."""
    product_id: int
    product_name: str
    variant_id: int
    variant_name: Optional[str] = None
    attributes: Dict[str, Any] = {}
    unit: Optional[str] = None
    pool_key: str
    sealed_stock: int
    nominal_quantity: Optional[float] = None
    has_open: bool = False
    avg_yield: Optional[float] = None


class YieldHistoryEntry(BaseModel):
    container_id: int
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    units_sold: float
    actual_quantity: Optional[float] = None


class YieldHistoryResponse(BaseModel):
    """What packs of this variant have actually yielded. nominal_quantity is
    what the pack claims; avg_yield is what it delivered, which is the number
    this whole feature exists to discover."""
    variant_id: int
    nominal_quantity: Optional[float] = None
    sample_size: int
    avg_yield: Optional[float] = None
    min_yield: Optional[float] = None
    max_yield: Optional[float] = None
    entries: List[YieldHistoryEntry] = []


class ContainerUsageLine(BaseModel):
    """One sale that drew from a pack, reconstructed from the stock_sources
    recorded on the order line at checkout time (see
    inventoryService._dispense_from_open_container)."""
    order_id: int
    item_id: int
    customer_name: Optional[str] = None
    served_by: Optional[str] = None
    sold_at: Optional[datetime] = None
    units: float
    revenue: float = 0.0
    # 'purchased' | 'returned' -- a returned line's units were already rolled
    # back off the pack's tally, and it is listed so the gap is explicable.
    item_status: Optional[str] = None


class ContainerUsageResponse(BaseModel):
    container: OpenContainerResponse
    lines: List[ContainerUsageLine] = []
    total_units: float = 0.0
    total_revenue: float = 0.0


class VariantUtilizationRow(BaseModel):
    """Per-variant rollup across every pack ever opened of it -- the CEO view of
    whether a given item's packs deliver what they claim."""
    product_id: int
    product_name: str
    variant_id: int
    variant_name: Optional[str] = None
    unit: Optional[str] = None

    nominal_quantity: Optional[float] = None
    packs_opened: int = 0
    packs_finished: int = 0
    packs_open_now: int = 0
    sealed_remaining: int = 0

    # Averaged over finished packs only -- an open pack hasn't finished yielding.
    avg_yield: Optional[float] = None
    min_yield: Optional[float] = None
    max_yield: Optional[float] = None
    # avg_yield as a percentage of the labelled pack size. Under 100% means packs
    # consistently deliver less than the label.
    yield_vs_label_pct: Optional[float] = None
    # How many finished packs were actually measured at close. The yield figures
    # lean on the billed tally for the rest, so a low number here means the
    # averages understate real usage.
    measured_count: int = 0
    total_unaccounted: Optional[float] = None

    total_units_sold: float = 0.0
    total_revenue: float = 0.0
