from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID

class OrderItemRequest(BaseModel):
    productId: int
    variantId: Optional[int] = None
    quantity: float
    unitType: Optional[str] = None
    unitPrice: float
    details: Optional[Dict[str, Any]] = None
    totalPrice: Optional[float] = 0.0

class OrderCreate(BaseModel):
    customerId: Optional[int] = None
    customerName: Optional[str] = None   # walk-in customer's provided name, when customerId is not set
    amountPaid: float = 0.0
    # totalAmount is now calculated by backend
    # totalAmount: float = 0.0 
    parentOrderId: Optional[int] = None
    sourceInvoiceId: Optional[int] = None   # set when converting an invoice at checkout
    servedBy: UUID
    VAT_status: bool = False
    discount: Optional[float] = 0.0
    paymentStatus: str
    
    # New Fields
    status: Optional[str] = "pending"
    paymentMethod: Optional[str] = None
    paymentDetails: Optional[Dict[str, Any]] = None
    total: float = 0.0
    
    # Nested Items
    items: List[OrderItemRequest] = []

class OrderCreateResponse(BaseModel):
    message: str
    orderId: int
    # Gap-free receipt number (core/ordering/orderNumbers.py). None only for responses
    # about an order that has not been confirmed yet.
    orderNo: Optional[int] = None

class OrderResponse(BaseModel):
    orderId: int
    orderNo: Optional[int] = None   # the number to show people; see OrderCreateResponse
    customerId: Optional[int] = None
    customerName: Optional[str] = None
    customerType: Optional[str] = None
    customerPhone: Optional[str] = None
    amountPaid: float
    # Maps to subtotal or a generic total
    totalAmount: float
    parentOrderId: Optional[int] = None
    servedBy: Optional[UUID] = None
    VAT_status: bool
    discount: Optional[float] = 0.0
    paymentStatus: str
    created_at: str

    # New Fields
    status: str
    paymentMethod: Optional[str] = None
    balance: float = 0.0
    subtotal: float = 0.0
    total: float = 0.0
    source_invoice_id: Optional[int] = None
    items: List["OrderItemResponse"] = []
    
class OrderUpdateRequest(BaseModel):
    amountPaid: Optional[float] = None
    totalAmount: Optional[float] = None    
    status: Optional[str] = None


########orderItem model###########

class OrderItemCreate(BaseModel):
    orderId: int
    productId: int
    variantId: Optional[int] = None
    quantity: float 
    unitType: Optional[str] = None
    unitPrice: float 
    totalAmount: float
    details: Optional[Dict[str, Any]] = None
    
class OrderItemCreateResponse(BaseModel):
    message: str
    orderItemId: List[int]
    
class OrderItemResponse(BaseModel):
    itemId: Optional[int] = None
    productId: int
    orderId: int
    variantId: Optional[int] = None
    quantity: float
    unitType: Optional[str] = None
    unitPrice: float
    totalPrice: float
    details: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    cuttingCompleted: bool = True
    cuttingCompletedAt: Optional[str] = None
    
class totalPriceRequest(BaseModel):
    quantity: float
    unitPrice: float
    
class OrderItemStatusUpdateResponse(BaseModel):
    message: str

class OrderStatusUpdateResponse(BaseModel):
    message: str

class OrderCancelRequest(BaseModel):
    """Payload for cancelling an order — requires the CEO-configured PIN.
    refundMethod/refundDetails: how the cashier is handing back whatever was
    already collected (cash/mpesa/split, with a {cash, mpesa} breakdown for
    split) — optional since a fully-unpaid order has nothing to refund; when
    omitted on a paid order, the backend falls back to whatever method that
    order was last paid through."""
    pin: str
    refundMethod: Optional[str] = None
    refundDetails: Optional[Dict[str, Any]] = None
    # {line_ref: {physicalState, resolution}} — the operator's answer per cut line, keyed
    # by the line_ref from GET /orders/{id}/reversal-plan. Optional: lines that need no
    # judgement fall back to their prefilled default, so an order with nothing cut yet
    # cancels with no payload at all.
    cutConfirmations: Optional[Dict[str, Dict[str, Any]]] = None
    # Staleness tag from the reversal plan these confirmations were made against. When
    # given and no longer current, the request is refused with 409 and a fresh plan.
    planToken: Optional[str] = None

class OrderEditRequest(BaseModel):
    """Payload for editing an existing order (replaces items + recalculates)."""
    customerId: Optional[int] = None
    customerName: Optional[str] = None   # walk-in customer's provided name, when customerId is not set
    amountPaid: float = 0.0
    servedBy: UUID
    VAT_status: bool = False
    discount: Optional[float] = 0.0
    paymentStatus: str
    paymentMethod: Optional[str] = None
    paymentDetails: Optional[Dict[str, Any]] = None
    items: List[OrderItemRequest] = []
    notes: Optional[str] = None
    # See OrderCancelRequest.cutConfirmations / planToken — same shape, same rules.
    cutConfirmations: Optional[Dict[str, Dict[str, Any]]] = None
    planToken: Optional[str] = None

class OffcutRemainderInput(BaseModel):
    """One corrected remainder piece (width/height in mm). status defaults to
    the product's own min-usable-dimension classification if omitted."""
    width: float
    height: float
    status: Optional[str] = None

class FailedCutRef(BaseModel):
    """One missed cut, addressed by which cut-line it actually belongs to —
    not necessarily the line whose event owns the recorded consumption (see
    CorrectOffcutRequest.failed_cuts)."""
    line_idx: int
    cut_idx: int

class CorrectOffcutRequest(BaseModel):
    """Payload for correcting a single owning offcut_sources event on an order
    line — replaces the remainders that cutting event recorded with what the
    manager says actually came out of it. failed_cuts marks any delivered cuts
    that never actually came out of this source — those get pulled out and
    re-resolved against a replacement offcut/sheet (forced_offcut_id overrides
    the auto-suggestion). A physical sheet joint-packed across several of this
    OrderItem's cut-lines (see glassOffcutService._apply_candidate's
    owns_consumption/group_id) splits into one owning event (line_idx/event_idx
    below) plus a non-owning stub per sibling line — each failed_cuts entry's
    own line_idx says which of those lines that particular missed piece came
    from, so a sibling line's cut can be flagged too, not just the owner's."""
    item_id: int
    line_idx: int
    event_idx: int
    new_remainders: List[OffcutRemainderInput]
    failed_cuts: List[FailedCutRef] = []
    forced_offcut_id: Optional[int] = None
    notes: Optional[str] = None

class CorrectOffcutResponse(BaseModel):
    message: str
    before: List[Dict[str, Any]]
    after: List[Dict[str, Any]]
    replacement_events: List[Dict[str, Any]] = []

class CorrectProfileOffcutRequest(BaseModel):
    """Payload for correcting a single 1D (bar/profile) offcut_sources entry —
    the 1D analogue of CorrectOffcutRequest. new_remainder_length always
    describes the corrected remainder of the RECORDED source (mirrors
    CorrectOffcutRequest.new_remainders — always applied, required, 0 means
    nothing usable was left, e.g. full offcut_length if none of it was
    really used). replace_source separately marks that length_used didn't
    actually come from that source — this resolves an independent
    replacement, never touching the original event's own remainder logic
    above; forced_offcut_id overrides the auto-suggested replacement."""
    item_id: int
    line_idx: int
    event_idx: int
    new_remainder_length: float
    replace_source: bool = False
    forced_offcut_id: Optional[int] = None
    notes: Optional[str] = None

class CorrectProfileOffcutResponse(BaseModel):
    message: str
    before: Dict[str, Any]
    after: Dict[str, Any]
    replacement_event: Optional[Dict[str, Any]] = None

class MarkCuttingDoneRequest(BaseModel):
    """Batch report: floor staff report a batch of already-finished cutting jobs
    at once, not one at a time."""
    item_ids: List[int]

class MarkCuttingDoneResponse(BaseModel):
    updated: List[int]

class PendingCuttingItem(BaseModel):
    """One still-pending item within a PendingCuttingOrder row."""
    itemId: int
    productName: str
    details: Optional[Dict[str, Any]] = None

class PendingCuttingOrder(BaseModel):
    """One row on the cutting queue — a whole order carrying 1+ items still
    awaiting a cutting report. The queue is checked off order-by-order, not
    item-by-item (see mark_cutting_complete_for_orders_batch)."""
    orderId: int
    orderNo: Optional[int] = None
    customerName: Optional[str] = None
    items: List[PendingCuttingItem] = []

class MarkOrdersCuttingDoneRequest(BaseModel):
    """Order-queue batch report: mark every still-pending item across the given
    orders as cut, and each order itself as completed."""
    order_ids: List[int]

class MarkOrdersCuttingDoneResponse(BaseModel):
    updated_orders: List[int]
    updated_items: List[int]

class ReversalBlocker(BaseModel):
    """Another order that has since cut into this line's material, which is why a whole
    bar/sheet can't be returned for it."""
    piece_id: Optional[int] = None
    order_id: Optional[int] = None
    # None while the holder is an open sale window (not an order yet).
    order_no: Optional[int] = None
    item_id: Optional[int] = None
    customer_name: Optional[str] = None
    size: Optional[str] = None
    depth: Optional[int] = None


class ReversalChainPiece(BaseModel):
    """One node of the physical chain, for the bar/sheet visualisation."""
    piece_id: int
    parent_piece_id: Optional[int] = None
    depth: int = 0
    size: Optional[str] = None
    state: Optional[str] = None
    is_scrap: bool = False
    origin: Optional[str] = None
    holder: Optional[Dict[str, Any]] = None


class ReversalChain(BaseModel):
    root_piece_id: Optional[int] = None
    pieces: List[ReversalChainPiece] = []


class ReversalPlanLine(BaseModel):
    """One cut line awaiting physical confirmation before an edit or cancel."""
    line_ref: str
    item_id: int
    line_idx: int
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    variant_name: Optional[str] = None
    line_type: Optional[str] = None
    is_2d: bool = False
    cut_description: Optional[str] = None
    event_count: int = 0
    default_physical_state: str
    requires_explicit_answer: bool = False
    allowed_resolutions: List[str] = []
    default_resolution: Optional[str] = None
    reconstructable: bool = False
    legacy: bool = False
    blockers: List[ReversalBlocker] = []
    effect_if_not_cut: Optional[str] = None
    effect_if_already_cut: Optional[str] = None
    chain: Optional[ReversalChain] = None
    # False when an edit leaves this item untouched, so its material never moves and it
    # needs no answer. Always True for a cancel.
    will_reverse: bool = True
    # Lines cut from the same physical sheet share this value (None when a line has its
    # sheet to itself). They are one piece of glass, so they take one cut/not-cut answer.
    sheet_group: Optional[str] = None


class ReversalPlanRequest(BaseModel):
    """The cart an edit is about to submit. Lets the plan narrow itself to the items that
    edit will actually disturb, so the operator is only asked about material that moves.
    Omit it (or use the GET form) for a cancel, which reverses everything."""
    items: List[OrderItemRequest] = []


class ReversalPlanResponse(BaseModel):
    """Read-only preview of what reversing an order's cuts would do."""
    order_id: int
    order_status: str
    has_cut_lines: bool = False
    all_defaults_safe: bool = True
    can_edit: bool = True
    can_cancel: bool = True
    # Submit this back with the edit/cancel so the server can tell whether the material
    # moved while the operator was confirming.
    plan_token: Optional[str] = None
    lines: List[ReversalPlanLine] = []
    warnings: List[str] = []


class EditHistoryResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    edited_by: str
    edited_at: str
    action: str
    before_snapshot: Dict[str, Any]
    after_snapshot: Dict[str, Any]
    notes: Optional[str] = None
    # For an order event, that order's number as people know it (entity_id is its internal id).
    order_no: Optional[int] = None

    class Config:
        from_attributes = True


