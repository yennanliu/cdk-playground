#!/bin/bash
# Bootstrap script to install Django and start a minimal app on macOS
set -e

# Update and install Python 3 if not already available
if ! command -v python3 &>/dev/null; then
  echo "Installing Python3..."
  brew install python
fi

# Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Django
pip install --upgrade pip
pip install django

# Start project if it doesn't exist
if [ ! -d "mysite" ]; then
  django-admin startproject mysite
fi

cd mysite
python3 manage.py migrate

# Run server
python3 manage.py runserver 0.0.0.0:8080