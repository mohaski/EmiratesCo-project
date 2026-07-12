from pydantic import BaseModel, EmailStr, Field, field_validator
from uuid import UUID
from typing import Optional, Annotated
import re

class UserRegistrationRequest(BaseModel):
    firstName: str
    secondName: str
    username: str
    role: str
    email: EmailStr
    password: str = "1234"
    phoneNumber: str
    firstLogin: bool = False
    
class Token(BaseModel):
    access_token: str
    token_type: str
    
class TokenData(BaseModel):
    userId: Optional[str] 
    username: Optional[str]
    role: Optional[str]
    
    def get_uuid(self):
        if self.userId:
            return UUID(self.userId)
        return None
    
######### users models #########

class userDetailsResponse(BaseModel):
    userId: Optional[UUID] = None
    firstName: str
    secondName: Optional[str] = None
    username: str
    role: str
    email: EmailStr
    phoneNumber: str

    class Config:
        from_attributes = True


class passwordResetRequest(BaseModel):
    currentPassword: str
    newPassword: str
    confirmNewPassword: str
    
class passwordChangeRequest(BaseModel):
    newPassword: str
    confirmNewPassword: str
    
    
######### customers models #########

class CustomerCreateRequest(BaseModel):
    name: str
    phoneNumber: str
    type: str = "individual"

    @field_validator('phoneNumber')
    def validate_phoneNumber(cls, v: str):
        # Accept international (+XXX) or local formats
        # Minimum 7 digits after stripping symbols; max 15 (E.164)
        digits = re.sub(r'[\s\-\(\)\+]', '', v)
        if not digits.isdigit() or not (7 <= len(digits) <= 15):
            raise ValueError(
                'Invalid phone number. Use international format (e.g. +1 555 000 0000) '
                'or a valid local number.'
            )
        return v
            
class CustomerCreateResponse(BaseModel):
    msg: str
    customerId: int

class CustomerResponse(BaseModel):
    customerId: int
    name: str
    phoneNumber: str
    type: str # 'registered', 'corporate', etc.
