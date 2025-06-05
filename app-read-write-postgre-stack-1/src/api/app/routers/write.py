from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..main import get_writer_db
from pydantic import BaseModel

router = APIRouter()

class DataCreate(BaseModel):
    content: str

@router.post("/data")
def create_data(data: DataCreate, db: Session = Depends(get_writer_db)):
    try:
        # Example query - modify based on your data model
        result = db.execute(
            "INSERT INTO data (content) VALUES (:content) RETURNING id",
            {"content": data.content}
        )
        db.commit()
        return {"id": result.fetchone()[0], "content": data.content}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
