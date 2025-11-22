# Stock Analysis Service

A FastAPI microservice that fetches real-time US stock data and provides AI-powered analysis using OpenAI.

## Features

- ✅ Real-time stock data for TSLA, PLTR, and GOOGL from Yahoo Finance
- ✅ AI-powered analysis using OpenAI GPT-3.5
- ✅ RESTful API with FastAPI
- ✅ Health check endpoint
- ✅ Works without OpenAI API key (basic summary mode)

## API Endpoints

### GET /
Service information and available endpoints

### GET /health
Health check endpoint (returns `{"status": "healthy"}`)

### GET /stocks
Get AI-powered analysis for TSLA, PLTR, and GOOGL

**Response:**
```json
{
  "timestamp": "2025-11-22T10:00:00",
  "stocks": [
    {
      "symbol": "TSLA",
      "current_price": 240.50,
      "previous_close": 238.00,
      "change_percent": 1.05,
      "day_high": 242.00,
      "day_low": 237.50,
      "volume": 45000000,
      "company_name": "Tesla, Inc."
    }
  ],
  "analysis": "AI-powered analysis text..."
}
```

## Configuration

### With OpenAI (Recommended)

1. Get an OpenAI API key: https://platform.openai.com/api-keys
2. Set the environment variable:
   ```bash
   export OPENAI_API_KEY=sk-your-api-key-here
   ```

### Without OpenAI

The service works without an API key but returns a basic summary instead of AI analysis.

## Running Locally

### With Docker (Recommended)
```bash
docker build -t stock-service .
docker run -p 8000:8000 -e OPENAI_API_KEY=your-key stock-service
```

### With Python
```bash
pip install -r requirements.txt
export OPENAI_API_KEY=your-key  # Optional
python main.py
```

Access the API at http://localhost:8000

## Testing

```bash
# Health check
curl http://localhost:8000/health

# Get stock analysis
curl http://localhost:8000/stocks
```

## Dependencies

- **FastAPI**: Web framework
- **yfinance**: Stock data from Yahoo Finance
- **OpenAI**: AI analysis (optional)
- **uvicorn**: ASGI server

## Notes

- Stock data is fetched in real-time from Yahoo Finance (free, no API key needed)
- AI analysis requires OpenAI API key (optional)
- Service runs on port 8000 by default
