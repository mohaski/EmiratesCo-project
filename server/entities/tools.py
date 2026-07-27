from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Enum, func
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class Tool(SQLModel, table=True):
    """A physical shop tool that can be lent out to (unregistered) workers."""

    __tablename__ = "tools"

    toolId: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    # Current known issues/defects (e.g. "missing rubber grip") — updated on return.
    description: Optional[str] = Field(default=None)
    status: str = Field(
        sa_column=Column(
            Enum("available", "taken", "non_functional", name="tool_status_enum"),
            default="available",
            nullable=False,
        )
    )
    created_at: datetime = Field(sa_column_kwargs={"server_default": func.now()})

    loanItems: List["ToolLoanItem"] = Relationship(back_populates="tool")


class ToolLoan(SQLModel, table=True):
    """One checkout event: a worker taking out one or more tools at once."""

    __tablename__ = "tool_loans"

    loanId: Optional[int] = Field(default=None, primary_key=True)
    workerName: str = Field(index=True)

    issued_by: UUID = Field(nullable=False, foreign_key="users.userId")
    issued_at: datetime = Field(sa_column_kwargs={"server_default": func.now()}, index=True)

    returned_by: Optional[UUID] = Field(default=None, foreign_key="users.userId")
    returned_at: Optional[datetime] = Field(default=None)

    status: str = Field(
        sa_column=Column(
            Enum("out", "partially_returned", "returned", name="tool_loan_status_enum"),
            default="out",
            nullable=False,
        )
    )
    notes: Optional[str] = Field(default=None)

    items: List["ToolLoanItem"] = Relationship(back_populates="loan")


class ToolLoanItem(SQLModel, table=True):
    """A single tool within a loan — tracks its own return state."""

    __tablename__ = "tool_loan_items"

    itemId: Optional[int] = Field(default=None, primary_key=True)
    loan_id: int = Field(nullable=False, foreign_key="tool_loans.loanId")
    tool_id: int = Field(nullable=False, foreign_key="tools.toolId")

    returned: bool = Field(default=False)
    returned_at: Optional[datetime] = Field(default=None)
    defect_note: Optional[str] = Field(default=None)

    loan: "ToolLoan" = Relationship(back_populates="items")
    tool: "Tool" = Relationship(back_populates="loanItems")
