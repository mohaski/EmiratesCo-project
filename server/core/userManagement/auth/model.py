from pydantic import BaseModel, EmailStr
from uuid import UUID
from typing import Optional

class UserRegistrationRequest(BaseModel):
    firstName: str
    lastName: str
    role: str
    email: EmailStr
    password: str
    question: str
    answer: str
    phoneNumber: str
    firstLogin: bool = False
    
class Token(BaseModel):
    access_token: str
    token_type: str
    
class TokenData(BaseModel):
    userId: Optional[str] 
    role: Optional[str]
    
    def get_uuid(self):
        if self.userId:
            return UUID(self.userId)
        return None
    
