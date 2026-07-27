from pydantic import BaseModel
from typing import Optional, List


# ── Tool Catalog ─────────────────────────────────────────────────────────────

class ToolCreate(BaseModel):
    name: str
    description: Optional[str] = None
    status: Optional[str] = "available"  # available | non_functional


class ToolUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None  # available | non_functional (not "taken" — system managed)


class ToolResponse(BaseModel):
    toolId: int
    name: str
    description: Optional[str] = None
    status: str

    class Config:
        from_attributes = True


# ── Loans (checkout / return) ───────────────────────────────────────────────

class ToolLoanCreate(BaseModel):
    workerName: str
    toolIds: List[int]
    notes: Optional[str] = None


class ToolLoanCreateResponse(BaseModel):
    message: str
    loanId: int


class ToolLoanItemResponse(BaseModel):
    itemId: int
    toolId: int
    toolName: str
    returned: bool
    returned_at: Optional[str] = None
    defect_note: Optional[str] = None


class ToolLoanResponse(BaseModel):
    loanId: int
    workerName: str
    issued_by: Optional[str] = None
    issued_at: str
    returned_by: Optional[str] = None
    returned_at: Optional[str] = None
    status: str
    notes: Optional[str] = None
    items: List[ToolLoanItemResponse] = []


class ToolReturnItem(BaseModel):
    toolId: int
    defectNote: Optional[str] = None
    markNonFunctional: bool = False


class ToolReturnRequest(BaseModel):
    items: List[ToolReturnItem]


class ToolReturnResponse(BaseModel):
    message: str
    loanStatus: str
