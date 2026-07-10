"""
RAG Orchestrator Service.

This service orchestrates the Retrieval-Augmented Generation (RAG) pipeline
by coordinating between Weaviate (vector database), embedding service,
and vLLM (inference server).
"""

import logging
import os
from typing import List, Optional

import httpx
import weaviate
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="RAG Orchestrator",
    description="Retrieval-Augmented Generation orchestration service",
    version="1.0.0",
)

# Service URLs from environment
WEAVIATE_URL = os.getenv("WEAVIATE_URL", "http://weaviate-client:8080")
VLLM_URL = os.getenv("VLLM_URL", "http://vllm:8000")
EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://embedding-service:8080")

# Global Weaviate client
weaviate_client = None


class QueryRequest(BaseModel):
    """Request model for RAG query."""

    query: str
    top_k: int = 5
    max_tokens: int = 512
    temperature: float = 0.7


class Source(BaseModel):
    """Source document model."""

    content: str
    metadata: dict


class QueryResponse(BaseModel):
    """Response model for RAG query."""

    answer: str
    sources: List[Source]
    query: str


@app.on_event("startup")
async def startup():
    """Initialize connections on startup."""
    global weaviate_client

    logger.info(f"Connecting to Weaviate at {WEAVIATE_URL}")
    try:
        weaviate_client = weaviate.Client(url=WEAVIATE_URL)
        logger.info("Connected to Weaviate successfully")

        # Check if schema exists, create if not
        schema = weaviate_client.schema.get()
        if not any(cls["class"] == "Document" for cls in schema.get("classes", [])):
            logger.info("Creating Weaviate schema for Document class")
            weaviate_client.schema.create_class({
                "class": "Document",
                "description": "A document with vector embeddings",
                "vectorizer": "none",
                "properties": [
                    {
                        "name": "content",
                        "dataType": ["text"],
                        "description": "Document content",
                    },
                    {
                        "name": "metadata",
                        "dataType": ["object"],
                        "description": "Document metadata",
                    },
                ],
            })
            logger.info("Schema created successfully")

    except Exception as e:
        logger.error(f"Failed to connect to Weaviate: {e}")
        raise


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    health_status = {
        "status": "healthy",
        "services": {
            "weaviate": "unknown",
            "vllm": "unknown",
            "embedding": "unknown",
        },
    }

    # Check Weaviate
    try:
        if weaviate_client and weaviate_client.is_ready():
            health_status["services"]["weaviate"] = "healthy"
    except Exception as e:
        logger.error(f"Weaviate health check failed: {e}")
        health_status["services"]["weaviate"] = "unhealthy"

    # Check vLLM
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{VLLM_URL}/health")
            if response.status_code == 200:
                health_status["services"]["vllm"] = "healthy"
    except Exception as e:
        logger.error(f"vLLM health check failed: {e}")
        health_status["services"]["vllm"] = "unhealthy"

    # Check Embedding service
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{EMBEDDING_SERVICE_URL}/health")
            if response.status_code == 200:
                health_status["services"]["embedding"] = "healthy"
    except Exception as e:
        logger.error(f"Embedding service health check failed: {e}")
        health_status["services"]["embedding"] = "unhealthy"

    # Overall status
    if any(status == "unhealthy" for status in health_status["services"].values()):
        health_status["status"] = "degraded"

    return health_status


@app.post("/query", response_model=QueryResponse)
async def rag_query(request: QueryRequest):
    """
    Process a RAG query.

    Steps:
    1. Generate embedding for the query
    2. Retrieve relevant documents from Weaviate
    3. Construct prompt with context
    4. Call vLLM for generation
    5. Return answer with sources
    """
    logger.info(f"Processing RAG query: {request.query[:100]}...")

    try:
        # Step 1: Generate query embedding
        logger.info("Generating query embedding...")
        async with httpx.AsyncClient(timeout=30.0) as client:
            embed_response = await client.post(
                f"{EMBEDDING_SERVICE_URL}/embed",
                json={"text": request.query, "normalize": True},
            )
            embed_response.raise_for_status()
            query_embedding = embed_response.json()["embeddings"][0]

        logger.info(f"Generated embedding with dimension: {len(query_embedding)}")

        # Step 2: Retrieve relevant documents from Weaviate
        logger.info(f"Retrieving top {request.top_k} documents from Weaviate...")
        results = (
            weaviate_client.query.get("Document", ["content", "metadata"])
            .with_near_vector({"vector": query_embedding})
            .with_limit(request.top_k)
            .do()
        )

        documents = results.get("data", {}).get("Get", {}).get("Document", [])
        logger.info(f"Retrieved {len(documents)} documents")

        if not documents:
            logger.warning("No documents retrieved from Weaviate")
            return QueryResponse(
                answer="I don't have enough information to answer this question.",
                sources=[],
                query=request.query,
            )

        # Step 3: Construct prompt with context
        context = "\n\n".join([doc["content"] for doc in documents])
        prompt = f"""Context:
{context}

Question: {request.query}

Based on the context provided above, please provide a detailed answer to the question. If the context doesn't contain relevant information, say so.

Answer:"""

        logger.info("Sending prompt to vLLM...")

        # Step 4: Call vLLM for generation
        async with httpx.AsyncClient(timeout=60.0) as client:
            llm_response = await client.post(
                f"{VLLM_URL}/v1/completions",
                json={
                    "model": "qwen2.5-7b-sft",
                    "prompt": prompt,
                    "max_tokens": request.max_tokens,
                    "temperature": request.temperature,
                    "top_p": 0.9,
                    "stop": ["\n\nQuestion:", "\n\nContext:"],
                },
            )
            llm_response.raise_for_status()
            answer = llm_response.json()["choices"][0]["text"].strip()

        logger.info("Generated answer successfully")

        # Step 5: Format sources
        sources = [
            Source(
                content=doc["content"],
                metadata=doc.get("metadata", {}),
            )
            for doc in documents
        ]

        return QueryResponse(
            answer=answer,
            sources=sources,
            query=request.query,
        )

    except httpx.HTTPError as e:
        logger.error(f"HTTP error during RAG query: {e}")
        raise HTTPException(status_code=502, detail=f"Service communication error: {str(e)}")
    except Exception as e:
        logger.error(f"Error during RAG query: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest")
async def ingest_document(content: str, metadata: Optional[dict] = None):
    """
    Ingest a document into Weaviate.

    Args:
        content: Document content
        metadata: Optional document metadata
    """
    try:
        # Generate embedding
        async with httpx.AsyncClient(timeout=30.0) as client:
            embed_response = await client.post(
                f"{EMBEDDING_SERVICE_URL}/embed",
                json={"text": content, "normalize": True},
            )
            embed_response.raise_for_status()
            embedding = embed_response.json()["embeddings"][0]

        # Store in Weaviate
        weaviate_client.data_object.create(
            data_object={
                "content": content,
                "metadata": metadata or {},
            },
            class_name="Document",
            vector=embedding,
        )

        return {"status": "success", "message": "Document ingested successfully"}

    except Exception as e:
        logger.error(f"Error ingesting document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "RAG Orchestrator",
        "endpoints": {
            "health": "/health",
            "query": "/query (POST)",
            "ingest": "/ingest (POST)",
            "docs": "/docs",
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
