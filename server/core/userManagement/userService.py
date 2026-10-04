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

        if password_data.newPassword != password_data.confirmNewPassword:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password and confirm password do not match"
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
    """Replace a temporary password (new account, or reset by an admin) — the forced change.

    Only while the account is flagged mustChangePassword, and only with the temporary
    password: a normal change goes through password_reset, which checks the current one.
    """
    try:
        user = get_user_by_id(id, db)
        if not user.mustChangePassword:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use Change Password in Settings (it asks for your current password)."
            )
        if not verify_password(passwordChangeRequest.currentPassword, user.password):
            logger.warning(f"User {id} gave a wrong temporary password on the forced change.")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The temporary password is incorrect"
            )
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

def admin_reset_password(id: str, new_password: str, db: Session = Depends(get_session), actor=None) -> dict:
    """CEO/admin reset of another user's forgotten password. No current-password check."""
    try:
        user = get_user_by_id(id, db)
        if actor is not None:
            assert_may_manage(actor, user, db)
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
PRIVILEGED_ROLES = {"ceo", "admin"}


def assert_may_manage(actor, target: User, db: Session) -> None:
    """An admin manages staff (managers, cashiers); only a CEO manages admin and CEO
    accounts. Without this an admin could reset the CEO's password and sign in as them."""
    if target.role in PRIVILEGED_ROLES and actor.role != "ceo":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Only the CEO can manage admin and CEO accounts.")


def _assert_not_last_active_ceo(target: User, db: Session) -> None:
    if target.role != "ceo" or not target.isActive:
        return
    others = db.exec(select(User).where(User.role == "ceo", User.isActive == True,  # noqa: E712
                                        User.userId != target.userId)).first()
    if others is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This is the only active CEO account; it can't be removed or deactivated.")

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
        assert_may_manage(current_user, user, db)
        if not is_active:
            _assert_not_last_active_ceo(user, db)
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

def delete_user(id: str, db: Session = Depends(get_session), actor=None) -> dict:
    """Delete a user by ID."""
    try:
        user = get_user_by_id(id, db)
        if actor is not None:
            if str(user.userId) == actor.userId:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")
            assert_may_manage(actor, user, db)
            _assert_not_last_active_ceo(user, db)
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
