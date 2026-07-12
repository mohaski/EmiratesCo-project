from sqlmodel import SQLModel, Field
from sqlalchemy import func
from typing import Optional
from datetime import datetime
from uuid import UUID


class SystemSetting(SQLModel, table=True):
    """Generic key/value store for org-wide settings (e.g. the order-cancel PIN)."""

    __tablename__ = "system_settings"

    key: str = Field(primary_key=True)
    value: str
    updated_by: Optional[UUID] = Field(foreign_key="users.userId", default=None)
    updated_at: datetime = Field(
        sa_column_kwargs={"server_default": func.now(), "onupdate": func.now()}
    )
