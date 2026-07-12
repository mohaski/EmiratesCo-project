from pydantic import BaseModel, field_validator


class CancelPinSet(BaseModel):
    pin: str

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
