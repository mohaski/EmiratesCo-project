"""The {cash, mpesa} breakdown stored on a split Payment row.

Rule: every part carries the same sign as the row's amount (a refund of -1000 split
400/600 is stored {cash: -400, mpesa: -600}) and the parts add up to the amount.
get_financial_summary adds the parts straight into the cash/M-Pesa buckets, so a part
with the wrong sign moves money between the buckets.
"""
import math

from fastapi import HTTPException

SPLIT_KEYS = ("cash", "mpesa")
# Whole-KSH rounding on the client (ceil of the M-Pesa remainder) can leave the parts a
# fraction off the amount; anything beyond a shilling is a genuinely wrong breakdown.
SUM_TOLERANCE = 1.0


def _number(value):
    try:
        f = float(value or 0)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def normalize_payment_details(method: str | None, details, amount: float) -> dict | None:
    """Validate and sign the details for a Payment row that is about to be written.

    Only call it when a row is actually created — a re-run that records no money (the
    undo tool's corrections) must not be refused over details it never uses.
    Non-split methods carry no breakdown. Raises 400 on a breakdown that can't be right.
    """
    if (method or "").lower() != "split":
        return None
    if not isinstance(details, dict) or not details:
        raise HTTPException(status_code=400, detail="A split payment needs the cash and M-Pesa amounts.")
    unknown = sorted(set(details) - set(SPLIT_KEYS))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown split payment part(s): {', '.join(unknown)}.")

    parts = {}
    for key in SPLIT_KEYS:
        value = _number(details.get(key))
        if value is None:
            raise HTTPException(status_code=400, detail=f"The {key} amount of a split payment must be a number.")
        parts[key] = value

    sign = -1 if amount < 0 else 1
    # Refund screens send what goes back to the customer as positive amounts; store them
    # signed like the row.
    if sign < 0 and all(v >= 0 for v in parts.values()):
        parts = {k: -v for k, v in parts.items()}
    if any(v * sign < 0 for v in parts.values()):
        raise HTTPException(status_code=400, detail="Split payment amounts can't be negative.")

    split_total = sum(abs(v) for v in parts.values())
    if abs(split_total - abs(amount)) > SUM_TOLERANCE:
        raise HTTPException(
            status_code=400,
            detail=f"The split amounts (KSH {split_total:,.0f}) don't add up to the payment (KSH {abs(amount):,.0f}).",
        )
    return {k: round(v, 2) + 0.0 for k, v in parts.items()}  # + 0.0 turns -0.0 into 0.0


def signed_split_parts(details, amount: float) -> dict:
    """Read side: the {cash, mpesa} parts of a stored row, signed like its amount.

    Tolerant on purpose — it reads rows written before normalize_payment_details existed,
    including split cancel refunds stored as positive parts on a negative amount.
    """
    parts = {}
    for key, value in (details or {}).items() if isinstance(details, dict) else ():
        if key in SPLIT_KEYS:
            number = _number(value)
            if number is not None:
                parts[key] = number
    if not parts:
        return parts
    if amount < 0 and all(v >= 0 for v in parts.values()):
        parts = {k: -v for k, v in parts.items()}
    elif amount > 0 and all(v <= 0 for v in parts.values()):
        parts = {k: -v for k, v in parts.items()}
    return parts
