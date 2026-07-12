from fastapi import APIRouter, Depends, BackgroundTasks
from typing import List
from sqlmodel import Session
from db.database import get_session
from core.userManagement.authService import get_current_user
from ws.manager import manager
from . import model, service

router = APIRouter(prefix="/attributes", tags=["Attributes"])


@router.get("/", response_model=List[model.AttributeClassResponse])
def get_attribute_classes(db: Session = Depends(get_session)):
    return service.get_all_attribute_classes(db)


@router.post("/", response_model=model.AttributeClassResponse)
async def create_attribute_class(
    data: model.AttributeClassCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.create_attribute_class(data, db)
    background_tasks.add_task(manager.broadcast, "attributes_updated")
    return result


@router.put("/{class_id}", response_model=model.AttributeClassResponse)
async def rename_attribute_class(
    class_id: int,
    data: model.AttributeClassRename,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.rename_attribute_class(class_id, data, db)
    background_tasks.add_task(manager.broadcast, "attributes_updated")
    return result


@router.delete("/{class_id}")
async def delete_attribute_class(
    class_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.delete_attribute_class(class_id, db)
    background_tasks.add_task(manager.broadcast, "attributes_updated")
    return result


@router.post("/{class_id}/values", response_model=model.AttributeValueResponse)
async def add_attribute_value(
    class_id: int,
    data: model.AttributeValueCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.add_attribute_value(class_id, data, db)
    background_tasks.add_task(manager.broadcast, "attributes_updated")
    return result


@router.put("/values/{value_id}", response_model=model.AttributeValueResponse)
async def rename_attribute_value(
    value_id: int,
    data: model.AttributeValueRename,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.rename_attribute_value(value_id, data, db)
    background_tasks.add_task(manager.broadcast, "attributes_updated")
    return result


@router.delete("/values/{value_id}")
async def delete_attribute_value(
    value_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    result = service.delete_attribute_value(value_id, db)
    background_tasks.add_task(manager.broadcast, "attributes_updated")
    return result
