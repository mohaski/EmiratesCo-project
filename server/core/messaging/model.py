from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from uuid import UUID

class messageCreate(BaseModel):
    sender_id: str
    content: str
    recipient_ids: Optional[list[UUID]] = None
    role: Optional[str] = None
    is_broadcast: Optional[bool] = False
    
    
class messageReadStatusUpdate(BaseModel):
    has_read: bool
    read_at: datetime = None
    

    