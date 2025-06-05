from fastapi import FastAPI, Depends
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import os

app = FastAPI(title="Read/Write API")

# Database configuration
WRITER_DB_URL = os.getenv("WRITER_DB_URL")
READER_DB_URL = os.getenv("READER_DB_URL")

# Create separate engines for read and write operations
writer_engine = create_engine(WRITER_DB_URL)
reader_engine = create_engine(READER_DB_URL)

# SessionLocal classes for both connections
WriterSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=writer_engine)
ReaderSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=reader_engine)

Base = declarative_base()

# Dependency for write operations
def get_writer_db():
    db = WriterSessionLocal()
    try:
        yield db
    finally:
        db.close()

# Dependency for read operations
def get_reader_db():
    db = ReaderSessionLocal()
    try:
        yield db
    finally:
        db.close()

# Health check endpoint
@app.get("/health")
def health_check():
    return {"status": "healthy"}

# Import and include routers
from app.routers import read, write

app.include_router(read.router, prefix="/api/read", tags=["read"])
app.include_router(write.router, prefix="/api/write", tags=["write"])