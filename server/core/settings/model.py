from typing import Optional

from pydantic import BaseModel, field_validator


class CancelPinSet(BaseModel):
    pin: str
    # The signed-in user's own account password. Required to REPLACE an existing PIN, so
    # someone at an unlocked till can't silently change it; not needed for the first setup.
    currentPassword: Optional[str] = None

    @field_validator("pin")
    @classmethod
    def validate_pin(cls, v: str) -> str:
        if not (v.isdigit() and len(v) == 4):
            raise ValueError("PIN must be exactly 4 digits")
        return v


class CancelPinStatusResponse(BaseModel):
    configured: bool


class MessageResponse(BaseModel):
    message: str
