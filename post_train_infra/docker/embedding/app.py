"""
Embedding service using sentence-transformers.

This service provides a REST API for generating text embeddings using
sentence-transformers models.
"""

import logging
import os
from typing import List, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Embedding Service",
    description="Text embedding generation using sentence-transformers",
    version="1.0.0",
)

# Global model variable
model = None
model_name = os.getenv("MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")
device = os.getenv("DEVICE", "cpu")


class EmbedRequest(BaseModel):
    """Request model for embedding generation."""

    text: Union[str, List[str]]
    normalize: bool = True


class EmbedResponse(BaseModel):
    """Response model for embedding generation."""

    embeddings: List[List[float]]
    model: str
    dimension: int


@app.on_event("startup")
async def load_model():
    """Load the sentence-transformers model on startup."""
    global model
    logger.info(f"Loading model: {model_name} on device: {device}")
    try:
        model = SentenceTransformer(model_name, device=device)
        logger.info(f"Model loaded successfully. Embedding dimension: {model.get_sentence_embedding_dimension()}")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {
        "status": "healthy",
        "model": model_name,
        "device": device,
        "dimension": model.get_sentence_embedding_dimension(),
    }


@app.post("/embed", response_model=EmbedResponse)
async def generate_embeddings(request: EmbedRequest):
    """
    Generate embeddings for the provided text.

    Args:
        request: EmbedRequest containing text (string or list of strings)

    Returns:
        EmbedResponse with embeddings, model name, and dimension
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        # Convert single string to list
        texts = [request.text] if isinstance(request.text, str) else request.text

        # Generate embeddings
        embeddings = model.encode(
            texts,
            normalize_embeddings=request.normalize,
            convert_to_numpy=True,
        )

        # Convert to list of lists
        embeddings_list = embeddings.tolist()

        return EmbedResponse(
            embeddings=embeddings_list,
            model=model_name,
            dimension=model.get_sentence_embedding_dimension(),
        )

    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "Embedding Service",
        "model": model_name,
        "endpoints": {
            "health": "/health",
            "embed": "/embed (POST)",
            "docs": "/docs",
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
