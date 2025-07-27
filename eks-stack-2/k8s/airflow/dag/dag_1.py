from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator

def hello():
    print("Hello from Airflow!")

with DAG(
    dag_id="hello_world_dag",
    start_date=datetime(2023, 1, 1),
    schedule_interval="@once",  # run once
    catchup=False
) as dag:
    task = PythonOperator(
        task_id="say_hello",
        python_callable=hello
    )