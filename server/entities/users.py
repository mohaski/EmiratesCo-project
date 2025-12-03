from sqlmodel import Field, SQLModel, Relationship   
from sqlalchemy import Enum, UniqueConstraint, Column, func
from sqlalchemy.dialects.postgresql import UUID
from typing import Optional, List
from datetime import datetime
from uuid import UUID, uuid4

class User(SQLModel, table=True):

    __tablename__ = "users"

    userId: Optional[UUID] = Field(sa_column= Column(UUID(as_uuid= True)), primary_key= True, default= uuid4)
    firstName: str
    lastName: Optional[str] = None
    phoneNumber: str = Field(unique= True, nullable= False)
    role: str = Field(sa_column= Column(Enum("Admin","ceo", "seniorCashier", "juniorCashier", "stockManager", name="user_role_enum")))
    username: str = Field(unique= True, nullable= False)
    password: str = Field(max_length= 50, nullable= False)
    question: str = Field(max_length= 100, nullable= False)
    answer: str = Field(max_length= 100, nullable= False)
    firstLogin: bool = Field(default= False)
    createdAt: datetime = Field(sa_column_kwargs={"server_default": func.now()})

    orders: List["Order"] = Relationship(back_populates = "user")
    messages: List["Message"] = Relationship(back_populates= "user")
    messageRecipients: List["MessageRecipient"] = Relationship(back_populates= "user")
    
