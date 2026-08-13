from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select
from db.database import get_session
from entities.users import User
from .authService import hash_password, verify_password
from . import model

from loggiing import logger

def get_users(db: Session = Depends(get_session)) -> list[User]:
    """Fetch all users without exposing password hashes."""
    try:
        users = db.exec(select(User)).all()
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
        user = db.exec(select(User).where(User.userId == id)).first()
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


def password_reset(id: str, password_data: model.passwordResetRequest, db: Session = Depends(get_session)):
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
        user.mustChangePassword = False
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

def password_change(id: str, passwordChangeRequest: model.passwordChangeRequest, db: Session = Depends(get_session)):
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
        user.mustChangePassword = False

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

def admin_reset_password(id: str, new_password: str, db: Session = Depends(get_session)) -> dict:
    """CEO/admin reset of another user's forgotten password. No current-password check."""
    try:
        user = get_user_by_id(id, db)
        user.password = hash_password(new_password)
        user.mustChangePassword = True
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"Password administratively reset for user {id}.")
        return {"message": "Password reset successfully. The user must set a new password on next login."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error administratively resetting password for user {id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

CHANGEABLE_ROLES = {"manager", "cashier"}

def update_role(id: str, role: str, db: Session = Depends(get_session)) -> dict:
    """Change a user's role. Restricted to switching between manager and cashier."""
    try:
        if role not in CHANGEABLE_ROLES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role must be either manager or cashier")
        user = get_user_by_id(id, db)
        if user.role not in CHANGEABLE_ROLES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change the role of an admin or CEO account")
        user.role = role
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"Role updated to '{role}' for user {id}.")
        return {"message": "Role updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating role for user {id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

def set_active_status(id: str, is_active: bool, current_user, db: Session = Depends(get_session)) -> dict:
    """Activate or deactivate a user."""
    try:
        user = get_user_by_id(id, db)
        if str(user.userId) == current_user.userId and not is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")
        user.isActive = is_active
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"User {id} set to {'active' if is_active else 'inactive'}.")
        return {"message": "User activated successfully" if is_active else "User deactivated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error setting active status for user {id}: {e}", exc_info=True)
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
