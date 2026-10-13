"""Glass A4 threshold setting (/settings/glass-print), through the real controller functions,
on emiratesco_edit_test. Run from server/:  .venv/bin/python <this file>
"""
import sys, os, logging
sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)

from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import Session, create_engine, text
from config import settings
import entities  # noqa: F401
from entities.settings import SystemSetting
from core.settings import controller, model, service

failures = []
def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    if not ok:
        failures.append(label)

class FakeUser:
    def __init__(self, role):
        self.userId = None; self.role = role; self.username = "qa"

base, _, _ = settings.get_database_url().rpartition("/")
engine = create_engine(f"{base}/emiratesco_edit_test", echo=False)

with Session(engine) as db:
    assert db.exec(text("select current_database()")).one()[0] == "emiratesco_edit_test"
    row = db.get(SystemSetting, service.GLASS_A4_MIN_PANELS_KEY)
    if row:
        db.delete(row); db.commit()

    print("Default when never set")
    check("tills read 3", controller.get_glass_print_setting(db, FakeUser("cashier")).a4MinPanels, 3)

    print("CEO sets it, every role reads it")
    controller.set_glass_print_setting(model.GlassPrintSetting(a4MinPanels=4), db, FakeUser("ceo"))
    for role in ("ceo", "admin", "manager", "cashier"):
        check(f"{role} reads 4", controller.get_glass_print_setting(db, FakeUser(role)).a4MinPanels, 4)
    controller.set_glass_print_setting(model.GlassPrintSetting(a4MinPanels=0), db, FakeUser("admin"))
    check("0 (off) is kept, not replaced by the default", service.get_glass_a4_min_panels(db), 0)

    print("Only CEO/admin may change it")
    for role in ("manager", "cashier"):
        try:
            controller.set_glass_print_setting(model.GlassPrintSetting(a4MinPanels=2), db, FakeUser(role))
            check(f"{role} refused", "no error", 403)
        except HTTPException as e:
            check(f"{role} refused", e.status_code, 403)
    check("value unchanged after refusals", service.get_glass_a4_min_panels(db), 0)

    print("Out-of-range values are rejected")
    for bad in (-1, 51):
        try:
            model.GlassPrintSetting(a4MinPanels=bad)
            check(f"{bad} rejected", "accepted", "ValidationError")
        except ValidationError:
            check(f"{bad} rejected", "ValidationError", "ValidationError")

    print("A garbage stored value falls back to the default")
    row = db.get(SystemSetting, service.GLASS_A4_MIN_PANELS_KEY)
    row.value = "lots"; db.add(row); db.commit()
    check("reads 3", service.get_glass_a4_min_panels(db), 3)

    db.delete(db.get(SystemSetting, service.GLASS_A4_MIN_PANELS_KEY)); db.commit()

print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
sys.exit(1 if failures else 0)
