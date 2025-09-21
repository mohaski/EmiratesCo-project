from sqlmodel import SQLModel, create_engine
from sqlalchemy import Engine
from typing import Generator
from sqlmodel import Session
#from ..config import settings
import sys
import os

# Add the parent directory to the path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import settings

# Database URL from configuration
DATABASE_URL = settings.get_database_url()

# Create engine
engine: Engine = create_engine(
    DATABASE_URL,
    echo=False,  # Set to False in production
    
)

def create_db_and_tables():
    """Create database tables from all models"""
    SQLModel.metadata.create_all(engine)

def get_session() -> Generator[Session, None, None]:
    """Get database session"""
    with Session(engine) as session:
        yield session
