FROM apache/airflow:2.7.3

# Switch to root to install packages
USER root

# Install system dependencies if needed
# RUN apt-get update && apt-get install -y <system-packages> && apt-get clean

# Switch to airflow user to install Python packages
USER airflow

# Install Python packages
RUN pip install --no-cache-dir \
    feedparser==6.0.10 \
    openai==1.54.0 \
    python-dotenv==1.0.0 \
    requests==2.31.0 \
    multitasking==0.0.11 \
    yfinance==0.2.48 \
    plotly==5.24.1 \
    kaleido==0.2.1
