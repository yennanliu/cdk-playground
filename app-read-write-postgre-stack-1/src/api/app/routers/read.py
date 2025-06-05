from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..main import get_reader_db

router = APIRouter()

@router.get("/data/{id}")
def read_data(id: int, db: Session = Depends(get_reader_db)):
    try:
        # Example query - modify based on your data model
        result = db.execute(f"SELECT * FROM data WHERE id = {id}").fetchone()
        if result is None:
            raise HTTPException(status_code=404, detail="Data not found")
        return {"id": result[0], "data": result[1]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
