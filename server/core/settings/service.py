from sqlmodel import Session
from entities.settings import SystemSetting
from core.userManagement.authService import hash_password, verify_password
from loggiing import logger

CANCEL_PIN_KEY = "order_cancel_pin"


def set_cancel_pin(db: Session, pin: str, current_user) -> None:
    """Hash and store/replace the org-wide order-cancel PIN. CEO-only — enforced by the caller."""
    hashed = hash_password(pin)
    existing = db.get(SystemSetting, CANCEL_PIN_KEY)
    if existing:
        existing.value = hashed
        existing.updated_by = current_user.userId
        db.add(existing)
    else:
        db.add(SystemSetting(key=CANCEL_PIN_KEY, value=hashed, updated_by=current_user.userId))
    db.commit()
    logger.info(f"Order-cancel PIN updated by {current_user.userId}.")


def cancel_pin_is_configured(db: Session) -> bool:
    return db.get(SystemSetting, CANCEL_PIN_KEY) is not None


def verify_cancel_pin(db: Session, pin: str) -> bool:
    setting = db.get(SystemSetting, CANCEL_PIN_KEY)
    if not setting:
        return False
    return verify_password(pin, setting.value)
