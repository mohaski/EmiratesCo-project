from pydantic import BaseModel, EmailStr

class userDetailsResponse(BaseModel):
    firstName: str
    lastName: str
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
    