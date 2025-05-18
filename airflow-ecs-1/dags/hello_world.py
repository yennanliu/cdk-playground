from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator

# Define default arguments for the DAG
default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

# Define the DAG
dag = DAG(
    'hello_world',
    default_args=default_args,
    description='A simple hello world DAG',
    schedule_interval=timedelta(days=1),
    start_date=datetime(2023, 1, 1),
    catchup=False,
)

# Define a Python function to execute
def hello_world_function():
    print("Hello World from Airflow!")
    return "Hello World"

# Create a task using the Python operator
hello_world_task = PythonOperator(
    task_id='hello_world_task',
    python_callable=hello_world_function,
    dag=dag,
)

# Task dependencies (just one task in this case)
hello_world_task 