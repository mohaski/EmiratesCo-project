import logging
from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select
from ...db.database import get_session
from ...entities.users import User
from ..auth.service import hash_password, verify_password
from . import models

from ...logging import logger

def get_users(db: Session = Depends(get_session)) -> list[User]:
    """Fetch all users with limited columns."""
    try:
        query = select(User.firstName, User.lastName, User.email, User.role, User.phoneNumber)
        users = db.exec(query).all()
        if not users:
            logger.warning("No users found in database.")
        else:
            logger.info(f"{len(users)} users fetched successfully.")
        return users or []
    except Exception as e:
        logger.error(f"Error fetching users: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def get_user_by_id(id: str, db: Session = Depends(get_session)) -> User:
    """Fetch a single user by ID."""
    try:
        user = db.exec(select(User).where(User.id == id)).first()
        if not user:
            logger.warning(f"User with ID {id} not found.")
            raise HTTPException(status_code=404, detail="User not found")
        logger.info(f"User {id} fetched successfully.")
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching user by ID {id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def password_reset(id: str, password_data: models.passwordResetRequest, db: Session = Depends(get_session)):
    """Reset a user's password with proper validation."""
    try:
        # ✅ Reuse get_user_by_id for cleaner code
        user = get_user_by_id(id, db)

        # ✅ Verify current password
        if not verify_password(password_data.currentPassword, user.password):
            logger.warning(f"User {id} provided incorrect current password.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect"
            )

        # ✅ Prevent reusing the same password
        if verify_password(password_data.newPassword, user.password):
            logger.warning(f"User {id} attempted to reuse the same password.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password cannot be the same as the current password"
            )

        # ✅ Update password
        user.password = hash_password(password_data.newPassword)
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"Password reset successfully for user {id}.")
        return {"message": "Password updated successfully"}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error resetting password for user {id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

def password_change(id: str, passwordChangeRequest: models.passwordReequestChange, db: Session = Depends(get_session)):
    """Change a user's password while already logged on."""
    try:
        user = get_user_by_id(id, db)
        new_password = passwordChangeRequest.newPassword
        confirm_password = passwordChangeRequest.confirmNewPassword
        if new_password != confirm_password:
            logger.warning(f"User {id} provided non-matching new passwords.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password and confirm password do not match"
            )
        if verify_password(passwordChangeRequest.newPassword, user.password):
            logger.warning(f"User {id} attempted to reuse the same password.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password cannot be the same as the current password"
            )
        user.password = hash_password(passwordChangeRequest.newPassword)
        
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"Password changed successfully for user {id}.")
        return {"message": "Password changed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error changing password for user {id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    
def delete_user(id: str, db: Session = Depends(get_session)) -> dict:
    """Delete a user by ID."""
    try:
        user = get_user_by_id(id, db)
        db.delete(user)
        db.commit()
        logger.info(f"User {id} deleted successfully.")
        return {"message": "User deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting user {id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
