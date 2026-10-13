from sqlmodel import Session
from entities.settings import SystemSetting
from core.userManagement.authService import hash_password, verify_password
from loggiing import logger

CANCEL_PIN_KEY = "order_cancel_pin"
GLASS_A4_MIN_PANELS_KEY = "glass_a4_min_panels"
GLASS_A4_MIN_PANELS_DEFAULT = 3


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


def check_cancel_pin(db: Session, pin: str | None, current_user) -> bool:
    """verify_cancel_pin with wrong guesses slowed down per user (429 after five).

    Per user, not shop-wide: the PIN is shared by every manager, so one person's typos
    must not block cancel/undo/correct for everyone.
    """
    from core.userManagement.throttle import pin_throttle
    key = str(getattr(current_user, "userId", "") or "-")
    pin_throttle.check(key)
    if pin and verify_cancel_pin(db, pin):
        pin_throttle.succeeded(key)
        return True
    pin_throttle.failed(key)
    logger.warning(f"Incorrect cancel PIN entered by {key}.")
    return False


def verify_cancel_pin(db: Session, pin: str) -> bool:
    setting = db.get(SystemSetting, CANCEL_PIN_KEY)
    if not setting:
        return False
    return verify_password(pin, setting.value)


def get_glass_a4_min_panels(db: Session) -> int:
    """Panels a glass worksheet must cut before it prints on A4 (0 = never). Each till still
    needs its own A4 printer set up; without one the worksheet stays on the thermal roll."""
    row = db.get(SystemSetting, GLASS_A4_MIN_PANELS_KEY)
    if row is None:
        return GLASS_A4_MIN_PANELS_DEFAULT
    try:
        return int(row.value)
    except ValueError:
        return GLASS_A4_MIN_PANELS_DEFAULT


def set_glass_a4_min_panels(db: Session, value: int, current_user) -> int:
    """CEO/admin-only — enforced by the caller."""
    existing = db.get(SystemSetting, GLASS_A4_MIN_PANELS_KEY)
    if existing:
        existing.value = str(value)
        existing.updated_by = current_user.userId
        db.add(existing)
    else:
        db.add(SystemSetting(key=GLASS_A4_MIN_PANELS_KEY, value=str(value), updated_by=current_user.userId))
    db.commit()
    logger.info(f"Glass A4 threshold set to {value} panels by {current_user.userId}.")
    return value
