#!/bin/bash
# Bootstrap script to install Django and start a minimal app
set -e
sudo apt update -y
sudo apt install -y python3 python3-pip python3-venv

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install django
if [ ! -d "mysite" ]; then
  django-admin startproject mysite
fi
cd mysite
python3 manage.py migrate
#nohup python3 manage.py runserver 0.0.0.0:8080 &
python3 manage.py runserver 0.0.0.0:8080