#!/bin/bash

# Stop and clean all Airflow data
echo "Stopping and cleaning Airflow..."
docker-compose down -v

echo "Cleaning logs..."
rm -rf logs/*

echo ""
echo "Airflow has been completely cleaned."
echo "All data, logs, and volumes have been removed."
