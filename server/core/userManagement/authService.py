from datetime import timedelta, datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4
from fastapi import Depends, HTTPException, status
from passlib.context import CryptContext
import jwt
import json
import logging
from jwt import PyJWTError
from sqlmodel import Session, select, or_
from sqlalchemy.exc import IntegrityError
from db.database import get_session
from entities.users import User
from . import model
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from config import settings

logger = logging.getLogger("emiratesco.auth")

SECRET_KEY = settings.JWT_SECRET_KEY
ALGORITHM = settings.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
auth_scheme = OAuth2PasswordBearer(tokenUrl="token")



def hash_password(password: str) -> str:
    """Hash a password for storing."""
    return pwd_context.hash(password)

def userRegistration(register_user_request: model.UserRegistrationRequest, db: Session = Depends(get_session)) -> None:
    """Register a new user"""
    # Check if user already exists
    existing_user = db.exec(select(User).where(User.email == register_user_request.email)).first()
    if existing_user:
        logger.warning(json.dumps({
            "event": "user.registration.failed",
            "reason": "email_already_exists",
            "email_attempted": register_user_request.email,
            "role_attempted": register_user_request.role,
        }))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User with this email already exists")
    
    import secrets, string
    generated = register_user_request.password is None
    temp_password = register_user_request.password if not generated else "".join(
        secrets.choice(string.ascii_letters + string.digits) for _ in range(10))
    try:
        
        create_user = User(
        userId=uuid4(),
        firstName=register_user_request.firstName,
        secondName=register_user_request.secondName,
        role=register_user_request.role,
        username=register_user_request.username,
        email=register_user_request.email,
        password=hash_password(temp_password),
        phoneNumber=register_user_request.phoneNumber,
        mustChangePassword= True)
        
        db.add(create_user)
        db.commit()
        db.refresh(create_user)

        logger.info(json.dumps({
            "event": "user.registered",
            "user_id": str(create_user.userId),
            "username": create_user.username,
            "email": create_user.email,
            "role": create_user.role,
        }))
        # Shown once to the admin who created the account; it must be changed at first sign-in.
        return {"message": "User registered", "temporaryPassword": temp_password if generated else None}

    except IntegrityError:
        db.rollback()
        logger.warning(json.dumps({
            "event": "user.registration.failed",
            "reason": "duplicate_field",
            "username_attempted": register_user_request.username,
            "email_attempted": register_user_request.email,
        }))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User details already exist (Duplicate username, email, or phone number)")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating user: {e}", exc_info=True)
        raise e
    
def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a stored password against one provided by user"""
        return pwd_context.verify(plain_password, hashed_password)
    
def authenticate_user(username: str, password: str, db: Session) -> dict | bool:
    """Authenticate user by email OR username and password"""

    user = db.exec(select(User).where(User.username == username)).first()

    if not user:
        logger.warning(json.dumps({
            "event": "User authentication failed",
            "message": "No account found with this username",
            "provided_username": username,
        }))
        return {"success": False, "reason": "no user"}

    if not verify_password(password, user.password):
        logger.warning(json.dumps({
            "event": "User authentication failed",
            "message": "Incorrect password provided",
            "provided_username": username,
        }))
        return {"success": False, "reason": "wrong password"}

    if not user.isActive:
        logger.warning(json.dumps({
            "event": "User authentication failed",
            "message": "Account is deactivated",
            "provided_username": username,
        }))
        return {"success": False, "reason": "inactive"}

    logger.info(json.dumps({
            "Event": "Login successfully",
            "User_id": str(user.userId),
            "role": user.role
        }))
    return {
        "success": True,
        "user": user
    }
    
def create_access_token(username: str, email: str, userId: UUID, role: str, mustChangePassword: bool = False) -> str:
    try:

        """Create a JWT access token with expiry."""
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        encode = {
            "sub": email,
            "username": username,
            "id": str(userId),
            "role": role,
            "mustChangePassword": mustChangePassword,
            "exp": expire,
        }
        
        return jwt.encode(encode, SECRET_KEY, algorithm=ALGORITHM)
    
    except PyJWTError as e:
        logger.error(json.dumps({
            "Event": 'Token creation failed',
            "message": "JWT encoding error",
            "Error": str(e)
        }))
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail= 'Could not create access token'
        )
    
    except Exception as e:
        logger.error(json.dumps({
            "event": "Token creation failed",
            "message": "Unexpected error during token creation",
            "error": str(e),
        }))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred",
        )
    
def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_session),
                           client_ip: str | None = None) -> model.Token:
        from .throttle import login_throttle
        # Keyed on username AND address: tills behind one router (or the Cloudflare tunnel,
        # where every request arrives from 127.0.0.1) don't slow each other's staff down.
        throttle_key = f"{(form_data.username or '').strip().lower()}|{client_ip or '-'}"
        login_throttle.check(throttle_key)

        result= authenticate_user(form_data.username, form_data.password, db)
        if not result["success"]:
            if result["reason"] == "inactive":
                # Only reachable with the right password (checked first), so saying why
                # reveals nothing to someone guessing.
                login_throttle.succeeded(throttle_key)
                raise HTTPException(
                    status_code = status.HTTP_401_UNAUTHORIZED,
                    detail = "This account has been deactivated. Contact your administrator.",
                    headers={"WWW-Authenticate": "Bearer"}
                )
            login_throttle.failed(throttle_key)
            # One message for an unknown username and a wrong password, so the sign-in form
            # can't be used to find out which usernames exist.
            raise HTTPException(
                status_code = status.HTTP_401_UNAUTHORIZED,
                detail = "Incorrect username or password.",
                headers={"WWW-Authenticate": "Bearer"}
            )

        login_throttle.succeeded(throttle_key)
        user = result['user']

        access_token = create_access_token(
            username = user.username,
            email = user.email,
            userId = user.userId,
            role = user.role,
            mustChangePassword = user.mustChangePassword
        )
        
        logger.info(json.dumps({
            "event": "Access token created successfully",
            "username": user.username,
            "userId": str(user.userId),
        }))
        
        return model.Token(access_token=access_token, token_type="bearer")
    
def verify_token(token: str) -> model.TokenData:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            userId: str = payload.get("id")
            username: str = payload.get("username")
            email: str = payload.get("sub")
            role: str = payload.get("role")
            mustChangePassword: bool = payload.get("mustChangePassword", False)
            if userId is None or email is None or role is None:
                raise HTTPException(
                    status_code = status.HTTP_401_UNAUTHORIZED,
                    detail = "Could not validate credentials",
                )
            return model.TokenData(userId=userId, username=username, role=role, mustChangePassword=mustChangePassword)
        except PyJWTError:
            raise HTTPException(
                status_code= status.HTTP_401_UNAUTHORIZED,
                detail= "Could not validate credentials",
            )
            
            
PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED"


def _load_session_user(token: str, db: Session) -> tuple[model.TokenData, User]:
    """The token proves who is calling; the database says what they may do NOW.

    Role, active status and the forced-password-change flag are read from the users table
    on every request, so deactivating a user, changing their role or resetting their
    password takes effect immediately instead of when their 8-hour token expires.
    """
    claims = verify_token(token)
    try:
        user = db.get(User, UUID(claims.userId)) if claims.userId else None
    except ValueError:
        user = None
    if user is None or not user.isActive:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has ended. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return model.TokenData(
        userId=str(user.userId), username=user.username, role=user.role,
        mustChangePassword=bool(user.mustChangePassword),
    ), user


def get_current_user(token: Annotated[str, Depends(auth_scheme)], db: Session = Depends(get_session)) -> model.TokenData:
    current, _ = _load_session_user(token, db)
    if current.mustChangePassword:
        # A temporary password (new account or admin reset) only opens the change-password
        # screen; everything else waits until it has been replaced.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PASSWORD_CHANGE_REQUIRED)
    return current


def get_current_user_allow_pending(token: Annotated[str, Depends(auth_scheme)], db: Session = Depends(get_session)) -> model.TokenData:
    """Same as get_current_user but lets a user who must change their password through —
    only for the endpoints the change-password flow itself needs."""
    current, _ = _load_session_user(token, db)
    return current

current_user = Annotated[model.TokenData, Depends(get_current_user)]
