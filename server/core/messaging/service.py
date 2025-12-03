from fastapi import Depends, HTTPException
from sqlmodel import Session, select
from ...entities.messages import Message, MessageRecipient
from . import models
from ...db.database import get_session
from ..userManagement.authService import get_current_user
from ...entities.users import User
from ...logging import logger
from sqlalchemy import func

def send_message(message_data: models.messageCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)) -> dict:
    try:
        new_message = Message(senderId=current_user.userId, content=message_data.content)
        db.add(new_message)
        db.commit()
        db.flush(new_message)
        
        
        if message_data.is_broadcast:
            roleRecipients = db.exec(select(User.userId).where(User.userId != current_user.userId)).all()
            for recipient in roleRecipients:
                message_recipient = MessageRecipient(messageId=new_message.messageId, recipientUserId= recipient)
                db.add(message_recipient)
                
        elif message_data.recipient_ids:
            for recipient_id in message_data.recipient_ids:
                message_recipient = MessageRecipient(messageId=new_message.messageId, recipientUserId= recipient_id)
                db.add(message_recipient)
                
        elif message_data.role:
            recipients_ids = db.exec(select(User.userId).where(User.role == message_data.role, User.userId != current_user.userId))
            for recipient in recipients_ids:
                message_recipient = MessageRecipient(messageId=new_message.messageId, recipientUserId= recipient)
                db.add(message_recipient)
        
        db.commit()        
        logger.info(f"Message sent by {current_user.userId} to {len(message_data.recipient_ids or roleRecipients)} recipients.")
        return {"message": "Message sent successfully", "id": new_message.messageId}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error sending message: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
                
        
        
        
def update_message_read_status(message_id: int, status_data: models.messageReadStatusUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)) -> dict:
    try:
        message_recipient = db.exec(
            select(MessageRecipient)
            .where(MessageRecipient.messageId == message_id, MessageRecipient.recipientUserId == current_user.userId)
        ).first()
        
        if not message_recipient:
            logger.warning(f"MessageRecipient not found for message {message_id} and user {current_user.id}.")
            raise HTTPException(status_code=404, detail="Message or recipient not found")
        
        message_recipient.has_read = status_data.has_read
        message_recipient.read_at = status_data.read_at or (func.now() if status_data.has_read else None)
        
        db.add(message_recipient)
        db.commit()
        
        logger.info(f"User {current_user.id} updated read status for message {message_id} to {status_data.has_read}.")
        return {"message": "Read status updated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating read status for message {message_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
        
def read_inbox(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)) -> list[models.messageResponse]:
    try:
        messages = db.exec(
            select(Message)
            .join(MessageRecipient)
            .where(MessageRecipient.recipientUserId == current_user.userId)
            .order_by(Message.sent_at.desc())
        ).all()
        
        if not messages:
            logger.info(f"No messages found for user {current_user.id}.")
            return []
        
        logger.info(f"{len(messages)} messages fetched for user {current_user.id}.")
        return messages
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching inbox for user {current_user.id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    

