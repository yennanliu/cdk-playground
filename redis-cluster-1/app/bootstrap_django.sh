#!/bin/bash
# Bootstrap script to install Django and start a minimal app
set -e
sudo yum update -y
sudo yum install -y python3 python3-pip
python3 -m pip install --user django
cd /home/ec2-user
python3 -m django startproject mysite
cd mysite
python3 manage.py migrate
nohup python3 manage.py runserver 0.0.0.0:80 &
