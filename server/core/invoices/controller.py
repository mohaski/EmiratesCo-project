from fastapi import APIRouter, Depends, Query, BackgroundTasks, HTTPException
from typing import List, Optional
from sqlmodel import Session

from db.database import get_session
from core.userManagement.authService import get_current_user
from core.userManagement.model import TokenData
from ws.manager import manager
from . import model, service

router = APIRouter(prefix="/invoices", tags=["Invoices"])


@router.post("/", response_model=model.InvoiceCreateResponse)
async def create_invoice(
    data: model.InvoiceCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """Create a new invoice (quotation/draft)."""
    result = service.create_invoice(data, current_user.userId, db)
    background_tasks.add_task(manager.broadcast, "invoices_updated")
    return result


@router.get("/", response_model=List[model.InvoiceResponse])
def list_invoices(
    skip: int = 0,
    limit: int = Query(100, ge=1, le=1000),
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
async def update_invoice(
    invoice_id: int,
    data: model.InvoiceUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """Update a draft invoice (items, customer, totals, or mark as sent/cancelled)."""
    result = service.update_invoice(invoice_id, data, db)
    background_tasks.add_task(manager.broadcast, "invoices_updated")
    return result


@router.post("/{invoice_id}/convert", response_model=model.InvoiceConvertResponse)
async def convert_invoice(
    invoice_id: int,
    data: model.InvoiceConvertRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Retired. This path made a confirmed order WITHOUT deducting any stock, priced from the
    quotation's browser-supplied totals, with no stock operation recorded and no lock on the
    quotation. No screen used it. A quotation is converted through checkout (POST /orders/
    with sourceInvoiceId) or a sale window, which price it on the server and take its stock.
    """
    raise HTTPException(
        status_code=410,
        detail="Convert quotations from Order History > Quotations > Convert (checkout).",
    )
