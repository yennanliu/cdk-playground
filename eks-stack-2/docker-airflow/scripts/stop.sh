#!/bin/bash

# Stop Airflow services
echo "Stopping Airflow..."
docker-compose down

echo "Airflow stopped."
echo "To remove all data including database, run: docker-compose down -v"
