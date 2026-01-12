from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session
from db.database import create_db_and_tables, get_session
from entities import *

# Import Controllers
from core.ordering.controller import router as ordering_router
from core.inventory.products.controller import router as products_router
from core.financials.controller import router as financials_router
from core.userManagement.controller import router as users_router
from core.messaging.controller import router as messaging_router

# Create FastAPI app
app = FastAPI(title="EmiratesCo API", version="1.0.0")

# CORS Configuration
origins = [
    "http://localhost:5173", # Vite Default
    "http://localhost:3000",
    "*" # Allow all for dev
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(ordering_router)
app.include_router(products_router)
app.include_router(financials_router)
app.include_router(users_router)
app.include_router(messaging_router)

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