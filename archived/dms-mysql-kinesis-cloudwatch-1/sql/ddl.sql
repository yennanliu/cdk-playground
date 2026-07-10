CREATE DATABASE mydb;
USE mydb;

CREATE TABLE users (
  id INT PRIMARY KEY,
  name VARCHAR(100),
  created_at TIMESTAMP
);