from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy import Enum, func
from typing import Optional, List
from datetime import datetime

class Message(SQLModel, table=True):

    __tablename__ = "messages"

    messageId: Optional[int] = Field(default= None, primary_key= True)
    senderId: int = Field(foreign_key= "users.userId")
    content: str
    sent_at: datetime = Field(sa_column_kwargs={"server_default": func.now()})

    messageRecipients: List["MessageRecipient"] = Relationship(back_populates="message")
    user: "User" = Relationship(back_populates="messages")



class MessageRecipient(SQLModel, table=True):

    __tablename__ = "messageRecipients"

    messageRecipientId: Optional[int] = Field(default=None, primary_key=True)
    messageId: int = Field(foreign_key="messages.messageId")
    recipientUserId: int = Field(foreign_key="users.userId")
    has_read: bool = Field(default=False)
    read_at: Optional[datetime] = Field(default=None)

    # link back to message
    message: Optional["Message"] = Relationship(back_populates="messageRecipients")    
    
    #Link back to user
    user: "User" = Relationship(back_populates="messageRecipients")
