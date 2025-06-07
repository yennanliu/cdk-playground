-- Create the database (optional)
CREATE DATABASE IF NOT EXISTS company_db;
USE company_db;

-- Create a table
CREATE TABLE employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    email VARCHAR(100),
    hire_date DATE
);

-- Insert some sample data
INSERT INTO employees (first_name, last_name, email, hire_date) VALUES
('Alice', 'Smith', 'alice.smith@example.com', '2023-01-15'),
('Bob', 'Johnson', 'bob.johnson@example.com', '2022-09-20'),
('Carol', 'Williams', 'carol.williams@example.com', '2021-03-10');