from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime

class Customer(SQLModel, table=True):

    __tablename__ = "customers"

    customerId: Optional[int] = Field(default= None, primary_key= True)
    name: str = Field(nullable= False)
    phoneNumber: str = Field(unique= True, nullable= False)
    createdAt: datetime = Field(sa_column_kwargs={"server_default": func.now()})
    
    credits: List["Credit"] = Relationship(back_populates="customer")
    orders: List["Order"] = Relationship(back_populates="customer")
