# Database Setup Guide

This guide explains how to set up and create database tables for the EmiratesCo project.

## Prerequisites

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

## Database Configuration

The database configuration is located in `db/__init__.py`. By default, it uses SQLite, but you can change it to any database supported by SQLAlchemy.


### PostgreSQL Example
```python
DATABASE_URL = "postgresql://username:password@localhost/emiratesco"
```

### MySQL Example
```python
DATABASE_URL = "mysql+pymysql://username:password@localhost/emiratesco"
```

## Creating Tables

### Method 1: Using the Script (Recommended)
```bash
cd server
python create_tables.py
```

### Method 2: Using FastAPI Startup
When you run the FastAPI application, tables are automatically created on startup:
```bash
cd server
uvicorn main:app --reload
```

### Method 3: Programmatically
```python
from db import create_db_and_tables
from models import *  # Import all models

# Create all tables
create_db_and_tables()
```

## Models Included

The following tables will be created:

1. **users** - User accounts and authentication
2. **customers** - Customer information
3. **products** - Product catalog
4. **orders** - Order records
5. **orderitems** - Individual items in orders
6. **offcuts** - Product offcuts tracking
7. **payments** - Payment records
8. **credits** - Credit/installment tracking
9. **messages** - Internal messaging system
10. **messagerecipients** - Message recipients

## Database Session Usage

To use the database in your FastAPI endpoints:

```python
from fastapi import Depends
from sqlmodel import Session
from db import get_session

@app.get("/users/")
def get_users(session: Session = Depends(get_session)):
    users = session.query(User).all()
    return users
```

## Environment Variables

You can set the database URL using environment variables:

```bash
export DATABASE_URL="postgresql://user:pass@localhost/emiratesco"
python create_tables.py
```

## Troubleshooting

1. **Import Errors**: Make sure all model files are properly imported in `models/__init__.py`
2. **Database Connection**: Check your DATABASE_URL format
3. **Permissions**: Ensure your database user has CREATE TABLE permissions
4. **Dependencies**: Make sure all required packages are installed

## Next Steps

After creating the tables, you can:
1. Add sample data
2. Create API endpoints for CRUD operations
3. Set up database migrations
4. Add database indexes for performance
