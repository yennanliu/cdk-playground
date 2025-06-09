from datetime import datetime
from airflow import DAG
from airflow.operators.dummy import DummyOperator

# Default arguments for the DAG
default_args = {
    'owner': 'airflow',
    'start_date': datetime(2024, 1, 1),
    'retries': 0
}

# Define the DAG
with DAG(
    dag_id='dummy_test_dag',
    default_args=default_args,
    description='A simple dummy DAG to test Airflow setup',
    schedule_interval='@daily',  # or None for manual-only
    catchup=False,
    tags=['test']
) as dag:

    # Define tasks
    start = DummyOperator(task_id='start')
    end = DummyOperator(task_id='end')

    # Task dependencies
    start >> end
