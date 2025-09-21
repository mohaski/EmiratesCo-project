#!/usr/bin/env python3
"""
Script to create all database tables from SQLModel models.
Run this script to initialize your database with all tables.
"""

import sys
import os

# Add the server directory to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db import create_db_and_tables, engine
from models import *  # Import all models to register them with SQLModel

def main():
    """Create all database tables"""
    print("Creating database tables...")
    
    try:
        # Create all tables
        create_db_and_tables()
        print("✅ All tables created successfully!")
        
        # Print table information
        print("\n📋 Created tables:")
        for table_name in engine.table_names():
            print(f"  - {table_name}")
            
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
