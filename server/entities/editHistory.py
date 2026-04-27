from sqlmodel import SQLModel, Field, Column
from sqlalchemy import JSON, func
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID


class EditHistory(SQLModel, table=True):
    __tablename__ = "edit_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    entity_type: str = Field(index=True)          # 'order' | 'restock' | 'product_update'
    entity_id: int = Field(index=True)             # orderId, productId, etc.
    edited_by: UUID = Field(foreign_key="users.userId", index=True)
    edited_at: datetime = Field(sa_column_kwargs={"server_default": func.now()}, index=True)
    action: str = Field(default="edit")            # 'edit' | 'restock' | 'delete'
    before_snapshot: Dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    after_snapshot: Dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    notes: Optional[str] = Field(default=None)
