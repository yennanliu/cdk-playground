#!/bin/bash

# Start Airflow with Docker Compose
echo "Starting Airflow..."
echo "This may take a few minutes on first run..."

# Check if .env exists, if not create from example
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    #cp .env.example .env
    echo "Please edit .env file with your settings"
fi

# Start services
docker-compose up -d

echo ""
echo "Airflow is starting up..."
echo "Access the web UI at: http://localhost:8080"
echo "Username: admin"
echo "Password: admin"
echo ""
echo "Check status with: docker-compose ps"
echo "View logs with: docker-compose logs -f"
