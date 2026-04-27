from fastapi import APIRouter, Depends, Query
from typing import List, Optional
from sqlmodel import Session

from db.database import get_session
from core.userManagement.authService import get_current_user
from core.userManagement.model import TokenData
from . import model, service

router = APIRouter(prefix="/invoices", tags=["Invoices"])


@router.post("/", response_model=model.InvoiceCreateResponse)
def create_invoice(
    data: model.InvoiceCreate,
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """Create a new invoice (quotation/draft)."""
    return service.create_invoice(data, current_user.userId, db)


@router.get("/", response_model=List[model.InvoiceResponse])
def list_invoices(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = Query(None, description="Filter by status: draft|sent|converted|cancelled"),
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """List invoices, newest first. Optionally filter by status."""
    return service.list_invoices(skip, limit, status, db)


@router.get("/{invoice_id}", response_model=model.InvoiceResponse)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """Get a single invoice by ID."""
    return service.get_invoice(invoice_id, db)


@router.put("/{invoice_id}", response_model=model.InvoiceResponse)
def update_invoice(
    invoice_id: int,
    data: model.InvoiceUpdate,
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """Update a draft invoice (items, customer, totals, or mark as sent/cancelled)."""
    return service.update_invoice(invoice_id, data, db)


@router.post("/{invoice_id}/convert", response_model=model.InvoiceConvertResponse)
def convert_invoice(
    invoice_id: int,
    data: model.InvoiceConvertRequest,
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Convert a draft/sent invoice into a confirmed sales order.
    Creates an Order, deducts stock, and marks the invoice as 'converted'.
    """
    return service.convert_invoice_to_order(invoice_id, data, current_user.userId, db)
