from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
import feedparser
import os
from openai import OpenAI
import yfinance as yf
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import io

# Email configuration - using environment variables
SMTP_HOST = "smtp-relay.brevo.com"
SMTP_PORT = 587
SMTP_LOGIN = os.getenv('SMTP_LOGIN', '')
SMTP_PASSWORD = os.getenv('SENDER_PASSWORD', '')
SENDER_EMAIL = os.getenv('SENDER_EMAIL', '')
RECIPIENT_EMAIL = os.getenv('RECIPIENT_EMAIL', '')

# Stock tickers to analyze
STOCK_TICKERS = ['TSLA', 'PLTR', 'GOOGL']
NUM_ARTICLES_PER_STOCK = 5
CHART_PERIOD = '1mo'


def fetch_stock_news(ticker, num_articles=5):
    """
    Fetch latest news for a specific stock ticker from Google News RSS

    Args:
        ticker: Stock ticker symbol (e.g., 'TSLA', 'PLTR')
        num_articles: Number of articles to fetch

    Returns:
        List of article dictionaries
    """
    url = f'https://news.google.com/rss/search?q={ticker}+stock&hl=en-US&gl=US&ceid=US:en'

    feed = feedparser.parse(url)

    articles = []
    for entry in feed.entries[:num_articles]:
        article = {
            'ticker': ticker,
            'title': entry.title,
            'link': entry.link,
            'published': entry.published if 'published' in entry else 'N/A',
            'summary': entry.summary if 'summary' in entry else entry.title
        }
        articles.append(article)

    return articles


def fetch_stock_price_data(ticker, period='1mo'):
    """
    Fetch historical stock price data

    Args:
        ticker: Stock ticker symbol
        period: Time period ('1d', '5d', '1mo', '3mo', '6mo', '1y', etc.)

    Returns:
        Dictionary with stock price data
    """
    stock = yf.Ticker(ticker)
    data = stock.history(period=period)

    # Get current info
    info = stock.info
    current_price = info.get('currentPrice', data['Close'].iloc[-1] if len(data) > 0 else 'N/A')

    return {
        'data': data,
        'current_price': current_price,
        'info': info
    }


def create_stock_chart_image(ticker, stock_data, period='1mo'):
    """
    Create an interactive stock price chart and export as PNG

    Args:
        ticker: Stock ticker symbol
        stock_data: Stock data dictionary from fetch_stock_price_data
        period: Time period for the chart

    Returns:
        PNG image bytes
    """
    df = stock_data['data']
    current_price = stock_data['current_price']

    # Create figure with secondary y-axis
    fig = make_subplots(
        rows=2, cols=1,
        row_heights=[0.7, 0.3],
        vertical_spacing=0.05,
        subplot_titles=(f'{ticker} Stock Price', 'Volume')
    )

    # Add candlestick chart
    fig.add_trace(
        go.Candlestick(
            x=df.index,
            open=df['Open'],
            high=df['High'],
            low=df['Low'],
            close=df['Close'],
            name='Price'
        ),
        row=1, col=1
    )

    # Add volume bar chart
    fig.add_trace(
        go.Bar(
            x=df.index,
            y=df['Volume'],
            name='Volume',
            marker_color='rgba(102, 126, 234, 0.5)'
        ),
        row=2, col=1
    )

    # Calculate price change
    start_price = df['Close'].iloc[0]
    end_price = df['Close'].iloc[-1]
    price_change = ((end_price - start_price) / start_price) * 100

    # Set color based on price change
    title_color = 'green' if price_change >= 0 else 'red'

    # Update layout
    fig.update_layout(
        title=f'<b>{ticker} Stock Price - {period.upper()}</b><br>' +
              f'<span style="color:{title_color};">Current: ${current_price:.2f} ' +
              f'({price_change:+.2f}%)</span>',
        height=600,
        showlegend=False,
        template='plotly_white'
    )

    fig.update_xaxes(title_text="Date", row=2, col=1)
    fig.update_yaxes(title_text="Price ($)", row=1, col=1)
    fig.update_yaxes(title_text="Volume", row=2, col=1)

    # Export as PNG bytes
    img_bytes = fig.to_image(format="png", width=1000, height=600)
    return img_bytes


def summarize_stock_news_with_references(ticker, articles):
    """
    Generate an AI summary with references to specific news articles

    Args:
        ticker: Stock ticker symbol
        articles: List of article dictionaries

    Returns:
        Dictionary with summary and referenced articles
    """
    # Get OpenAI API key from environment
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        return {
            'summary': f"ERROR: OPENAI_API_KEY not found in environment for {ticker}",
            'articles': articles
        }

    client = OpenAI(api_key=api_key)

    # Prepare articles with numbering for reference
    news_text = "\n\n".join([
        f"[{i+1}] {article['title']}\nSource: {article['summary']}"
        for i, article in enumerate(articles)
    ])

    # Call OpenAI API with instruction to reference articles
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": """You are a financial analyst assistant that summarizes stock news.
                Provide concise, objective summaries highlighting key developments, market sentiment, and potential impacts.
                IMPORTANT: When referencing information, cite the article number in brackets like [1], [2], etc."""
            },
            {
                "role": "user",
                "content": f"""Please provide a brief summary of recent news for {ticker} stock based on these articles.
                When you mention specific information, reference the article number in brackets.

                Articles:
                {news_text}"""
            }
        ],
        max_tokens=600,
        temperature=0.7
    )

    return {
        'summary': response.choices[0].message.content,
        'articles': articles
    }


def analyze_stock_enhanced(ticker, num_articles=5, chart_period='1mo'):
    """
    Complete enhanced stock analysis with formatting, charts, and references

    Args:
        ticker: Stock ticker symbol
        num_articles: Number of news articles to fetch
        chart_period: Time period for price chart ('1d', '5d', '1mo', '3mo', '6mo', '1y')

    Returns:
        Dictionary with all analysis data including chart image
    """
    print(f"🔍 Analyzing {ticker}...")

    # Fetch news
    print(f"📰 Fetching latest news for {ticker}...")
    articles = fetch_stock_news(ticker, num_articles)
    print(f"✓ Found {len(articles)} articles")

    # Fetch stock data
    print(f"📊 Fetching stock price data...")
    stock_data = fetch_stock_price_data(ticker, chart_period)
    print(f"✓ Retrieved {chart_period} price data")

    # Generate AI summary with references
    print(f"🤖 Generating AI summary with references...")
    summary_data = summarize_stock_news_with_references(ticker, articles)
    print(f"✓ Summary generated")

    # Generate chart image
    print(f"📈 Creating stock price chart...")
    chart_image = create_stock_chart_image(ticker, stock_data, chart_period)
    print(f"✓ Chart created")

    # Calculate additional metrics
    df = stock_data['data']
    start_price = df['Close'].iloc[0]
    end_price = df['Close'].iloc[-1]
    price_change = ((end_price - start_price) / start_price) * 100
    info = stock_data['info']

    return {
        'ticker': ticker,
        'company_name': info.get('longName', ticker),
        'current_price': stock_data['current_price'],
        'price_change': price_change,
        'market_cap': info.get('marketCap', 'N/A'),
        'summary': summary_data['summary'],
        'articles': summary_data['articles'],
        'chart_image': chart_image
    }


def fetch_and_analyze_stocks(**context):
    """
    Fetch stock news, generate AI summaries, and create charts for all stocks.
    Returns the combined analysis with chart images.
    """
    all_analyses = []

    for ticker in STOCK_TICKERS:
        print(f"\n{'='*60}")
        print(f"Processing {ticker}...")
        print(f"{'='*60}")

        try:
            analysis = analyze_stock_enhanced(ticker, NUM_ARTICLES_PER_STOCK, CHART_PERIOD)
            all_analyses.append(analysis)
            print(f"✓ Successfully analyzed {ticker}")

        except Exception as e:
            error_msg = f"Error processing {ticker}: {str(e)}"
            print(error_msg)
            all_analyses.append({
                'ticker': ticker,
                'error': error_msg
            })

    # Push to XCom for the email task
    return all_analyses


def create_html_email_body(analyses):
    """
    Create beautiful HTML email body with stock analyses

    Args:
        analyses: List of analysis dictionaries

    Returns:
        HTML string for email body
    """
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
            }
            .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px;
                border-radius: 15px;
                text-align: center;
                margin-bottom: 30px;
            }
            .stock-section {
                margin-bottom: 40px;
                border: 1px solid #e0e0e0;
                border-radius: 10px;
                overflow: hidden;
            }
            .stock-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
            }
            .stock-price {
                font-size: 32px;
                font-weight: bold;
            }
            .price-change {
                font-size: 18px;
                margin-left: 10px;
            }
            .positive {
                color: #28a745;
            }
            .negative {
                color: #dc3545;
            }
            .summary-section {
                background: #f8f9fa;
                padding: 20px;
                border-left: 5px solid #667eea;
            }
            .articles-section {
                padding: 20px;
            }
            .article-item {
                padding: 12px;
                margin: 10px 0;
                background: #f8f9fa;
                border-radius: 8px;
                border-left: 4px solid #667eea;
            }
            .article-number {
                background: #667eea;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-weight: bold;
                margin-right: 10px;
            }
            .chart-image {
                max-width: 100%;
                height: auto;
                margin: 20px 0;
            }
            .footer {
                text-align: center;
                color: #888;
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #e0e0e0;
                font-size: 14px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📈 Enhanced Stock Analysis Report</h1>
            <p>""" + datetime.now().strftime('%B %d, %Y') + """</p>
        </div>
    """

    for i, analysis in enumerate(analyses):
        if 'error' in analysis:
            html += f"""
            <div class="stock-section">
                <div class="stock-header">
                    <h2>{analysis['ticker']} - Error</h2>
                </div>
                <div class="summary-section">
                    <p style="color: #dc3545;">{analysis['error']}</p>
                </div>
            </div>
            """
            continue

        # Format market cap
        market_cap = analysis['market_cap']
        if market_cap != 'N/A' and isinstance(market_cap, (int, float)):
            market_cap_str = f"${market_cap/1e9:.2f}B" if market_cap > 1e9 else f"${market_cap/1e6:.2f}M"
        else:
            market_cap_str = 'N/A'

        # Price change formatting
        price_change = analysis['price_change']
        change_class = 'positive' if price_change >= 0 else 'negative'
        change_symbol = '▲' if price_change >= 0 else '▼'

        html += f"""
        <div class="stock-section">
            <div class="stock-header">
                <h2>{analysis['ticker']} - {analysis['company_name']}</h2>
                <div class="stock-price">
                    ${analysis['current_price']:.2f}
                    <span class="price-change {change_class}">
                        {change_symbol} {abs(price_change):.2f}%
                    </span>
                </div>
                <div style="margin-top: 10px; font-size: 14px; opacity: 0.9;">
                    Market Cap: {market_cap_str}
                </div>
            </div>

            <div style="text-align: center; padding: 20px; background: white;">
                <img src="cid:chart_{i}" class="chart-image" alt="{analysis['ticker']} Chart">
            </div>

            <div class="summary-section">
                <h3>🤖 AI-Powered News Summary</h3>
                <p>{analysis['summary']}</p>
            </div>

            <div class="articles-section">
                <h3>📰 Referenced News Articles</h3>
        """

        for j, article in enumerate(analysis['articles'], 1):
            html += f"""
                <div class="article-item">
                    <span class="article-number">[{j}]</span>
                    <a href="{article['link']}" style="color: #333; text-decoration: none; font-weight: 500;">
                        {article['title']}
                    </a>
                    <div style="color: #888; font-size: 13px; margin-top: 5px;">
                        📅 {article['published']}
                    </div>
                </div>
            """

        html += """
            </div>
        </div>
        """

    html += """
        <div class="footer">
            <p>📧 This email was automatically generated by your Airflow DAG</p>
            <p>🤖 Powered by OpenAI GPT-4o-mini and Yahoo Finance</p>
            <p>📊 Charts generated with Plotly</p>
        </div>
    </body>
    </html>
    """

    return html


def send_enhanced_stock_email(**context):
    """
    Send enhanced stock analysis email with charts using Brevo SMTP.
    Fetches the analysis from the previous task.
    """
    # Get the stock analyses from XCom (passed from previous task)
    ti = context['ti']
    analyses = ti.xcom_pull(task_ids='fetch_and_analyze_stocks')

    if not analyses:
        analyses = [{'ticker': 'N/A', 'error': 'No stock analysis data available'}]

    try:
        # Create message
        message = MIMEMultipart('related')
        message["From"] = SENDER_EMAIL
        message["To"] = RECIPIENT_EMAIL
        message["Subject"] = f"📈 Enhanced Stock Analysis Report - {datetime.now().strftime('%Y-%m-%d')}"

        # Create HTML body
        html_body = create_html_email_body(analyses)

        # Attach HTML body
        message.attach(MIMEText(html_body, "html"))

        # Attach chart images
        for i, analysis in enumerate(analyses):
            if 'chart_image' in analysis and analysis['chart_image']:
                img = MIMEImage(analysis['chart_image'])
                img.add_header('Content-ID', f'<chart_{i}>')
                img.add_header('Content-Disposition', 'inline', filename=f'{analysis["ticker"]}_chart.png')
                message.attach(img)

        # Connect to Brevo SMTP server
        print(f"Connecting to {SMTP_HOST}:{SMTP_PORT}...")
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()  # Enable TLS encryption

        # Login with Brevo credentials
        print(f"Logging in to Brevo with {SMTP_LOGIN}...")
        server.login(SMTP_LOGIN, SMTP_PASSWORD)

        # Send email
        print(f"Sending email to {RECIPIENT_EMAIL}...")
        server.send_message(message)

        # Close connection
        server.quit()
        print("✓ Enhanced stock analysis email sent successfully!")

    except Exception as e:
        print(f"Failed to send email: {str(e)}")
        raise


with DAG(
    dag_id="stock_enhanced_analysis_email_dag",
    start_date=datetime(2023, 1, 1),
    schedule_interval="0 9 * * 1-5",  # Run at 9 AM on weekdays (Mon-Fri)
    catchup=False,
    description="Enhanced stock analysis with charts, AI summaries, and email delivery",
    tags=['stocks', 'email', 'openai', 'charts', 'enhanced']
) as dag:

    # Task 1: Fetch stock news, generate AI summaries, and create charts
    fetch_task = PythonOperator(
        task_id="fetch_and_analyze_stocks",
        python_callable=fetch_and_analyze_stocks,
        provide_context=True
    )

    # Task 2: Send the enhanced analysis via email with charts
    email_task = PythonOperator(
        task_id="send_enhanced_stock_email",
        python_callable=send_enhanced_stock_email,
        provide_context=True
    )

    # Define task dependencies
    fetch_task >> email_task
