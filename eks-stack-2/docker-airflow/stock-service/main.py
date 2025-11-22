from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import yfinance as yf
from datetime import datetime, timedelta
import os
from openai import OpenAI

app = FastAPI()

# OpenAI client (set OPENAI_API_KEY environment variable)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

class StockAnalysis(BaseModel):
    symbol: str
    current_price: float
    previous_close: float
    change_percent: float
    day_high: float
    day_low: float
    volume: int
    analysis: str

def get_stock_data(symbol: str) -> dict:
    """Fetch stock data from Yahoo Finance"""
    try:
        stock = yf.Ticker(symbol)
        info = stock.info

        # Get historical data for more context
        hist = stock.history(period="5d")

        if hist.empty:
            raise ValueError(f"No data available for {symbol}")

        latest = hist.iloc[-1]
        previous = hist.iloc[-2] if len(hist) > 1 else latest

        return {
            "symbol": symbol,
            "current_price": round(latest['Close'], 2),
            "previous_close": round(previous['Close'], 2),
            "change_percent": round(((latest['Close'] - previous['Close']) / previous['Close']) * 100, 2),
            "day_high": round(latest['High'], 2),
            "day_low": round(latest['Low'], 2),
            "volume": int(latest['Volume']),
            "company_name": info.get('longName', symbol)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching data for {symbol}: {str(e)}")

def analyze_stocks_with_ai(stocks_data: list) -> str:
    """Use OpenAI to analyze stock data"""

    # Format stock data for AI
    stock_summary = "\n\n".join([
        f"{data['company_name']} ({data['symbol']}):\n"
        f"- Current Price: ${data['current_price']}\n"
        f"- Change: {data['change_percent']:+.2f}%\n"
        f"- Day Range: ${data['day_low']} - ${data['day_high']}\n"
        f"- Volume: {data['volume']:,}"
        for data in stocks_data
    ])

    prompt = f"""Analyze the following US stock data and provide a brief, insightful summary:

{stock_summary}

Please provide:
1. A brief overview of today's performance for these stocks
2. Notable trends or patterns
3. A concise market sentiment assessment

Keep the response professional and under 200 words."""

    try:
        if not client.api_key:
            # If no API key, return a simple summary
            return f"""Stock Analysis Summary - {datetime.now().strftime('%Y-%m-%d')}

{stock_summary}

Note: AI analysis unavailable (no OpenAI API key configured)."""

        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a financial analyst providing stock market insights."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=300,
            temperature=0.7
        )

        ai_analysis = response.choices[0].message.content

        return f"""Stock Analysis Report - {datetime.now().strftime('%Y-%m-%d')}

{stock_summary}

AI Analysis:
{ai_analysis}
"""
    except Exception as e:
        # Fallback if AI fails
        return f"""Stock Analysis Summary - {datetime.now().strftime('%Y-%m-%d')}

{stock_summary}

Note: AI analysis unavailable ({str(e)})"""

@app.get("/")
def root():
    return {
        "service": "Stock Analysis Service",
        "version": "1.0",
        "endpoints": {
            "/stocks": "Get AI analysis for TSLA, PLTR, GOOGL"
        }
    }

@app.get("/health")
def health():
    return {"status": "healthy"}

@app.get("/stocks")
def get_stock_analysis():
    """Get AI-powered analysis of TSLA, PLTR, and GOOGL stocks"""

    symbols = ["TSLA", "PLTR", "GOOGL"]
    stocks_data = []

    # Fetch data for all stocks
    for symbol in symbols:
        try:
            data = get_stock_data(symbol)
            stocks_data.append(data)
        except HTTPException as e:
            return {"error": str(e.detail)}

    # Get AI analysis
    analysis = analyze_stocks_with_ai(stocks_data)

    return {
        "timestamp": datetime.now().isoformat(),
        "stocks": stocks_data,
        "analysis": analysis
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
