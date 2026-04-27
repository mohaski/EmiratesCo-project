from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select, and_
from . import model
from ....entities import offcut
from db.database import get_session
from core.userManagement.authService import get_current_user
from loggiing import logger


async def create_offcut(payload: model.create_offcut, db: Session = Depends(get_session)):
    try:
        new_offcut = offcut(
            product_id=payload.product_id,
            variant_id=payload.variant_id,
            length=payload.length,
            quantity=payload.quantity
        )
        db.add(new_offcut)
        db.commit()
        db.refresh(new_offcut)
        return new_offcut
    except Exception as e:
        logger.error(f"Create Offcut Error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create offcut")


async def get_offcut_by_id(ids: model.offcutIds, db: Session = Depends(get_session)):
    try:
        query = select(offcut).where(
            and_(
                offcut.product_id == ids.product_id,
                offcut.variant_id == ids.variant_id
            )
        )
        offcut = db.exec(query).first()
        return offcut
    except Exception as e:
        logger.error(f"Get Offcut By ID Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch offcut")

async def get_all_offcuts(db: Session = Depends(get_session)):
    try:
        query = select(offcut)
        offcuts = db.exec(query).all()
        return offcuts
    except Exception as e:
        logger.error(f"Get All Offcuts Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch offcuts")