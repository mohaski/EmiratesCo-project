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
    role: Optional[str]
    
    def get_uuid(self):
        if self.userId:
            return UUID(self.userId)
        return None
    
######### users models #########

class userDetailsResponse(BaseModel):
    firstName: str
    secondName: str
    role: str
    email: EmailStr
    phoneNumber: str


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
    #phoneNumber: Annotated[str, Field(pattern=r'^07|01|+2547|+2541|+')]
    phoneNumber: str
    type: str = "individual"
    
    @field_validator('phoneNumber')
    def validate_phoneNumber(cls, v: str):
        pattern = r'^(254|0)(7|1)\d{8}'
        
        if not re.search(pattern, v):
            raise  ValueError('Invalid phone number formart. Make sure they start with either 0 or 254 followed by 1 or 7 '
                              'Must not exceed 12 digits')
        return v
            
class CustomerCreateResponse(BaseModel):
    msg: str
    customerId: int

class CustomerResponse(BaseModel):
    customerId: int
    name: str
    phoneNumber: str
    type: str # 'registered', 'corporate', etc.
