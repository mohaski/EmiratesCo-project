from datetime import timedelta, datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4
from fastapi import Depends, HTTPException, status
from passlib.context import CryptContext
import jwt
from jwt import PyJWTError
from sqlmodel import Session, select, or_
from sqlalchemy.exc import IntegrityError
from db.database import get_session
from entities.users import User
from . import model
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from config import settings

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User with this email already exists")
    
    try:
        
        create_user = User(
        userId=uuid4(),
        firstName=register_user_request.firstName,
        secondName=register_user_request.secondName,
        role=register_user_request.role,
        username=register_user_request.username,
        email=register_user_request.email,
        password=hash_password(register_user_request.password),
        phoneNumber=register_user_request.phoneNumber,
        firstLogin= False)
        
        db.add(create_user)
        db.commit()
        db.refresh(create_user)
        
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User details already exist (Duplicate username, email, or phone number)")
        
    except Exception as e:
        db.rollback()
        print(f"DEBUG: Error creating user: {e}")
        raise e
    
def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a stored password against one provided by user"""
        return pwd_context.verify(plain_password, hashed_password)
    
def authenticate_user(identifier: str, password: str, db: Session) -> User | bool:
        """Authenticate user by email OR username and password"""
        user = db.exec(select(User).where(or_(User.email == identifier, User.username == identifier))).first()
        if not user or not verify_password(password, user.password):
            return False
        return user
    
def create_access_token(username: str, email: str, userId: UUID, role: str) -> str:
        """Create a JWT access token with expiry."""
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        encode = {
            "sub": email,
            "username": username,
            "id": str(userId),
            "role": role,
            "exp": expire,
        }
        return jwt.encode(encode, SECRET_KEY, algorithm=ALGORITHM)
    
def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_session)) -> model.Token:
        user= authenticate_user(form_data.username, form_data.password, db)
        if not user:
            raise HTTPException(
                status_code = status.HTTP_401_UNAUTHORIZED,
                detail = "Incorrect email or password",
            )
            
        access_token = create_access_token(
            username = user.username,
            email = user.email,
            userId = user.userId,
            role = user.role
        )
        return model.Token(access_token=access_token, token_type="bearer")
    
def verify_token(token: str) -> model.TokenData:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            userId: str = payload.get("id")
            username: str = payload.get("username")
            email: str = payload.get("sub")
            role: str = payload.get("role")
            if userId is None or email is None or role is None:
                raise HTTPException(
                    status_code = status.HTTP_401_UNAUTHORIZED,
                    detail = "Could not validate credentials",
                )
            return model.TokenData(userId=userId, role=role)
        except PyJWTError:
            raise HTTPException(
                status_code= status.HTTP_401_UNAUTHORIZED,
                detail= "Could not validate credentials",
            )
            
            
def get_current_user(token: Annotated[str, Depends(auth_scheme)]) -> model.TokenData:
    return verify_token(token)

current_user = Annotated[model.TokenData, Depends(get_current_user)]
