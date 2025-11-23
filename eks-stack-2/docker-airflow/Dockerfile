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
    python-dotenv==1.0.0
