from datetime import timedelta, datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4
from fastapi import Depends, HTTPException, status
from passlib.context import CryptContext
import jwt
from jwt import PyJWTError
from sqlmodel import Session, select
from db.database import get_session
from entities.users import User
from . import models
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
#from ..exceptions import AuthenticationError
#import logging

# You would want to store this in an environment variable or a secret manager
SECRET_KEY = '197b2c37c391bed93fe80344fe73b806947a65e36206e05a1a23c2fa12702fe3'
ALGORITHM = 'HS256'

argon_context = CryptContext(schemes=["argon2"], deprecated="auto")
auth_scheme = OAuth2PasswordBearer(tokenUrl="token")



def hash_password(password: str) -> str:
    """Hash a password for storing."""
    return argon_context.hash(password)

def userRegistration(register_user_request: models.UserRegistrationRequest, db: Session = Depends(get_session)) -> None:
    
    """Register a new user"""
    # Check if user already exists
    from sqlmodel import select

    existing_user = db.exec(select(User).where(User.email == register_user_request.email)).first()
    if existing_user:
        raise ValueError("User with this email already exists")
    
    try:
        
        create_user = User(
        userId=uuid4(),
        firstName=register_user_request.firstName,
        lastName=register_user_request.lastName,    
        role=register_user_request.role,
        email=register_user_request.email,
        password=hash_password(register_user_request.password),
        phoneNumber=register_user_request.phoneNumber)
        
        db.add(create_user)
        db.commit()
        
    except Exception as e:
        db.rollback()
        raise e
    
def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a stored password against one provided by user"""
        return argon_context.verify(plain_password, hashed_password)
    
def authenticate_user(email: str, password: str, db: Session) -> User | bool:
        """Authenticate user by email and password"""
        user = db.exec(select(User).where(User.email == email)).first()
        if not user or not verify_password(password, user.password):
            return False
        return user
    
def create_access_token(email: str, userId: UUID, role: str) -> str:
        """Create a JWT access token"""
        encode = {
            "sub": email,
            "id": str(userId),
            "role": role,
        }
        return jwt.encode(encode, SECRET_KEY, algorithm=ALGORITHM)
    
def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_session)) -> models.Token:
        user= authenticate_user(form_data.username, form_data.password, db)
        if not user:
            raise HTTPException(
                status_code = status.HTTP_401_UNAUTHORIZED,
                detail = "Incorrect email or password",
            )
            
        access_token = create_access_token(
            email = user.email,
            userId = user.userId,
            role = user.role
        )
        return models.Token(access_token=access_token, token_type="bearer")
    
def verify_token(token: str) -> models.TokenData:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            userId: str = payload.get("id")
            email: str = payload.get("sub")
            role: str = payload.get("role")
            if userId is None or email is None or role is None:
                raise HTTPException(
                    status_code = status.HTTP_401_UNAUTHORIZED,
                    detail = "Could not validate credentials",
                )
            return models.TokenData(userId=userId, role=role)
        except PyJWTError:
            raise HTTPException(
                status_code= status.HTTP_401_UNAUTHORIZED,
                detail= "Could not validate credentials",
            )
            
            
def get_current_user(token: Annotated[str, Depends(auth_scheme)]) -> models.TokenData:
    return verify_token(token)

current_user = Annotated[models.TokenData, Depends(get_current_user)]