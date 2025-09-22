from fastapi import FastAPI, Depends
from sqlmodel import Session
from db.database import create_db_and_tables, get_session
from entities import *

# Create FastAPI app
app = FastAPI(title="EmiratesCo API")

# Create database tables on startup
@app.on_event("startup")
def on_startup():
    create_db_and_tables()

@app.get('/')
async def root():
    return {"message": "EmiratesCo API is running!"}

@app.get('/health')
async def health_check(session: Session = Depends(get_session)):
    return {"status": "healthy", "database": "connected"}