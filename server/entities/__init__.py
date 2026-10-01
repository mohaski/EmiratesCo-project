from .users import User
from .customers import Customer
from .products import Product
from .variants import Variant
from .attributes import AttributeClass, AttributeValue
from .invoices import Invoice      # Must be before Order (Order has FK → invoices)
from .orders import Order
from .orderItems import OrderItem
from .offcuts import Offcut
from .offcutLedger import OffcutPiece, OffcutPieceEvent  # after Offcut (advisory offcut_row_id link)
from .openContainers import OpenContainer
from .payments import Payment
from .credits import Credit
from .messages import Message, MessageRecipient
from .editHistory import EditHistory
from .settings import SystemSetting
from .tools import Tool, ToolLoan, ToolLoanItem
from .stockInputSession import StockInputSession, StockInputSessionItem
from .opJournal import StockOperation, JournalEntry, StockBaseline

__all__ = [
    "User",
    "Customer",
    "Product",
    "Variant",
    "AttributeClass",
    "AttributeValue",
    "Invoice",
    "Order",
    "OrderItem",
    "Offcut",
    "OffcutPiece",
    "OffcutPieceEvent",
    "OpenContainer",
    "Payment",
    "Credit",
    "Message",
    "MessageRecipient",
    "EditHistory",
    "SystemSetting",
    "Tool",
    "ToolLoan",
    "ToolLoanItem",
    "StockInputSession",
    "StockInputSessionItem",
    "StockOperation",
    "JournalEntry",
    "StockBaseline",
]

# Registers the after_flush hook that journals every stock-affecting row change. Imported
# here, after every entity, so no session can flush before the hook exists.
from core.audit import journal as _journal  # noqa: E402,F401
