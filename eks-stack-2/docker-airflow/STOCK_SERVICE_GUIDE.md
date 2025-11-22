# Stock Analysis Service + Email DAG Guide

Complete setup guide for the stock analysis service and automated email DAG.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Airflow DAG (stock_analysis_email_dag)        │
│  ┌──────────────┐      ┌─────────────────┐    │
│  │ Fetch Stock  │ ───> │ Send Email      │    │
│  │ Analysis     │      │ (Brevo SMTP)    │    │
│  └──────────────┘      └─────────────────┘    │
│         │                                       │
│         ▼                                       │
│  ┌──────────────────────────────────────────┐  │
│  │  Stock Service (FastAPI)                 │  │
│  │  - Fetches TSLA, PLTR, GOOGL data       │  │
│  │  - AI analysis with OpenAI              │  │
│  │  - Returns formatted report              │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Quick Start

### 1. Optional: Add OpenAI API Key

If you want AI-powered analysis (recommended):

1. Get API key from https://platform.openai.com/api-keys
2. Create `.env` file in `docker-airflow/`:
   ```bash
   echo "OPENAI_API_KEY=sk-your-api-key-here" > .env
   ```

**Note:** Service works without API key but gives basic summary instead of AI analysis.

### 2. Build and Start Services

```bash
cd docker-airflow

# Build the stock service
docker-compose build stock-service

# Start all services
docker-compose up -d
```

### 3. Verify Stock Service

```bash
# Check if service is healthy
curl http://localhost:8000/health

# Test stock analysis (wait 30 seconds after startup)
curl http://localhost:8000/stocks
```

You should see stock data and analysis!

### 4. Configure Email in DAG

Edit `dags/dag_stock_email.py` if needed:

```python
SMTP_LOGIN = "your-brevo-login"
SMTP_PASSWORD = "your-brevo-smtp-key"
SENDER_EMAIL = "your-verified-email@gmail.com"
RECIPIENT_EMAIL = "recipient@gmail.com"
```

### 5. Trigger the DAG

1. Go to http://localhost:8080 (admin/admin)
2. Find `stock_analysis_email_dag`
3. Toggle it ON
4. Click **▶ Play** to trigger manually
5. Check your email!

## Services Overview

### Stock Service (Port 8000)
- **URL**: http://localhost:8000
- **Endpoints**:
  - `GET /`: Service info
  - `GET /health`: Health check
  - `GET /stocks`: Stock analysis

### Airflow (Port 8080)
- **URL**: http://localhost:8080
- **Login**: admin / admin

## DAG Configuration

### Schedule

The DAG runs **automatically at 9 AM on weekdays** (Mon-Fri):

```python
schedule_interval="0 9 * * 1-5"
```

To change:
- `"@daily"` - Every day at midnight
- `"0 16 * * 1-5"` - 4 PM on weekdays
- `"@hourly"` - Every hour
- `None` - Manual trigger only

### Stock Symbols

To change stocks, edit `stock-service/main.py`:

```python
symbols = ["TSLA", "PLTR", "GOOGL"]  # Change these
```

Then rebuild:
```bash
docker-compose build stock-service
docker-compose restart stock-service
```

## Monitoring

### View Stock Service Logs
```bash
docker-compose logs -f stock-service
```

### View Airflow Scheduler Logs
```bash
docker-compose logs -f airflow-scheduler
```

### Check DAG Execution
1. Go to Airflow UI: http://localhost:8080
2. Click on `stock_analysis_email_dag`
3. View task logs and execution history

## Troubleshooting

### Stock Service Not Starting

```bash
# Check logs
docker-compose logs stock-service

# Rebuild
docker-compose build stock-service
docker-compose up -d stock-service
```

### Email Not Sending

1. **Check Brevo credentials** in `dag_stock_email.py`
2. **Verify sender email** at https://app.brevo.com/senders
3. **Check DAG logs** in Airflow UI

### No Stock Data

- **Wait 30 seconds** after starting stock service
- **Check internet connection** (needs to reach Yahoo Finance)
- **Test manually**: `curl http://localhost:8000/stocks`

### OpenAI API Issues

If you see OpenAI errors:
1. Check API key is valid
2. Check OpenAI account has credits
3. Service will fall back to basic summary if OpenAI fails

## Example Output

### Stock Service Response
```json
{
  "timestamp": "2025-11-22T09:00:00",
  "stocks": [
    {
      "symbol": "TSLA",
      "current_price": 240.50,
      "change_percent": 1.05,
      ...
    }
  ],
  "analysis": "Stock Analysis Report - 2025-11-22\n\nTesla (TSLA): $240.50 (+1.05%)..."
}
```

### Email Content
```
Subject: Daily Stock Analysis - 2025-11-22

Hello!

Here is your daily stock analysis for TSLA, PLTR, and GOOGL:

Tesla, Inc. (TSLA):
- Current Price: $240.50
- Change: +1.05%
- Day Range: $237.50 - $242.00

[AI Analysis]
Tesla shows positive momentum with a 1.05% gain...
```

## Stopping Services

```bash
# Stop all services
docker-compose down

# Stop and remove all data
docker-compose down -v
```

## Cost Considerations

- **Yahoo Finance**: Free, no API key needed
- **Brevo**: Free tier (300 emails/day)
- **OpenAI**: ~$0.002 per request with GPT-3.5-turbo (optional)

If running daily, OpenAI costs = ~$0.06/month (30 days × $0.002)
